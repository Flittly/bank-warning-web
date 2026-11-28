import { describe, expect, it } from 'vitest';
import { pickTaskDemId, terrainSpecOf } from './demTerrainService';

describe('pickTaskDemId（任务 → DEM）', () => {
  it('取出现次数最多的那份 DEM（跨区任务的主 DEM）', () => {
    const profiles = {
      a: { dem_id: 'tiff/A.tif' },
      b: { dem_id: 'tiff/B.tif' },
      c: { dem_id: 'tiff/B.tif' },
    };
    expect(pickTaskDemId(profiles)).toBe('tiff/B.tif');
  });

  it('并列时按 key 排序取第一个（结果必须确定，否则每次打开三维看到的区域会变）', () => {
    const profiles = {
      a: { dem_id: 'tiff/Z.tif' },
      b: { dem_id: 'tiff/A.tif' },
    };
    expect(pickTaskDemId(profiles)).toBe('tiff/A.tif');
    expect(pickTaskDemId({ b: profiles.b, a: profiles.a })).toBe('tiff/A.tif');
  });

  it('兼容 demId 写法与空值：任务还没跑出断面档案时返回 null', () => {
    expect(pickTaskDemId({ a: { demId: 'tiff/X.tif' } })).toBe('tiff/X.tif');
    expect(pickTaskDemId({ a: { dem_id: '   ' }, b: { dem_id: null } })).toBeNull();
    expect(pickTaskDemId({})).toBeNull();
    expect(pickTaskDemId(null)).toBeNull();
  });

  it('去掉首尾空白：库里有 \tiff\\A 与 tiff/A 两种写法混用过', () => {
    expect(pickTaskDemId({ a: { dem_id: '  tiff/A.tif  ' } })).toBe('tiff/A.tif');
  });
});

describe('terrainSpecOf', () => {
  const ready = {
    tiff_key: 'tiff/A.tif',
    status: 'ready' as const,
    fingerprint: 'abc123',
    minzoom: 0,
    maxzoom: 12,
    bounds: { west: 118, south: 31, east: 122, north: 33 },
    tile_count: 10,
    error: null,
    generated_at: null,
  };

  it('ready 才给 spec，bounds 拍平成 [西, 南, 东, 北]', () => {
    expect(terrainSpecOf(ready)).toEqual({
      tiffKey: 'tiff/A.tif',
      fingerprint: 'abc123',
      minzoom: 0,
      maxzoom: 12,
      bounds: [118, 31, 122, 33],
    });
  });

  it('未就绪一律 null：缺指纹/缺层级/缺范围都挂不上', () => {
    expect(terrainSpecOf(null)).toBeNull();
    expect(terrainSpecOf({ ...ready, status: 'building' })).toBeNull();
    expect(terrainSpecOf({ ...ready, fingerprint: null })).toBeNull();
    expect(terrainSpecOf({ ...ready, maxzoom: null })).toBeNull();
    expect(terrainSpecOf({ ...ready, bounds: null })).toBeNull();
  });
});
