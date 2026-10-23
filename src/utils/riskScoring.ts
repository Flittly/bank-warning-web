/**
 * 风险评估的「唯一计算口径」（前端）。
 *
 * 背景：结果页原先只有 `indicators.result`（0~1）一个数，风险等级在 `mapIndicatorResultToRiskLevel()`
 * 里用**硬编码 0.25/0.5/0.75** 现切。默认参数下没问题，但任务参数里的 `risk_thresholds.all`
 * 一旦不是默认值，地图配色就会与库里的 `risk_level`(1..4) 不一致。
 *
 * 人工修改结果这个功能必须先把口径收敛成一处，否则「改完数值 → 地图颜色」与
 * 「出图/报告读到的 risk_level」会各算各的。所以这里完整复刻
 * `bank-model-server/modelResource/multipleIndicators/riskLevel.py` 的算法：
 *
 *   water_flow_power_matrix(4×3) · wNM  ┐
 *   riverbed_evolution_matrix(4×3) · wRE ├→ concat(4×3) · wRL → result_matrix(4×1)
 *   geology_engineering_matrix(4×3) · wGE┘
 *   risk_value = result_matrix[2] + result_matrix[3]     # 3、4 档权重之和
 *   risk_level = bucket(risk_value, all) + 1             # 1..4，与库内取值一致
 *
 * 复刻是否可信由 `riskScoring.test.ts` 用**真实库记录**做副本校验兜底：
 * 拿生产记录的 raw_values + thresholds 重算，必须逐元素等于记录里已有的 matrices / result / risk_level。
 * 公式一旦漂移，那条测试立刻红。
 */

// ENUM_TIER_COLUMN（PL/LC 在 geology_engineering_matrix 里的列位）由展示层维护，
// 这里只借它做「老结果没有 raw_values 时」的最后一级兜底，避免两处各抄一份列号。
import { resolveEnumIndicatorTier } from './indicatorDisplay';

// ============================================================
//  指标定义
// ============================================================

export type RiskIndicatorKey = 'Ky' | 'PQ' | 'Zd' | 'Sa' | 'Ln' | 'Zb' | 'Dsed' | 'PL' | 'LC';

export type RiskMatrixGroup = {
  title: string;
  /** 该组 result 矩阵点乘的权重键。水流动力=wNM、河床演变=wRE，两者曾在前端被对调。 */
  weightKey: 'wNM' | 'wRE' | 'wGE';
  indicatorKeys: Array<{ key: RiskIndicatorKey; label: string }>;
};

/** 与 riskLevel.py 的 np.hstack(soil, slope_protection, load_control) 列顺序严格对应。 */
export const RISK_MATRIX_GROUPS: RiskMatrixGroup[] = [
  {
    title: '水流动力指标',
    weightKey: 'wNM',
    indicatorKeys: [
      { label: '抗冲流速(Ky)', key: 'Ky' },
      { label: '造床流量当量(PQ)', key: 'PQ' },
      { label: '水位变幅(Zd)', key: 'Zd' },
    ],
  },
  {
    title: '河床演变指标',
    weightKey: 'wRE',
    indicatorKeys: [
      { label: '岸坡坡比(Sa)', key: 'Sa' },
      { label: '近岸冲刷(Ln)', key: 'Ln' },
      { label: '滩槽高差(Zb)', key: 'Zb' },
    ],
  },
  {
    title: '地质工程指标',
    weightKey: 'wGE',
    indicatorKeys: [
      { label: '土体组成(Dsed)', key: 'Dsed' },
      { label: '岸坡防护(PL)', key: 'PL' },
      { label: '荷载控制(LC)', key: 'LC' },
    ],
  },
];

export const RISK_INDICATOR_KEYS: RiskIndicatorKey[] = RISK_MATRIX_GROUPS.flatMap(g =>
  g.indicatorKeys.map(i => i.key),
);

/**
 * 分档方向。
 * ⚠️ 只有 Ky 是反的：阈值 [1.7, 1.35, 1.0] 降序，`Ky > 1.7` 落第 1 档（抗冲流速越大越安全）。
 * 其余连续量都是「小于阈值更安全」。枚举指标不走阈值。
 */
const INDICATOR_DIRECTION: Record<string, 'asc' | 'desc'> = {
  Ky: 'desc',
  PQ: 'asc',
  Zd: 'asc',
  Sa: 'asc',
  Ln: 'asc',
  Zb: 'asc',
  Dsed: 'asc',
};

