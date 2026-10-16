/**
 * 流场（水动力流场）纯逻辑层：描述文件解析、几何/量纲换算、以及"粒子该怎么走"的那一步。
 *
 * <p>这里刻意不放任何 fetch / WebGL / React：量纲换算最容易出错，必须能被 vitest 直接测。
 * 着色器里的推进公式与 {@link flowAdvectionDelta} 是同一套，改一个必须改另一个。
 *
 * <h3>坐标系与纹理约定（改代码前先读这段）</h3>
 * <ul>
 *   <li>产物描述里的 {@code extent} 是 **归一化 Web 墨卡托** [0,1]：[西, y1, 东, y2]，
 *       且 y 轴与纬度反向 —— 南边的 y 值**更大**。这里统一整理成
 *       {@code west/east/south/north}，其中 {@code south > north}。</li>
 *   <li>本模块的 (s, t) 是"纹理空间"：s 向西→东（0..1），t 向**北→南**（0..1，
 *       与 PNG 行序一致，第 0 行是北）。</li>
 *   <li>流速纹理的 u/v 是**归一化值**，反归一化基准来自描述文件的 {@code flow_boundary}。</li>
 * </ul>
 */

/** 赤道处 Web 墨卡托世界的宽度（米），即地球赤道周长。 */
export const MERCATOR_WORLD_METERS = 40075016.686;

export interface FlowFieldGeometry {
  /** 归一化 Web 墨卡托包围盒：西边界。 */
  west: number;
  /** 南边界（y 值更大）。 */
  south: number;
  /** 东边界。 */
  east: number;
  /** 北边界（y 值更小）。 */
  north: number;
  /** 东向流速的反归一化基准（m/s）。 */
  uMin: number;
  uMax: number;
  /** 北向流速的反归一化基准（m/s）。 */
  vMin: number;
  vMax: number;
  /** 流速纹理网格宽度（格数，纹理像素宽是其 2 倍：每格 2 个 texel 分别装 u、v）。 */
  gridWidth: number;
  /** 流速纹理网格高度。 */
  gridHeight: number;
  /** 可用帧数。 */
  frameCount: number;
}

function num(value: unknown, label: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`流场描述文件缺少可用的 ${label}`);
  }
  return n;
}

/**
 * 解析 `/v0/bank/flow-field/{case}/description` 的返回体。
 *
 * <p>容错点：{@code extent} 的第 2、4 项谁大谁小取决于纬度方向，这里用 min/max 归一，
 * 不假设书写顺序；{@code texture_size.flow_field} 是**格数**，而实际 PNG 宽度是其 2 倍。
 */
export function parseFlowFieldGeometry(raw: any): FlowFieldGeometry {
  const extent = Array.isArray(raw?.extent) ? raw.extent.map((v: unknown) => num(v, 'extent')) : [];
  if (extent.length < 4) {
    throw new Error('流场描述文件缺少 extent');
  }
  const boundary = raw?.flow_boundary ?? {};
  const texture = raw?.texture_size?.flow_field;
  const gridWidth = num(texture?.[0], 'texture_size.flow_field[0]');
  const gridHeight = num(texture?.[1], 'texture_size.flow_field[1]');
  const frames = Array.isArray(raw?.flow_fields) ? raw.flow_fields.length : 0;

  const geometry: FlowFieldGeometry = {
    west: Math.min(extent[0], extent[2]),
    east: Math.max(extent[0], extent[2]),
    south: Math.max(extent[1], extent[3]),
    north: Math.min(extent[1], extent[3]),
    uMin: num(boundary.u_min, 'flow_boundary.u_min'),
    uMax: num(boundary.u_max, 'flow_boundary.u_max'),
    vMin: num(boundary.v_min, 'flow_boundary.v_min'),
    vMax: num(boundary.v_max, 'flow_boundary.v_max'),
    gridWidth,
    gridHeight,
    frameCount: frames,
  };

  if (!(geometry.east > geometry.west) || !(geometry.south > geometry.north)) {
    throw new Error('流场描述文件的 extent 不是一个有效包围盒');
  }
  if (!(geometry.uMax > geometry.uMin) || !(geometry.vMax > geometry.vMin)) {
    throw new Error('流场描述文件的流速区间无效');
  }
  if (!(geometry.gridWidth > 0) || !(geometry.gridHeight > 0)) {
    throw new Error('流场描述文件的纹理尺寸无效');
  }
  return geometry;
}

