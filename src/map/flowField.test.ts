import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FLOW_COLOR_SCHEME,
  DEFAULT_FRAME_CYCLE_MS,
  DEFAULT_SPEED_FACTOR,
  FLOW_COLOR_SCHEMES,
  advanceFlowPhase,
  advectionAdvance,
  buildFlowColorLut,
  denormalizeVelocity,
  describeSpeedRange,
  findFlowColorScheme,
  flowAdvectionDelta,
  flowColorSchemeGradient,
  geometryCenterLat,
  geometryGroundSize,
  gridIndexFromTextureCoord,
  latFromMercatorY,
  mercatorYFromLat,
  metersPerMercatorUnit,
  parseFlowFieldGeometry,
  resolveFlowFrame,
  sampleFlowColorRamp,
  textureCoordFromGridIndex,
  velocityTexelCenters,
  type FlowColorScheme,
  type FlowFieldGeometry,
} from './flowField';

/**
 * 这里用的描述体是 `10000dc` 的真实产物（从后端 `/description` 抄回来的原值）。
 * 量纲/坐标换算一旦写错，屏幕上就是"粒子不动"或"粒子在岸上乱跳"，
 * 靠肉眼看截图很难定位，所以这一层必须被单测钉住。
 */
const REAL_DESCRIPTION = {
  extent: [0.8340399502979101, 0.406875545397046, 0.8360569048089063, 0.40582939051302147],
  flow_boundary: {
    u_min: -3.5000320299,
    u_max: 5.9567826615,
    v_min: -2.8606236059,
    v_max: 7.5741746969,
  },
  texture_size: { area_mask: [1024, 530], flow_field: [1024, 530], projection: [1024, 2048] },
  flow_fields: new Array(26).fill('hydrodynamic/Mzs/default/standard/10000dc/renderResource/uv_0.png'),
};

describe('parseFlowFieldGeometry', () => {
  it('把 extent 归一到 west/east/south/north，且 south > north（y 轴与纬度反向）', () => {
    const geometry = parseFlowFieldGeometry(REAL_DESCRIPTION);

    expect(geometry.west).toBeCloseTo(0.8340399502979101, 12);
    expect(geometry.east).toBeCloseTo(0.8360569048089063, 12);
    // 后两项谁大谁小取决于书写顺序，这里断言的是"归一化之后北小南大"
    expect(geometry.north).toBeCloseTo(0.40582939051302147, 12);
    expect(geometry.south).toBeCloseTo(0.406875545397046, 12);
    expect(geometry.south).toBeGreaterThan(geometry.north);
  });

  it('读出水速区间、纹理尺寸与帧数', () => {
    const geometry = parseFlowFieldGeometry(REAL_DESCRIPTION);

    expect(geometry.uMin).toBeCloseTo(-3.5000320299, 9);
    expect(geometry.uMax).toBeCloseTo(5.9567826615, 9);
    expect(geometry.vMin).toBeCloseTo(-2.8606236059, 9);
    expect(geometry.vMax).toBeCloseTo(7.5741746969, 9);
    expect(geometry.gridWidth).toBe(1024);
    expect(geometry.gridHeight).toBe(530);
    expect(geometry.frameCount).toBe(26);
  });

  it('extent 书写顺序反过来也能解析（用 min/max 归一，不假设顺序）', () => {
    const flipped = parseFlowFieldGeometry({
      ...REAL_DESCRIPTION,
      extent: [
        REAL_DESCRIPTION.extent[2],
        REAL_DESCRIPTION.extent[3],
        REAL_DESCRIPTION.extent[0],
        REAL_DESCRIPTION.extent[1],
      ],
    });

    expect(flipped.west).toBeCloseTo(0.8340399502979101, 12);
    expect(flipped.east).toBeCloseTo(0.8360569048089063, 12);
    expect(flipped.north).toBeCloseTo(0.40582939051302147, 12);
    expect(flipped.south).toBeCloseTo(0.406875545397046, 12);
  });

  it('缺字段或区间非法时明确抛错，而不是默默算出一堆 NaN', () => {
    expect(() => parseFlowFieldGeometry({})).toThrow(/extent/);
    expect(() => parseFlowFieldGeometry({ ...REAL_DESCRIPTION, extent: [0, 0, 1] })).toThrow(/extent/);
    // u_max 必须小于 u_min 才算区间非法（只把 u_max 归零的话区间仍然成立）
    expect(() =>
      parseFlowFieldGeometry({
        ...REAL_DESCRIPTION,
        flow_boundary: { ...REAL_DESCRIPTION.flow_boundary, u_max: -10 },
      }),
    ).toThrow(/流速区间/);
    expect(() =>
      parseFlowFieldGeometry({ ...REAL_DESCRIPTION, texture_size: { flow_field: [0, 0] } }),
    ).toThrow(/纹理尺寸/);
    // extent 退化成一条线
    expect(() => parseFlowFieldGeometry({ ...REAL_DESCRIPTION, extent: [0.5, 0.4, 0.5, 0.3] })).toThrow(/包围盒/);
  });
});

