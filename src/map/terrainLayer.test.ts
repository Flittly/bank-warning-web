import { describe, expect, it, vi } from 'vitest';
import type { Map as MapboxMap } from 'mapbox-gl';
import {
  DEFAULT_TERRAIN_EXAGGERATION,
  TERRAIN_ENTER_PITCH,
  TERRAIN_HILLSHADE_LAYER,
  TERRAIN_LIGHT,
  TERRAIN_SOURCE,
  applyTerrain,
  buildTerrainHillshadeLayer,
  buildTerrainSourceSpec,
  buildTerrainTileUrl,
  createTerrainTransformRequest,
  isTerrainTileError,
  terrainStatusView,
  terrainTileErrorStatus,
  terrainTileRequest,
  type DemTerrainSpec,
} from './terrainLayer';

/**
 * 这里的 spec 是真实 DEM `2023-Yangtze-uvhH.tif` 切出来的原值（照 metadata.json 抄）：
 * 指纹 921cd5752d5b178f，z0–12 共 266 张瓦片，范围 118.2129–121.9922E / 31.2786–32.5468N。
 * URL 少一段、bounds 顺序写反，地图上表现都是「地形不出来」或「去拉整片海的空白瓦片」，
 * 截图上看不出根因，所以这一层用单测钉死。
 */
const REAL_SPEC: DemTerrainSpec = {
  tiffKey: 'tiff/Yangtze/2023/standard/1998-2023/2023-Yangtze-uvhH.tif',
  fingerprint: '921cd5752d5b178f',
  minzoom: 0,
  maxzoom: 12,
  bounds: [118.21289062500001, 31.278550858946513, 121.99218749999999, 32.546813173515154],
};

/** 记录调用顺序的最小地图替身：摘地形那几步先后错了 Mapbox 会直接抛。 */
function fakeMap(initial: { source?: object; terrain?: object; existingLayers?: string[] } = {}) {
  const calls: string[] = [];
  const state = {
    source: initial.source ?? null,
    layer: false,
    terrain: initial.terrain ?? null,
    pitch: 0,
  };
  const map = {
    calls,
    state,
    getSource: vi.fn(() => state.source),
    getLayer: vi.fn((id: string) => state.layer || initial.existingLayers?.includes(id)),
    getTerrain: vi.fn(() => state.terrain),
    addSource: vi.fn((id: string, spec: unknown) => {
      calls.push(`addSource:${id}`);
      state.source = { serialize: () => spec };
    }),
    removeSource: vi.fn((id: string) => {
      calls.push(`removeSource:${id}`);
      state.source = null;
    }),
    addLayer: vi.fn((layer: { id: string }, before?: string) => {
      calls.push(`addLayer:${layer.id}@${before ?? 'top'}`);
      state.layer = true;
    }),
    removeLayer: vi.fn((id: string) => {
      calls.push(`removeLayer:${id}`);
      state.layer = false;
    }),
    setTerrain: vi.fn((t: object | null) => {
      calls.push(`setTerrain:${t ? 'on' : 'off'}`);
      state.terrain = t;
    }),
    setLight: vi.fn((l: { position?: number[] }) => {
      calls.push(`setLight:${l?.position?.join('/') ?? 'default'}`);
    }),
    getPitch: vi.fn(() => state.pitch),
    easeTo: vi.fn((o: { pitch: number }) => {
      state.pitch = o.pitch;
    }),
  };
  return map;
}

describe('buildTerrainTileUrl', () => {
  it('路径里带指纹、XYZ 占位符在路径段上，tiff_key 走查询串', () => {
    const url = buildTerrainTileUrl('http://localhost:5173', REAL_SPEC.tiffKey, REAL_SPEC.fingerprint);
    expect(url).toBe(
      'http://localhost:5173/v0/bank/tiffs/terrain/921cd5752d5b178f/{z}/{x}/{y}.png?tiff_key=tiff%2FYangtze%2F2023%2Fstandard%2F1998-2023%2F2023-Yangtze-uvhH.tif',
    );
  });

  it('DEM 标识含 & 与中文不会被截断', () => {
    const url = buildTerrainTileUrl('http://h', 'a&b/中文.tif', 'f');
    expect(url).toContain('?tiff_key=a%26b%2F%E4%B8%AD%E6%96%87.tif');
  });
});

