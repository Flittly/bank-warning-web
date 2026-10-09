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

function tdtStyle(base: 'vec' | 'img', label: 'cia' | null, tk: string): StyleSpecification {
  const sources: StyleSpecification['sources'] = {
    'tdt-base': {
      type: 'raster',
      tiles: tdtTiles(base, tk),
      tileSize: 256,
      maxzoom: 18,
      attribution: '<a href="https://www.tianditu.gov.cn/" target="_blank" rel="noreferrer">天地图</a>',
    },
  };
  const layers: StyleSpecification['layers'] = [
    { id: 'tdt-background', type: 'background', paint: { 'background-color': '#ffffff' } },
    {
      id: 'tdt-base',
      type: 'raster',
      source: 'tdt-base',
      ...(base === 'vec' ? { paint: TDT_STANDARD_RASTER_PAINT } : {}),
    },
  ];
  if (label) {
    sources['tdt-label'] = {
      type: 'raster',
      tiles: tdtTiles(label, tk),
      tileSize: 256,
      maxzoom: 18,
    };
    layers.push({ id: 'tdt-label', type: 'raster', source: 'tdt-label' });
  }
  return { version: 8, sources, layers };
}

const cache = new Map<BasemapMode, string | StyleSpecification>();

export function getBasemapStyle(mode: BasemapMode): string | StyleSpecification {
  const hit = cache.get(mode);
  if (hit) return hit;
  const value: string | StyleSpecification =
    TDT_TOKEN && TDT_TOKEN.length > 0
      ? mode === 'satellite'
        ? tdtStyle('img', 'cia', TDT_TOKEN)
        : tdtStyle('vec', null, TDT_TOKEN)
      : FALLBACK[mode];
  cache.set(mode, value);
  return value;
}