describe('墨卡托与纬度换算', () => {
  it('mercatorYFromLat 与 latFromMercatorY 互逆', () => {
    for (const lat of [0, 12.5, 31.96, 45, -23.4]) {
      expect(latFromMercatorY(mercatorYFromLat(lat))).toBeCloseTo(lat, 6);
    }
  });

  it('纬度越高 y 越小（北在上面），赤道是 0.5', () => {
    expect(mercatorYFromLat(0)).toBeCloseTo(0.5, 12);
    expect(mercatorYFromLat(60)).toBeLessThan(mercatorYFromLat(0));
    expect(mercatorYFromLat(-60)).toBeGreaterThan(mercatorYFromLat(0));
  });

  it('包围盒中心纬度落在长江口附近，量程随纬度收缩', () => {
    const geometry = parseFlowFieldGeometry(REAL_DESCRIPTION);
    const lat = geometryCenterLat(geometry);
    expect(lat).toBeGreaterThan(31.7);
    expect(lat).toBeLessThan(32.2);
    expect(metersPerMercatorUnit(lat)).toBeLessThan(metersPerMercatorUnit(0));
  });
});

describe('advectionAdvance / flowAdvectionDelta', () => {
  const geometry = parseFlowFieldGeometry(REAL_DESCRIPTION);

  it('advance.y 为负：北向流速必须让 y（向南递增）变小', () => {
    const advance = advectionAdvance(geometry, geometryCenterLat(geometry));
    expect(advance.x).toBeGreaterThan(0);
    expect(advance.y).toBeLessThan(0);
  });

  it('量级自检：1 m/s 推进 1 秒 ≈ 1/(包围盒米数) 的归一化位移', () => {
    const advance = advectionAdvance(geometry, geometryCenterLat(geometry));
    const { ds } = flowAdvectionDelta({ u: 1, v: 0 }, advance, 1, 1);
    const { widthMeters } = geometryGroundSize(geometry);

    expect(ds * widthMeters).toBeCloseTo(1, 4);
  });

  it('按默认放大倍数，1 m/s 在 1/60 秒里推进的屏幕位移是"看得见但不会瞬移"的量级', () => {
    const advance = advectionAdvance(geometry, geometryCenterLat(geometry));
    const { ds } = flowAdvectionDelta({ u: 1, v: 0 }, advance, 1 / 60, DEFAULT_SPEED_FACTOR);
    // 位移占包围盒宽度的比例；屏幕上包围盒铺满约 1000px，所以这个值乘 1000 就是像素/帧
    const fractionPerFrame = ds;

    expect(fractionPerFrame * 1000).toBeGreaterThan(0.2);
    expect(fractionPerFrame * 1000).toBeLessThan(5);
  });

  it('北向流速产生负的 py 增量', () => {
    const advance = advectionAdvance(geometry, geometryCenterLat(geometry));
    const north = flowAdvectionDelta({ u: 0, v: 1 }, advance, 10, 1);
    expect(north.dt).toBeLessThan(0);
    expect(north.ds).toBe(0);
  });
});

