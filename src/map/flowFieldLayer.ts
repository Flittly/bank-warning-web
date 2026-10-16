import type { CustomLayerInterface, Map as MapboxMap } from 'mapbox-gl';
import {
  DEFAULT_FRAME_CYCLE_MS,
  DEFAULT_SPEED_FACTOR,
  FLOW_COLOR_LUT_SIZE,
  advectionAdvance,
  advanceFlowPhase,
  buildFlowColorLut,
  findFlowColorScheme,
  geometryCenterLat,
  resolveFlowFrame,
  type FlowColorSchemeId,
  type FlowFieldGeometry,
} from './flowField';
import { fetchFlowFieldMaskBitmap, fetchFlowFieldVelocityBitmap } from '../services/flowFieldApi';

/**
 * 流场粒子图层 —— mapbox custom WebGL layer（`renderingMode: '2d'`）。
 *
 * <h3>它到底在算什么</h3>
 * 每颗粒子的状态放在一张 **RGBA32F 状态纹理**里（乒乓两张、每帧交替）：
 * {@code xy} = 位置（extent 空间归一化 [0,1]，`x` 西→东、`y` 北→南），
 * {@code zw} = 该颗粒子固定的随机数（出界重生用，固定值才不会每帧乱跳）。
 * 每帧跑三个 pass：
 * <ol>
 *   <li><b>advance</b>：全屏 pass，逐颗粒子在流速场里推进一格（GPU 端积分）。</li>
 *   <li><b>points</b>：把粒子画成一堆 `gl.POINTS`，颜色按流速大小上色，叠加到一张
 *       **屏幕空间残影纹理**上；残影纹理每帧先整体乘一个衰减系数，于是轨迹自然拖尾。</li>
 *   <li><b>composite</b>：把残影纹理贴到 mapbox 的画布上。</li>
 * </ol>
 *
 * <h3>为什么残影要放离屏 FBO，而不直接在 mapbox 画布上叠</h3>
 * 拖尾靠"不清屏 + 半透明衰减"实现，如果在共享的 mapbox 画布上做衰减，
 * 会把底图一起变暗。所以粒子画进自己的 FBO，最后只做一次合成。
 * 代价是残影是**屏幕空间**的：相机一动，旧的轨迹就会错位，所以矩阵一变就整张清掉。
 *
 * <h3>几个必须记住的实现细节</h3>
 * <ul>
 *   <li>流速纹理 `uv_N.png` 每格 **2 个 texel**（先 u 后 v），每个 texel 的 RGBA 字节按
 *       **小端**拼成一个 `float32`（归一化流速）—— 着色器里用 `uintBitsToFloat` 还原。
 *       因此上传时必须关掉 `UNPACK_PREMULTIPLY_ALPHA_WEBGL` 与
 *       `UNPACK_COLORSPACE_CONVERSION_WEBGL`，任何一个开着都会改掉字节。</li>
 *   <li>`mask_0.png` 每像素存一对 16 位**大端**索引 `ix=(R<<8)|G`、`iy=(B<<8)|A`，
 *       且 `iy` 的 0 在**南**（生成端写的是 `(ny-iy-1)` 行）。水域格存自己的坐标、
 *       陆域格存一个随机水域格坐标 —— 这就是"粒子飘上岸就重生"的查找表。
 *       **坑（实测踩过）**：判定"这一格是不是水"时，必须把纹理行号翻成网格 iy 再去比，
 *       否则每一格都会被判成岸上、粒子每帧被吸附回格心，看上去还在亮但其实完全不流动。</li>
 *   <li>26 个 `uv_N.png` 是**离散**的速度场，相邻帧之间要做线性插值（见
 *       `FlowFieldOptions.frameCycleMs`），硬切帧会让流速跳变。</li>
 *   <li>纹理 `t` 的 0 是**北**（PNG 第 0 行），而粒子 `y` 的 0 也是北，所以
 *       `t = y` 直接可用；但网格索引 `iy = gridHeight - 1 - floor(t * gridHeight)` 要翻。</li>
 *   <li>相机矩阵 `matrix` 直接把**归一化墨卡托 [0,1]** 映射到裁剪空间，所以
 *       `mercX = west + x*(east-west)`、`mercY = north + y*(south-north)` 之后
 *       直接 `matrix * vec4(mercX, mercY, 0, 1)` 即可，不需要自己造 MVP。</li>
 *   <li>配色（`colorScheme`）不在着色器里写死，而是烘成一张 256×1 的查找纹理
 *       `u_rampLut`（见 `flowField.ts` 的 `FLOW_COLOR_SCHEMES`）。换配色只重传 1 KB，
 *       不重编着色器、不重建图层。顶点阶段取值必须用 `textureLod(..., 0.0)` ——
 *       顶点着色器没有屏幕空间导数，用 `texture()` 行为不确定。</li>
 * </ul>
 */

/** 全屏三角带顶点：位置 + uv（uv 的 0 在左下，与 FBO 纹理行序一致）。 */
const QUAD_VERT_SRC = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

/**
 * 流速读取公共段：两帧间插值 + 反归一化。advance 与 points 两个 pass 共用，避免两份实现漂移。
 *
 * <p>`unpackVelocity` / `sampleNormCell` 都**把 sampler 当参数传**（GLSL ES 3.00 允许），
 * 这样"当前帧"与"下一帧"走同一份解码代码，不会出现一处对小端、一处对大端的漂移。
 */
