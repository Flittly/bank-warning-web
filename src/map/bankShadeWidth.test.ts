import { describe, expect, it } from 'vitest';
import {
  BANK_SHADE_ANCHOR_WIDTH,
  BANK_SHADE_ANCHOR_ZOOM,
  BANK_SHADE_MAX_ZOOM,
  BANK_SHADE_MIN_ZOOM,
  BANK_SHADE_WIDTH_STOPS,
  BANK_SHADE_ZOOM_IN_EXPONENT,
  BANK_SHADE_ZOOM_OUT_EXPONENT,
  bankShadeWidthAt,
  bankShadeWidthExpr,
  bankShadeWidthRaw,
} from './bankShadeWidth';

describe('bankShadeWidthRaw 目标曲线', () => {
  it('锚点处两侧公式取值相同（曲线连续、无跳变）', () => {
    const a = BANK_SHADE_ANCHOR_WIDTH * Math.pow(2, BANK_SHADE_ZOOM_OUT_EXPONENT * 0);
    const b = BANK_SHADE_ANCHOR_WIDTH * Math.pow(2, BANK_SHADE_ZOOM_IN_EXPONENT * 0);
    expect(a).toBe(b);
    expect(bankShadeWidthRaw(BANK_SHADE_ANCHOR_ZOOM)).toBe(BANK_SHADE_ANCHOR_WIDTH);
  });

  it('缩小方向按 2^0.7 收细（收得快，否则小比例尺下十几条岸段会连成一片）', () => {
    expect(bankShadeWidthRaw(6) / bankShadeWidthRaw(7)).toBeCloseTo(Math.pow(2, -0.7), 10);
    expect(bankShadeWidthRaw(5) / bankShadeWidthRaw(6)).toBeCloseTo(Math.pow(2, -0.7), 10);
  });

  it('放大方向按 2^0.1 变宽（收得慢，否则 zoom 8~10 岸段之间只有几十像素，一加宽就连片）', () => {
    expect(bankShadeWidthRaw(8) / bankShadeWidthRaw(7)).toBeCloseTo(Math.pow(2, 0.1), 10);
    expect(bankShadeWidthRaw(13) / bankShadeWidthRaw(12)).toBeCloseTo(Math.pow(2, 0.1), 10);
  });

  it('放大方向的宽度始终显著小于缩小方向的同等跨度（非对称是本模块的核心取舍）', () => {
    // 从锚点往下/往上各走 4 级：收细幅度必须远大于变宽幅度
    const shrink = bankShadeWidthRaw(3) / BANK_SHADE_ANCHOR_WIDTH;
    const grow = bankShadeWidthRaw(11) / BANK_SHADE_ANCHOR_WIDTH;
    expect(shrink).toBeLessThan(0.2);
    expect(grow).toBeGreaterThan(1.25);
    expect(1 / shrink).toBeGreaterThan(grow);
  });
});

/** 不含宽度的纯形状因子：curve(z) = ANCHOR_WIDTH · shape(z)。
 *  这个"只差一个常数倍"的性质，正是"整体加粗/减细只需改一个常量"的依据。 */
const shape = (z: number) =>
  Math.pow(
    2,
    (z <= BANK_SHADE_ANCHOR_ZOOM ? BANK_SHADE_ZOOM_OUT_EXPONENT : BANK_SHADE_ZOOM_IN_EXPONENT) *
      (z - BANK_SHADE_ANCHOR_ZOOM),
  );