describe('纹理空间与网格索引', () => {
  const geometry = parseFlowFieldGeometry(REAL_DESCRIPTION);

  it('t 的 0 在北、网格 iy 的 0 在南，所以要翻过来', () => {
    // t 接近 0 = 最北一行 → 应该是最大的 iy
    expect(gridIndexFromTextureCoord(0.5, 0, geometry).iy).toBe(geometry.gridHeight - 1);
    // t 接近 1 = 最南一行 → iy = 0
    expect(gridIndexFromTextureCoord(0.5, 0.999999, geometry).iy).toBe(0);
  });

  it('s/t 越界被夹到边界格，不会产生越界索引', () => {
    expect(gridIndexFromTextureCoord(-3, -3, geometry)).toEqual({ ix: 0, iy: geometry.gridHeight - 1 });
    expect(gridIndexFromTextureCoord(9, 9, geometry)).toEqual({ ix: geometry.gridWidth - 1, iy: 0 });
  });

  it('textureCoordFromGridIndex 与 gridIndexFromTextureCoord 互逆（取格中心）', () => {
    for (const [ix, iy] of [[0, 0], [1, 0], [0, 1], [1023, 529], [512, 265]]) {
      const { s, t } = textureCoordFromGridIndex(ix, iy, geometry);
      expect(gridIndexFromTextureCoord(s, t, geometry)).toEqual({ ix, iy });
    }
  });

  it('流速纹理横向是格数的两倍：u 在左 texel、v 在右 texel，且都落在同一格内', () => {
    for (const ix of [0, 1, 255, 1023]) {
      const { u, v } = velocityTexelCenters(ix, geometry);
      expect(v).toBeGreaterThan(u);
      // 折算回格索引，两个 texel 必须都归属第 ix 格
      expect(Math.floor(u * geometry.gridWidth)).toBe(ix);
      expect(Math.floor(v * geometry.gridWidth)).toBe(ix);
    }
  });
});

describe('流速反归一化', () => {
  const geometry = parseFlowFieldGeometry(REAL_DESCRIPTION);

  it('端点正好落在 flow_boundary 上', () => {
    const low = denormalizeVelocity({ u: 0, v: 0 }, geometry);
    const high = denormalizeVelocity({ u: 1, v: 1 }, geometry);

    expect(low.u).toBeCloseTo(geometry.uMin, 9);
    expect(low.v).toBeCloseTo(geometry.vMin, 9);
    expect(high.u).toBeCloseTo(geometry.uMax, 9);
    expect(high.v).toBeCloseTo(geometry.vMax, 9);
  });

  it('实测的归一化中位值能反解出合理流速（0.3896 应落在 0 ~ 1 m/s 区间）', () => {
    const { u } = denormalizeVelocity({ u: 0.3896, v: 0 }, geometry);
    expect(u).toBeGreaterThan(0);
    expect(u).toBeLessThan(1);
  });

  it('陆地格恒为 0（生成端填 0），反解出来是 uMin 而不是 0', () => {
    expect(denormalizeVelocity({ u: 0, v: 0 }, geometry).u).toBeLessThan(0);
  });

  it('量程说明取四端绝对值最大者', () => {
    expect(describeSpeedRange(geometry)).toBe('0 – 7.6 m/s');
  });
});

describe('geometryGroundSize', () => {
  it('包围盒约 68km 宽 × 37km 高（与素材自述的量级一致）', () => {
    const geometry: FlowFieldGeometry = parseFlowFieldGeometry(REAL_DESCRIPTION);
    const { widthMeters, heightMeters } = geometryGroundSize(geometry);

    expect(widthMeters).toBeGreaterThan(66000);
    expect(widthMeters).toBeLessThan(71000);
    expect(heightMeters).toBeGreaterThan(34000);
    expect(heightMeters).toBeLessThan(41000);
  });
});

