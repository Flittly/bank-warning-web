/**
 * 框选分析统计口径的契约测试。
 *
 * 守三件事：
 * 1. **长度** = 岸段色带在选区内的长度（按断面中点切段，与图上颜色同一套口径）；
 * 2. **断面数** = 与选区相交的断面（不是「中点在内」）；
 * 3. 低风险 / 未计算**计入分母**（否占比会虚高）。两者的区别在 `rendered`：
 *    低风险自 2026-10-26 起在图上着绿色 ⇒ `rendered: true`；
 *    未计算是「没数」，图上仍留空 ⇒ `rendered: false`。
 *
 * 全部用真实经纬度附近的坐标（119.2E / 32.2N），turf 算出来的就是米，不靠手写换算。
 */
import * as turf from '@turf/turf';
import { describe, expect, it } from 'vitest';

import {
  computeAreaRiskStats,
  emptyAreaRiskStats,
  lengthInsidePolygon,
  rowKeyOfLevel,
  toSelectionFeature,
  UNKNOWN_RISK_KEY,
} from './areaRiskAnalysis';

const LAT = 32.2;
const LNG0 = 119.2;
const LNG1 = 119.4;

const bankLine = (): GeoJSON.LineString => ({
  type: 'LineString',
  coordinates: [[LNG0, LAT], [LNG1, LAT]],
});

const banks = () => [{ bank_id: 'B1', geometry: bankLine() }];

/** 沿岸线等距发一条断面（断面本身画成短的竖线，不影响沿线投影位置）。 */
function sectionAt(id: string, lng: number, level: number | null, bankId: string | null = 'B1') {
  return {
    section_id: id,
    bank_id: bankId,
    geometry: {
      type: 'LineString' as const,
      coordinates: [[lng, LAT - 0.002], [lng, LAT + 0.002]] as number[][],
    },
    level,
  };
}

function totalBankLengthM(): number {
  return turf.length(turf.lineString(bankLine().coordinates as any), { units: 'meters' });
}

function box(west: number, south: number, east: number, north: number): GeoJSON.Polygon {
  return {
    type: 'Polygon',
    coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
  };
}

describe('lengthInsidePolygon', () => {
  it('线被多边形完全包含时返回全长（lineSplit 无交点会返回 0 段，这里必须兜住）', () => {
    const line = turf.lineString([[119.2, 32.2], [119.4, 32.2]]);
    const poly = turf.feature(box(119.1, 32.1, 119.5, 32.3));
    const full = turf.length(line, { units: 'meters' });

    expect(lengthInsidePolygon(line as any, poly as any)).toBeCloseTo(full, 3);
  });

  it('完全在外时返回 0', () => {
    const line = turf.lineString([[119.2, 32.2], [119.4, 32.2]]);
    const poly = turf.feature(box(120.0, 32.1, 120.2, 32.3));
    expect(lengthInsidePolygon(line as any, poly as any)).toBe(0);
  });

  it('只截取区内那一段（与多边形区域等长）', () => {
    const line = turf.lineString([[119.2, 32.2], [119.4, 32.2]]);
    const poly = turf.feature(box(119.25, 32.1, 119.35, 32.3));
    const expected = turf.length(turf.lineString([[119.25, 32.2], [119.35, 32.2]]), { units: 'meters' });

    expect(lengthInsidePolygon(line as any, poly as any)).toBeCloseTo(expected, 3);
  });

  it('凹多边形里伸出去的那一截不算（内-外-内 两段相加）', () => {
    const line = turf.lineString([[119.2, 32.2], [119.4, 32.2]]);
    // 中间从北侧挖进一条走廊（下探到 32.15，低于 32.2 这条线），把线切断
    const poly = turf.feature({
      type: 'Polygon',
      coordinates: [[
        [119.22, 32.1], [119.38, 32.1], [119.38, 32.3], [119.32, 32.3],
        [119.32, 32.15], [119.28, 32.15], [119.28, 32.3], [119.22, 32.3], [119.22, 32.1],
      ]],
    } as any);
    const left = turf.length(turf.lineString([[119.22, 32.2], [119.28, 32.2]]), { units: 'meters' });
    const right = turf.length(turf.lineString([[119.32, 32.2], [119.38, 32.2]]), { units: 'meters' });

    expect(lengthInsidePolygon(line as any, poly as any)).toBeCloseTo(left + right, 3);
  });
});

