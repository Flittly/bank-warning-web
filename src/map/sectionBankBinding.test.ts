import { describe, expect, it } from 'vitest';
import {
  MAX_BIND_DISTANCE_M,
  bankIdOfFeature,
  describeUnbound,
  isPlaceholderBankId,
  renderKeyOfFeature,
  resolveBankBinding,
  snapPointToBank,
} from './sectionBankBinding';

/** 东西向直岸段 A：纬度 32.00，跨 0.10° ≈ 9.4 km */
const BANK_A = {
  type: 'Feature' as const,
  properties: { index: 0, bank_id: 'bankwgs84_1' },
  geometry: {
    type: 'LineString' as const,
    coordinates: [[120.0, 32.0], [120.1, 32.0]],
  },
};
/** 与 A 平行、北侧 0.01°（≈1.1 km）的岸段 B */
const BANK_B = {
  type: 'Feature' as const,
  properties: { index: 1, bank_id: 'bankwgs84_2' },
  geometry: {
    type: 'LineString' as const,
    coordinates: [[120.0, 32.01], [120.1, 32.01]],
  },
};
/** 没有真实 bank_id 的岸段（只有上传下标占位） */
const BANK_NO_ID = {
  type: 'Feature' as const,
  properties: { index: 0, bank_id: 'line-0' },
  geometry: {
    type: 'LineString' as const,
    coordinates: [[120.0, 32.0], [120.1, 32.0]],
  },
};

const banksOf = (...features: any[]) => ({ type: 'FeatureCollection' as const, features });

describe('bank_id 取值口径', () => {
  it('读 bank_id / bankId 两种命名', () => {
    expect(bankIdOfFeature({ properties: { bank_id: 'bankwgs84_7' } })).toBe('bankwgs84_7');
    expect(bankIdOfFeature({ properties: { bankId: 'bankwgs84_8' } })).toBe('bankwgs84_8');
  });

  it('line-N 是占位符，一律当没有 id', () => {
    expect(isPlaceholderBankId('line-0')).toBe(true);
    expect(isPlaceholderBankId('line-12')).toBe(true);
    expect(isPlaceholderBankId('bankwgs84_4')).toBe(false);
    expect(bankIdOfFeature({ properties: { bank_id: 'line-3' } })).toBeNull();
  });

  it('空值 / null 都返回 null，绝不兜底造 line-N', () => {
    expect(bankIdOfFeature({ properties: {} })).toBeNull();
    expect(bankIdOfFeature({ properties: { bank_id: '' } })).toBeNull();
    expect(bankIdOfFeature({ properties: { bank_id: '   ' } })).toBeNull();
    expect(bankIdOfFeature(null)).toBeNull();
  });

  it('渲染 key 才允许退化成 line-index', () => {
    expect(renderKeyOfFeature(BANK_A, 0)).toBe('bankwgs84_1');
    expect(renderKeyOfFeature(BANK_NO_ID, 5)).toBe('line-5');
  });
});

describe('吸附', () => {
  it('点吸附后严格落在岸段线上，并给出沿程里程', () => {
    const snap = snapPointToBank([120.05, 32.0005], BANK_A);
    expect(snap).not.toBeNull();
    expect(snap!.footPoint[0]).toBeCloseTo(120.05, 6);
    // turf 的垂直投影是局部近似，会有 ~1 m 级误差，这里只要求「落在线上」的量级
    expect(snap!.footPoint[1]).toBeCloseTo(32.0, 4);
    // 岸段总长约 9.4 km，正中间约 4.7 km
    expect(snap!.distance).toBeGreaterThan(4600);
    expect(snap!.distance).toBeLessThan(4800);
    expect(snap!.meters).toBeGreaterThan(50);
    expect(snap!.meters).toBeLessThan(65);
    expect(snap!.bankId).toBe('bankwgs84_1');
  });

  it('几何异常不抛错', () => {
    expect(snapPointToBank([120, 32], { geometry: { type: 'Point', coordinates: [120, 32] } })).toBeNull();
    expect(snapPointToBank([120, 32], null)).toBeNull();
  });
});