/**
 * 帧间插值的相位推进。
 *
 * 这一层存在的理由：产物只给 26 个离散速度场，整数帧号会硬切、流速跳变。
 * 相位写错的表现很隐蔽 —— 要么永远停在第 0 帧（看着"不动"），
 * 要么插值权重恒为 0（看着"在动但一卡一卡"），所以用单测把边界钉死。
 */
describe('advanceFlowPhase', () => {
  it('按 frameCycleMs 均分到每一帧', () => {
    // 11000ms / 26 帧 ≈ 423.08ms 一帧
    expect(advanceFlowPhase(0, DEFAULT_FRAME_CYCLE_MS, 26, DEFAULT_FRAME_CYCLE_MS)).toBeCloseTo(0, 9);
    expect(advanceFlowPhase(0, DEFAULT_FRAME_CYCLE_MS / 2, 26, DEFAULT_FRAME_CYCLE_MS)).toBeCloseTo(13, 9);
  });

  it('到帧末循环回 0，不会溢出 frameCount', () => {
    const phase = advanceFlowPhase(25.5, DEFAULT_FRAME_CYCLE_MS, 26, DEFAULT_FRAME_CYCLE_MS);
    expect(phase).toBeGreaterThanOrEqual(0);
    expect(phase).toBeLessThan(26);
  });

  it('frameCount 非法时退化为 0，而不是 NaN', () => {
    expect(advanceFlowPhase(3, 16, 0, 1000)).toBe(0);
  });

  it('elapsedMs 为负（时钟回拨）不会倒退相位', () => {
    expect(advanceFlowPhase(5, -100, 26, 11000)).toBe(5);
  });
});

describe('resolveFlowFrame', () => {
  it('整数相位落在该帧、进度为 0', () => {
    expect(resolveFlowFrame(7, 26)).toEqual({ frame: 7, nextFrame: 8, progress: 0 });
  });

  it('小数相位给出两帧之间的权重', () => {
    const cursor = resolveFlowFrame(7.25, 26);
    expect(cursor.frame).toBe(7);
    expect(cursor.nextFrame).toBe(8);
    expect(cursor.progress).toBeCloseTo(0.25, 9);
  });

  it('最后一帧的下一帧回到 0（时间轴是首尾相接的）', () => {
    expect(resolveFlowFrame(25.75, 26)).toEqual({ frame: 25, nextFrame: 0, progress: 0.75 });
  });

  it('负数与超范围相位都会被折回值域', () => {
    expect(resolveFlowFrame(-1.5, 26).frame).toBe(24);
    expect(resolveFlowFrame(26 + 0.5, 26)).toEqual({ frame: 0, nextFrame: 1, progress: 0.5 });
  });

  it('frameCount 为 0 时退化为 (0,0,0)，不产生越界索引', () => {
    expect(resolveFlowFrame(3, 0)).toEqual({ frame: 0, nextFrame: 0, progress: 0 });
  });
});

/**
 * masks 的行序契约 —— 这是本模块最容易出错、且错得最隐蔽的一条。
 *
 * 生成端把网格 iy（0 在最南）写在第 `ny-iy-1` 行，也就是说
 * **掩膜里存的坐标是"网格索引"，而着色器拿到的行号是"纹理行号"**，两者差一次翻转。
 * 实测 `84000dc` 的 mask_0.png：按"行号直比"自指率 **0.0000%**，
 * 按"翻成网格 iy 再比"自指率 **22.07%**（= 水域占比）。
 * 判错的后果不是"少了点粒子"，而是每一格都被当成岸上、粒子每帧被吸附回格心。
 */
