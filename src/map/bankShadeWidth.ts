/**
 * 结果页「岸段着色」色带（`bankline-result-*` 那条 line-gradient 图层）的线宽。
 *
 * 背景：这条色带原来写死 `'line-width': 20`。Mapbox 的 line-width 单位就是**屏幕 CSS 像素**，
 * 与比例尺无关，所以缩放时它一动不动：
 *   - 缩到小比例尺（zoom 5，@32°N 约 1px ≈ 4.1km）时，20px 相当于地面 83km 宽，
 *     而整段 312km 的岸线这时在屏幕上只有约 76px 长 —— 宽 20px 的带子贴在一个 76px 长的
 *     折线上，再叠上十几条平行岸段，整条河就糊成一条"毛毛虫"；
 *   - 放大到 zoom 13（约 1px ≈ 16m）时又只有 320m，和岸段自身尺度脱节。
 *
 * 现在改成随 zoom 变化。曲线刻意做成**以 zoom 7 为锚点、两侧指数不同**：
 *
 *   宽度 = 10 · 2^(k · (zoom − 7))     zoom ≤ 7 时 k = 0.7
 *                                      zoom >  7 时 k = 0.1
 *
 * 为什么两侧不一样（这是真机截图比出来的，不是拍脑袋）：
 *
 * - **缩小方向必须收得快**。小比例尺下十几条平行岸段在屏幕上只隔几个像素，带子一宽就互相
 *   连成一片 —— 这正是用户报的"整个岸段挤在一起"。k = 0.7 时每缩小一级宽度乘 0.62，
 *   zoom 5 时降到约 3.8px（原来的 7.6px），毛毛虫明显变细。
 * - **放大方向必须收得慢**。试过两侧都用 0.5（"标准半比例"）：zoom 13 时会涨到 160px，
 *   十几条岸段直接铺成一整片绿地毯，底图和断面线全被盖住 —— 反而比改之前更难用。
 *   k = 0.1 时 zoom 13 约 16px（锚点的 1.6 倍），既看得出"跟着比例尺变宽了"，
 *   又保住了底图与断面线的可读性。
 *
 * 也就是说：**"按比例"这件事在两端的目标是冲突的** —— 小比例尺要不遮不挤，大比例尺要不
 * 盖底图。两头都不能用纯比例（k = 1）或标准半比例，所以取这条非对称曲线。
 *
 * 【调整口径】**整条曲线的形状只由 `BANK_SHADE_ANCHOR_WIDTH` 等比缩放** ——
 * 想整体加粗/减细（例如"再细一半"），改这一个常量即可，两侧指数不用动，
 * 曲线形状与两端比值保持不变。2026-10-16 用户要求整体减半：`20 → 10`。
 */

import type { ExpressionSpecification } from 'mapbox-gl';

/** 锚点 zoom：结果页点开任务的默认视口就在 zoom ≈ 7.2，取 7 让默认视图观感最接近原样。 */
export const BANK_SHADE_ANCHOR_ZOOM = 7;

/** 锚点宽度（px）：zoom = 7 时色带的屏幕宽度。
 *  这是**整条曲线的唯一缩放因子**：曲线其余部分全是它的派生量，
 *  所以想整体加粗/减细直接改这一个数（2026-10-16 由 20 减半为 10）。 */
export const BANK_SHADE_ANCHOR_WIDTH = 10;

/** 缩小方向（zoom < 锚点）的指数：每缩小一级宽度乘 2^-0.7 ≈ 0.62 */
export const BANK_SHADE_ZOOM_OUT_EXPONENT = 0.7;
/** 放大方向（zoom > 锚点）的指数：每放大一级宽度乘 2^0.1 ≈ 1.07。
 *  刻意取得很小：zoom 8~10 这段岸段之间只有几十像素，一加宽就互相连片（实测 0.2 时
 *  zoom 9 已明显连成一片），所以放大方向只能"缓慢变宽"。 */
