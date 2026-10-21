import { describe, expect, it } from 'vitest';
import {
  formatCellValue,
  formatIndicatorResult,
  isEnumIndicator,
  resolveEnumIndicatorText,
  resolveEnumIndicatorTier,
} from './indicatorDisplay';

/** 真实结构：行 = 档位 1..4，列 = [Dsed, PL, LC]。 */
const geMatrix = (dsedTier: number, plTier: number, lcTier: number) => {
  const m = Array.from({ length: 4 }, () => [0, 0, 0]);
  m[dsedTier - 1][0] = 1;
  m[plTier - 1][1] = 1;
  m[lcTier - 1][2] = 1;
  return m;
};

describe('formatCellValue', () => {
  it('空值统一成 -', () => {
    expect(formatCellValue(null)).toBe('-');
    expect(formatCellValue(undefined)).toBe('-');
  });

  it('长小数截到 4 位，大数取整', () => {
    expect(formatCellValue(0.1548000001)).toBe('0.1548');
    expect(formatCellValue(9999.4)).toBe('9999');
    expect(formatCellValue(1234.56)).toBe('1235');
  });
});

describe('isEnumIndicator', () => {
  it('只有 PL / LC 是枚举型', () => {
    expect(isEnumIndicator('PL')).toBe(true);
    expect(isEnumIndicator('LC')).toBe(true);
    expect(isEnumIndicator('Dsed')).toBe(false);
    expect(isEnumIndicator('Zb')).toBe(false);
  });
});

describe('resolveEnumIndicatorText —— 从矩阵反推档位', () => {
  it('PL 取第 1 列、LC 取第 2 列，不会串列', () => {
    // Dsed=1 档、PL=3 档、LC=4 档 —— 三者故意不同，串列会立刻暴露
    const matrices = { geology_engineering_matrix: geMatrix(1, 3, 4) };
    expect(resolveEnumIndicatorText(matrices, 'PL')).toBe('一般（第3档）');
    expect(resolveEnumIndicatorText(matrices, 'LC')).toBe('弱（第4档）');
  });

  it('当前库内的真实形态（全 1 档）显示为强', () => {
    const matrices = { geology_engineering_matrix: geMatrix(1, 1, 1) };
    expect(resolveEnumIndicatorText(matrices, 'PL')).toBe('强（第1档）');
    expect(resolveEnumIndicatorText(matrices, 'LC')).toBe('强（第1档）');
  });

  it('矩阵缺失或全 0 时写「未记录」，不写 N/A', () => {
    expect(resolveEnumIndicatorText({}, 'PL')).toBe('未记录');
    expect(resolveEnumIndicatorText(null, 'PL')).toBe('未记录');
    expect(
      resolveEnumIndicatorText({ geology_engineering_matrix: [[0, 0, 0]] }, 'PL'),
    ).toBe('未记录');
  });
});

describe('resolveEnumIndicatorTier —— 档位数字（1..4）', () => {
  it('与文案同源：档位 + 1 就是矩阵行号', () => {
    const matrices = { geology_engineering_matrix: geMatrix(1, 3, 4) };
    expect(resolveEnumIndicatorTier(matrices, 'PL')).toBe(3);
    expect(resolveEnumIndicatorTier(matrices, 'LC')).toBe(4);
    expect(resolveEnumIndicatorText(matrices, 'PL')).toContain('第3档');
  });

  it('非枚举指标 / 矩阵缺失 / 全 0 都返回 null', () => {
    expect(resolveEnumIndicatorTier({ geology_engineering_matrix: geMatrix(1, 1, 1) }, 'Zb')).toBeNull();
    expect(resolveEnumIndicatorTier({}, 'PL')).toBeNull();
    expect(resolveEnumIndicatorTier(null, 'PL')).toBeNull();
    expect(resolveEnumIndicatorTier({ geology_engineering_matrix: [[0, 0, 0], [0, 0, 0]] }, 'LC')).toBeNull();
  });
});

describe('formatIndicatorResult', () => {
  it('连续量按原值渲染', () => {
    expect(formatIndicatorResult('Dsed', { Dsed: 0.25 }, {})).toBe('0.25');
    expect(formatIndicatorResult('Zb', { Zb: 7.6912 }, {})).toBe('7.6912');
  });

  it('新结果：模型回带的原始枚举翻成中文', () => {
    expect(formatIndicatorResult('PL', { PL: 'no' }, {})).toBe('弱');
    expect(formatIndicatorResult('PL', { PL: 'systemic' }, {})).toBe('强');
    expect(formatIndicatorResult('LC', { LC: 'strict' }, {})).toBe('强');
    expect(formatIndicatorResult('LC', { LC: '  NORMAL ' }, {})).toBe('较强');
  });

  it('老结果：raw_values 没有 PL/LC 时用矩阵兜底（无需重跑）', () => {
    const matrices = { geology_engineering_matrix: geMatrix(1, 1, 1) };
    expect(formatIndicatorResult('PL', { PL: null }, matrices)).toBe('强（第1档）');
    expect(formatIndicatorResult('LC', {}, matrices)).toBe('强（第1档）');
  });

  it('老结果 + 无矩阵：写「未记录」而不是 N/A', () => {
    expect(formatIndicatorResult('PL', { PL: null }, {})).toBe('未记录');
    expect(formatIndicatorResult('LC', {}, {})).toBe('未记录');
  });

  it('连续量缺失仍然写 N/A（表示真的没有值）', () => {
    expect(formatIndicatorResult('Zb', { Zb: null }, {})).toBe('N/A');
    expect(formatIndicatorResult('Ky', {}, {})).toBe('N/A');
  });
});