describe('整体缩放口径（整条曲线与锚点宽度成正比）', () => {
  it('每个缩放级的宽度都精确等于 锚点宽度 × 形状因子', () => {
    for (const z of [3, 5, 6, 7, 8, 9, 13, 18]) {
      expect(bankShadeWidthRaw(z)).toBeCloseTo(BANK_SHADE_ANCHOR_WIDTH * shape(z), 10);
    }
  });

  it('锚点宽度是现行口径 10px（2026-10-16 由 20px 整体减半；改这个数会直接缩放整条曲线）', () => {
    expect(BANK_SHADE_ANCHOR_WIDTH).toBe(10);
  });

  it('全部停靠点都是"锚点 20px"版本的一半 —— 本次整体减半的回归锁', () => {
    for (const s of BANK_SHADE_WIDTH_STOPS) {
      const beforeHalving = 20 * shape(s.zoom);
      expect(Math.abs(s.width - beforeHalving / 2)).toBeLessThanOrEqual(0.0500001);
    }
  });

  it('减半不改变形状：缩细端与放大端的比值与锚点宽度无关', () => {
    // 两个"相对锚点"的比值必须只由指数决定，换个锚点宽度结果一样
    const ratio8 = bankShadeWidthRaw(8) / bankShadeWidthRaw(7);
    const ratio5 = bankShadeWidthRaw(5) / bankShadeWidthRaw(7);
    expect(ratio8).toBeCloseTo(Math.pow(2, 0.1), 10);
    expect(ratio5).toBeCloseTo(Math.pow(2, -0.7 * 2), 10);
  });
});

describe('bankShadeWidthStops 停靠点表', () => {
  it('覆盖 [MIN, MAX] 的全部整数缩放级，且 zoom 严格递增', () => {
    const zooms = BANK_SHADE_WIDTH_STOPS.map((s) => s.zoom);
    expect(zooms[0]).toBe(BANK_SHADE_MIN_ZOOM);
    expect(zooms[zooms.length - 1]).toBe(BANK_SHADE_MAX_ZOOM);
    expect(zooms).toEqual([...zooms].sort((a, b) => a - b));
    expect(new Set(zooms).size).toBe(zooms.length);
  });

  it('宽度严格单调递增（这正是本次要修的行为：原来在所有缩放级下都恒为 20）', () => {
    for (let i = 1; i < BANK_SHADE_WIDTH_STOPS.length; i++) {
      expect(BANK_SHADE_WIDTH_STOPS[i].width).toBeGreaterThan(BANK_SHADE_WIDTH_STOPS[i - 1].width);
    }
  });

  it('每个停靠点都贴合目标曲线（取整误差 ≤ 0.05）', () => {
    for (const s of BANK_SHADE_WIDTH_STOPS) {
      expect(Math.abs(s.width - bankShadeWidthRaw(s.zoom))).toBeLessThanOrEqual(0.05);
    }
  });

  it('相邻缩放级的比值只在锚点两侧各取两种值（1.62… 与 1.15…）', () => {
    const stopAt = (z: number) => BANK_SHADE_WIDTH_STOPS.find((s) => s.zoom === z)!.width;
    expect(stopAt(5) / stopAt(4)).toBeCloseTo(Math.pow(2, 0.7), 1);
    expect(stopAt(6) / stopAt(5)).toBeCloseTo(Math.pow(2, 0.7), 1);
    // 跨过锚点这一级是收细→变宽的转折，比值从 0.62 翻成 1.15
    expect(stopAt(7) / stopAt(6)).toBeCloseTo(Math.pow(2, 0.7), 1);
    expect(stopAt(8) / stopAt(7)).toBeCloseTo(Math.pow(2, 0.1), 1);
    expect(stopAt(13) / stopAt(12)).toBeCloseTo(Math.pow(2, 0.1), 1);
  });

  it('高缩放端不会失控（zoom 13 不到原来的 2.5 倍，避免盖住底图）', () => {
    const w13 = BANK_SHADE_WIDTH_STOPS.find((s) => s.zoom === 13)!.width;
    expect(w13).toBeGreaterThan(BANK_SHADE_ANCHOR_WIDTH);
    expect(w13).toBeLessThan(BANK_SHADE_ANCHOR_WIDTH * 2.5);
  });
});