/** PL/LC 是枚举：1 档 = 防护/控制最强 = 风险最低。两套字符串不同，别混用。 */
export const ENUM_TIER_OPTIONS: Record<'PL' | 'LC', Array<{ value: string; label: string; tier: number }>> = {
  PL: [
    { value: 'systemic', label: '强（1 档）', tier: 1 },
    { value: 'normal', label: '较强（2 档）', tier: 2 },
    { value: 'low', label: '一般（3 档）', tier: 3 },
    { value: 'no', label: '弱（4 档）', tier: 4 },
  ],
  LC: [
    { value: 'strict', label: '强（1 档）', tier: 1 },
    { value: 'normal', label: '较强（2 档）', tier: 2 },
    { value: 'low', label: '一般（3 档）', tier: 3 },
    { value: 'no', label: '弱（4 档）', tier: 4 },
  ],
};

const ENUM_TIER_MAP: Record<string, Record<string, number>> = {
  PL: { systemic: 1, normal: 2, low: 3, no: 4 },
  LC: { strict: 1, normal: 2, low: 3, no: 4 },
};

// ============================================================
//  默认参数（与 CreateParamTemplateModal 的 DEFAULT_* 同值）
// ============================================================

export const DEFAULT_SUB_THRESHOLDS: Record<string, number[]> = {
  Ky: [1.7, 1.35, 1],
  Ln: [0.04, 0.12, 0.2],
  PQ: [0.5, 1, 2.3],
  Sa: [0.2, 0.3, 0.5],
  Zb: [20, 30, 40],
  Zd: [0.1, 0.15, 0.3],
  Dsed: [0.7, 1, 1.5],
};

export const DEFAULT_WEIGHTS: Record<'wNM' | 'wRE' | 'wGE' | 'wRL', number[]> = {
  wGE: [0.6, 0.2, 0.2],
  wNM: [0.43, 0.32, 0.25],
  wRE: [0.48, 0.16, 0.36],
  wRL: [0.32, 0.43, 0.25],
};

export const DEFAULT_RISK_THRESHOLDS: [number, number, number] = [0.25, 0.5, 0.75];

/**
 * 0..3 显示等级（0 最低）。三处消费：断面线、岸段色带、等级徽章。
 *
 * 文案与库内 `risk_level`(1..4) 的对应：level 3 ↔ risk_level 4（最高），level 0 ↔ risk_level 1。
 *
 * 文案（2026-10-21 定稿，原名「一级/二级/三级风险」）：level 3 = 高风险、level 2 = 较高风险、
 * level 1 = 中风险、level 0 = 低风险。旧文案带序号且序号与 risk_level 相反（一级最高），
 * 读起来与「第 N 档」打架，故统一改成不带数字的定性词 —— **别再改回带序号的写法**。
 * 界面上同时出现数字时请用 `risk_level N` 标注，别写「第 N 档」。
 *
 * 配色语义（2026-10-20 定稿）：高风险红、较高风险橙、中风险蓝、低风险绿。
 */
export const RISK_COLORS: Record<string, string> = {
  '0': '#10b981',
  '1': '#3b82f6',
  '2': '#f97316',
  '3': '#ef4444',
  'default': '#94a3b8',
};

export const RISK_LABELS: Record<number, string> = {
  3: '高风险',
  2: '较高风险',
  1: '中风险',
  0: '低风险',
};

// ============================================================
//  阈值 / 权重解析
// ============================================================

export type ResolvedRiskParams = {
  sub: Record<string, number[]>;
  all: [number, number, number];
  wNM: number[];
  wRE: number[];
  wGE: number[];
  wRL: number[];
  /** 结果里没记录、回落到默认值的键（用于给用户一条明确提示，而不是静默换口径）。 */
  fellBack: string[];
};

const asNumberArray = (v: any): number[] | null =>
  Array.isArray(v) && v.length >= 3 && v.every(item => Number.isFinite(Number(item)))
    ? v.map(Number)
    : null;

/**
 * 从一条结果的 indicators 里取出计算所需的全部参数。
 * 老记录（2026-06 前后）没有 `thresholds`，这里按默认值回落并把回落项报给 UI。
 */
