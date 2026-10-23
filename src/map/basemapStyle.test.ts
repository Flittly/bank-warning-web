import { describe, expect, it } from 'vitest';
import type { StyleSpecification } from 'mapbox-gl';
import { buildBasemapStyle } from './basemapStyle';

/**
 * 底图样式的契约测试。
 *
 * 核心一条：**卫星影像必须是「纯影像」**，不能带天地图的 `cia`（影像注记）层 ——
 * 那层会把道路、行政区名、地名 POI 叠在断面线/岸段色带上面，既挡判读又干扰配色。
 * 这条曾经靠人工看截图发现，改成断言后回归会直接红。
 */

function styleOf(mode: 'standard' | 'satellite', token = 'test-token'): StyleSpecification {
  return buildBasemapStyle(mode, token) as StyleSpecification;
}

function rasterLayerIds(style: StyleSpecification): string[] {
  return style.layers.filter((l) => l.type === 'raster').map((l) => l.id);
}

describe('buildBasemapStyle / 卫星影像', () => {
  it('只有影像底图，不叠注记层（无道路、无地名）', () => {
    const style = styleOf('satellite');
    expect(rasterLayerIds(style)).toEqual(['tdt-base']);
    expect(style.sources['tdt-label']).toBeUndefined();
    expect(style.layers.map((l) => l.id)).toEqual(['tdt-background', 'tdt-base']);
  });

  it('瓦片 URL 走 img，且整体不出现任何 cia 注记请求', () => {
    const style = styleOf('satellite');
    const json = JSON.stringify(style);
    expect(json).toContain('/img_w/');
    expect(json).not.toContain('/cia_w/');
    expect(json).not.toContain('LAYER=cia');
  });

  it('影像层不加矢量底图的淡化 paint（生搬会让人误以为影像发灰）', () => {
    const base = styleOf('satellite').layers.find((l) => l.id === 'tdt-base');
    expect(base?.type).toBe('raster');
    expect((base as any).paint).toBeUndefined();
  });
});

describe('buildBasemapStyle / 标准底图与兜底', () => {
  it('标准底图仍走 vec，并保留淡化 paint', () => {
    const style = styleOf('standard');
    const base = styleOf('standard').layers.find((l) => l.id === 'tdt-base') as any;
    expect(rasterLayerIds(style)).toEqual(['tdt-base']);
    expect(JSON.stringify(style)).toContain('/vec_w/');
    expect(base.paint['raster-opacity']).toBeCloseTo(0.55);
  });

  it('无 token 时退回 Mapbox 官方样式（卫星本身即无标注）', () => {
    expect(buildBasemapStyle('satellite', undefined)).toBe('mapbox://styles/mapbox/satellite-v9');
    expect(buildBasemapStyle('standard', '')).toBe('mapbox://styles/mapbox/light-v10');
  });
});