const VELOCITY_UTILS_SRC = `uniform sampler2D u_velocity;
uniform sampler2D u_velocityNext;
uniform float u_progress;
uniform vec2 u_gridSize;
uniform vec2 u_velocityRangeMin;
uniform vec2 u_velocityRangeSpan;

/** 从某张打包纹理的某个 texel 里，把小端字节拼回的 float32 取出来。 */
float unpackVelocity(sampler2D tex, ivec2 coord) {
  uvec4 t = uvec4(clamp(texelFetch(tex, coord, 0) * 255.0 + 0.5, vec4(0.0), vec4(255.0)));
  uint raw = t.r | (t.g << 8u) | (t.b << 16u) | (t.a << 24u);
  return uintBitsToFloat(raw);
}

/** 取某张纹理里某个格的归一化流速（u 在偶 texel、v 在奇 texel）。 */
vec2 sampleNormCell(sampler2D tex, ivec2 cell) {
  ivec2 cells = ivec2(u_gridSize);
  ivec2 c = clamp(cell, ivec2(0), cells - 1);
  return vec2(
    unpackVelocity(tex, ivec2(c.x * 2, c.y)),
    unpackVelocity(tex, ivec2(c.x * 2 + 1, c.y))
  );
}

/**
 * extent 空间位置 pos 处的水流（物理量，m/s）。
 *
 * <p>产物只有 26 个离散速度场，直接硬切帧会让流速**跳变**、粒子一顿一顿的；
 * 这里按 u_progress 在"当前帧"和"下一帧"之间做线性插值（参考实现同样如此）。
 */
vec2 sampleVelocity(vec2 pos) {
  ivec2 cell = ivec2(clamp(floor(pos * u_gridSize), vec2(0.0), u_gridSize - 1.0));
  vec2 a = sampleNormCell(u_velocity, cell);
  vec2 b = sampleNormCell(u_velocityNext, cell);
  return u_velocityRangeMin + mix(a, b, u_progress) * u_velocityRangeSpan;
}
`;

/** 推进 pass：读状态 → 取样流速 → 移一步 → 出界或落岸则重生。 */
const ADVECT_FRAG_SRC = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D u_state;
uniform sampler2D u_mask;
uniform vec2 u_advance;
uniform float u_dt;

out vec4 outState;

${VELOCITY_UTILS_SRC}

void main() {
  ivec2 slot = ivec2(gl_FragCoord.xy);
  vec4 state = texelFetch(u_state, slot, 0);
  vec2 pos = state.xy;
  vec2 seed = state.zw;

  pos += sampleVelocity(pos) * u_advance * u_dt;

  // 飘出包围盒 → 用该颗粒子固定的随机数重生（随后还要过一遍落岸判定）
  if (pos.x < 0.0 || pos.x > 1.0 || pos.y < 0.0 || pos.y > 1.0) {
    pos = seed;
  }

  // 落岸判定。掩膜里存的是**网格 iy**（生成端约定 iy=0 在最南：写在第 ny-iy-1 行），
  // 而这里的 cell.y 是**纹理行号**（0 在最北）。两者差一次翻转 —— 忘了翻就会把每一格
  // 都判成"岸上"，粒子每帧被吸附回格心，表面看还在亮但完全不流动。
  ivec2 cell = ivec2(clamp(floor(pos * u_gridSize), vec2(0.0), u_gridSize - 1.0));
  int gridY = int(u_gridSize.y) - 1 - cell.y;
  uvec4 m = uvec4(clamp(texelFetch(u_mask, cell, 0) * 255.0 + 0.5, vec4(0.0), vec4(255.0)));
  int mx = int((m.r << 8u) | m.g);
  int my = int((m.b << 8u) | m.a);
  if (mx != cell.x || my != gridY) {
    float rowFromNorth = float(int(u_gridSize.y) - 1 - my);
    pos = vec2((float(mx) + 0.5) / u_gridSize.x, (rowFromNorth + 0.5) / u_gridSize.y);
  }

  outState = vec4(pos, seed);
}
`;

/**
 * 粒子顶点着色器。
 *
 * <p>用 `gl_VertexID` 反推颗粒子落在状态纹理的哪一格，因此**不需要顶点属性缓冲**，
 * 一个 `drawArrays(gl.POINTS, 0, N)` 就画完全部粒子。
 * 注意 ES 3.00 下 `gl_PointSize` 必须在 `gl_Position` 之后、显式赋值。
 */
const POINTS_VERT_SRC = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D u_state;
uniform vec2 u_stateSize;
uniform mat4 u_matrix;
uniform vec4 u_extent;
uniform float u_pointSize;
uniform float u_speedCeiling;
uniform sampler2D u_rampLut;

out vec3 v_color;

${VELOCITY_UTILS_SRC}

void main() {
  int width = int(u_stateSize.x);
  ivec2 slot = ivec2(gl_VertexID % width, gl_VertexID / width);
  vec2 pos = texelFetch(u_state, slot, 0).xy;

  vec2 mercator = vec2(
    u_extent.x + pos.x * (u_extent.z - u_extent.x),
    u_extent.y + pos.y * (u_extent.w - u_extent.y)
  );
  gl_Position = u_matrix * vec4(mercator, 0.0, 1.0);
  gl_PointSize = u_pointSize;

  // 慢流暗 → 急流亮，阅读方向感主要靠这条色带。
  // 色带本身是一张 256×1 的查找纹理（见 flowField.ts 的 FLOW_COLOR_SCHEMES），
  // 换配色只重传 1 KB 纹理，不用重编着色器。vertex 阶段取 LOD 0：
  // 顶点着色器没有屏幕空间导数，必须用 textureLod 而不是 texture。
  float ratio = clamp(length(sampleVelocity(pos)) / u_speedCeiling, 0.0, 1.0);
  v_color = textureLod(u_rampLut, vec2(ratio, 0.5), 0.0).rgb;
}
`;

