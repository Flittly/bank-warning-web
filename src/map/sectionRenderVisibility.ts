/**
 * 结果页「断面 / 岸段着色」的可见性口径（2026-10-20 需求，2026-10-20 二次修订）。
 *
 * 规则只有一条：**低风险 与 无风险值 都不画**。
 *
 *   - 低风险（显示等级 0 = `risk_level` 1）不再用绿色铺满河岸 —— 预警图只留需要处理的部分；
 *   - 无风险值（断面未计算 / 计算失败 / 结果里没有 `result`）不再兜底成灰色实线 ——
 *     灰色最容易被读成「一种等级」，实际上它只是「没数」。
 *
 * ## 关键：岸段色带必须「整段」留空，而不是「整点」留空
 *
 * 第一版实现只在不渲染的断面**所在位置**插一个透明 stop，结果一条低风险断面两侧被
 * 相邻两条可见断面的实色继续插值填充 —— 透明点宽度不到 1 像素，肉眼完全看不出来，
 * 表现就是「断面没了，岸段还是花的」。
 *
 * 现在改为把断面当作**抽样点**，按「最近断面」把岸段切成首尾相接的区间（Voronoi 式）：
 * 断面 i 管辖 [中点到中点] 这一段岸线。区间内填**纯色**（不再是跨断面渐变），
 * 不渲染的断面就把它管辖的整段填透明。
 *
 *   - 好处 1：透明是「没有这条颜色」，不是「一个透明的点」，不会再被邻段颜色吃掉；
 *   - 好处 2：等级本来就只有 4 档离散值，区间内渐变其实在暗示「半档」，纯色更诚实；
 *   - 好处 3：低风险段自然形成断层，符合「岸段看起来像断开」的预期。
 *
 * 这里全是纯函数，Mapbox 表达式拼装的正确性由 `sectionRenderVisibility.test.ts` 守着。
 */

/** 隐藏用的颜色。注意必须是 **rgba(...,0)**：Mapbox 对 `transparent` 关键字支持不一致。 */
export const TRANSPARENT_RISK_COLOR = 'rgba(0, 0, 0, 0)';

/** Mapbox 的 interpolate 要求 stop 严格递增；区间交界处用这点宽度完成换色（视觉上是一条硬边）。 */
const DEFAULT_GAP = 1e-5;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/**
 * 显示等级（0..3）是否值得渲染。
 *
 * 0 = 低风险（绿）→ 不渲染；1..3 → 渲染。null / 非整数 / 越界一律视为「没有风险值」。
 * 刻意不把非法值兜底成 0 或 1：兜底会把「没数」画成「一种等级」。
 */
export function isRiskLevelRenderable(level: number | null | undefined): boolean {
  if (level === null || level === undefined) return false;
  const n = Number(level);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 3) return false;
  return n > 0;
}

export type SectionRiskInfoLike = {
  valid?: boolean;
  level?: number | null;
} | null | undefined;

/**
 * 断面 / 岸段是否应该被画出来。
 * `valid === false` 表示「拿不到风险值」，即使 level 有值也不画（两个条件必须同时成立）。
 */
export function shouldRenderRisk(info: SectionRiskInfoLike): boolean {
  if (!info || info.valid !== true) return false;
  return isRiskLevelRenderable(info.level ?? null);
}

/** 一组断面里是否还有需要渲染的 —— 岸段级判定用它决定整条色带画不画。 */
export function hasRenderableRisk(levels: Array<number | null | undefined>): boolean {
  return levels.some(level => isRiskLevelRenderable(level));
}

export type RiskGradientPoint = {
  /** 沿线上位置 0..1（`sectionProgressAlongBank` 的结果）。 */
  val: number;
  /** 显示等级 0..3；null = 无风险值。 */
  level: number | null;
  /** 该断面对应的配色（已由 `RISK_COLORS` 解析好）。 */
  color: string;
};

