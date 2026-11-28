import { describe, expect, it, vi } from 'vitest';
import type { Map as MapboxMap } from 'mapbox-gl';
import { applyDemPreviewLayer, DEM_PREVIEW_LAYER, DEM_PREVIEW_SOURCE } from './demPreviewLayer';
import type { DemPreview } from '../services/demPreviewService';

/**
 * 这层的作用是「给三维地形提供表面颜色」：`raster-dem` + `hillshade` 只算起伏与光照，
 * 颜色来自压在下面的一张栅格。层次序写错的表现是**看不出问题**的那种：
 *   * 落到 hillshade 上面 → 阴影被盖平，三维变回平板；
 *   * 落到断面线/岸段色带上面 → 要素被糊住，但图还在。
 * 截图上都像「样式问题」，所以这里用最小地图替身把顺序钉死。
 */
function fakeMap(existingLayers: string[] = []) {
  const calls: string[] = [];
  const state: {
    source: { updateImage: ReturnType<typeof vi.fn> } | null;
    layers: Set<string>;
  } = { source: null, layers: new Set(existingLayers) };
  const map = {
    calls,
    state,
    getLayer: vi.fn((id: string) => state.layers.has(id)),
    getSource: vi.fn(() => state.source),
    addSource: vi.fn((id: string, spec: unknown) => {
      calls.push(`addSource:${id}:${(spec as { url?: string }).url}`);
      state.source = { updateImage: vi.fn((o: unknown) => calls.push(`updateImage:${JSON.stringify(o)}`)) };
    }),
    removeSource: vi.fn((id: string) => {
      calls.push(`removeSource:${id}`);
      state.source = null;
    }),
    addLayer: vi.fn((layer: { id: string; type: string; paint?: Record<string, unknown> }, before?: string) => {
      calls.push(`addLayer:${layer.id}:${layer.type}@${before ?? 'top'}`);
      state.layers.add(layer.id);
    }),
    removeLayer: vi.fn((id: string) => {
      calls.push(`removeLayer:${id}`);
      state.layers.delete(id);
    }),
    setPaintProperty: vi.fn((id: string, name: string, value: unknown) => {
      calls.push(`setPaint:${id}:${name}=${String(value)}`);
    }),
  };
  return map;
}

const PREVIEW: DemPreview = {
  tiffKey: 'tiff/Yangtze/2023/standard/1998-2023/2023-Yangtze-uvhH.tif',
  imageUrl: 'blob:http://localhost/abc',
  coordinates: [
    [118.2, 32.5],
    [122, 32.5],
    [122, 31.2],
    [118.2, 31.2],
  ],
  meta: {
    west: 118.2,
    south: 31.2,
    east: 122,
    north: 32.5,
    width: 1000,
    height: 600,
    min: -57.1,
    max: 12.4,
    low: -50,
    high: 8,
    nodata: -9999,
    nodataRatio: 0.91,
    ramp: 'gray',
    legendStops: [],
  },
};

describe('applyDemPreviewLayer', () => {
  it('首次铺设：image 源 + raster 图层，压到第一个存在的候选图层之前', () => {
    const map = fakeMap(['dem-hillshade', 'uploaded-lines-base']);
    applyDemPreviewLayer(map as unknown as MapboxMap, PREVIEW, {
      beforeLayers: ['dem-hillshade', 'uploaded-lines-base'],
    });

    expect(map.calls).toEqual([
      `addSource:${DEM_PREVIEW_SOURCE}:blob:http://localhost/abc`,
      // 阴影要盖在栅格上 ⇒ 栅格插在 dem-hillshade 之前（视觉上更靠下）
      `addLayer:${DEM_PREVIEW_LAYER}:raster@dem-hillshade`,
    ]);
  });

  it('候选顺序按数组走：阴影层不在时退到下一个候选，全都缺则落到最上层', () => {
    const map = fakeMap(['uploaded-lines-base']);
    applyDemPreviewLayer(map as unknown as MapboxMap, PREVIEW, {
      beforeLayers: ['dem-hillshade', 'uploaded-lines-base'],
    });
    expect(map.calls[1]).toBe(`addLayer:${DEM_PREVIEW_LAYER}:raster@uploaded-lines-base`);

    const bare = fakeMap([]);
    applyDemPreviewLayer(bare as unknown as MapboxMap, PREVIEW, { beforeLayers: ['dem-hillshade'] });
    expect(bare.calls[1]).toBe(`addLayer:${DEM_PREVIEW_LAYER}:raster@top`);
  });

  it('换图（切配色）只 updateImage，不重建 source、不重复加图层 —— 否则地图会闪一下', () => {
    const map = fakeMap(['dem-hillshade']);
    applyDemPreviewLayer(map as unknown as MapboxMap, PREVIEW, { beforeLayers: ['dem-hillshade'] });
    map.calls.length = 0;

    const next: DemPreview = { ...PREVIEW, imageUrl: 'blob:http://localhost/def', meta: { ...PREVIEW.meta, ramp: 'hypsometric' } };
    applyDemPreviewLayer(map as unknown as MapboxMap, next, { beforeLayers: ['dem-hillshade'] });

    expect(map.calls.some((c) => c.startsWith('addSource'))).toBe(false);
    expect(map.calls.some((c) => c.startsWith('addLayer'))).toBe(false);
    expect(map.calls[0]).toContain('updateImage');
    expect(map.calls[0]).toContain('blob:http://localhost/def');
  });

  it('清掉时先删图层再删源（反过来会因「source 仍被引用」抛错）', () => {
    const map = fakeMap(['dem-hillshade']);
    applyDemPreviewLayer(map as unknown as MapboxMap, PREVIEW, { beforeLayers: ['dem-hillshade'] });
    map.calls.length = 0;

    applyDemPreviewLayer(map as unknown as MapboxMap, null);

    expect(map.calls).toEqual([`removeLayer:${DEM_PREVIEW_LAYER}`, `removeSource:${DEM_PREVIEW_SOURCE}`]);
    expect(map.state.source).toBeNull();
  });

  it('清除一个本来就没有的图层是安全的（关三维时会被连着调一次）', () => {
    const map = fakeMap([]);
    expect(() => applyDemPreviewLayer(map as unknown as MapboxMap, undefined)).not.toThrow();
    expect(map.calls).toEqual([]);
  });
});