/** 粒子片元着色器：把流速写进 alpha（配合加性混合当亮度用），颜色给到 rgb。 */
const POINTS_FRAG_SRC = `#version 300 es
precision highp float;

uniform float u_particleAlpha;

in vec3 v_color;
out vec4 outColor;

void main() {
  // gl.POINTS 是方点，用一个圆形衰减把它修成柔和的光点
  vec2 offset = gl_PointCoord * 2.0 - 1.0;
  float falloff = 1.0 - smoothstep(0.35, 1.0, length(offset));
  if (falloff <= 0.0) discard;
  outColor = vec4(v_color, u_particleAlpha * falloff);
}
`;

/** 残影衰减：配合 `blendFunc(ZERO, ONE_MINUS_SRC_ALPHA)`，等价于整张乘 u_decay。 */
const FADE_FRAG_SRC = `#version 300 es
precision highp float;

uniform float u_decay;

out vec4 outColor;

void main() {
  outColor = vec4(0.0, 0.0, 0.0, 1.0 - u_decay);
}
`;

/** 合成：残影纹理是预乘形式（rgb 与 a 同步累积），所以用 ONE / ONE_MINUS_SRC_ALPHA。 */
const COMPOSITE_FRAG_SRC = `#version 300 es
precision highp float;

uniform sampler2D u_trail;

in vec2 v_uv;
out vec4 outColor;

void main() {
  outColor = texture(u_trail, v_uv);
}
`;

/** 图层 id；结果页用它判断"当前样式里有没有挂上这个图层"（切底图会整层重挂）。 */
export const FLOW_FIELD_LAYER_ID = 'flow-field-particles';

export type FlowFieldPhase = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export interface FlowFieldStatus {
  phase: FlowFieldPhase;
  caseId: string | null;
  /** 当前显示第几帧（0 基）。 */
  frame: number;
  frameCount: number;
  /** 已经下载好的帧数，用于加载进度提示。 */
  loadedFrames: number;
  fps: number;
  message?: string;
}

export interface FlowFieldLayerOptions {
  /** 粒子数，会被拆成最接近的 W×H（宽高都不超过 4096）。默认 65536。 */
  particleCount?: number;
  /** 视觉放大倍数。真实流速在这条河里走完全程要好几小时，不放大屏幕上根本不动。 */
  speedFactor?: number;
  /** 每帧残影保留比例，(0,1)，越大拖尾越长。 */
  fadeOpacity?: number;
  /** 粒子点直径（设备像素）。 */
  pointSize?: number;
  /** 色带满量程对应的流速（m/s），超过就取最亮的颜色。 */
  speedCeiling?: number;
  /** 粒子亮度。 */
  particleAlpha?: number;
  /**
   * 配色方案（见 `flowField.ts` 的 `FLOW_COLOR_SCHEMES`）。
   *
   * <p>换配色是运行时行为 —— {@link setParameters} 只会把色带重烘成 1 KB 的查找纹理，
   * **不重建图层**（重建会白丢已经下载好的 26 帧流速纹理）。
   */
  colorScheme?: FlowColorSchemeId;
  /**
   * 跑完一整轮（全部帧）的墙钟毫秒数。
   *
   * <p>产物没带真实时间步（26 帧就是一个潮周期），节奏只能自己定。相邻帧之间做插值，
   * 所以这里控制的是"整体快慢"，不会出现硬切帧的跳变。
   */
  frameCycleMs?: number;
  onStatus?: (status: FlowFieldStatus) => void;
}

/** 把粒子数拆成宽高都不超过 4096 的矩形纹理尺寸。 */
function stateGridSize(particleCount: number): { width: number; height: number } {
  const count = Math.max(1, Math.floor(particleCount));
  let width = Math.min(4096, Math.max(1, Math.round(Math.sqrt(count))));
  let height = Math.ceil(count / width);
  if (height > 4096) {
    height = 4096;
    width = Math.min(4096, Math.ceil(count / height));
  }
  return { width, height };
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('创建着色器失败');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '未知错误';
    gl.deleteShader(shader);
    throw new Error(`流场着色器编译失败：${log}`);
  }
  return shader;
}

function linkProgram(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error('创建着色器程序失败');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? '未知错误';
    gl.deleteProgram(program);
    throw new Error(`流场着色器链接失败：${log}`);
  }
  return program;
}

/** 缓存 uniform 位置查询，别每帧 `getUniformLocation`。 */
function uniformLookup(gl: WebGL2RenderingContext, program: WebGLProgram): (name: string) => WebGLUniformLocation | null {
  const cache = new Map<string, WebGLUniformLocation | null>();
  return (name: string) => {
    if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name));
    return cache.get(name) ?? null;
  };
}

/**
 * 流场粒子图层。
 *
 * <p>用法：`map.addLayer(new FlowFieldLayer())`；然后 `await layer.loadCase('84000dc')`。
 * 参数（速度倍数、粒子大小…）都走 uniform，**不要**为了改参数重建 GL 上下文 ——
 * 重建会把粒子状态和残影全丢掉。
 */
export class FlowFieldLayer implements CustomLayerInterface {
  readonly id = FLOW_FIELD_LAYER_ID;
  readonly type = 'custom' as const;
  readonly renderingMode = '2d' as const;

  private readonly options: Required<Omit<FlowFieldLayerOptions, 'onStatus'>>;
  private readonly onStatus?: (status: FlowFieldStatus) => void;

  private map: MapboxMap | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private disposed = false;