/** 纬度（度）→ 归一化 Web 墨卡托 y。与生成端 `MercatorCoordsFromLonLat` 同一公式。 */
export function mercatorYFromLat(latDeg: number): number {
  const lat = (latDeg * Math.PI) / 180;
  return (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + lat / 2))) / 360;
}

/** 归一化 Web 墨卡托 y → 纬度（度）。 */
export function latFromMercatorY(y: number): number {
  const inner = Math.PI * (1 - 2 * y);
  return (Math.atan(Math.sinh(inner)) * 180) / Math.PI;
}

/** 该纬度处 1 个归一化墨卡托单位对应多少米（Web 墨卡托正形：两个轴向相同）。 */
export function metersPerMercatorUnit(latDeg: number): number {
  return MERCATOR_WORLD_METERS * Math.cos((latDeg * Math.PI) / 180);
}

/** 包围盒中心纬度，用于把"米/秒"换算成"归一化单位/秒"。 */
export function geometryCenterLat(geometry: FlowFieldGeometry): number {
  return latFromMercatorY((geometry.south + geometry.north) / 2);
}

/**
 * 粒子推进的换算系数：`Δ(st) = 物理流速(m/s) * advance * 时间(秒)`。
 *
 * <p>{@code x} 分量把东向流速换算成 s 的增量；{@code y} 分量把**北向**流速换算成 t 的增量
 * —— t 是南向递增的，所以这里带一个负号。把这个系数做成 uniform 而不是在着色器里现算，
 * 是为了让这段最容易错的换算只有一处实现、并且能被单测覆盖。
 */
export function advectionAdvance(geometry: FlowFieldGeometry, latDeg: number): { x: number; y: number } {
  const metersPerUnit = metersPerMercatorUnit(latDeg);
  const widthNorm = geometry.east - geometry.west;
  const heightNorm = geometry.south - geometry.north;
  return {
    x: 1 / (metersPerUnit * widthNorm),
    y: -1 / (metersPerUnit * heightNorm),
  };
}

/** 时间步 → Δs/Δt（不含 {@link advectionAdvance}）。 */
export function flowAdvectionDelta(
  velocity: { u: number; v: number },
  advance: { x: number; y: number },
  dtSeconds: number,
  speedFactor: number,
): { ds: number; dt: number } {
  return {
    ds: velocity.u * advance.x * dtSeconds * speedFactor,
    dt: velocity.v * advance.y * dtSeconds * speedFactor,
  };
}

/** 纹理空间 (s,t) → 网格索引。t 的 0 是北，而网格 iy 的 0 是南，所以要翻。 */
export function gridIndexFromTextureCoord(s: number, t: number, geometry: FlowFieldGeometry): { ix: number; iy: number } {
  const ix = Math.min(geometry.gridWidth - 1, Math.max(0, Math.floor(s * geometry.gridWidth)));
  const rowFromNorth = Math.min(geometry.gridHeight - 1, Math.max(0, Math.floor(t * geometry.gridHeight)));
  return { ix, iy: geometry.gridHeight - 1 - rowFromNorth };
}

/** 网格索引 → 纹理空间中心点。 */
export function textureCoordFromGridIndex(ix: number, iy: number, geometry: FlowFieldGeometry): { s: number; t: number } {
  return {
    s: (ix + 0.5) / geometry.gridWidth,
    t: 1 - (iy + 0.5) / geometry.gridHeight,
  };
}

/** 流速纹理里 u、v 两个 texel 的水平中心（纹理宽度是格数的 2 倍）。 */
export function velocityTexelCenters(ix: number, geometry: FlowFieldGeometry): { u: number; v: number } {
  return {
    u: (ix + 0.25) / geometry.gridWidth,
    v: (ix + 0.75) / geometry.gridWidth,
  };
}