export function resolveRiskParams(indicators: any): ResolvedRiskParams {
  const thresholds =
    indicators?.thresholds ??
    indicators?.indicators?.thresholds ??
    null;
  const rawSub = thresholds?.sub_thresholds ?? indicators?.sub_thresholds ?? {};
  const fellBack: string[] = [];

  const sub: Record<string, number[]> = {};
  Object.keys(DEFAULT_SUB_THRESHOLDS).forEach(key => {
    const resolved = asNumberArray(rawSub?.[key]);
    if (resolved) {
      sub[key] = resolved;
    } else {
      sub[key] = DEFAULT_SUB_THRESHOLDS[key];
      fellBack.push(key);
    }
  });

  const allRaw = asNumberArray(thresholds?.risk_threshold ?? rawSub?.all);
  const all: [number, number, number] = allRaw
    ? [allRaw[0], allRaw[1], allRaw[2]]
    : DEFAULT_RISK_THRESHOLDS;
  if (!allRaw) fellBack.push('all');

  const pickWeights = (key: 'wNM' | 'wRE' | 'wGE' | 'wRL') => {
    const resolved = asNumberArray(thresholds?.[key]);
    if (resolved) return resolved;
    fellBack.push(key);
    return DEFAULT_WEIGHTS[key];
  };

  return {
    sub,
    all,
    wNM: pickWeights('wNM'),
    wRE: pickWeights('wRE'),
    wGE: pickWeights('wGE'),
    wRL: pickWeights('wRL'),
    fellBack,
  };
}

// ============================================================
//  分档 / 重算
// ============================================================

export type IndicatorValue = number | string | null;

/** 单个指标取值 -> 1..4 档；无法判定返回 null（不兜底成 1 档）。 */
export function classifyIndicatorTier(
  key: RiskIndicatorKey,
  value: IndicatorValue,
  sub: Record<string, number[]>,
): number | null {
  if (key === 'PL' || key === 'LC') {
    if (typeof value !== 'string') return null;
    return ENUM_TIER_MAP[key][value.trim().toLowerCase()] ?? null;
  }
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const t = sub[key];
  if (!t || t.length < 3) return null;
  if (INDICATOR_DIRECTION[key] === 'desc') {
    if (n > t[0]) return 1;
    if (n > t[1]) return 2;
    if (n > t[2]) return 3;
    return 4;
  }
  if (n < t[0]) return 1;
  if (n < t[1]) return 2;
  if (n < t[2]) return 3;
  return 4;
}

/** risk_value -> 0..3 显示等级。与 riskLevel.py 的 `risk_value < risk_threshold[i]` 同语义。 */
export function bucketRiskValue(value: number, all: [number, number, number]): 0 | 1 | 2 | 3 {
  if (value < all[0]) return 0;
  if (value < all[1]) return 1;
  if (value < all[2]) return 2;
  return 3;
}

export type RiskComputation = {
  values: Record<string, IndicatorValue>;
  tiers: Record<string, number | null>;
  matrices: Record<string, any>;
  /** 无法计算的指标（枚举缺失 / 数值非法 / 阈值缺失）。非空时 riskValue 为 null。 */
  unresolved: RiskIndicatorKey[];
  riskValue: number | null;
  /** 0..3，用于配色 */
  level: 0 | 1 | 2 | 3 | null;
  /** 1..4，用于写库 */
  riskLevel: number | null;
  /** 与 `indicators['risk-level']` 同形状的 one-hot */
  oneHot: number[] | null;
  params: ResolvedRiskParams;
};

const round6 = (n: number) => Number(n.toFixed(6));

/**
 * 完整重算。`valuesOverride` 缺省时取 indicators.raw_values。
 * 纯函数，不改入参；返回的 matrices 与模型响应的键完全一致，可直接写回 indicators。
 */
