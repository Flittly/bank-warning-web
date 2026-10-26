import { describe, expect, it } from 'vitest';
import {
  BANK_EDIT_DRAFT_LAYER_ID,
  BANK_EDIT_VERTEX_HIT_LAYER_ID,
  BANK_EDIT_VERTEX_LAYER_ID,
  bankEditDraftPaint,
  bankEditVertexHitPaint,
  bankEditVertexPaint,
  coordsSignature,
  coordsToLineFeature,
  deleteVertex,
  dropCoincidentVertices,
  insertVertexAfter,
  moveVertex,
  nearestPointOnBank,
  normalizeBankCoords,
  vertexFeatures,
} from './bankGeometryEdit';

const LINE = {
  type: 'LineString',
  coordinates: [
    [120.0, 32.0],
    [120.1, 32.1],
    [120.2, 32.2],
  ],
};

describe('normalizeBankCoords：只接一条首尾有序的线', () => {
  it('标准 LineString 原样取出', () => {
    expect(normalizeBankCoords(LINE)).toEqual([
      [120.0, 32.0],
      [120.1, 32.1],
      [120.2, 32.2],
    ]);
  });

  it('MultiLineString 返回 null —— 拼接会在段间造出假岸线，那段假线会被算进长度', () => {
    expect(
      normalizeBankCoords({ type: 'MultiLineString', coordinates: [[[120, 32], [120.1, 32.1]]] }),
    ).toBeNull();
  });

  it('Polygon / Point / 空值一律 null', () => {
    expect(normalizeBankCoords({ type: 'Polygon', coordinates: [] })).toBeNull();
    expect(normalizeBankCoords({ type: 'Point', coordinates: [120, 32] })).toBeNull();
    expect(normalizeBankCoords(null)).toBeNull();
    expect(normalizeBankCoords(undefined)).toBeNull();
  });

  it('少于 2 个折点返回 null（画不出一条线）', () => {
    expect(normalizeBankCoords({ type: 'LineString', coordinates: [[120, 32]] })).toBeNull();
    expect(normalizeBankCoords({ type: 'LineString', coordinates: [] })).toBeNull();
  });

  it('任何非法坐标都会让整条几何作废，而不是悄悄丢掉那个点', () => {
    // 丢点会静默改变岸线形状；作废则让用户看到「这条岸段读不出来」，两种后果差很远。
    expect(normalizeBankCoords({ type: 'LineString', coordinates: [[120, 32], [NaN, 32.1]] })).toBeNull();
    expect(normalizeBankCoords({ type: 'LineString', coordinates: [[120, 32], [120.1, Infinity]] })).toBeNull();
    expect(normalizeBankCoords({ type: 'LineString', coordinates: [[120, 32], [null, 32.1]] })).toBeNull();
    expect(normalizeBankCoords({ type: 'LineString', coordinates: [[120, 32], ['120.1', '32.1']] })).toBeNull();
  });

  it('超出经纬度范围返回 null —— 越界点会让 Mapbox 整条线都不画', () => {
    expect(normalizeBankCoords({ type: 'LineString', coordinates: [[181, 32], [120.1, 32.1]] })).toBeNull();
    expect(normalizeBankCoords({ type: 'LineString', coordinates: [[120, 32], [120.1, 91]] })).toBeNull();
  });
});

describe('moveVertex', () => {
  it('只改目标折点，其余原样', () => {
    const next = moveVertex(LINE.coordinates as [number, number][], 1, 120.15, 32.15);
    expect(next[1]).toEqual([120.15, 32.15]);
    expect(next[0]).toEqual([120.0, 32.0]);
    expect(next[2]).toEqual([120.2, 32.2]);
  });

  it('返回新数组，不原地改入参（React 靠引用变化重绘）', () => {
    const source = LINE.coordinates as [number, number][];
    const next = moveVertex(source, 0, 121, 33);
    expect(next).not.toBe(source);
    expect(source[0]).toEqual([120.0, 32.0]);
  });

  it('越界下标 / 非法坐标都退化为「原样复制」而不是抛错', () => {
    const source = LINE.coordinates as [number, number][];
    expect(moveVertex(source, 9, 121, 33)).toEqual(source);
    expect(moveVertex(source, -1, 121, 33)).toEqual(source);
    expect(moveVertex(source, 0, NaN, 33)).toEqual(source);
    expect(moveVertex(source, 0, 121, 999)).toEqual(source);
  });
});