/** 归一化流速 → 物理流速（m/s）。 */
export function denormalizeVelocity(
  normalized: { u: number; v: number },
  geometry: FlowFieldGeometry,
): { u: number; v: number } {
  return {
    u: geometry.uMin + normalized.u * (geometry.uMax - geometry.uMin),
    v: geometry.vMin + normalized.v * (geometry.vMax - geometry.vMin),
  };
}

/**
 * 由流速范围反推一个"够看"的放大倍数。
 *
 * <p>物理上 2 m/s 的流速在 68 km 宽的河里，走完整个包围盒要 9 小时 —— 直接按真实比例画
 * 屏幕上根本不会动。所以展示必须放大，这里给一个默认倍数并如实标注"视觉放大"。
 */
export const DEFAULT_SPEED_FACTOR = 2600;

/**
 * 跑完一遍全部帧（26 帧）的默认墙钟时长（毫秒）。
 *
 * <p>产物里没有真实时间步（26 个 uv 帧就是一个潮周期），所以节奏只能自己定。
 * 这里取约 420 ms/帧 —— 慢到能看清形态变化，快到不用等。
 */
export const DEFAULT_FRAME_CYCLE_MS = 11000;

/** 连续相位解算出来的帧游标。 */
export interface FlowFrameCursor {
  /** 当前帧（向下取整）。 */
  frame: number;
  /** 下一帧（循环回到 0）。 */
  nextFrame: number;
  /** 在 frame → nextFrame 之间的插值进度，[0,1)。 */
  progress: number;
}

/**
 * 推进"连续帧相位"。
 *
 * <p>为什么要有相位而不是整数帧号：产物给的是离散的 26 个速度场，硬切帧会让流速**跳变**，
 * 粒子看上去是一顿一顿的。真实做法是在相邻两帧之间做线性插值（参考实现也是这么做的），
 * 于是帧号必须是连续的实数，整数部分选纹理、小数部分是插值权重。
 *
 * @param phase 当前相位，取值域 [0, frameCount)
 * @param elapsedMs 本次推进的墙钟毫秒
 * @param frameCount 帧总数
 * @param cycleMs 跑完一整轮要多少毫秒
 */
export function advanceFlowPhase(
  phase: number,
  elapsedMs: number,
  frameCount: number,
  cycleMs: number,
): number {
  if (!(frameCount > 0)) return 0;
  const msPerFrame = Math.max(1, cycleMs) / frameCount;
  const next = phase + Math.max(0, elapsedMs) / msPerFrame;
  const wrapped = next % frameCount;
  return wrapped < 0 ? wrapped + frameCount : wrapped;
}

/** 连续相位 → (当前帧, 下一帧, 帧内插值进度)。 */
export function resolveFlowFrame(phase: number, frameCount: number): FlowFrameCursor {
  if (!(frameCount > 0)) return { frame: 0, nextFrame: 0, progress: 0 };
  const wrapped = ((phase % frameCount) + frameCount) % frameCount;
  const frame = Math.min(frameCount - 1, Math.floor(wrapped));
  return { frame, nextFrame: (frame + 1) % frameCount, progress: wrapped - frame };
}

/** 包围盒在地面上的实际尺寸（米），用于界面提示与速度倍数的合理性自检。 */
export function geometryGroundSize(geometry: FlowFieldGeometry): { widthMeters: number; heightMeters: number } {
  const metersPerUnit = metersPerMercatorUnit(geometryCenterLat(geometry));
  return {
    widthMeters: (geometry.east - geometry.west) * metersPerUnit,
    heightMeters: (geometry.south - geometry.north) * metersPerUnit,
  };
}

/** 由流速范围给出一条人类可读的量程说明，例如 "0.0 – 4.5 m/s"。 */
export function describeSpeedRange(geometry: FlowFieldGeometry): string {
  const max = Math.max(Math.abs(geometry.uMin), Math.abs(geometry.uMax), Math.abs(geometry.vMin), Math.abs(geometry.vMax));
  return `0 – ${max.toFixed(1)} m/s`;
}