describe('toSelectionFeature', () => {
  it('合法矩形能包成 feature 并算出面积', () => {
    const feature = toSelectionFeature(box(119.2, 32.1, 119.4, 32.3));
    expect(feature).not.toBeNull();
    expect(turf.area(feature as any)).toBeGreaterThan(0);
  });

  it('退化 / 空几何一律返回 null（不抛错）', () => {
    expect(toSelectionFeature(null)).toBeNull();
    expect(toSelectionFeature(undefined)).toBeNull();
    expect(toSelectionFeature({ type: 'Polygon', coordinates: [] } as any)).toBeNull();
    // 三个点共线，面积为 0
    expect(toSelectionFeature({
      type: 'Polygon',
      coordinates: [[[119.2, 32.2], [119.3, 32.2], [119.4, 32.2], [119.2, 32.2]]],
    } as any)).toBeNull();
  });
});

describe('rowKeyOfLevel', () => {
  it('0..3 各成一档，其余全部归到「未计算」', () => {
    expect([0, 1, 2, 3].map(rowKeyOfLevel)).toEqual(['0', '1', '2', '3']);
    expect(rowKeyOfLevel(null)).toBe(UNKNOWN_RISK_KEY);
    expect(rowKeyOfLevel(undefined)).toBe(UNKNOWN_RISK_KEY);
    expect(rowKeyOfLevel(4)).toBe(UNKNOWN_RISK_KEY);
    expect(rowKeyOfLevel(-1)).toBe(UNKNOWN_RISK_KEY);
    expect(rowKeyOfLevel(1.5)).toBe(UNKNOWN_RISK_KEY);
    expect(rowKeyOfLevel(NaN)).toBe(UNKNOWN_RISK_KEY);
  });
});

