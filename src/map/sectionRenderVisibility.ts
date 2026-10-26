/**
 * 结果页「断面 / 岸段着色」的可见性口径。
 *
 * 规则只有一条：**4 个风险等级（含低风险）在色带上实色上色；「无风险值」不上实色，
 * 但用灰色虚线显示出来。**
 *
 *   - 低风险（显示等级 0 = `risk_level` 1，绿）：**2026-10-26 起改为正常着色**。
 *     此前（2026-10-20）它被刻意留空，理由是「预警图只留需要处理的部分」；实际使用中
 *     那样会让人误以为低风险段没有数据，且绿色图例与图面矛盾。现在四个等级一视同仁。
 *   - 无风险值（断面未计算 / 计算失败 / 结果里没有 `result`）：**色带留空 + 灰色虚线**。
 *     2026-10-26 二次调整：此前它在地图上整段消失，用户看不到「这里还有一条岸段」，
 *     也就无从发现该去哪个断面做人工评定。现在改成「看得见、但不是一种等级」：
 *
 *     * **不进 `line-gradient`** —— 灰色实色会被读成第 5 个等级，而且会被相邻区间的颜色
 *       插值污染。所以 `buildRiskBandSpans` 里它仍是 `TRANSPARENT_RISK_COLOR`。
 *     * **另外单独一层画**（结果页 `bankline-nodata-*` / `sections-nodata-line`），
 *       样式是 `NO_DATA_RISK_COLOR` + **虚线**。虚线是「没数」的唯一视觉标记，
 *       四个等级永远是实线 —— 这个区分必须保留，否则图上又多一个"看起来像等级"的颜色。
 *
 *     低风险与「无风险值」是两件事，代码里必须继续分开（见 `shouldRenderRisk` 的两个条件）。
 *
 * ## 关键：岸段色带必须「整段」留空，而不是「整点」留空
 *
 * 第一版实现只在不渲染的断面**所在位置**插一个透明 stop，结果该断面两侧被相邻可见断面的
 * 实色继续插值填充 —— 透明点宽度不到 1 像素，肉眼完全看不出来，
 * 表现就是「断面没了，岸段还是花的」。这条坑与「哪些等级算可渲染」无关，
 * 只要还存在「不渲染的断面」（现在 = 无风险值那条），就必须按区间处理。
 *
 * 所以把断面当作**抽样点**，按「最近断面」把岸段切成首尾相接的区间（Voronoi 式）：
 * 断面 i 管辖 [中点到中点] 这一段岸线。区间内填**纯色**（不再是跨断面渐变），
 * 不渲染的断面就把管辖的整段填透明。
 *
 *   - 好处 1：透明是「没有这条颜色」，不是「一个透明的点」，不会被邻段颜色吃掉；
 *   - 好处 2：等级本来就只有 4 档离散值，区间内渐变其实在暗示「半档」，纯色更诚实；
 *   - 好处 3：换色是硬边，与出图端（`visualization/gradient.py`）逐像素同款。
 *   - 好处 4：透明区间正好是灰色虚线层要覆盖的区间（`collectNoDataSpans`），
 *     两层共用同一份区间划分，不会出现「实色和虚线错位」。
 *
 * 这里全是纯函数，Mapbox 表达式拼装的正确性由 `sectionRenderVisibility.test.ts` 守着。
 */

/** 隐藏用的颜色。注意必须是 **rgba(...,0)**：Mapbox 对 `transparent` 关键字支持不一致。 */
export const TRANSPARENT_RISK_COLOR = 'rgba(0, 0, 0, 0)';

/**
 * 「无风险值」在地图上的显示色。
 *
 * 三处同色（必须是同一个值，否则图例、地图、框选面板三张脸）：
 *   - 结果页地图的灰色虚线层（`sections-nodata-line` / `bankline-nodata-*`）；
 *   - 框选分析面板的「未计算」行（`areaRiskAnalysis.UNKNOWN_RISK_COLOR` 从这里取）；
 *   - 出图端的 `DEFAULT_RISK_COLOR`。
 */
export const NO_DATA_RISK_COLOR = '#94a3b8';

/** Mapbox 的 interpolate 要求 stop 严格递增；区间交界处用这点宽度完成换色（视觉上是一条硬边）。 */
const DEFAULT_GAP = 1e-5;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/**
 * 显示等级（0..3）是否值得渲染。
 *
 * 0..3 全部渲染（0 = 低风险 = 绿，2026-10-26 起上色）；只有 null / 非整数 / 越界算「没有风险值」。
 * 刻意不把非法值兜底成 0 或 1：兜底会把「没数」画成「一种等级」。
 */
export function isRiskLevelRenderable(level: number | null | undefined): boolean {
  if (level === null || level === undefined) return false;
  const n = Number(level);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 3) return false;
  return true;
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
  /** 该区间要填的颜色；不可渲染（= 无风险值）时是 `TRANSPARENT_RISK_COLOR`。 */
  color: string;
  level: number | null;
  /** 该断面是否需要渲染（决定这段岸线是实色还是留空）。0..3 全为 true，只有无风险值为 false。 */
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
 * 断面三个图层的 Mapbox 过滤表达式（结果页 `sections-*`）。
 *
 * 拆成函数而不是散在页面里，是因为三者必须**严格互补**：
 *   - `solid` + `noData` 恰好覆盖全部断面 → 任何一个断面都不会既看不见又摸不到；
 *   - `hit` 完全不看 `noData` → 无数据断面也点得开（那是人工评定的入口）。
 *
 * 2026-10-26 之前 `hit` 里挂着 `['!=', ['get','hidden'], true]`，于是无数据断面
 * 被静默过滤掉：地图上看不见、鼠标也点不到，用户根本找不到该去哪条断面上补数据。
 * 谁要是想把「不可见就不能点」的写法加回来，先看 `sectionRenderVisibility.test.ts`。
 */
export function sectionLayerFilters(): { solid: unknown; noData: unknown; hit: unknown } {
  return {
    solid: ['!=', ['get', 'noData'], true],
    noData: ['==', ['get', 'noData'], true],
    hit: ['has', 'id'],
  };
}

/**
 * 从区间划分里挑出「无风险值」的那些段。
 *
 * 结果页用它生成灰色虚线层：色带上这些段是透明的（什么都没有），虚线层负责把
 * 「这里有一条岸段、但还没有数据」画出来。两份几何共用同一次 `buildRiskBandSpans`，
 * 所以虚线区间与透明区间**必然**严丝合缝 —— 别在页面里另算一套切分。
 */
export function collectNoDataSpans(spans: RiskBandSpan[]): RiskBandSpan[] {
  return spans.filter(span => !span.visible);
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
