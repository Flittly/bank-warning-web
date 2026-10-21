import { describe, expect, it } from 'vitest';
import * as turf from '@turf/turf';
import { sectionProgressAlongBank } from './sectionBandProgress';

// 一条约 954 m 的东向岸段（31°N 上 0.01° 经度 ≈ 954 m），便于断言比例。
const bankLine = turf.lineString([
  [120.0, 31.0],
  [120.01, 31.0],
]);
const totalDist = turf.length(bankLine, { units: 'meters' });

/** 一条横跨岸段的断面（南北向），中点落在给定经度上。 */
const sectionAt = (lng: number, distance?: number) => ({
  distance,
  geometry: {
    type: 'LineString',
    coordinates: [
      [lng, 30.999],
      [lng, 31.001],
    ],
  },
});

describe('sectionProgressAlongBank', () => {
  it('按几何投影定位，桩号与实际位置矛盾时以几何为准', () => {
    // 桩号写 0（岸段起点），几何却在 60% 处 —— 拖动断面后就是这个状态。
    const progress = sectionProgressAlongBank(sectionAt(120.006, 0), bankLine, totalDist);
    expect(progress).not.toBeNull();
    expect(progress as number).toBeCloseTo(0.6, 2);
  });

  it('落在岸段两端之外时夹到 0 / 1', () => {
    expect(sectionProgressAlongBank(sectionAt(119.99), bankLine, totalDist)).toBe(0);
    expect(sectionProgressAlongBank(sectionAt(120.02), bankLine, totalDist)).toBe(1);
  });

  it('没有几何（只有桩号）时回落桩号', () => {
    const progress = sectionProgressAlongBank({ distance: totalDist * 0.25 }, bankLine, totalDist);
    expect(progress as number).toBeCloseTo(0.25, 4);
  });

  it('几何与桩号都不可用时返回 null，交给调用方跳过该条断面', () => {
    expect(sectionProgressAlongBank({}, bankLine, totalDist)).toBeNull();
    expect(sectionProgressAlongBank(null, bankLine, totalDist)).toBeNull();
  });

  it('岸段长度为 0 时返回 null，不做除零', () => {
    expect(sectionProgressAlongBank(sectionAt(120.006), bankLine, 0)).toBeNull();
  });
});