  // ---- GPU 资源 ----
  private programs: {
    advect: WebGLProgram;
    points: WebGLProgram;
    fade: WebGLProgram;
    composite: WebGLProgram;
  } | null = null;
  private quadBuffer: WebGLBuffer | null = null;
  private quadVao: WebGLVertexArrayObject | null = null;
  private emptyVao: WebGLVertexArrayObject | null = null;

  private stateTextures: [WebGLTexture, WebGLTexture] | null = null;
  private stateFbos: [WebGLFramebuffer, WebGLFramebuffer] | null = null;
  private statePingPong = 0;
  /** 状态纹理尺寸 = 粒子排布，创建后不再变（改粒子数需要重建图层）。 */
  private stateSize = { width: 0, height: 0 };

  private trailTexture: WebGLTexture | null = null;
  private trailFbo: WebGLFramebuffer | null = null;
  private trailWidth = 0;
  private trailHeight = 0;

  private velocityTextures: (WebGLTexture | null)[] = [];
  private maskTexture: WebGLTexture | null = null;

  // ---- 仿真状态 ----
  private geometry: FlowFieldGeometry | null = null;
  private caseId: string | null = null;
  private phase: FlowFieldPhase = 'idle';
  /** 当前显示的帧号（展示用的整数），由 {@link flowPhase} 取整得到。 */
  private frameIndex = 0;
  /**
   * 连续帧相位，取值域 [0, frameCount)。
   *
   * <p>为什么要连续：产物只有 26 个离散速度场，整数帧号会硬切、流速跳变。
   * 整数部分选纹理、小数部分是插值权重，这样帧与帧之间是平滑过渡。
   */
  private flowPhase = 0;
  private lastTimestamp = 0;
  private statusMessage: string | undefined;

  private fps = 0;
  private fpsWindowStart = 0;
  private fpsWindowFrames = 0;
  private lastStatusAt = 0;

  private lastMatrix: Float32Array | null = null;
  private glError: string | null = null;

  /** 配色查找纹理（256×1 RGBA8），换配色时只重传这 1 KB。 */
  private rampTexture: WebGLTexture | null = null;
  private rampDirty = true;

  /** 每次 loadCase 自增；异步回调靠它判断"是不是已经换了工况"。 */
  private loadToken = 0;
  private inFlight = new Map<number, Promise<void>>();

  constructor(options: FlowFieldLayerOptions = {}) {
    this.options = {
      particleCount: options.particleCount ?? 65536,
      speedFactor: options.speedFactor ?? DEFAULT_SPEED_FACTOR,
      fadeOpacity: options.fadeOpacity ?? 0.96,
      pointSize: options.pointSize ?? 1.8,
      speedCeiling: options.speedCeiling ?? 3,
      particleAlpha: options.particleAlpha ?? 0.35,
      frameCycleMs: options.frameCycleMs ?? DEFAULT_FRAME_CYCLE_MS,
      colorScheme: findFlowColorScheme(options.colorScheme).id,
    };
    this.onStatus = options.onStatus;
  }

  // ==================== mapbox 生命周期 ====================

  onAdd(map: MapboxMap, gl: WebGLRenderingContext): void {
    if (!(gl instanceof WebGL2RenderingContext)) {
      this.fail('当前渲染环境不是 WebGL2，无法绘制流场粒子');
      return;
    }
    this.map = map;
    const sameContext = this.gl === gl;
    this.gl = gl;
    // 切底图（setStyle）会把图层全部清掉，需要重新 addLayer ⇒ onAdd 会再跑一次。
    // 但 GL 上下文是复用的，旧资源仍然有效 —— 重建会白丢已下载的 26 帧纹理。
    if (sameContext && this.programs && this.stateTextures) {
      this.lastMatrix = null;
      map.triggerRepaint();
      return;
    }
    try {
      this.initGl(gl);
    } catch (error: any) {
      this.fail(`流场图层初始化失败：${error?.message || String(error)}`);
    }
  }

  onRemove(): void {
    this.disposeResources();
    this.map = null;
    this.gl = null;
  }

  render(gl: WebGLRenderingContext, matrix: number[]): void {
    const context = this.gl;
    if (!context || context !== gl || this.disposed) return;
    if (this.glError) return;
    if (!this.geometry || !this.programs || !this.stateTextures || !this.stateFbos) return;
    if (!this.map) return;

    try {
      this.renderFrame(context, matrix);
    } catch (error: any) {
      this.fail(`流场绘制失败：${error?.message || String(error)}`);
      return;
    }

    // 让 mapbox 下一帧继续叫我们，否则动画停在第一帧
    if (this.phase === 'playing') this.map.triggerRepaint();
  }

  // ==================== 对外 API ====================

  /** 切换工况：拉掩膜与描述对应的第 0 帧，随后后台补齐其余帧。 */
  async loadCase(caseId: string, geometry: FlowFieldGeometry): Promise<void> {
    const gl = this.gl;
    if (!gl || !this.programs) throw new Error('流场图层尚未就绪');

    const token = ++this.loadToken;
    this.caseId = caseId;
    this.geometry = geometry;
    this.frameIndex = 0;
    this.flowPhase = 0;
    this.lastTimestamp = 0;
    this.setPhase('loading', undefined);

    this.releaseFrameTextures();
    this.velocityTextures = new Array(geometry.frameCount).fill(null);

    const maskBitmap = await fetchFlowFieldMaskBitmap(caseId);
    // 卸载（StrictMode 双挂载 / 关掉流场）后这一步可能才回来：此时 GL 资源已经放掉，
    // 再上传就会漏一张纹理，所以必须同时看 disposed。
    if (this.disposed || token !== this.loadToken) {
      maskBitmap.close();
      return;
    }
    this.uploadMask(gl, maskBitmap);
    maskBitmap.close();

    await this.loadFrame(0);
    if (this.disposed || token !== this.loadToken) return;

    this.setPhase('playing', undefined);
    this.lastTimestamp = 0;
    this.map?.triggerRepaint();

    // 后台把剩下的帧补上；单帧失败不致命，播到那一帧会退回最近可用的一帧
    void this.prefetchFrames(token);
  }