describe('bankShadeWidthAt', () => {
  it('锚点上等于锚点宽度', () => {
    expect(bankShadeWidthAt(BANK_SHADE_ANCHOR_ZOOM)).toBe(BANK_SHADE_ANCHOR_WIDTH);
  });

  it('缩小变细、放大变宽（本次 bug 的核心断言）', () => {
    expect(bankShadeWidthAt(4)).toBeLessThan(bankShadeWidthAt(6));
    expect(bankShadeWidthAt(6)).toBeLessThan(bankShadeWidthAt(9));
    expect(bankShadeWidthAt(9)).toBeLessThan(bankShadeWidthAt(12));
    expect(bankShadeWidthAt(12)).toBeLessThan(bankShadeWidthAt(15));
  });

  it('小比例尺下明显收细（用户报的"挤在一起"发生在这一端）', () => {
    // 用相对锚点的比值断言，整体加粗/减细时不用改这个测试
    expect(bankShadeWidthAt(5)).toBeLessThan(BANK_SHADE_ANCHOR_WIDTH * 0.45);
    expect(bankShadeWidthAt(5)).toBeGreaterThan(BANK_SHADE_ANCHOR_WIDTH * 0.3);
  });

  it('范围之外取最近一端的定值（与 Mapbox interpolate 语义一致）', () => {
    const lowest = BANK_SHADE_WIDTH_STOPS[0].width;
    const highest = BANK_SHADE_WIDTH_STOPS[BANK_SHADE_WIDTH_STOPS.length - 1].width;
    expect(bankShadeWidthAt(-5)).toBe(lowest);
    expect(bankShadeWidthAt(0)).toBe(lowest);
    expect(bankShadeWidthAt(BANK_SHADE_MIN_ZOOM)).toBe(lowest);
    expect(bankShadeWidthAt(99)).toBe(highest);
    expect(bankShadeWidthAt(BANK_SHADE_MAX_ZOOM)).toBe(highest);
  });

  it('非有限值不会返回 NaN：NaN 取最低端，±Infinity 各贴对应一端', () => {
    expect(bankShadeWidthAt(NaN)).toBe(BANK_SHADE_WIDTH_STOPS[0].width);
    expect(bankShadeWidthAt(-Infinity)).toBe(BANK_SHADE_WIDTH_STOPS[0].width);
    expect(bankShadeWidthAt(Infinity)).toBe(
      BANK_SHADE_WIDTH_STOPS[BANK_SHADE_WIDTH_STOPS.length - 1].width,
    );
  });

  it('整数之间是线性插值（与 Mapbox 渲染口径逐点一致）', () => {
    const lo = BANK_SHADE_WIDTH_STOPS.find((s) => s.zoom === 9)!;
    const hi = BANK_SHADE_WIDTH_STOPS.find((s) => s.zoom === 10)!;
    expect(bankShadeWidthAt(9.25)).toBeCloseTo(lo.width + (hi.width - lo.width) * 0.25, 6);
    expect(bankShadeWidthAt(9.5)).toBeCloseTo(lo.width + (hi.width - lo.width) * 0.5, 6);
    expect(bankShadeWidthAt(9.75)).toBeCloseTo(lo.width + (hi.width - lo.width) * 0.75, 6);
  });
});

describe('bankShadeWidthExpr', () => {
  it('是 [interpolate, [linear], [zoom], z0, w0, …] 的形状', () => {
    const expr = bankShadeWidthExpr() as unknown as any[];
    expect(expr[0]).toBe('interpolate');
    expect(expr[1]).toEqual(['linear']);
    expect(expr[2]).toEqual(['zoom']);
    expect(expr.length).toBe(3 + BANK_SHADE_WIDTH_STOPS.length * 2);
  });

  it('停靠点按 zoom 升序，且宽度与 bankShadeWidthAt 在停靠点上一致', () => {
    const expr = bankShadeWidthExpr() as unknown as any[];
    const pairs: [number, number][] = [];
    for (let i = 3; i < expr.length; i += 2) pairs.push([expr[i], expr[i + 1]]);

    expect(pairs.map((p) => p[0])).toEqual([...pairs.map((p) => p[0])].sort((a, b) => a - b));
    for (const [zoom, width] of pairs) {
      expect(bankShadeWidthAt(zoom)).toBe(width);
    }
  });

  it('每次调用返回独立数组（避免 Mapbox 内部按引用比较时互相干扰）', () => {
    const a = bankShadeWidthExpr() as unknown as any[];
    const b = bankShadeWidthExpr() as unknown as any[];
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