// ==================== 配色（流速大小 → 颜色） ====================

/**
 * 配色的唯一事实源。
 *
 * <p>色带是**纯数据**：这里的 stop 会被烘成一张 {@link FLOW_COLOR_LUT_SIZE}×1 的查找纹理，
 * 着色器只做一次 `textureLod` 采样。好处有三：
 * <ol>
 *   <li>换配色只是重传 **1 KB** 纹理，不重编着色器、不动粒子状态；</li>
 *   <li>色带怎么插值、端点怎么处理全部在 TS 里，能被 vitest 直测（着色器里的分支测不到）；</li>
 *   <li>加一套配色 = 往数组里加一条，没有别的改动。</li>
 * </ol>
 *
 * <p>分量的取值约定：**sRGB 0..255**（不是 0..1 的线性值）。LUT 直接按这个值写字节，
 * 所以面板上画的预览色与地图上出现的颜色一定一致。
 */
export interface FlowColorStop {
  /** 位置，[0,1]，必须单调递增且首尾为 0 / 1。 */
  at: number;
  /** sRGB 分量 0..255。 */
  rgb: [number, number, number];
}

export interface FlowColorScheme {
  id: FlowColorSchemeId;
  /** 面板上的短名。 */
  label: string;
  /** 面板 button 的 tooltip：说清这套色带"在什么底图上更清楚"。 */
  hint: string;
  /** 从"最慢"到"最快"的色标。 */
  stops: FlowColorStop[];
}

export type FlowColorSchemeId = 'classic' | 'spectral' | 'thermal' | 'amber';

/**
 * 四套配色，覆盖四类底图场景。
 *
 * <p>`classic` 就是原来硬编码在着色器里的那条色带（深蓝 → 青 → 近白）按 8 bit 取整后的结果，
 * 因此默认配色与改动前**逐像素一致**，不是"顺手改了个观感"。
 */
export const FLOW_COLOR_SCHEMES: readonly FlowColorScheme[] = [
  {
    id: 'classic',
    label: '经典蓝',
    hint: '深蓝→青→近白，浅色底图上最干净（默认）',
    stops: [
      { at: 0, rgb: [10, 77, 217] },
      { at: 0.5, rgb: [26, 204, 250] },
      { at: 1, rgb: [230, 252, 255] },
    ],
  },
  {
    id: 'spectral',
    label: '光谱',
    hint: '蓝→青→绿→黄→红；色标偏向低流速段，慢流与急流一眼分得开',
    // 色标为什么不是均匀铺开的：这条河里粒子绝大多数是慢流。实测曲线中位流速约 0.53 m/s，
    // 而 u_speedCeiling = 3 m/s ⇒ **绝大多数粒子落在 ratio ≈ 0.1~0.3**。
    // 均匀铺的彩虹在这个区间里只有蓝→青，与「经典蓝」几乎同色（实测平均色相只差 2°，
    // 等于这个按钮按下去看不出区别）。把绿/黄两档提前到 0.30 / 0.58，
    // 才能让"数据实际待着的那一段"落在可分辨的色相跨度上。
    stops: [
      { at: 0, rgb: [28, 63, 148] },
      { at: 0.08, rgb: [15, 155, 215] },
      { at: 0.22, rgb: [47, 191, 106] },
      { at: 0.5, rgb: [242, 197, 61] },
      { at: 1, rgb: [226, 69, 60] },
    ],
  },
  {
    id: 'thermal',
    label: '热力',
    hint: '深紫→洋红→橙→浅黄，与青绿色的水体对比最强',
    stops: [
      { at: 0, rgb: [42, 10, 69] },
      { at: 0.35, rgb: [142, 26, 110] },
      { at: 0.65, rgb: [232, 86, 42] },
      { at: 1, rgb: [255, 240, 168] },
    ],
  },
  {
    id: 'amber',
    label: '暖金',
    hint: '深褐→金→米白，落在偏蓝的遥感影像上最跳',
    stops: [
      { at: 0, rgb: [74, 42, 5] },
      { at: 0.5, rgb: [224, 155, 18] },
      { at: 1, rgb: [255, 248, 221] },
    ],
  },
];