  /** 暂停/继续粒子推进（保持当前帧与残影）。 */
  setPlaying(playing: boolean): void {
    if (this.phase === 'error' || this.phase === 'idle') return;
    this.setPhase(playing ? 'playing' : 'paused', this.statusMessage);
    this.lastTimestamp = 0;
    if (playing) this.map?.triggerRepaint();
  }

  /**
   * 跳到指定帧。
   *
   * <p>刻意**立刻**改帧号、把纹理加载放到后台：拖进度条时目标是即时响应，
   * 该帧还没到位就先按最近一张已加载的帧画（`resolveUsableFrame` 兜底），
   * 否则滑块会在 1MB 的下载期间看起来卡住。
   */
  seekFrame(frame: number): void {
    if (!this.geometry) return;
    const clamped = Math.max(0, Math.min(this.geometry.frameCount - 1, Math.floor(frame)));
    this.frameIndex = clamped;
    // 相位取整 ⇒ 立刻停在该帧上（progress = 0），继续播时从这一帧往下走
    this.flowPhase = clamped;
    this.lastStatusAt = 0;
    this.emitStatus(true);
    this.map?.triggerRepaint();
    if (!this.velocityTextures[clamped]) {
      void this.loadFrame(clamped).catch(() => undefined);
    }
  }

  /** 运行时调参：只改 uniform，不动 GL 资源。 */
  setParameters(patch: Partial<Omit<FlowFieldLayerOptions, 'onStatus' | 'particleCount'>>): void {
    if (patch.speedFactor !== undefined) this.options.speedFactor = patch.speedFactor;
    if (patch.fadeOpacity !== undefined) this.options.fadeOpacity = Math.max(0.5, Math.min(0.995, patch.fadeOpacity));
    if (patch.pointSize !== undefined) this.options.pointSize = patch.pointSize;
    if (patch.speedCeiling !== undefined) this.options.speedCeiling = patch.speedCeiling;
    if (patch.particleAlpha !== undefined) this.options.particleAlpha = patch.particleAlpha;
    if (patch.frameCycleMs !== undefined) {
      this.options.frameCycleMs = Math.max(500, patch.frameCycleMs);
    }
    if (patch.colorScheme !== undefined) {
      // 只标脏，真正的重传发生在下一帧绘制前 —— setParameters 可能在还没有 GL 上下文时被调用
      this.options.colorScheme = findFlowColorScheme(patch.colorScheme).id;
      this.rampDirty = true;
      this.map?.triggerRepaint();
    }
  }

