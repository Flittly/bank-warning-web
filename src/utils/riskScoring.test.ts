import { describe, expect, it } from 'vitest';
import {
  bucketRiskValue,
  classifyIndicatorTier,
  computeRisk,
  displayLevelOfResult,
  formatEditableValue,
  resolveRiskParams,
  toDisplayLevel,
} from './riskScoring';

/**
 * 两条**真实生产记录**（bank_risk_db.bank_risk_results，id 6804 / 6805）。
 *
 * 这里刻意不手写"我认为应该是 0.18"这种期望值，而是直接从库里抄下来的：
 *   - 原始输入 raw_values
 *   - 全量参数 thresholds
 *   - 模型输出的 matrices / result / risk-level / risk_level
 * 断言重算结果与库内完全一致 —— 这是"前端复刻公式没有漂移"的唯一硬证据。
 */
const RECORD_6805 = {
  riskLevelInDb: 1,
  rawValues: {
    Ky: 2.4231, LC: 'no', Ln: 0.01864627997080485, PL: 'no', PQ: 0.0,
    Sa: 0.02196026152894708, Zb: 27.874408721923828, Zd: 6.019999999999999, Dsed: 0.25,
  },
  thresholds: {
    wGE: [0.6, 0.2, 0.2],
    wNM: [0.43, 0.32, 0.25],
    wRE: [0.48, 0.16, 0.36],
    wRL: [0.32, 0.43, 0.25],
    risk_threshold: [0.25, 0.5, 0.75],
    sub_thresholds: {
      Ky: [1.7, 1.35, 1], Ln: [0.04, 0.12, 0.2], PQ: [0.5, 1, 2.3],
      Sa: [0.2, 0.3, 0.5], Zb: [20, 30, 40], Zd: [0.1, 0.15, 0.3],
      all: [0.25, 0.5, 0.75], Dsed: [0.7, 1, 1.5],
    },
  },
  expected: {
    result: 0.18,
    oneHot: [1, 0, 0, 0],
    indicatorTiers: { Ky: 1, LC: 4, Ln: 1, PL: 4, PQ: 1, Sa: 1, Zb: 2, Zd: 4, Dsed: 1 },
    concatMatrix: [[0.75, 0.64, 0.6], [0.0, 0.36, 0.0], [0.0, 0.0, 0.0], [0.25, 0.0, 0.4]],
    resultMatrix: [[0.6652], [0.1548], [0.0], [0.18]],
    riskValueComponents: [0.0, 0.18],
  },
};

const RECORD_6804 = {
  riskLevelInDb: 2,
  rawValues: {
    Ky: 2.4231, LC: 'no', Ln: 0.03406831423441569, PL: 'no', PQ: 0.0,
    Sa: 0.134781613945961, Zb: 39.65522384643555, Zd: 6.019999999999999, Dsed: 0.25,
  },
  thresholds: RECORD_6805.thresholds,
  expected: {
    result: 0.3348,
    oneHot: [0, 1, 0, 0],
    indicatorTiers: { Ky: 1, LC: 4, Ln: 1, PL: 4, PQ: 1, Sa: 1, Zb: 3, Zd: 4, Dsed: 1 },
    concatMatrix: [[0.75, 0.64, 0.6], [0.0, 0.0, 0.0], [0.0, 0.36, 0.0], [0.25, 0.0, 0.4]],
    resultMatrix: [[0.6652], [0.0], [0.1548], [0.18]],
    riskValueComponents: [0.1548, 0.18],
  },
};

const asIndicators = (rec: typeof RECORD_6805) => ({
  raw_values: rec.rawValues,
  thresholds: rec.thresholds,
});

describe('computeRisk —— 与模型输出逐项对账', () => {
  it.each([
    ['record 6805', RECORD_6805],
    ['record 6804', RECORD_6804],
  ])('%s 重算结果必须等于库里的 result / risk-level / matrices', (_name, rec) => {
    const inputs = asIndicators(rec as typeof RECORD_6805);
    const out = computeRisk(inputs);

    expect(out.unresolved).toEqual([]);
    expect(out.riskValue).toBeCloseTo(rec.expected.result, 6);
    expect(out.riskLevel).toBe((rec as typeof RECORD_6805).riskLevelInDb);
    expect(out.oneHot).toEqual(rec.expected.oneHot);
    expect(out.tiers).toEqual(rec.expected.indicatorTiers);
    expect(out.matrices.concat_matrix).toEqual(rec.expected.concatMatrix);
    expect(out.matrices.result_matrix).toEqual(rec.expected.resultMatrix);
    expect(out.matrices.risk_value_components).toEqual(rec.expected.riskValueComponents);
  });
});