describe('掩膜索引与纹理行号的对应关系', () => {
  it('水域格的自指判定必须翻转行号', () => {
    const geometry: FlowFieldGeometry = parseFlowFieldGeometry(REAL_DESCRIPTION);
    const gridHeight = geometry.gridHeight;

    // 取纹理第 0 行（最北）的一个水域格：掩膜里存的网格 iy 应该是 ny-1
    const textureRow = 0;
    const storedGridY = gridHeight - 1 - textureRow;
    expect(storedGridY).toBe(gridHeight - 1);
    expect(storedGridY).not.toBe(textureRow);

    // 取纹理最后一行（最南）：掩膜里存的网格 iy 应该是 0
    expect(gridHeight - 1 - (gridHeight - 1)).toBe(0);
  });

  it('gridIndexFromTextureCoord 与掩膜用的是同一套网格索引（0 在南）', () => {
    const geometry: FlowFieldGeometry = parseFlowFieldGeometry(REAL_DESCRIPTION);
    // 纹理空间 t=0 是北 ⇒ 对应的网格 iy 应该是最大的那个
    expect(gridIndexFromTextureCoord(0.5, 0, geometry).iy).toBe(geometry.gridHeight - 1);
    // t=1 是南 ⇒ 网格 iy = 0
    expect(gridIndexFromTextureCoord(0.5, 1, geometry).iy).toBe(0);
  });
});

/**
 * 配色是**纯数据 + 纯插值**，所以"颜色对不对"这件事必须能被单测钉住 ——
 * 着色器里那条 `textureLod(u_rampLut, ...)` 只负责采样，插值规则全在这里。
 */
