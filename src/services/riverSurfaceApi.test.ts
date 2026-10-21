import { describe, expect, it } from 'vitest';
import { DEFAULT_RIVER_TOL_M, normalizeRiverSurface } from './riverSurfaceApi';

/**
 * 长江范围图层的入参归一化。
 *
 * 这层要挡住的都是"画出来会让人以为规则判错了"的情形：
 *   1. 几何为 null 的要素 —— Mapbox 拿到 null geometry 会整条 source 报错；
 *   2. 坐档位错误（3857 米制漏出来）—— 图层飞出视野，比直接报错更难排查；
 *   3. 缺 meta —— 侧栏要显示"多少点/多大容差"，不能靠猜。
 */
const polygonFeature = (coords: number[][][], props: Record<string, unknown> = {}) => ({
  type: 'Feature',
  properties: { name: '长江', ...props },
  geometry: { type: 'Polygon', coordinates: coords },
});

const RING: number[][][] = [
  [
    [118.45, 31.6],
    [121.9, 31.6],
    [121.9, 32.3],
    [118.45, 32.3],
    [118.45, 31.6],
  ],
];

describe('normalizeRiverSurface', () => {
  it('保留 Polygon / MultiPolygon，扔掉 null 几何与非面几何', () => {
    const out = normalizeRiverSurface({
      success: true,
      data: {
        type: 'FeatureCollection',
        features: [
          polygonFeature(RING),
          { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[118, 31], [119, 32]] } },
          { type: 'Feature', properties: {}, geometry: null },
          {
            type: 'Feature',
            properties: {},
            geometry: { type: 'MultiPolygon', coordinates: [RING] },
          },
        ],
      },
      meta: { source: 'river_yangtze', srid: 4326, tol_m: 30, features: 2, points: 8841 },
    });

    expect(out.collection.features).toHaveLength(2);
    expect(out.meta.tolM).toBe(30);
    expect(out.meta.points).toBe(8841);
    expect(out.meta.source).toBe('river_yangtze');
  });

  it('容差缺省回落到"不简化"（0），不影响几何', () => {
    const out = normalizeRiverSurface({ data: { type: 'FeatureCollection', features: [polygonFeature(RING)] } });
    expect(out.meta.tolM).toBe(DEFAULT_RIVER_TOL_M);
    expect(out.meta.features).toBe(1);
    expect(out.collection.features).toHaveLength(1);
  });

  it('3857 米制坐标漏出来时直接抛错，而不是把图层画到视野外', () => {
    const mercatorRing: number[][][] = [
      [
        [13187374, 3699229],
        [13572109, 3699229],
        [13572109, 3807050],
        [13187374, 3807050],
        [13187374, 3699229],
      ],
    ];
    expect(() => normalizeRiverSurface({ data: { type: 'FeatureCollection', features: [polygonFeature(mercatorRing)] } }))
      .toThrow(/不是经纬度/);
  });

  it('空集合不抛错（交由调用方按 empty 处理）', () => {
    const out = normalizeRiverSurface({ data: { type: 'FeatureCollection', features: [] } });
    expect(out.collection.features).toHaveLength(0);
    expect(out.meta.features).toBe(0);
  });
});