export function computeRisk(
  indicators: any,
  valuesOverride?: Record<string, IndicatorValue>,
): RiskComputation {
  const params = resolveRiskParams(indicators);
  const source = valuesOverride ?? indicators?.raw_values ?? {};

  const values: Record<string, IndicatorValue> = {};
  RISK_INDICATOR_KEYS.forEach(key => {
    const v = source[key];
    values[key] = v === undefined ? null : v;
  });

  const tiers: Record<string, number | null> = {};
  const unresolved: RiskIndicatorKey[] = [];
  RISK_INDICATOR_KEYS.forEach(key => {
    const tier = classifyIndicatorTier(key, values[key] as IndicatorValue, params.sub);
    tiers[key] = tier;
    if (tier === null) unresolved.push(key);
  });

  const oneHotOf = (tier: number | null) => [1, 2, 3, 4].map(t => (tier === t ? 1 : 0));

  const buildGroup = (group: RiskMatrixGroup) =>
    [1, 2, 3, 4].map(tier => group.indicatorKeys.map(({ key }) => (tiers[key] === tier ? 1 : 0)));

  const waterFlow = buildGroup(RISK_MATRIX_GROUPS[0]);
  const riverbed = buildGroup(RISK_MATRIX_GROUPS[1]);
  const geology = buildGroup(RISK_MATRIX_GROUPS[2]);

  const multiply = (rows: number[][], weights: number[]) =>
    rows.map(row => [round6(row.reduce((acc, cell, i) => acc + cell * (weights[i] ?? 0), 0))]);

  const wfResult = multiply(waterFlow, params.wNM);
  const reResult = multiply(riverbed, params.wRE);
  const geResult = multiply(geology, params.wGE);

  const concat = [0, 1, 2, 3].map(i => [wfResult[i][0], reResult[i][0], geResult[i][0]]);
  const resultMatrix = multiply(concat, params.wRL);

  const riskValue = round6(resultMatrix[2][0] + resultMatrix[3][0]);
  const level = unresolved.length > 0 ? null : bucketRiskValue(riskValue, params.all);
  const riskLevel = level === null ? null : level + 1;

  return {
    values,
    tiers,
    matrices: {
      water_flow_power_matrix: waterFlow,
      riverbed_evolution_matrix: riverbed,
      geology_engineering_matrix: geology,
      water_flow_power_result_matrix: wfResult,
      riverbed_evolution_result_matrix: reResult,
      geology_engineering_result_matrix: geResult,
      concat_matrix: concat,
      weight_matrix: params.wRL.map(w => [w]),
      result_matrix: resultMatrix,
      risk_value_components: [resultMatrix[2][0], resultMatrix[3][0]],
      indicator_tiers: tiers,
    },
    unresolved,
    riskValue: unresolved.length > 0 ? null : riskValue,
    level,
    riskLevel,
    oneHot: riskLevel === null ? null : oneHotOf(riskLevel),
    params,
  };
}

/** 把 1..4 的库内等级转为 0..3 显示等级；非法值返回 null。 */
export function toDisplayLevel(riskLevel: any): 0 | 1 | 2 | 3 | null {
  const n = Number(riskLevel);
  if (!Number.isFinite(n) || n < 1 || n > 4) return null;
  return (n - 1) as 0 | 1 | 2 | 3;
}

/**
 * 从一条结果（/results/{id} 的 payload 或已铺平的 matrixDetail）里抠出 0..3 显示等级。
 * 阈值优先用该结果自带的；缺失才回落默认值。
 */
export function displayLevelOfResult(payload: any): 0 | 1 | 2 | 3 | null {
  const indicators =
    payload?.indicators ??
    payload?.result?.indicators ??
    payload?.data?.indicators ??
    payload?.data?.result?.indicators;
  const raw = indicators?.result ?? payload?.result?.result ?? payload?.result;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  const params = resolveRiskParams(indicators ?? payload);
  return bucketRiskValue(n, params.all);
}

/** 输入框回显：数字保留 6 位有效小数，避免 1.5200000000000002 这种噪声。 */
export function formatEditableValue(v: any): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    return String(Number(v.toFixed(6)));
  }
  return String(v);
}

/**
 * 单指标风险等级（1..4，1 档最安全、4 档最危险）。
 *
 * 用途：指标矩阵里逐行标出「这个结果落在该指标的第几档」，而不是整条断面的综合等级。
 * 判定顺序（越靠前越可信，绝不另造第二份公式）：
 *   ① `matrices.indicator_tiers` —— 模型算分级时自己写下的档位，直接采用；
 *   ② 缺失才用 `classifyIndicatorTier()` 按**该记录自带的** sub_thresholds 现算；
 *   ③ PL/LC 老结果 `raw_values` 是 null，最后从 `geology_engineering_matrix` 的列反推。
 * 三条都拿不到时返回 null（界面写「未判定」），不兜底成 1 档 ——
 * 兜底会把「未填报」显示成「最安全」，这正是 2026-10 那批 4 级不可达问题的成因。
 */
export function resolveIndicatorTier(
  key: RiskIndicatorKey,
  source: { indicators?: any; rawValues?: any; matrices?: any },
): number | null {
  const recorded = Number(source?.matrices?.indicator_tiers?.[key]);
  if (Number.isInteger(recorded) && recorded >= 1 && recorded <= 4) return recorded;

  const params = resolveRiskParams(source?.indicators ?? source);
  const computed = classifyIndicatorTier(key, source?.rawValues?.[key] ?? null, params.sub);
  if (computed !== null) return computed;

  return resolveEnumIndicatorTier(source?.matrices, key);
}