export const DEFAULT_FLOW_COLOR_SCHEME: FlowColorSchemeId = 'classic';

/** 配色查找纹理的宽度（texel 数）。256 级足够，人眼也看不出 8 bit 量化。 */
export const FLOW_COLOR_LUT_SIZE = 256;

/** 按 id 找配色；给不出可用 id 时回退默认，绝不抛错（配色不该让整层挂掉）。 */
export function findFlowColorScheme(id: string | null | undefined): FlowColorScheme {
  const found = FLOW_COLOR_SCHEMES.find((scheme) => scheme.id === id);
  if (found) return found;
  return FLOW_COLOR_SCHEMES.find((scheme) => scheme.id === DEFAULT_FLOW_COLOR_SCHEME) ?? FLOW_COLOR_SCHEMES[0];
}

/** 在相邻两个 stop 之间线性插值。ratio 越界会被夹到 [0,1]。 */
export function sampleFlowColorRamp(scheme: FlowColorScheme, ratio: number): [number, number, number] {
  const stops = scheme.stops;
  if (stops.length === 0) return [255, 255, 255];
  if (stops.length === 1) return [...stops[0].rgb] as [number, number, number];

  // 先夹再判 NaN：这样 +∞ 落到末色、-∞ 落到首色，而不是两个都当成 0
  const clamped = Math.min(1, Math.max(0, ratio));
  const r = Number.isNaN(clamped) ? 0 : clamped;
  // 找到 ratio 落在哪一段：第一个 at >= r 的 stop 是右端
  const upper = stops.findIndex((stop) => stop.at >= r);
  // r 比最后一个 stop 还靠右（色带末端没到 1 时会走到这里）⇒ 取末色，不能落到首色
  if (upper < 0) return [...stops[stops.length - 1].rgb] as [number, number, number];
  if (upper === 0) return [...stops[0].rgb] as [number, number, number];

  const a = stops[upper - 1];
  const b = stops[upper];
  const span = b.at - a.at;
  const w = span <= 0 ? 0 : (r - a.at) / span;
  return [
    a.rgb[0] + (b.rgb[0] - a.rgb[0]) * w,
    a.rgb[1] + (b.rgb[1] - a.rgb[1]) * w,
    a.rgb[2] + (b.rgb[2] - a.rgb[2]) * w,
  ];
}

/**
 * 把色带烘成 RGBA8 的查找表（长度 `size * 4`）。
 *
 * <p>alpha 恒为 255：这张纹理只用来取颜色，粒子亮度由 `u_particleAlpha` 管，
 * 两者混在一起会很难调。上传时必须走 `texImage2D(..., UNSIGNED_BYTE, lut)` 这条
 * 原始字节通道 —— 这样不受任何色彩管理影响，字节就是屏幕上出现的值。
 */
export function buildFlowColorLut(scheme: FlowColorScheme, size: number = FLOW_COLOR_LUT_SIZE): Uint8Array {
  const width = Math.max(2, Math.floor(size));
  const lut = new Uint8Array(width * 4);
  for (let i = 0; i < width; i += 1) {
    const [r, g, b] = sampleFlowColorRamp(scheme, i / (width - 1));
    const o = i * 4;
    lut[o] = Math.round(Math.min(255, Math.max(0, r)));
    lut[o + 1] = Math.round(Math.min(255, Math.max(0, g)));
    lut[o + 2] = Math.round(Math.min(255, Math.max(0, b)));
    lut[o + 3] = 255;
  }
  return lut;
}

/** 面板按钮的背景：直接用同一份 stop 画 CSS 渐变，预览与实际渲染同源。 */
export function flowColorSchemeGradient(scheme: FlowColorScheme): string {
  const stops = scheme.stops
    .map((stop) => `rgb(${stop.rgb[0]}, ${stop.rgb[1]}, ${stop.rgb[2]}) ${(stop.at * 100).toFixed(1)}%`)
    .join(', ');
  return `linear-gradient(90deg, ${stops})`;
}
