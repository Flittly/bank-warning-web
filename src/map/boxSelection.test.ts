import { describe, expect, it } from 'vitest';
import {
  assessBoxAgainstDems,
  bankCandidatesFromBanks,
  bankCandidatesFromFeatures,
  boundsOfGeoJson,
  boxFromCorners,
  boxPolygon,
  boxesIntersect,
  boxToBbox,
  demBoundsOf,
  demNote,
  isBoxTooSmall,
  isValidBox,
  pickBankIdsInBox,
  summarizeBoxSelection,
} from './boxSelection';

/** 一条横穿 (119.8,32.0)-(120.2,32.0) 的岸段：框只盖住中段，两端都在框外 */
const CROSSING_LINE = { type: 'LineString', coordinates: [[119.8, 32.0], [120.0, 32.0], [120.2, 32.0]] };
/** 完全在框内的小岸段 */
const INSIDE_LINE = { type: 'LineString', coordinates: [[119.9, 31.9], [119.95, 31.95]] };
/** 完全在框外 */
const OUTSIDE_LINE = { type: 'LineString', coordinates: [[118.0, 30.0], [118.1, 30.1]] };

describe('矩形构造与校验', () => {
  it('任意方向拖拽都规范成 west<east / south<north', () => {
    const a = boxFromCorners([120.2, 32.1], [119.9, 31.8]);
    const b = boxFromCorners([119.9, 31.8], [120.2, 32.1]);
    expect(a).toEqual({ west: 119.9, south: 31.8, east: 120.2, north: 32.1 });
    expect(a).toEqual(b);
  });

  it('边界值非法（NaN / 零宽）一律判为无效', () => {
    expect(isValidBox(null)).toBe(false);
    expect(isValidBox({ west: 1, south: 1, east: 1, north: 2 })).toBe(false);
    expect(isValidBox({ west: Number.NaN, south: 1, east: 2, north: 2 })).toBe(false);
    expect(isValidBox({ west: 1, south: 1, east: 2, north: 2 })).toBe(true);
  });

  it('太小的框按误点处理（默认阈值 ≈11 m）', () => {
    const tiny = boxFromCorners([120, 32], [120.00001, 32.00001]);
    const normal = boxFromCorners([120, 32], [120.001, 32.001]);
    expect(isBoxTooSmall(tiny)).toBe(true);
    expect(isBoxTooSmall(normal)).toBe(false);
    // 无效矩形也算"太小"：调用方不需要再判一次 isValidBox
    expect(isBoxTooSmall(null)).toBe(true);
  });

  it('polygon 首尾闭合，bbox 顺序与 turf 一致', () => {
    const box = { west: 119.9, south: 31.8, east: 120.2, north: 32.1 };
    const ring = boxPolygon(box).geometry.coordinates[0];
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
    expect(boxToBbox(box)).toEqual([119.9, 31.8, 120.2, 32.1]);
  });

  it('矩形相交含相切（边界贴边也算压上）', () => {
    const a = { west: 0, south: 0, east: 10, north: 10 };
    expect(boxesIntersect(a, { west: 10, south: 0, east: 20, north: 10 })).toBe(true);
    expect(boxesIntersect(a, { west: 10.0001, south: 0, east: 20, north: 10 })).toBe(false);
  });
});

describe('取外包矩形', () => {
  it('裸几何 / Feature / FeatureCollection 都能取', () => {
    const geom = { type: 'LineString', coordinates: [[119, 31], [120, 32]] };
    expect(boundsOfGeoJson(geom)).toEqual({ west: 119, south: 31, east: 120, north: 32 });
    expect(boundsOfGeoJson({ type: 'Feature', properties: {}, geometry: geom })).toEqual(
      { west: 119, south: 31, east: 120, north: 32 },
    );
    const fc = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: geom },
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [121, 30] } },
      ],
    };
    expect(boundsOfGeoJson(fc)).toEqual({ west: 119, south: 30, east: 121, north: 32 });
  });

  it('坏数据返回 null 而不是抛错（一条坏几何不该毁掉整次框选）', () => {
    expect(boundsOfGeoJson(null)).toBeNull();
    expect(boundsOfGeoJson({ type: 'LineString' })).toBeNull();
    expect(boundsOfGeoJson('not json')).toBeNull();
  });

  it('DEM 范围清单逐个取外包矩形，跳过坏要素', () => {
    const dems = demBoundsOf({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { tiff_key: 'a' }, geometry: { type: 'Polygon', coordinates: [[[119, 31], [120, 31], [120, 32], [119, 32], [119, 31]]] } },
        { type: 'Feature', properties: { tiff_key: 'b' }, geometry: null },
        { type: 'Feature', properties: { tiff_key: 'c' }, geometry: { type: 'Polygon', coordinates: [[[121, 30], [121.5, 30], [121.5, 30.5], [121, 30.5], [121, 30]]] } },
      ],
    });
    expect(dems).toHaveLength(2);
    expect(dems[0]).toEqual({ west: 119, south: 31, east: 120, north: 32 });
  });
});