describe('归属判定', () => {
  it('首点落在岸段上 → 按首点归属', () => {
    const b = resolveBankBinding({ start: [120.05, 32.0], end: [120.05, 32.02], banks: banksOf(BANK_A) });
    expect(b.matchedBy).toBe('start');
    expect(b.bankId).toBe('bankwgs84_1');
    expect(b.bankIndex).toBe(0);
    expect(b.distanceToBank).toBeLessThan(2);
    expect(b.footPoint).not.toBeNull();
  });

  it(`首点离岸段 ${MAX_BIND_DISTANCE_M} m 以内仍归属`, () => {
    // 北侧约 55 m
    const b = resolveBankBinding({ start: [120.05, 32.0005], end: [120.05, 32.02], banks: banksOf(BANK_A) });
    expect(b.matchedBy).toBe('start');
    expect(b.bankId).toBe('bankwgs84_1');
  });

  it('首点悬空但中点在岸段上 → 退让到中点', () => {
    const b = resolveBankBinding({ start: [120.02, 32.02], end: [120.08, 32.0], banks: banksOf(BANK_A, BANK_B) });
    expect(b.matchedBy).toBe('midpoint');
    expect(b.bankId).toBe('bankwgs84_2');
  });

  it('三级都超出阈值 → 不归属，且不硬绑最近的岸段', () => {
    const b = resolveBankBinding({ start: [121.0, 32.5], end: [121.1, 32.5], banks: banksOf(BANK_A, BANK_B) });
    expect(b.bankId).toBeNull();
    expect(b.matchedBy).toBeNull();
    expect(b.distance).toBeNull();
    expect(b.footPoint).toBeNull();
    // 但保留距离，供提示文案使用
    expect(b.distanceToBank).toBeGreaterThan(40000);
  });

  it('锚点显式指定时优先于「首点更近的另一条」', () => {
    const b = resolveBankBinding({
      start: [120.05, 32.0],
      end: [120.05, 32.03],
      banks: banksOf(BANK_A, BANK_B),
      anchor: { point: [120.05, 32.01], bankId: 'bankwgs84_2', distance: 4700 },
    });
    expect(b.matchedBy).toBe('anchor');
    expect(b.bankId).toBe('bankwgs84_2');
  });

  it('锚点指向的岸段已不在集合里 → 回落到首点判定', () => {
    const b = resolveBankBinding({
      start: [120.05, 32.0],
      end: [120.05, 32.03],
      banks: banksOf(BANK_A, BANK_B),
      anchor: { point: [120.05, 32.01], bankId: 'bankwgs84_9', distance: 100 },
    });
    expect(b.matchedBy).toBe('start');
    expect(b.bankId).toBe('bankwgs84_1');
  });

  it('岸段没有真实 bank_id → 未归属（不写 line-N）', () => {
    const b = resolveBankBinding({ start: [120.05, 32.0], end: [120.05, 32.02], banks: banksOf(BANK_NO_ID) });
    expect(b.bankId).toBeNull();
    expect(b.matchedBy).toBeNull();
  });

  it('没有岸段时安全返回未归属', () => {
    expect(resolveBankBinding({ start: [120, 32], end: [120.01, 32], banks: null }).bankId).toBeNull();
    expect(resolveBankBinding({ start: [120, 32], end: [120.01, 32], banks: banksOf() }).bankId).toBeNull();
  });

  it('MultiLineString 岸段也能归属', () => {
    const multi = {
      type: 'Feature' as const,
      properties: { bank_id: 'bankwgs84_5' },
      geometry: {
        type: 'MultiLineString' as const,
        coordinates: [
          [[120.0, 32.0], [120.05, 32.0]],
          [[120.05, 32.0], [120.1, 32.0]],
        ],
      },
    };
    const b = resolveBankBinding({ start: [120.08, 32.0], end: [120.08, 32.02], banks: banksOf(multi) });
    expect(b.bankId).toBe('bankwgs84_5');
    expect(b.matchedBy).toBe('start');
  });
});

describe('未归属提示文案', () => {
  it('有距离时报出实际米数与门限', () => {
    const text = describeUnbound({ ...resolveBankBinding({ start: [121.0, 32.5], end: [121.1, 32.5], banks: banksOf(BANK_A) }) });
    expect(text).toContain('未归属岸段');
    expect(text).toContain(`${MAX_BIND_DISTANCE_M} m`);
  });

  it('完全没有岸段时说明原因', () => {
    const text = describeUnbound({ ...resolveBankBinding({ start: [120, 32], end: [120.01, 32], banks: null }) });
    expect(text).toContain('无法关联');
  });
});