describe('buildTerrainSourceSpec', () => {
  it('raster-dem + terrarium，bounds 原样透传（西南东北），且只用最高层瓦片', () => {
    const spec = buildTerrainSourceSpec(REAL_SPEC, 'http://localhost:5173');
    expect(spec.type).toBe('raster-dem');
    expect(spec.encoding).toBe('terrarium');
    expect(spec.tileSize).toBe(256);
    // 层级一律照抄后端：钉到 maxzoom（或抬高下限）都会让低缩放缺图区变 NaN（实测 z9 直接 null）
    expect(spec.minzoom).toBe(REAL_SPEC.minzoom);
    expect(spec.maxzoom).toBe(REAL_SPEC.maxzoom);
    expect(spec.bounds).toEqual([118.21289062500001, 31.278550858946513, 121.99218749999999, 32.546813173515154]);
    expect(spec.tiles).toHaveLength(1);
    expect(spec.tiles?.[0]).toContain('/921cd5752d5b178f/{z}/{x}/{y}.png');
  });

  it('山体阴影层挂在同一个源上，不另开瓦片请求', () => {
    const layer = buildTerrainHillshadeLayer();
    expect(layer.id).toBe(TERRAIN_HILLSHADE_LAYER);
    expect(layer.type).toBe('hillshade');
    expect(layer.source).toBe(TERRAIN_SOURCE);
  });

  it('光照走西北斜射、阴影够浓，否则河床起伏看着像平板', () => {
    // 方位角 315 = 西北（制图惯例：光来自左上）；极角 45° 是「能读出阴面、又不糊成黑」的档。
    // 默认的 210°/30°（几乎正上方照）在几米级的河床起伏上产生不了阴面。
    expect(TERRAIN_LIGHT.position).toEqual([1.15, 315, 45]);
    const layer = buildTerrainHillshadeLayer();
    expect(layer.paint?.['hillshade-exaggeration']).toBeGreaterThanOrEqual(0.8);
  });
});

describe('terrainTileRequest / createTerrainTransformRequest', () => {
  it('只认地形瓦片路径；其余请求原样放行（回 { url }，不带任何头）', () => {
    expect(terrainTileRequest('https://a.example/v0/bank/tiffs/terrain/f/8/1/2.png?tiff_key=k', { Authorization: 'Bearer t' })).toEqual({
      url: 'https://a.example/v0/bank/tiffs/terrain/f/8/1/2.png?tiff_key=k',
      headers: { Authorization: 'Bearer t' },
    });
    // 底图瓦片绝不能带上我们的 token：第三方瓦片服务会把它记进访问日志
    expect(terrainTileRequest('https://tile.openstreetmap.org/8/1/2.png', { Authorization: 'Bearer t' })).toEqual({
      url: 'https://tile.openstreetmap.org/8/1/2.png',
    });
    expect(terrainTileRequest('http://x/v0/bank/tiffs/dem/preview.png', { Authorization: 'Bearer t' })).toEqual({
      url: 'http://x/v0/bank/tiffs/dem/preview.png',
    });
  });

  it('没登录时（无头）只回 url，不塞空 headers', () => {
    expect(terrainTileRequest('http://x/v0/bank/tiffs/terrain/f/8/1/2.png', {})).toEqual({
      url: 'http://x/v0/bank/tiffs/terrain/f/8/1/2.png',
    });
  });

  it('每次请求现读 token：重新登录后不带旧 token', () => {
    let token = 'old';
    const transform = createTerrainTransformRequest(() => ({ Authorization: `Bearer ${token}` }));
    const first = transform('http://x/v0/bank/tiffs/terrain/f/8/1/2.png');
    token = 'new';
    const second = transform('http://x/v0/bank/tiffs/terrain/f/8/1/2.png');
    expect(first?.headers).toEqual({ Authorization: 'Bearer old' });
    expect(second?.headers).toEqual({ Authorization: 'Bearer new' });
  });
});

describe('terrainStatusView', () => {
  it.each([
    ['ready', true, false, false, ''],
    ['building', false, true, false, '正在生成三维地形…'],
    ['pending', false, true, false, '三维地形排队中…'],
    ['none', false, true, false, '正在生成三维地形…'],
    ['unavailable', false, false, true, '三维地形暂不可用：服务端表结构未就绪，请重启模型服务'],
    ['missing', false, false, true, 'DEM 不存在或无权访问'],
  ])('%s → ready=%s busy=%s failed=%s', (status, ready, busy, failed, label) => {
    const view = terrainStatusView(status);
    expect([view.ready, view.busy, view.failed, view.label]).toEqual([ready, busy, failed, label]);
  });

  it('failed 带上服务端给的原因；没给原因只留标题', () => {
    expect(terrainStatusView('failed', 'gdal: cannot open').label).toBe('三维地形生成失败：gdal: cannot open');
    expect(terrainStatusView('failed').label).toBe('三维地形生成失败');
  });

  it('未知/空状态当作排队中，不把开关锁死', () => {
    const view = terrainStatusView(null);
    expect(view.busy).toBe(true);
    expect(view.failed).toBe(false);
  });
});

describe('isTerrainTileError / terrainTileErrorStatus', () => {
  // Mapbox 实际抛的是 ErrorEvent：{ error: AjaxError { status, url } }
  it('瓦片 404 是地形请求 → 属于预期内', () => {
    expect(isTerrainTileError({ error: { status: 404, url: 'http://x/v0/bank/tiffs/terrain/f/8/1/2.png' } })).toBe(true);
    expect(terrainTileErrorStatus({ error: { status: 404, url: 'http://x/v0/bank/tiffs/terrain/f/8/1/2.png' } })).toBe(404);
  });
  it('鉴权失败（401/403）要能与 404 区分开', () => {
    const ev = { error: { status: 401, url: 'http://x/v0/bank/tiffs/terrain/f/8/1/2.png' } };
    expect(isTerrainTileError(ev)).toBe(true);
    expect(terrainTileErrorStatus(ev)).toBe(401);
  });
  it('底图/字体出错不能被它吞掉', () => {
    expect(isTerrainTileError({ status: 404, url: 'http://x/v0/bank/map/satellite/8/1/2.png' })).toBe(false);
    expect(isTerrainTileError(new Error('boom'))).toBe(false);
    expect(isTerrainTileError(null)).toBe(false);
    expect(terrainTileErrorStatus(null)).toBeUndefined();
  });
});