describe('insertVertexAfter', () => {
  it('插在第 segmentIndex 段之后（下标 = segmentIndex + 1）', () => {
    const next = insertVertexAfter(LINE.coordinates as [number, number][], 0, 120.05, 32.05);
    expect(next).toHaveLength(4);
    expect(next[1]).toEqual([120.05, 32.05]);
    // 原有折点顺序不变
    expect(next[2]).toEqual([120.1, 32.1]);
    expect(next[3]).toEqual([120.2, 32.2]);
  });

  it('插在末段内部时落在倒数第二、末点之间（不是追加到末尾）', () => {
    // 末段 = coords[1] → coords[2]，新点下标应为 2，末点仍在下标 3
    const next = insertVertexAfter(LINE.coordinates as [number, number][], 1, 120.15, 32.15);
    expect(next).toHaveLength(4);
    expect(next[2]).toEqual([120.15, 32.15]);
    expect(next[3]).toEqual([120.2, 32.2]);
  });

  it('segmentIndex 超出 [0, n-2] 时不插入 —— 否则会在数组外造出空洞', () => {
    const source = LINE.coordinates as [number, number][];
    expect(insertVertexAfter(source, -1, 120, 32)).toEqual(source);
    expect(insertVertexAfter(source, 2, 120, 32)).toEqual(source);
    expect(insertVertexAfter(source, 9, 120, 32)).toEqual(source);
  });
});

describe('deleteVertex', () => {
  it('删中间点', () => {
    const next = deleteVertex(LINE.coordinates as [number, number][], 1);
    expect(next).toEqual([
      [120.0, 32.0],
      [120.2, 32.2],
    ]);
  });

  it('只剩 2 个折点时拒绝删除并返回 null（调用方据此提示，而不是删出退化线）', () => {
    const two: [number, number][] = [
      [120, 32],
      [120.1, 32.1],
    ];
    expect(deleteVertex(two, 0)).toBeNull();
    expect(deleteVertex(two, 1)).toBeNull();
  });

  it('越界下标退化为原样复制', () => {
    const source = LINE.coordinates as [number, number][];
    expect(deleteVertex(source, 5)).toEqual(source);
  });
});

describe('dropCoincidentVertices', () => {
  it('清掉中间的重合折点，首尾一律保留', () => {
    const dirty: [number, number][] = [
      [120, 32],
      [120.1, 32.1],
      [120.1, 32.1],
      [120.2, 32.2],
    ];
    expect(dropCoincidentVertices(dirty)).toEqual([
      [120, 32],
      [120.1, 32.1],
      [120.2, 32.2],
    ]);
  });

  it('首尾重合也不清 —— 清了会让整条岸段整体偏移（两端是里程基准）', () => {
    const ring: [number, number][] = [
      [120, 32],
      [120.1, 32.1],
      [120, 32],
    ];
    expect(dropCoincidentVertices(ring)).toHaveLength(3);
  });

  it('全点重合时原样返回，不制造退化线', () => {
    const same: [number, number][] = [
      [120, 32],
      [120, 32],
      [120, 32],
    ];
    expect(dropCoincidentVertices(same)).toHaveLength(3);
  });
});

describe('nearestPointOnBank：双击插点的落点必须在线上', () => {
  it('命中第一段，且投影点确实落在线段上', () => {
    // 点在第一段旁边（纬度偏北一点），投影应回到线段上
    const hit = nearestPointOnBank(LINE.coordinates as [number, number][], 120.05, 32.06);
    expect(hit).not.toBeNull();
    expect(hit!.segmentIndex).toBe(0);
    // 投影点的经度应落在 [120.0, 120.1] 内，纬度随之介于两端之间
    expect(hit!.point[0]).toBeGreaterThan(120.0);
    expect(hit!.point[0]).toBeLessThan(120.1);
    expect(hit!.point[1]).toBeGreaterThan(32.0);
    expect(hit!.point[1]).toBeLessThan(32.1);
    expect(hit!.distance).toBeGreaterThan(0);
  });

  it('点正落在折点上时距离约为 0', () => {
    const hit = nearestPointOnBank(LINE.coordinates as [number, number][], 120.1, 32.1);
    expect(hit!.distance).toBeLessThan(1);
  });

  it('点在线延长线之外时投影夹到端点，不会跑到延长线上', () => {
    const hit = nearestPointOnBank(LINE.coordinates as [number, number][], 119.0, 31.0);
    expect(hit!.point).toEqual([120.0, 32.0]);
    expect(hit!.segmentIndex).toBe(0);
  });

  it('折点不足或坐标非法时返回 null', () => {
    expect(nearestPointOnBank([[120, 32]], 120, 32)).toBeNull();
    expect(nearestPointOnBank(LINE.coordinates as [number, number][], NaN, 32)).toBeNull();
  });

  it('相邻折点完全重合（零长度段）不抛错，退化为到端点距离', () => {
    const degenerate: [number, number][] = [
      [120, 32],
      [120, 32],
      [120.1, 32.1],
    ];
    const hit = nearestPointOnBank(degenerate, 120.05, 32.05);
    expect(hit).not.toBeNull();
    expect(Number.isFinite(hit!.distance)).toBe(true);
    expect(hit!.segmentIndex).toBe(1);
  });
});