describe('computeAreaRiskStats', () => {
  it('没有选区时返回全 0 的 5 行', () => {
    const stats = computeAreaRiskStats({ selection: null, banks: banks(), sections: [] });
    expect(stats.totalLengthM).toBe(0);
    expect(stats.sectionCount).toBe(0);
    expect(stats.rows.map(r => r.key)).toEqual(['3', '2', '1', '0', UNKNOWN_RISK_KEY]);
    expect(stats.rows.every(r => r.lengthM === 0 && r.lengthRatio === 0)).toBe(true);
  });

  it('只框住前 1/4 岸段：只有高风险那一行有长度，其余为 0', () => {
    const sections = [
      sectionAt('S1', LNG0, 3),
      sectionAt('S2', (LNG0 + LNG1) / 2, 2),
      sectionAt('S3', LNG1, 1),
    ];
    const total = totalBankLengthM();

    // 三条断面把岸段切成 0~25%、25~75%、75~100% 三段
    const stats = computeAreaRiskStats({
      selection: box(LNG0 - 0.001, LAT - 0.01, LNG0 + 0.05, LAT + 0.01),
      banks: banks(),
      sections,
    });

    const high = stats.rows.find(r => r.key === '3')!;
    expect(high.lengthM / total).toBeCloseTo(0.25, 3);
    expect(high.lengthRatio).toBeCloseTo(1, 6);
    expect(stats.totalLengthM / total).toBeCloseTo(0.25, 3);
    // 选区东边界正压在 span0/span1 的分界上，浮点误差会漏进几厘米，按「可忽略」处理
    expect(stats.rows.find(r => r.key === '2')!.lengthM).toBeLessThan(1);
    expect(stats.bankCount).toBe(1);
  });

  it('框住整条岸段：三档按断面管辖区间 25% / 50% / 25% 分摊', () => {
    const sections = [
      sectionAt('S1', LNG0, 3),
      sectionAt('S2', (LNG0 + LNG1) / 2, 2),
      sectionAt('S3', LNG1, 1),
    ];
    const stats = computeAreaRiskStats({
      selection: box(LNG0 - 0.01, LAT - 0.01, LNG1 + 0.01, LAT + 0.01),
      banks: banks(),
      sections,
    });

    const ratio = (key: string) => stats.rows.find(r => r.key === key)!.lengthRatio;
    expect(ratio('3')).toBeCloseTo(0.25, 3);
    expect(ratio('2')).toBeCloseTo(0.5, 3);
    expect(ratio('1')).toBeCloseTo(0.25, 3);
    expect(stats.totalLengthM).toBeCloseTo(totalBankLengthM(), 3);
  });

  it('低风险计入分母且同属可渲染（2026-10-26 起上色）', () => {
    const sections = [
      sectionAt('S1', LNG0, 3),
      sectionAt('S2', (LNG0 + LNG1) / 2, 0),
      sectionAt('S3', LNG1, 0),
    ];
    const stats = computeAreaRiskStats({
      selection: box(LNG0 - 0.01, LAT - 0.01, LNG1 + 0.01, LAT + 0.01),
      banks: banks(),
      sections,
    });

    const low = stats.rows.find(r => r.key === '0')!;
    const high = stats.rows.find(r => r.key === '3')!;
    expect(low.lengthRatio).toBeCloseTo(0.75, 3);
    expect(high.lengthRatio).toBeCloseTo(0.25, 3);
    // rendered 的语义 = 「这个等级在图上会不会着色」。低风险自 2026-10-26 起着绿，
    // 所以不再被标成「图上不渲染」（面板也不会再把它灰化）。
    expect(low.rendered).toBe(true);
    expect(high.rendered).toBe(true);
    // 两行长度相加 = 总长：低风险没有被「悄悄丢掉」
    expect(low.lengthM + high.lengthM).toBeCloseTo(stats.totalLengthM, 3);
  });

  it('没有断面的岸段整条算「未计算」，长度不丢', () => {
    const stats = computeAreaRiskStats({
      selection: box(LNG0 - 0.01, LAT - 0.01, LNG1 + 0.01, LAT + 0.01),
      banks: banks(),
      sections: [],
    });

    const unknown = stats.rows.find(r => r.key === UNKNOWN_RISK_KEY)!;
    expect(unknown.lengthM).toBeCloseTo(totalBankLengthM(), 3);
    expect(unknown.lengthRatio).toBeCloseTo(1, 6);
    expect(unknown.rendered).toBe(false);
  });

  it('断面数按「与选区相交」计：横穿选区的断面即使两端在外也算', () => {
    // 断面是一条竖线，两端都在选区上下之外，但中段穿过选区
    const crossing = {
      section_id: 'SX',
      bank_id: 'B1',
      geometry: {
        type: 'LineString' as const,
        coordinates: [[119.25, 32.19], [119.25, 32.21]] as number[][],
      },
      level: 2,
    };
    const stats = computeAreaRiskStats({
      selection: box(119.24, 32.195, 119.26, 32.205),
      banks: banks(),
      sections: [crossing],
    });

    expect(stats.sectionCount).toBe(1);
    expect(stats.rows.find(r => r.key === '2')!.sectionCount).toBe(1);
    expect(stats.rows.find(r => r.key === '2')!.sectionRatio).toBe(1);
  });

  it('不在任何岸段上的自由断面仍计入断面数，但不影响长度', () => {
    const freeSection = {
      section_id: 'SF',
      bank_id: null,
      geometry: {
        type: 'LineString' as const,
        coordinates: [[119.3, 32.199], [119.3, 32.201]] as number[][],
      },
      level: 1,
    };
    const stats = computeAreaRiskStats({
      selection: box(119.29, 32.195, 119.31, 32.205),
      banks: banks(),
      sections: [freeSection],
    });

    expect(stats.sectionCount).toBe(1);
    expect(stats.rows.find(r => r.key === '1')!.sectionCount).toBe(1);
    // 岸段在这块选区里没有任何断面 ⇒ 整段未计算，长度照算
    expect(stats.rows.find(r => r.key === UNKNOWN_RISK_KEY)!.lengthM).toBeGreaterThan(0);
  });

  it('面积按球面算（m²），且随选区大小变化', () => {
    const small = computeAreaRiskStats({
      selection: box(119.2, 32.2, 119.3, 32.3),
      banks: [],
      sections: [],
    });
    const big = computeAreaRiskStats({
      selection: box(119.2, 32.2, 119.4, 32.4),
      banks: [],
      sections: [],
    });

    expect(small.areaM2).toBeGreaterThan(0);
    expect(big.areaM2).toBeGreaterThan(small.areaM2 * 3.5);
    expect(big.areaM2).toBeLessThan(small.areaM2 * 4.5);
  });

  it('非法几何的岸段/断面被跳过，不抛错', () => {
    const stats = computeAreaRiskStats({
      selection: box(119.2, 32.1, 119.4, 32.3),
      banks: [
        { bank_id: 'bad', geometry: null },
        { bank_id: 'short', geometry: { type: 'LineString', coordinates: [[119.2, 32.2]] } },
        ...banks(),
      ] as any,
      sections: [
        { section_id: 'x', bank_id: 'B1', geometry: null, level: 3 },
      ] as any,
    });

    expect(stats.bankCount).toBe(1);
    expect(stats.totalLengthM).toBeGreaterThan(0);
    expect(stats.sectionCount).toBe(0);
  });

  it('emptyAreaRiskStats 的行标签与颜色来自 RISK_LABELS / RISK_COLORS', () => {
    const rows = emptyAreaRiskStats().rows;
    expect(rows.map(r => r.label)).toEqual(['高风险', '较高风险', '中风险', '低风险', '未计算']);
    expect(rows.map(r => r.key)).toEqual(['3', '2', '1', '0', UNKNOWN_RISK_KEY]);
  });
});