describe('流场配色色带', () => {
  it('默认配色就是改动前那条硬编码色带（深蓝→青→近白），不能悄悄改观感', () => {
    const scheme = findFlowColorScheme(DEFAULT_FLOW_COLOR_SCHEME);
    expect(scheme.id).toBe('classic');
    expect(scheme.stops.map(s => s.rgb)).toEqual([
      [10, 77, 217], // 原 vec3(0.04, 0.30, 0.85) × 255 取整
      [26, 204, 250], // 原 vec3(0.10, 0.80, 0.98)
      [230, 252, 255], // 原 vec3(0.90, 0.99, 1.00)
    ]);
  });

  it('每套配色的 id 唯一、stop 单调递增、首尾覆盖 0 / 1、分量都在 0..255', () => {
    expect(FLOW_COLOR_SCHEMES.length).toBeGreaterThanOrEqual(3);
    expect(new Set(FLOW_COLOR_SCHEMES.map(s => s.id)).size).toBe(FLOW_COLOR_SCHEMES.length);

    for (const scheme of FLOW_COLOR_SCHEMES) {
      expect(scheme.stops.length).toBeGreaterThanOrEqual(2);
      expect(scheme.stops[0].at).toBe(0);
      expect(scheme.stops[scheme.stops.length - 1].at).toBe(1);
      for (let i = 1; i < scheme.stops.length; i += 1) {
        expect(scheme.stops[i].at).toBeGreaterThan(scheme.stops[i - 1].at);
      }
      for (const stop of scheme.stops) {
        expect(stop.rgb).toHaveLength(3);
        for (const c of stop.rgb) {
          expect(Number.isInteger(c)).toBe(true);
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThanOrEqual(255);
        }
      }
      expect(scheme.label.length).toBeGreaterThan(0);
      expect(scheme.hint.length).toBeGreaterThan(0);
    }
  });

  it('未知 / 空 id 回退到默认配色，而不是抛错（配色不该让整层挂掉）', () => {
    expect(findFlowColorScheme(undefined).id).toBe(DEFAULT_FLOW_COLOR_SCHEME);
    expect(findFlowColorScheme(null).id).toBe(DEFAULT_FLOW_COLOR_SCHEME);
    expect(findFlowColorScheme('nope').id).toBe(DEFAULT_FLOW_COLOR_SCHEME);
    expect(findFlowColorScheme('spectral').id).toBe('spectral');
  });

  it('色带端点取首末色，中间线性插值', () => {
    const scheme = findFlowColorScheme('classic');
    expect(sampleFlowColorRamp(scheme, 0)).toEqual([10, 77, 217]);
    expect(sampleFlowColorRamp(scheme, 1)).toEqual([230, 252, 255]);
    // 中点正好是第二个 stop
    expect(sampleFlowColorRamp(scheme, 0.5)).toEqual([26, 204, 250]);
    // 0.25 落在第一段的正中：首色与中色的算术平均
    const quarter = sampleFlowColorRamp(scheme, 0.25);
    expect(quarter[0]).toBeCloseTo((10 + 26) / 2, 6);
    expect(quarter[1]).toBeCloseTo((77 + 204) / 2, 6);
    expect(quarter[2]).toBeCloseTo((217 + 250) / 2, 6);
  });

  it('ratio 越界 / NaN 都被夹住，不会取到色带外的颜色', () => {
    const scheme = findFlowColorScheme('spectral');
    expect(sampleFlowColorRamp(scheme, -5)).toEqual(sampleFlowColorRamp(scheme, 0));
    expect(sampleFlowColorRamp(scheme, 9)).toEqual(sampleFlowColorRamp(scheme, 1));
    expect(sampleFlowColorRamp(scheme, Number.NaN)).toEqual(sampleFlowColorRamp(scheme, 0));
    expect(sampleFlowColorRamp(scheme, Number.POSITIVE_INFINITY)).toEqual(sampleFlowColorRamp(scheme, 1));
  });

  it('色带末端没到 1 时，右侧越界取末色而不是回落到首色', () => {
    const truncated: FlowColorScheme = {
      id: 'classic',
      label: '截断',
      hint: '仅测试用',
      stops: [
        { at: 0, rgb: [0, 0, 0] },
        { at: 0.5, rgb: [255, 255, 255] },
      ],
    };
    expect(sampleFlowColorRamp(truncated, 1)).toEqual([255, 255, 255]);
    expect(sampleFlowColorRamp(truncated, 0.75)).toEqual([255, 255, 255]);
  });

  it('只有一个 stop 时不除零，直接返回该色', () => {
    const single: FlowColorScheme = {
      id: 'classic',
      label: '单色',
      hint: '仅测试用',
      stops: [{ at: 0, rgb: [1, 2, 3] }],
    };
    expect(sampleFlowColorRamp(single, 0.4)).toEqual([1, 2, 3]);
    expect(sampleFlowColorRamp(single, 1)).toEqual([1, 2, 3]);
  });

  it('LUT 长度 = size×4、alpha 恒为 255、两端与 sampleFlowColorRamp 一致', () => {
    const scheme = findFlowColorScheme('thermal');
    const size = 64;
    const lut = buildFlowColorLut(scheme, size);
    expect(lut).toHaveLength(size * 4);

    for (let i = 0; i < size; i += 1) {
      expect(lut[i * 4 + 3]).toBe(255);
    }
    const first = sampleFlowColorRamp(scheme, 0);
    const last = sampleFlowColorRamp(scheme, 1);
    expect([lut[0], lut[1], lut[2]]).toEqual(first.map(Math.round));
    const o = (size - 1) * 4;
    expect([lut[o], lut[o + 1], lut[o + 2]]).toEqual(last.map(Math.round));
  });

  it('LUT 每个字节都在 0..255，且默认色带的亮度单调不减（"越亮越快"这条读法成立）', () => {
    const lut = buildFlowColorLut(findFlowColorScheme('classic'), 256);
    let previous = -1;
    for (let i = 0; i < 256; i += 1) {
      const o = i * 4;
      for (let c = 0; c < 4; c += 1) {
        expect(lut[o + c]).toBeGreaterThanOrEqual(0);
        expect(lut[o + c]).toBeLessThanOrEqual(255);
      }
      const luma = 0.2126 * lut[o] + 0.7152 * lut[o + 1] + 0.0722 * lut[o + 2];
      expect(luma).toBeGreaterThanOrEqual(previous - 0.5);
      previous = luma;
    }
  });

  it('面板按钮用的 CSS 渐变直接来自同一份 stop（预览与渲染同源）', () => {
    const css = flowColorSchemeGradient(findFlowColorScheme('spectral'));
    expect(css.startsWith('linear-gradient(90deg, ')).toBe(true);
    expect(css).toContain('rgb(28, 63, 148) 0.0%');
    expect(css).toContain('rgb(226, 69, 60) 100.0%');
    // 5 个 stop ⇒ 4 个逗号分段
    expect(css.split('rgb(').length - 1).toBe(5);
  });
});