export const BANK_SHADE_ZOOM_IN_EXPONENT = 0.1;

/** 覆盖到实际会用的缩放范围；范围之外 Mapbox 会取最近一端的定值（与下面函数一致）。 */
export const BANK_SHADE_MIN_ZOOM = 3;
export const BANK_SHADE_MAX_ZOOM = 18;

export interface BankShadeWidthStop {
  zoom: number;
  width: number;
}

/** 目标曲线（未取整）。zoom = 锚点时两侧公式取值相同，所以曲线在锚点处连续、没有跳变。 */
export function bankShadeWidthRaw(zoom: number): number {
  const exponent =
    zoom <= BANK_SHADE_ANCHOR_ZOOM ? BANK_SHADE_ZOOM_OUT_EXPONENT : BANK_SHADE_ZOOM_IN_EXPONENT;
  return BANK_SHADE_ANCHOR_WIDTH * Math.pow(2, exponent * (zoom - BANK_SHADE_ANCHOR_ZOOM));
}

/**
 * 停靠点表。刻意取**整数 zoom 逐级打点 + 线性插值**，而不是 `['exponential', base]`：
 *
 * - Mapbox 的 exponential 用的是 `(base^Δ − 1) / (base^Δtotal − 1)` 归一化曲线，
 *   不是单纯的幂函数，手算容易和实际渲染对不上，单测就没法当契约；
 * - 线性插值 + 整数打点，`bankShadeWidthAt()` 与渲染结果**逐点精确一致**。
 *
 * 整数打点后线之间最多偏离目标曲线约 1.5%，视觉上不可辨。
 */
export const BANK_SHADE_WIDTH_STOPS: ReadonlyArray<BankShadeWidthStop> = Object.freeze(
  Array.from({ length: BANK_SHADE_MAX_ZOOM - BANK_SHADE_MIN_ZOOM + 1 }, (_, i) => {
    const zoom = BANK_SHADE_MIN_ZOOM + i;
    // 保留一位小数即可，避免表达式里塞一长串浮点尾巴
    return Object.freeze({ zoom, width: Math.round(bankShadeWidthRaw(zoom) * 10) / 10 });
  }),
);

/**
 * 某个缩放级下的色带宽度（px）。
 *
 * 语义刻意与 Mapbox `interpolate` 对齐：范围外取最近一端的定值，范围内线性插值。
 * 于是它既能给单测当期望值，也能给界面上的说明文案用。
 */
export function bankShadeWidthAt(zoom: number): number {
  const stops = BANK_SHADE_WIDTH_STOPS;
  const first = stops[0];
  const last = stops[stops.length - 1];
  // NaN 没有"最近的一端"可言，取最低端；±Infinity 则各自贴到对应那一端（与 Mapbox 一致）
  if (Number.isNaN(zoom)) return first.width;
  if (zoom <= first.zoom) return first.width;
  if (zoom >= last.zoom) return last.width;

  for (let i = 1; i < stops.length; i++) {
    const hi = stops[i];
    if (zoom > hi.zoom) continue;
    const lo = stops[i - 1];
    const span = hi.zoom - lo.zoom;
    if (span <= 0) return hi.width;
    const t = (zoom - lo.zoom) / span;
    return lo.width + (hi.width - lo.width) * t;
  }
  return last.width;
}

/**
 * 交给 Mapbox 的 `line-width` 表达式。
 *
 * 每次调用返回新数组：Mapbox 会把它存进 style，共用同一实例没必要且容易踩到引用比较。
 */
export function bankShadeWidthExpr(): ExpressionSpecification {
  const stops: unknown[] = ['interpolate', ['linear'], ['zoom']];
  for (const s of BANK_SHADE_WIDTH_STOPS) {
    stops.push(s.zoom, s.width);
  }
  return stops as unknown as ExpressionSpecification;
}