/** 一个断面对应的「岸段管辖区间」。 */
export type RiskBandSpan = {
  /** 区间起点（沿线比例 0..1），取与上一断面的中点；首条断面延伸到岸段起点 0。 */
  start: number;
  /** 区间终点（沿线比例 0..1），取与下一断面的中点；末条断面延伸到岸段终点 1。 */
  end: number;
  /** 该区间要填的颜色；不可渲染时是 `TRANSPARENT_RISK_COLOR`。 */
  color: string;
  level: number | null;
  /** 该断面是否需要渲染（决定这段岸线是实色还是留空）。 */
  visible: boolean;
};

/**
 * 把「断面颜色」摊成「岸段区间颜色」。
 *
 * 断面 i 管辖 `[(p[i-1]+p[i])/2, (p[i]+p[i+1])/2]`；首尾两条各自延伸到 0 / 1，
 * 避免岸段两头出现没有归属的空白。多断面几何重合时区间会被压到极小（但仍严格递增）。
 */
export function buildRiskBandSpans(points: RiskGradientPoint[]): RiskBandSpan[] {
  const sorted = points
    .filter(p => p && Number.isFinite(Number(p.val)))
    .map(p => ({
      val: clamp01(Number(p.val)),
      level: p.level ?? null,
      color: p.color,
    }))
    .sort((a, b) => a.val - b.val);

  if (sorted.length === 0) return [];

  // 区间最小宽度：只用来保证 start < end，不影响可见宽度。
  const MIN_SPAN = 1e-9;

  return sorted.map((p, i) => {
    const start = i === 0 ? 0 : (sorted[i - 1].val + p.val) / 2;
    const rawEnd = i === sorted.length - 1 ? 1 : (p.val + sorted[i + 1].val) / 2;
    const end = Math.max(clamp01(rawEnd), clamp01(start) + MIN_SPAN);
    const visible = isRiskLevelRenderable(p.level);
    return {
      start: clamp01(start),
      end: clamp01(end),
      color: visible ? p.color : TRANSPARENT_RISK_COLOR,
      level: p.level,
      visible,
    };
  });
}

/**
 * 拼 `line-gradient` 的 `interpolate` 表达式：每个区间两端各一个同色 stop，区间内即纯色；
 * 相邻区间共用边界，换色只发生在 `gap` 宽度内（硬边）。
 *
 * 返回 **null** 表示这条岸段没有任何需要渲染的断面 —— 调用方应把整个图层 visibility 关掉，
 * 不要喂一条全透明渐变（全透明渐变仍会参与命中测试、也仍然是个图层）。
 */
export function buildRiskGradientStops(
  points: RiskGradientPoint[],
  gap = DEFAULT_GAP,
): unknown[] | null {
  const spans = buildRiskBandSpans(points);
  if (spans.length === 0) return null;
  if (!spans.some(s => s.visible)) return null;

  const width = Math.max(1e-9, Math.min(0.01, gap));
  const stops: unknown[] = ['interpolate', ['linear'], ['line-progress']];

  let prev = -1;
  const push = (val: number, color: string): void => {
    let v = clamp01(val);
    if (v <= prev) v = Math.min(1, prev + width);
    if (v <= prev) return; // 已经顶到 1，放不下了
    stops.push(v, color);
    prev = v;
  };

  spans.forEach((span, i) => {
    const isLast = i === spans.length - 1;
    push(span.start, span.color);
    // 非末段在自己的右边界前收尾，交界处留 width 给下一个区间的颜色跳变。
    if (isLast) push(1, span.color);
    else push(span.end - width, span.color);
  });

  // 兜底：Mapbox 至少需要两个 stop。极端退化（全部断面挤在 1.0）时用最后一个颜色铺满。
  if (stops.length < 5) {
    const lastColor = spans[spans.length - 1].color;
    return ['interpolate', ['linear'], ['line-progress'], 0, lastColor, 1, lastColor];
  }

  return stops;
}

/** 全透明渐变：只给「图层已存在但本岸段无可渲染断面」时占位，正常路径应走 null 分支关图层。 */
export function emptyRiskGradientStops(): unknown[] {
  return ['interpolate', ['linear'], ['line-progress'], 0, TRANSPARENT_RISK_COLOR, 1, TRANSPARENT_RISK_COLOR];
}