describe('框与 DEM 范围的关系', () => {
  const demA = { west: 119, south: 31, east: 120, north: 32 };
  const demB = { west: 120.5, south: 31, east: 121.5, north: 32 };

  it('地图上没显示 DEM 范围 → no-dem（不提示 DEM 相关的话）', () => {
    const r = assessBoxAgainstDems({ west: 119.5, south: 31.5, east: 119.6, north: 31.6 }, []);
    expect(r).toEqual({ relation: 'no-dem', touched: 0, covered: 0, total: 0 });
    expect(demNote(r)).toBe('');
  });

  it('框完全落在所有 DEM 之外 → outside（仍照常选，只多一句解释）', () => {
    const r = assessBoxAgainstDems({ west: 118, south: 30, east: 118.5, north: 30.5 }, [demA, demB]);
    expect(r.relation).toBe('outside');
    expect(demNote(r)).toContain('不在任何已显示的 DEM 范围内');
  });

  it('框小于 DEM 范围 → inside', () => {
    const r = assessBoxAgainstDems({ west: 119.2, south: 31.2, east: 119.4, north: 31.4 }, [demA, demB]);
    expect(r.relation).toBe('inside');
    expect(demNote(r)).toContain('小于 DEM 范围');
  });

  it('框覆盖整块 DEM → covers，并报覆盖数量', () => {
    const r = assessBoxAgainstDems({ west: 118, south: 30, east: 122, north: 33 }, [demA, demB]);
    expect(r.relation).toBe('covers');
    expect(r.covered).toBe(2);
    expect(demNote(r)).toContain('已覆盖 2 个 DEM 范围');
  });

  it('与 DEM 部分重叠 → partial', () => {
    const r = assessBoxAgainstDems({ west: 119.5, south: 31.5, east: 120.5, north: 32.5 }, [demA, demB]);
    expect(r.relation).toBe('partial');
    expect(r.touched).toBe(2);
  });
});

describe('岸段候选集', () => {
  it('资源库清单：兼容 bank_geometry / geometry / 字符串 JSON，缺失几何的跳过', () => {
    const list = bankCandidatesFromBanks([
      { bank_id: 'b1', bank_geometry: CROSSING_LINE },
      { bank_id: 'b2', geometry: INSIDE_LINE },
      { bank_id: 'b3', bank_geometry: JSON.stringify(OUTSIDE_LINE) },
      { bank_id: 'b4' },
      { bank_id: 'b1', bank_geometry: OUTSIDE_LINE }, // 重复 id 只留第一条
    ]);
    expect(list.map((c) => c.id)).toEqual(['b1', 'b2', 'b3']);
    expect(list[2].geometry.type).toBe('LineString');
  });

  it('地图要素：只认线、且必须有 bank_id（未入库的 line-N 占位不参与）', () => {
    const list = bankCandidatesFromFeatures({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { bank_id: 'b1' }, geometry: CROSSING_LINE },
        { type: 'Feature', properties: { bank_id: 'b2' }, geometry: { type: 'Polygon', coordinates: [] } },
        { type: 'Feature', properties: {}, geometry: INSIDE_LINE },
      ],
    });
    expect(list.map((c) => c.id)).toEqual(['b1']);
  });
});

describe('命中判定', () => {
  const candidates = [
    { id: 'crossing', geometry: CROSSING_LINE },
    { id: 'inside', geometry: INSIDE_LINE },
    { id: 'outside', geometry: OUTSIDE_LINE },
  ];

  it('相交即命中：岸段只有中段在框里也算（不要求整条被包含）', () => {
    const ids = pickBankIdsInBox(candidates, { west: 119.9, south: 31.85, east: 120.05, north: 32.05 });
    expect(ids).toContain('crossing');
    expect(ids).toContain('inside');
    expect(ids).not.toContain('outside');
  });

  it('框与岸段完全不相交 → 空结果', () => {
    expect(pickBankIdsInBox(candidates, { west: 117, south: 29, east: 117.5, north: 29.5 })).toEqual([]);
  });

  it('退化矩形不产生命中（宁可不选，也不要选中一片）', () => {
    expect(pickBankIdsInBox(candidates, { west: 120, south: 32, east: 120, north: 32 })).toEqual([]);
  });

  it('坏几何被跳过，不影响其它岸段', () => {
    const ids = pickBankIdsInBox(
      [{ id: 'bad', geometry: { type: 'LineString', coordinates: 'oops' } }, { id: 'inside', geometry: INSIDE_LINE }],
      { west: 119.85, south: 31.85, east: 120.05, north: 32.05 },
    );
    expect(ids).toEqual(['inside']);
  });
});

describe('结果摘要文案', () => {
  const noDem = { relation: 'no-dem' as const, touched: 0, covered: 0, total: 0 };

  it('已加载范围内命中：只报命中/候选', () => {
    const s = summarizeBoxSelection({ matched: 3, candidates: 40, scope: 'loaded', dem: noDem });
    expect(s.ok).toBe(true);
    expect(s.text).toContain('命中 3 条');
    expect(s.text).toContain('已加载 40 条');
  });

  it('全库命中：说明会加载到地图', () => {
    const s = summarizeBoxSelection({ matched: 5, candidates: 113, scope: 'library', dem: noDem });
    expect(s.ok).toBe(true);
    expect(s.text).toContain('全库 113 条');
    expect(s.text).toContain('已加载到地图');
  });

  it('候选为空时给出下一步动作，而不是干巴巴报 0', () => {
    const s = summarizeBoxSelection({ matched: 0, candidates: 0, scope: 'loaded', dem: noDem });
    expect(s.ok).toBe(false);
    expect(s.text).toContain('框选全库岸段');
  });

  it('框落在 DEM 之外且没命中：两个原因都要说清', () => {
    const s = summarizeBoxSelection({
      matched: 0,
      candidates: 12,
      scope: 'loaded',
      dem: { relation: 'outside', touched: 0, covered: 0, total: 2 },
    });
    expect(s.ok).toBe(false);
    expect(s.text).toContain('没有岸段');
    expect(s.text).toContain('不在任何已显示的 DEM 范围内');
  });
});
