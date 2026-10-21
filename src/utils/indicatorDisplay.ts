/**
 * 结果页「评估指标」列的显示规则。
 *
 * 背景：9 个指标里 PL（护岸等级）与 LC（工程扰动控制等级）是下拉枚举，没有连续量。
 * 早期 Slope Protection / Load Control 的响应只回 risk-level、不回原始枚举，
 * 于是 raw_values.PL / raw_values.LC 恒为 null，结果页只能显示 N/A —— 
 * 看起来像「数据缺失」，实际是「枚举没有回传通道」。
 */

const ENUM_INDICATOR_KEYS = new Set(['PL', 'LC']);

/** 档位文案：1 档 = 防护最强 = 风险最低，4 档 = 无防护 = 风险最高。 */
const ENUM_TIER_TEXT = ['强', '较强', '一般', '弱'];

/**
 * 各枚举指标在矩阵里的位置。
 * geology_engineering_matrix 的行 = 档位（1..4），列 = [Dsed, PL, LC]，
 * 与 riskLevel.py 的 np.hstack(soil_composition, slope_protection, load_control) 一一对应。
 */
const ENUM_TIER_COLUMN: Record<string, { matrix: string; column: number }> = {
  PL: { matrix: 'geology_engineering_matrix', column: 1 },
  LC: { matrix: 'geology_engineering_matrix', column: 2 },
};

/** 模型回带的原始枚举 -> 中文。PL 用 systemic、LC 用 strict 表示同一档「强」。 */
const ENUM_RAW_TEXT: Record<string, string> = {
  systemic: '强',
  strict: '强',
  normal: '较强',
  low: '一般',
  no: '弱',
};

/** 表格/CSV 通用单元格格式化。 */
export function formatCellValue(v: any): string {
  if (v === null || v === undefined) return '-';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return String(v);
    // 避免长小数影响可读性
    return Math.abs(v) >= 1000 ? String(Math.round(v)) : String(Number(v.toFixed(4)));
  }
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function isEnumIndicator(key: string): boolean {
  return ENUM_INDICATOR_KEYS.has(key);
}

/**
 * 从 `geology_engineering_matrix` 的枚举列反推档位（1..4）。
 * 老结果的 `raw_values.PL/LC` 是 null，但矩阵列里仍留着那个 1 —— 这是唯一能不上重跑就拿到档位的通道。
 * 矩阵缺失或该列全 0（= 未填报）时返回 null，不兜底成 1 档。
 */
export function resolveEnumIndicatorTier(matrices: any, key: string): number | null {
  const spec = ENUM_TIER_COLUMN[key];
  if (!spec) return null;

  const matrix = matrices?.[spec.matrix];
  if (Array.isArray(matrix)) {
    for (let tier = 0; tier < matrix.length; tier += 1) {
      const row = matrix[tier];
      if (Array.isArray(row) && Number(row[spec.column]) > 0) return tier + 1;
    }
  }
  return null;
}

/**
 * 枚举型指标的展示文案。
 * 优先用模型回带的原始枚举（新结果），否则从矩阵列反推档位（老结果，无需重跑）。
 * 两者都拿不到时明确写「未记录」，而不是 N/A —— N/A 会被误读成数据缺失。
 */
export function resolveEnumIndicatorText(matrices: any, key: string): string {
  const tier = resolveEnumIndicatorTier(matrices, key);
  if (tier === null) return '未记录';
  return `${ENUM_TIER_TEXT[tier - 1] ?? `第${tier}档`}（第${tier}档）`;
}

/** 统一的指标「结果」列取值：连续量按原值，枚举量出中文档位，确实没有值才 N/A。 */
export function formatIndicatorResult(key: string, rawValues: any, matrices: any): string {
  const raw = rawValues?.[key];
  if (raw !== undefined && raw !== null && raw !== '') {
    if (isEnumIndicator(key) && typeof raw === 'string') {
      return ENUM_RAW_TEXT[raw.trim().toLowerCase()] ?? raw;
    }
    return formatCellValue(raw);
  }
  if (isEnumIndicator(key)) {
    return resolveEnumIndicatorText(matrices, key);
  }
  return 'N/A';
}