describe('coordsSignature', () => {
  it('坐标变化后指纹必须变化（否则「是否改过」判断恒为 false）', () => {
    const a = coordsSignature(LINE.coordinates as [number, number][]);
    const b = coordsSignature(moveVertex(LINE.coordinates as [number, number][], 1, 120.15, 32.15));
    expect(a).not.toBe(b);
  });

  it('cm 以下的抖动视为未改（7 位小数 ≈ 1 cm）', () => {
    const a = coordsSignature([
      [120.0, 32.0],
      [120.1, 32.1],
    ]);
    const b = coordsSignature([
      [120.000000001, 32.0],
      [120.1, 32.1],
    ]);
    expect(a).toBe(b);
  });
});

describe('GeoJSON 输出形状', () => {
  it('vertexFeatures 的 index 必须是 number', () => {
    // 写成字符串时 Mapbox 的 ['==', ['get','index'], 3] 会静默不匹配
    const fc = vertexFeatures(LINE.coordinates as [number, number][]);
    expect(fc.features).toHaveLength(3);
    fc.features.forEach((f, i) => {
      expect(f.properties!.index).toBe(i);
      expect(typeof f.properties!.index).toBe('number');
    });
  });

  it('coordsToLineFeature 带 bank_id 属性，几何与入参一致', () => {
    const feature = coordsToLineFeature(LINE.coordinates as [number, number][], 'bank-1');
    expect(feature.properties).toEqual({ bank_id: 'bank-1' });
    expect(feature.geometry.coordinates).toHaveLength(3);
  });
});

describe('图层 paint 与 id', () => {
  it('草稿线/折点/命中层的 id 互不相同，clearMapLayers 才能分别清理', () => {
    const ids = [BANK_EDIT_DRAFT_LAYER_ID, BANK_EDIT_VERTEX_HIT_LAYER_ID, BANK_EDIT_VERTEX_LAYER_ID];
    expect(new Set(ids).size).toBe(3);
    // 必须与结果页已有图层前缀区分开，否则「清理 bankline-*」会误删编辑层
    ids.forEach(id => expect(id.startsWith('bankline-')).toBe(false));
  });

  it('草稿线用青色系而非风险四色 —— 避免被读成某一档风险', () => {
    const paint = bankEditDraftPaint();
    expect(paint['line-color']).toBe('#0ea5e9');
    ['#ef4444', '#f97316', '#3b82f6', '#10b981'].forEach(riskColor => {
      expect(paint['line-color']).not.toBe(riskColor);
    });
  });

  it('折点圆点半径随缩放插值，低缩放要小（平均一条岸段上百个折点）', () => {
    const expr = bankEditVertexPaint()['circle-radius'] as unknown[];
    expect(Array.isArray(expr)).toBe(true);
    expect(expr[0]).toBe('interpolate');
    // 取第一个 stop 的半径 < 最后一档，单调递增
    expect(Number(expr[4])).toBeLessThan(Number(expr[expr.length - 1]));
  });

  it('命中层完全透明但比圆点大 —— 只负责接鼠标，不参与观感', () => {
    const hit = bankEditVertexHitPaint();
    expect(Number(hit['circle-opacity'])).toBe(0);
    const hitExpr = hit['circle-radius'] as unknown[];
    const visibleExpr = bankEditVertexPaint()['circle-radius'] as unknown[];
    expect(Number(hitExpr[4])).toBeGreaterThan(Number(visibleExpr[4]));
  });
});