describe('classifyIndicatorTier', () => {
  const sub = resolveRiskParams({ thresholds: RECORD_6805.thresholds }).sub;

  it('Ky 是降序：值越大档位越低', () => {
    expect(classifyIndicatorTier('Ky', 2.4, sub)).toBe(1);
    expect(classifyIndicatorTier('Ky', 1.5, sub)).toBe(2);
    expect(classifyIndicatorTier('Ky', 1.2, sub)).toBe(3);
    expect(classifyIndicatorTier('Ky', 0.9, sub)).toBe(4);
  });

  it('其余连续量升序：值越大档位越高', () => {
    expect(classifyIndicatorTier('Zb', 10, sub)).toBe(1);
    expect(classifyIndicatorTier('Zb', 25, sub)).toBe(2);
    expect(classifyIndicatorTier('Zb', 35, sub)).toBe(3);
    expect(classifyIndicatorTier('Zb', 45, sub)).toBe(4);
  });

  it('枚举按各自字符串表映射，非法值返回 null 而不是兜底 1 档', () => {
    expect(classifyIndicatorTier('PL', 'systemic', sub)).toBe(1);
    expect(classifyIndicatorTier('LC', 'strict', sub)).toBe(1);
    expect(classifyIndicatorTier('LC', 'no', sub)).toBe(4);
    expect(classifyIndicatorTier('PL', 'bogus', sub)).toBeNull();
    expect(classifyIndicatorTier('PL', null, sub)).toBeNull();
  });
});

describe('阈值为自定义值时不再写死 0.25/0.5/0.75', () => {
  it('同一 risk_value 在自定义 all 下落到不同等级', () => {
    expect(bucketRiskValue(0.3, [0.25, 0.5, 0.75])).toBe(1);
    expect(bucketRiskValue(0.3, [0.2, 0.4, 0.6])).toBe(1);
    expect(bucketRiskValue(0.45, [0.25, 0.5, 0.75])).toBe(1);
    expect(bucketRiskValue(0.45, [0.2, 0.4, 0.6])).toBe(2);
    expect(bucketRiskValue(0.8, [0.2, 0.4, 0.6])).toBe(3);
  });

  it('displayLevelOfResult 用结果自带阈值', () => {
    const payload = {
      indicators: {
        result: 0.45,
        thresholds: { risk_threshold: [0.2, 0.4, 0.6] },
      },
    };
    expect(displayLevelOfResult(payload)).toBe(2);
  });
});

describe('异常与边界', () => {
  it('缺阈值的老记录回落到默认值，并如实报告回落项', () => {
    const params = resolveRiskParams({ raw_values: RECORD_6805.rawValues });
    expect(params.all).toEqual([0.25, 0.5, 0.75]);
    expect(params.fellBack).toContain('all');
    expect(params.fellBack).toContain('Zd');
  });

  it('枚举缺失时不下结论', () => {
    const out = computeRisk({
      raw_values: { ...RECORD_6805.rawValues, PL: null },
      thresholds: RECORD_6805.thresholds,
    });
    expect(out.unresolved).toEqual(['PL']);
    expect(out.riskValue).toBeNull();
    expect(out.riskLevel).toBeNull();
    expect(out.level).toBeNull();
  });

  it('toDisplayLevel 与库内 1..4 对齐', () => {
    expect(toDisplayLevel(1)).toBe(0);
    expect(toDisplayLevel(4)).toBe(3);
    expect(toDisplayLevel(0)).toBeNull();
    expect(toDisplayLevel('x')).toBeNull();
  });

  it('formatEditableValue 去掉浮点噪声但保留精度', () => {
    expect(formatEditableValue(1.5200000000000002)).toBe('1.52');
    expect(formatEditableValue(0.01864627997080485)).toBe('0.018646');
    expect(formatEditableValue(null)).toBe('');
  });
});