describe('applyTerrain', () => {
  it('首次挂载：先加源、再在指定图层之前加阴影层、最后开地形', () => {
    const map = fakeMap({ existingLayers: ['river-surface-fill'] });
    applyTerrain(map as unknown as MapboxMap, REAL_SPEC, DEFAULT_TERRAIN_EXAGGERATION, { beforeLayers: ['missing-layer', 'river-surface-fill'] });
    expect(map.calls).toEqual([
      `addSource:${TERRAIN_SOURCE}`,
      `addLayer:${TERRAIN_HILLSHADE_LAYER}@river-surface-fill`,
      'setLight:1.15/315/45',
      'setTerrain:on',
    ]);
    expect(map.setTerrain).toHaveBeenCalledWith({ source: TERRAIN_SOURCE, exaggeration: DEFAULT_TERRAIN_EXAGGERATION });
  });

  it('候选图层一个都没有时退到最上层', () => {
    const map = fakeMap();
    applyTerrain(map as unknown as MapboxMap, REAL_SPEC, 1, { beforeLayers: ['nope', 'also-nope'] });
    expect(map.calls[1]).toBe(`addLayer:${TERRAIN_HILLSHADE_LAYER}@top`);
  });

  it('同一份 DEM 只改夸张系数：不重建源、不加层', () => {
    const map = fakeMap();
    applyTerrain(map as unknown as MapboxMap, REAL_SPEC, 1.5);
    map.calls.length = 0;
    applyTerrain(map as unknown as MapboxMap, REAL_SPEC, 3);
    expect(map.calls).toEqual(['setTerrain:on']);
    expect(map.setTerrain).toHaveBeenLastCalledWith({ source: TERRAIN_SOURCE, exaggeration: 3 });
    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect(map.addLayer).toHaveBeenCalledTimes(1);
  });

  it('换了指纹：先摘地形再删层删源，然后重建', () => {
    const map = fakeMap();
    applyTerrain(map as unknown as MapboxMap, REAL_SPEC, 2);
    map.calls.length = 0;
    applyTerrain(map as unknown as MapboxMap, { ...REAL_SPEC, fingerprint: 'deadbeef00000000' }, 2);
    expect(map.calls).toEqual([
      'setTerrain:off',
      `removeLayer:${TERRAIN_HILLSHADE_LAYER}`,
      `removeSource:${TERRAIN_SOURCE}`,
      `addSource:${TERRAIN_SOURCE}`,
      `addLayer:${TERRAIN_HILLSHADE_LAYER}@top`,
      'setLight:1.15/315/45',
      'setTerrain:on',
    ]);
  });

  it('关掉：先摘地形再删层删源，并把光照还原成 Mapbox 默认值', () => {
    const map = fakeMap();
    applyTerrain(map as unknown as MapboxMap, REAL_SPEC, 2);
    map.calls.length = 0;
    applyTerrain(map as unknown as MapboxMap, null, 2);
    expect(map.calls).toEqual([
      'setTerrain:off',
      `removeLayer:${TERRAIN_HILLSHADE_LAYER}`,
      `removeSource:${TERRAIN_SOURCE}`,
      // 不还原的话，二维底图会一直顶着西北斜射灯，整体偏暗
      'setLight:1.15/210/30',
    ]);
  });

  it('关掉时本来就干净：什么都不做（不碰 light，也不管俯仰上限 — Mapbox 默认 85°）', () => {
    const map = fakeMap();
    applyTerrain(map as unknown as MapboxMap, null, 2);
    expect(map.calls).toEqual([]);
  });

  it('几乎俯视时打开 → 抬到 60°；已经侧过来就不抢视角', () => {
    const flat = fakeMap();
    applyTerrain(flat as unknown as MapboxMap, REAL_SPEC, 2, { ensurePitch: true });
    expect(flat.easeTo).toHaveBeenCalledWith(expect.objectContaining({ pitch: TERRAIN_ENTER_PITCH }));

    const tilted = fakeMap();
    tilted.state.pitch = 45;
    applyTerrain(tilted as unknown as MapboxMap, REAL_SPEC, 2, { ensurePitch: true });
    expect(tilted.easeTo).not.toHaveBeenCalled();

    const noEnsure = fakeMap();
    applyTerrain(noEnsure as unknown as MapboxMap, REAL_SPEC, 2);
    expect(noEnsure.easeTo).not.toHaveBeenCalled();
  });
});