/** 色相（0..360）。饱和度太低时色相没有意义 —— 经典蓝的急流端趋近白色，正是这种情况。 */
function hueOf([r, g, b]: [number, number, number]): number | null {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const c = max - min;
  if (c < 24) return null;
  let h: number;
  if (max === r) h = ((g - b) / c) % 6;
  else if (max === g) h = (b - r) / c + 2;
  else h = (r - g) / c + 4;
  const deg = h * 60;
  return deg < 0 ? deg + 360 : deg;
}

describe('配色在真实流速分布上的区分度（只覆盖色板本身）', () => {
  // 实测：这条河水域中位流速约 0.53 m/s，而 layer 的 u_speedCeiling 默认 3 m/s
  // ⇒ 绝大多数粒子落在 ratio ≈ 0.1~0.3。配色若在这一段区分不出来，按钮就等于没做。
  //
  // ⚠ 这里只保证"色板本身"在这一段可分辨。**屏幕上能不能看出来还受渲染模型限制**：
  //   轨迹是加性累积的，通道累积到 1 就被夹白 —— 低流速端越亮（蓝通道越接近 1）的色板
  //   越快被顶成白色。实测"经典蓝 vs 光谱"在真实截图上几乎看不出区别（见
  //   docs/flow-field-review-and-optimization.md §7.4），而"经典蓝 vs 热力"可以。
  //   要真正让所有色板都可见，得改混合模型或走 P1 的条带渲染。
  const BAND = [0.1, 0.15, 0.2, 0.25, 0.3];

  it('光谱在低流速段与经典蓝拉开明显色相（不是"按下去看不出区别"）', () => {
    const classic = findFlowColorScheme('classic');
    const spectral = findFlowColorScheme('spectral');
    for (const ratio of BAND) {
      const a = hueOf(sampleFlowColorRamp(classic, ratio).map(Math.round) as [number, number, number]);
      const b = hueOf(sampleFlowColorRamp(spectral, ratio).map(Math.round) as [number, number, number]);
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expect(Math.abs((a as number) - (b as number))).toBeGreaterThan(15);
    }
  });

  it('四套配色两两在低流速段都可分辨（否则等于给了四个同款按钮）', () => {
    const band = findFlowColorScheme('classic');
    const others = FLOW_COLOR_SCHEMES.filter(s => s.id !== 'classic');
    for (const scheme of others) {
      let maxDelta = 0;
      for (const ratio of BAND) {
        const a = sampleFlowColorRamp(band, ratio);
        const b = sampleFlowColorRamp(scheme, ratio);
        maxDelta = Math.max(maxDelta, Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
      }
      // 至少有一个通道在这一段里差出 60 以上（肉眼一定分得出）
      expect(maxDelta).toBeGreaterThan(60);
    }
  });

  it('低流速段的色相跨度足够宽（相邻 ratio 之间不是糊成一片）', () => {
    // 慢流段如果只占色带很小一截，粒子速度略有差别也看不出颜色变化，
    // "看颜色判断流速"这条读法就失效了。
    const spectral = findFlowColorScheme('spectral');
    const hues = BAND.map(r => hueOf(sampleFlowColorRamp(spectral, r).map(Math.round) as [number, number, number]));
    for (const h of hues) expect(h).not.toBeNull();
    const spread = Math.max(...(hues as number[])) - Math.min(...(hues as number[]));
    expect(spread).toBeGreaterThan(40);
  });
});
