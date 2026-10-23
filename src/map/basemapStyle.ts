import type { StyleSpecification } from 'mapbox-gl';

export type BasemapMode = 'standard' | 'satellite';

const TDT_TOKEN: string | undefined = import.meta.env.VITE_TIANDITU_TOKEN;

const FALLBACK: Record<BasemapMode, string> = {
  standard: 'mapbox://styles/mapbox/light-v10',
  satellite: 'mapbox://styles/mapbox/satellite-v9',
};

function tdtTiles(layer: 'vec' | 'img' | 'cva' | 'cia', tk: string): string[] {
  const subs = ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'];
  return subs.map(
    (s) =>
      `https://${s}.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${tk}`,
  );
}

const TDT_STANDARD_RASTER_PAINT = {
  'raster-opacity': 0.55,
  'raster-saturation': -0.4,
  'raster-contrast': -0.1,
};

/**
 * 天地图底图样式。
 *
 * ⚠ **卫星影像不带注记层**（需求 2026-10-21）：原来的 `img` + `cia`（影像注记）会叠上一层
 * 道路、行政区名、地名 POI，压在本系统的断面线/岸段色带下面既挡判读又干扰配色。
 * `img` 本身是纯影像，不叠 `cia` 就只剩地貌 —— 但千万不要改成「叠上再把 layer 设
 * `visibility: none`」，那样照样下瓦片、白耗流量。
 * 将来若要恢复道路/地名，在 layers 里再 push 一层 `tdtTiles('cia', tk)` 的 raster 即可
 * （`tdtTiles` 仍保留 `cia`/`cva` 等图层名的构造能力）。
 */
function tdtStyle(base: 'vec' | 'img', tk: string): StyleSpecification {
  return {
    version: 8,
    sources: {
      'tdt-base': {
        type: 'raster',
        tiles: tdtTiles(base, tk),
        tileSize: 256,
        maxzoom: 18,
        attribution: '<a href="https://www.tianditu.gov.cn/" target="_blank" rel="noreferrer">天地图</a>',
      },
    },
    layers: [
      { id: 'tdt-background', type: 'background', paint: { 'background-color': '#ffffff' } },
      {
        id: 'tdt-base',
        type: 'raster',
        source: 'tdt-base',
        ...(base === 'vec' ? { paint: TDT_STANDARD_RASTER_PAINT } : {}),
      },
    ],
  };
}

const cache = new Map<BasemapMode, string | StyleSpecification>();

/**
 * 构造某模式下的底图样式（纯函数，token 由外部传入，便于单测）。
 * 有 token 走天地图（自建 StyleSpecification），无 token 退回 Mapbox 官方样式。
 */
export function buildBasemapStyle(
  mode: BasemapMode,
  token: string | undefined,
): string | StyleSpecification {
  if (!token) return FALLBACK[mode];
  return tdtStyle(mode === 'satellite' ? 'img' : 'vec', token);
}

export function getBasemapStyle(mode: BasemapMode): string | StyleSpecification {
  const hit = cache.get(mode);
  if (hit) return hit;
  const value = buildBasemapStyle(mode, TDT_TOKEN);
  cache.set(mode, value);
  return value;
}