  /**
   * 取当前配色的查找纹理，必要时（首次 / 换配色后）重传。
   *
   * <p>色带只有 256 个 texel，所以"换配色"的代价是一次 1 KB 的 `texImage2D`，
   * 比重编着色器、比重建图层都便宜得多。
   * 采样用 LINEAR：256 级之间再插一次，视觉上就是连续渐变。
   *
   * <p><b>调用约定</b>：内部会往"当前活动纹理单元"上 `bindTexture` + `texImage2D`，
   * 所以调用方**必须先把 `activeTexture` 切到目标单元**（见 renderFrame 里的 points pass）。
   * 顺序反了就会把查找纹理写到别的单元上，把那一格的采样源悄悄换掉 ——
   * 这种错误在画面上只表现为"颜色不对/粒子不动"，极难定位。
   */
  private ensureRampTexture(gl: WebGL2RenderingContext): WebGLTexture {
    const scheme = findFlowColorScheme(this.options.colorScheme);
    if (!this.rampTexture) {
      const texture = gl.createTexture();
      if (!texture) throw new Error('创建流场配色纹理失败');
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.rampTexture = texture;
      this.rampDirty = true;
    }
    if (this.rampDirty) {
      const lut = buildFlowColorLut(scheme, FLOW_COLOR_LUT_SIZE);
      gl.bindTexture(gl.TEXTURE_2D, this.rampTexture);
      // 走原始字节通道：字节即屏幕上的颜色，不受任何色彩管理影响
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, FLOW_COLOR_LUT_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut);
      this.rampDirty = false;
    }
    return this.rampTexture;
  }

  /** 清掉残影（相机变化后会自动调用，也可以手动）。 */
  clearTrail(): void {
    const gl = this.gl;
    if (!gl || !this.trailFbo || !this.trailTexture) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailFbo);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  get status(): FlowFieldStatus {
    return {
      phase: this.phase,
      caseId: this.caseId,
      frame: this.frameIndex,
      frameCount: this.geometry?.frameCount ?? 0,
      loadedFrames: this.velocityTextures.reduce<number>((n, t) => (t ? n + 1 : n), 0),
      fps: this.fps,
      message: this.statusMessage,
    };
  }

  /** 释放全部 GPU 资源；`onRemove` 里也会调。 */
  dispose(): void {
    this.disposed = true;
    this.disposeResources();
  }

  // ==================== 初始化 ====================

  private initGl(gl: WebGL2RenderingContext): void {
    // 粒子位置要在 [0,1] 里做连续积分，RGBA8 的精度（1/255）不够用，必须浮点渲染目标
    if (!gl.getExtension('EXT_color_buffer_float')) {
      throw new Error('显卡/驱动不支持浮点渲染目标（EXT_color_buffer_float），无法绘制流场粒子');
    }

    this.programs = {
      advect: linkProgram(gl, QUAD_VERT_SRC, ADVECT_FRAG_SRC),
      points: linkProgram(gl, POINTS_VERT_SRC, POINTS_FRAG_SRC),
      fade: linkProgram(gl, QUAD_VERT_SRC, FADE_FRAG_SRC),
      composite: linkProgram(gl, QUAD_VERT_SRC, COMPOSITE_FRAG_SRC),
    };

    // 全屏三角带（两个三角形拼成的矩形，位置在裁剪空间）
    const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    this.quadBuffer = gl.createBuffer();
    this.quadVao = gl.createVertexArray();
    gl.bindVertexArray(this.quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    const quadLoc = gl.getAttribLocation(this.programs.advect, 'a_pos');
    gl.enableVertexAttribArray(quadLoc);
    gl.vertexAttribPointer(quadLoc, 2, gl.FLOAT, false, 0, 0);
    // fade/composite 用的是各自 program 的 a_pos，位置由链接器分配，通常都是 0
    for (const program of [this.programs.fade, this.programs.composite]) {
      const loc = gl.getAttribLocation(program, 'a_pos');
      if (loc !== quadLoc) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      }
    }
    gl.bindVertexArray(null);

    // 粒子 pass 不用顶点属性，但显式绑一个空 VAO 最稳
    this.emptyVao = gl.createVertexArray();

    this.createStateTargets(gl);
    this.setPhase('idle', undefined);
  }

  /** 建状态纹理与对应的 FBO，并用随机值做初值（落岸的粒子会在第一帧被重生到水里）。 */
  private createStateTargets(gl: WebGL2RenderingContext): void {
    const { width, height } = stateGridSize(this.options.particleCount);
    this.stateSize = { width, height };
    const initial = new Float32Array(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
      initial[i * 4] = Math.random();
      initial[i * 4 + 1] = Math.random();
      initial[i * 4 + 2] = Math.random();
      initial[i * 4 + 3] = Math.random();
    }

    const textures: WebGLTexture[] = [];
    const fbos: WebGLFramebuffer[] = [];
    for (let i = 0; i < 2; i += 1) {
      const texture = gl.createTexture();
      if (!texture) throw new Error('创建流场状态纹理失败');
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, initial);
      const fbo = gl.createFramebuffer();
      if (!fbo) throw new Error('创建流场状态帧缓冲失败');
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('流场状态帧缓冲不完整，可能是设备不支持浮点渲染目标');
      }
      textures.push(texture);
      fbos.push(fbo);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.stateTextures = [textures[0], textures[1]];
    this.stateFbos = [fbos[0], fbos[1]];
    this.statePingPong = 0;
  }

  /** 残影纹理跟随画布尺寸，尺寸变了就重建（重建必然丢一次轨迹，但只在缩放时发生）。 */
  private ensureTrailTarget(gl: WebGL2RenderingContext): void {
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    if (width === 0 || height === 0) return;
    if (this.trailTexture && this.trailFbo && this.trailWidth === width && this.trailHeight === height) return;

    if (this.trailTexture) gl.deleteTexture(this.trailTexture);
    if (this.trailFbo) gl.deleteFramebuffer(this.trailFbo);

    const texture = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!texture || !fbo) throw new Error('创建流场残影缓冲失败');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('流场残影帧缓冲不完整');
    }
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.trailTexture = texture;
    this.trailFbo = fbo;
    this.trailWidth = width;
    this.trailHeight = height;
    this.lastMatrix = null;
  }

  // ==================== 纹理上传 ====================

  /**
   * 上传前必须清掉这两个 pixelStore 开关。
   *
   * <p>`uv_N.png` 里装的是 float32 的原始字节，预乘 alpha 或做色彩管理都会改掉它们，
   * 解出来的流速就是噪声。mapbox 自己会动这些状态，所以每次上传前都显式设一遍。
   */
  private prepareUnpack(gl: WebGL2RenderingContext): void {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  }

  private createPackedTexture(gl: WebGL2RenderingContext, bitmap: ImageBitmap): WebGLTexture {
    const texture = gl.createTexture();
    if (!texture) throw new Error('创建流场纹理失败');
    this.prepareUnpack(gl);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return texture;
  }

  private uploadFrameTexture(gl: WebGL2RenderingContext, frame: number, bitmap: ImageBitmap): void {
    const previous = this.velocityTextures[frame];
    if (previous) gl.deleteTexture(previous);
    this.velocityTextures[frame] = this.createPackedTexture(gl, bitmap);
  }

  private uploadMask(gl: WebGL2RenderingContext, bitmap: ImageBitmap): void {
    if (this.maskTexture) gl.deleteTexture(this.maskTexture);
    this.maskTexture = this.createPackedTexture(gl, bitmap);
  }

  private async loadFrame(frame: number): Promise<void> {
    const existing = this.inFlight.get(frame);
    if (existing) return existing;
    const token = this.loadToken;
    const caseId = this.caseId;
    if (!caseId) return;

    const task = (async () => {
      const bitmap = await fetchFlowFieldVelocityBitmap(caseId, frame);
      try {
        const gl = this.gl;
        if (token !== this.loadToken || !gl || this.disposed) return;
        this.uploadFrameTexture(gl, frame, bitmap);
        this.emitStatus(true);
      } finally {
        bitmap.close();
      }
    })().finally(() => {
      this.inFlight.delete(frame);
    });

    this.inFlight.set(frame, task);
    return task;
  }

  /** 串行补齐剩余帧，避免同时开 26 条 1MB 的请求。 */
  private async prefetchFrames(token: number): Promise<void> {
    if (!this.geometry) return;
    for (let frame = 0; frame < this.geometry.frameCount; frame += 1) {
      if (token !== this.loadToken || this.disposed) return;
      if (this.velocityTextures[frame]) continue;
      try {
        await this.loadFrame(frame);
      } catch {
        // 单帧失败不致命：播到该帧会退回最近可用的帧，并在状态里提示
        this.statusMessage = `第 ${frame} 帧加载失败`;
      }
    }
  }

  private releaseFrameTextures(): void {
    const gl = this.gl;
    if (!gl) return;
    for (const texture of this.velocityTextures) {
      if (texture) gl.deleteTexture(texture);
    }
    this.velocityTextures = [];
  }

  /** 当前帧不可用时退回最近一张已加载的（偏向往前找，找完再往后找）。 */
  private resolveUsableFrame(frame: number): number {
    if (this.velocityTextures[frame]) return frame;
    for (let i = frame; i >= 0; i -= 1) {
      if (this.velocityTextures[i]) return i;
    }
    for (let i = frame + 1; i < this.velocityTextures.length; i += 1) {
      if (this.velocityTextures[i]) return i;
    }
    return -1;
  }

  // ==================== 每帧绘制 ====================

  private renderFrame(gl: WebGL2RenderingContext, matrix: number[]): void {
    const geometry = this.geometry!;
    const programs = this.programs!;
    const stateTextures = this.stateTextures!;
    const stateFbos = this.stateFbos!;
    if (!this.maskTexture) return;

    this.ensureTrailTarget(gl);
    if (!this.trailTexture || !this.trailFbo) return;

    // 相机一变，屏幕空间的残影就错位了，整张清掉重来
    const currentMatrix = new Float32Array(matrix);
    if (this.lastMatrix && !matricesEqual(this.lastMatrix, currentMatrix)) {
      this.clearTrail();
    }
    this.lastMatrix = currentMatrix;

    const now = performance.now();
    let stepSeconds = 0;
    if (this.phase === 'playing') {
      // 限幅：切后台回来 / 掉帧时不要一步跳过大半个河段
      const elapsedMs = Math.max(1, Math.min(64, this.lastTimestamp === 0 ? 16 : now - this.lastTimestamp));
      // 真实秒数 × 视觉放大倍数：不放大时 2 m/s 在这条河里要好几小时才走完包围盒
      stepSeconds = (elapsedMs / 1000) * this.options.speedFactor;
      // 帧号连续推进，相邻两帧之间插值 —— 见 FlowFieldOptions.frameCycleMs
      this.flowPhase = advanceFlowPhase(this.flowPhase, elapsedMs, geometry.frameCount, this.options.frameCycleMs);
    }
    this.lastTimestamp = now;

    const cursor = resolveFlowFrame(this.flowPhase, geometry.frameCount);
    const usableFrame = this.resolveUsableFrame(cursor.frame);
    if (usableFrame < 0) return;
    this.frameIndex = usableFrame;

    // 只有"下一帧确实就是紧接着的那一帧且已下载"时才插值；否则宁可停在当前帧，
    // 免得某个 1 MB 的 png 还在路上时进度权重把两帧错配成倒流。
    //
    // ⚠ 这里"宁可绑同一张纹理"不只是省事，而是**必须**：着色器里的
    //   `mix(当前帧, 下一帧, progress)` 在 progress=0 时并不会忽略下一帧 —— 若下一帧
    //   是一张内容不是流速的纹理（或半加载的脏数据），把它的字节 `uintBitsToFloat`
    //   解出来可能是 NaN/Inf，而 `NaN * 0.0 = NaN` 会顺着 mix 污染整个速度矢量，
    //   表现为"粒子流速全成 NaN、颜色退回色带首色"。（离线核查脚本 flow-ramp-check.js
    //   第一次跑就是这么假失败的：脚本自己的绑定顺序写错了，产品这边没这个顺序问题。）
    const wrappedNext = (usableFrame + 1) % geometry.frameCount;
    const nextUsable = this.resolveUsableFrame(cursor.nextFrame);
    const interpolate = nextUsable === wrappedNext && Boolean(this.velocityTextures[wrappedNext]);
    const velocityTexture = this.velocityTextures[usableFrame]!;
    const velocityNextTexture = interpolate ? this.velocityTextures[wrappedNext]! : velocityTexture;
    const frameProgress = interpolate ? cursor.progress : 0;

    const stateWidth = this.stateSize.width;
    const stateHeight = this.stateSize.height;

    const lat = geometryCenterLat(geometry);
    const advance = advectionAdvance(geometry, lat);
    const rangeMin = new Float32Array([geometry.uMin, geometry.vMin]);
    const rangeSpan = new Float32Array([
      geometry.uMax - geometry.uMin,
      geometry.vMax - geometry.vMin,
    ]);

    // ---- pass 1：粒子推进（乒乓） ----
    const source = this.statePingPong;
    const target = 1 - this.statePingPong;
    gl.bindFramebuffer(gl.FRAMEBUFFER, stateFbos[target]);
    gl.viewport(0, 0, stateWidth, stateHeight);
    gl.disable(gl.BLEND);
    gl.useProgram(programs.advect);
    const advectUniform = uniformLookup(gl, programs.advect);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stateTextures[source]);
    gl.uniform1i(advectUniform('u_state'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, velocityTexture);
    gl.uniform1i(advectUniform('u_velocity'), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
    gl.uniform1i(advectUniform('u_mask'), 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, velocityNextTexture);
    gl.uniform1i(advectUniform('u_velocityNext'), 3);
    gl.uniform1f(advectUniform('u_progress'), frameProgress);
    gl.uniform2f(advectUniform('u_gridSize'), geometry.gridWidth, geometry.gridHeight);
    gl.uniform2f(advectUniform('u_velocityRangeMin'), rangeMin[0], rangeMin[1]);
    gl.uniform2f(advectUniform('u_velocityRangeSpan'), rangeSpan[0], rangeSpan[1]);
    gl.uniform2f(advectUniform('u_advance'), advance.x, advance.y);
    gl.uniform1f(advectUniform('u_dt'), stepSeconds);
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // ---- pass 2：画粒子到残影纹理 ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailFbo);
    gl.viewport(0, 0, this.trailWidth, this.trailHeight);
    gl.enable(gl.BLEND);

    // 2a. 整张乘衰减：blendFunc(ZERO, ONE_MINUS_SRC_ALPHA)，src 被丢弃、dst 乘 (1-src.a)
    gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(programs.fade);
    const fadeUniform = uniformLookup(gl, programs.fade);
    gl.uniform1f(fadeUniform('u_decay'), this.options.fadeOpacity);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 2b. 加性叠加粒子：rgb 与 a 同步累积，合成时 a 就是"覆盖强度"
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(programs.points);
    const pointUniform = uniformLookup(gl, programs.points);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stateTextures[target]);
    gl.uniform1i(pointUniform('u_state'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, velocityTexture);
    gl.uniform1i(pointUniform('u_velocity'), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, velocityNextTexture);
    gl.uniform1i(pointUniform('u_velocityNext'), 2);
    // 配色查找纹理（256×1）。先切到 3 号单元再让它绑定，否则会绑到别的单元上。
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.ensureRampTexture(gl));
    gl.uniform1i(pointUniform('u_rampLut'), 3);
    gl.uniform1f(pointUniform('u_progress'), frameProgress);
    gl.uniform2f(pointUniform('u_stateSize'), stateWidth, stateHeight);
    gl.uniform2f(pointUniform('u_gridSize'), geometry.gridWidth, geometry.gridHeight);
    gl.uniform2f(pointUniform('u_velocityRangeMin'), rangeMin[0], rangeMin[1]);
    gl.uniform2f(pointUniform('u_velocityRangeSpan'), rangeSpan[0], rangeSpan[1]);
    gl.uniformMatrix4fv(pointUniform('u_matrix'), false, currentMatrix);
    gl.uniform4f(pointUniform('u_extent'), geometry.west, geometry.north, geometry.east, geometry.south);
    gl.uniform1f(pointUniform('u_pointSize'), this.options.pointSize);
    gl.uniform1f(pointUniform('u_speedCeiling'), this.options.speedCeiling);
    gl.uniform1f(pointUniform('u_particleAlpha'), this.options.particleAlpha);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.POINTS, 0, stateWidth * stateHeight);

    // ---- pass 3：合成到 mapbox 画布 ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    // 残影是预乘形式，用 ONE / ONE_MINUS_SRC_ALPHA 才是正确的"发光"叠加
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(programs.composite);
    const compositeUniform = uniformLookup(gl, programs.composite);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.trailTexture);
    gl.uniform1i(compositeUniform('u_trail'), 0);
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);

    this.statePingPong = target;
    this.trackFps(now);
  }

  private trackFps(now: number): void {
    this.fpsWindowFrames += 1;
    if (this.fpsWindowStart === 0) this.fpsWindowStart = now;
    const span = now - this.fpsWindowStart;
    if (span >= 500) {
      this.fps = Math.round((this.fpsWindowFrames * 1000) / span);
      this.fpsWindowStart = now;
      this.fpsWindowFrames = 0;
    }
    this.emitStatus(false);
  }

  // ==================== 状态与清理 ====================

  private setPhase(phase: FlowFieldPhase, message: string | undefined): void {
    this.phase = phase;
    this.statusMessage = message;
    this.lastStatusAt = 0;
    this.emitStatus(true);
  }

  private emitStatus(force: boolean): void {
    if (!this.onStatus) return;
    const now = performance.now();
    // 结果页很大，状态每次变化都会触发一次整页重渲染，所以节流到 0.5s
    if (!force && now - this.lastStatusAt < 500) return;
    this.lastStatusAt = now;
    this.onStatus(this.status);
  }

  private fail(message: string): void {
    if (this.glError) return;
    this.glError = message;
    this.setPhase('error', message);
  }

  private disposeResources(): void {
    const gl = this.gl;
    if (!gl) return;
    if (this.stateTextures) {
      for (const texture of this.stateTextures) gl.deleteTexture(texture);
    }
    if (this.stateFbos) {
      for (const fbo of this.stateFbos) gl.deleteFramebuffer(fbo);
    }
    this.releaseFrameTextures();
    if (this.maskTexture) gl.deleteTexture(this.maskTexture);
    if (this.trailTexture) gl.deleteTexture(this.trailTexture);
    if (this.rampTexture) gl.deleteTexture(this.rampTexture);
    if (this.trailFbo) gl.deleteFramebuffer(this.trailFbo);
    if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
    if (this.quadVao) gl.deleteVertexArray(this.quadVao);
    if (this.emptyVao) gl.deleteVertexArray(this.emptyVao);
    if (this.programs) {
      for (const program of Object.values(this.programs)) gl.deleteProgram(program);
    }
    this.stateTextures = null;
    this.stateFbos = null;
    this.maskTexture = null;
    this.trailTexture = null;
    this.rampTexture = null;
    this.rampDirty = true;
    this.trailFbo = null;
    this.quadBuffer = null;
    this.quadVao = null;
    this.emptyVao = null;
    this.programs = null;
    this.inFlight.clear();
  }
}

function matricesEqual(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (Math.abs(a[i] - b[i]) > 1e-9) return false;
  }
  return true;
}
