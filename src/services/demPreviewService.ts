/**
 * DEM 栅格预览：把一份 DEM 画成「灰度高程 + 红色 nodata」的图片，供地图铺底。
 *
 * <h3>为什么不用一个裸 URL 直接喂给 Mapbox</h3>
 * 地图的 `image` source 内部走 `fetch(new Request(url))`。`Request` 构造时会把相对地址
 * 解析成绝对地址，而 {@link apiClient} 的鉴权拦截器只对以 `/v0/` 开头的字符串生效
 * ⇒ 拦截器命中不到，请求必然 401。所以这里必须先 `fetch` 拿到 blob，再把
 * `blob:` URL 交给地图（`blob:` 不经过网络，也不需要 token）。
 *
 * <h3>为什么地理范围来自响应头而不是 tiff-bounds 接口</h3>
 * 后端为了把图贴正，渲染时做过一次 4326 重投影；实际输出范围的权威值就是那一刻的
 * GeoTransform。再用 `demBoundsOf()` 从边界表反推会出现「表里是原始投影的外包框、
 * 图是重投影后矩形」的错位，所以直接读后端给的 `X-Dem-*`。
 */

import { authHeaders } from '../utils/apiClient';

/** 与后端 `model/demPreview.py` 的配色常量一一对应（改那边必须同步改这里） */
export const DEM_PREVIEW_COLORS = {
  dark: 14,
  light: 208,
  nodata: 'rgb(230, 32, 32)',
} as const;

/**
 * 配色名，与后端 `RAMPS` 逐一对应。
 *
 * <ul>
 *   <li>`gray`：低暗高亮的灰度高程</li>
 *   <li>`hypsometric`：分层设色，绝对高程 深蓝河床 → 米黄滩地 → 砖红岸堤</li>
 * </ul>
 */
export type DemRamp = 'gray' | 'hypsometric';

export const DEM_RAMP_OPTIONS: Array<{ value: DemRamp; label: string }> = [
  { value: 'gray', label: '灰度' },
  { value: 'hypsometric', label: '分层设色' },
];

/** 图例断点：`[高程(米), "#rrggbb"]`，按高程升序；灰度配色为空（用固定两端色） */
export type DemLegendStop = [number, string];

export interface DemPreviewMeta {
  west: number;
  south: number;
  east: number;
  north: number;
  /** 输出图（已降采样）的像素尺寸 */
  width: number;
  height: number;
  /** 有效高程的真实极值，未知为 null */
  min: number | null;
  max: number | null;
  /** 有效高程的 2%/98% 分位（灰度配色拿它做拉伸端点） */
  low: number | null;
  high: number | null;
  /** DEM 声明的 nodata 值 */
  nodata: number | null;
  /** 无数据像素占比（0~1） */
  nodataRatio: number | null;
  /** 服务端**实际**用的配色 —— 以它为准画图例，而不是以本地请求参数为准 */
  ramp: DemRamp;
  /** 图例断点，直接来自服务端渲染用的那张表 */
  legendStops: DemLegendStop[];
}

export interface DemPreview {
  tiffKey: string;
  /** `blob:` URL —— 换图或卸载时必须 release，否则 PNG 会一直留在内存里 */
  imageUrl: string;
  /** Mapbox `image` source 要求的四角顺序：[左上, 右上, 右下, 左下] */
  coordinates: [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ];
  meta: DemPreviewMeta;
}

function isRamp(value: string | null): value is DemRamp {
  return value === 'gray' || value === 'hypsometric';
}

/** `X-Dem-Legend` 是服务端给的 `[[高程,"#rrggbb"], ...]`；解析失败就当没有（退回单色图例） */
function parseLegend(raw: string | null): DemLegendStop[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const stops: DemLegendStop[] = [];
    for (const item of parsed) {
      if (!Array.isArray(item) || item.length < 2) continue;
      const metres = Number(item[0]);
      const color = String(item[1]);
      if (!Number.isFinite(metres) || !/^#[0-9a-fA-F]{6}$/.test(color)) continue;
      stops.push([metres, color]);
    }
    return stops.sort((a, b) => a[0] - b[0]);
  } catch {
    return [];
  }
}

function headerNumber(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw == null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

async function readError(res: Response): Promise<string> {
  const fallback = `DEM 预览请求失败（HTTP ${res.status}）`;
  try {
    const text = await res.text();
    if (!text) return fallback;
    try {
      const body = JSON.parse(text);
      const detail = body?.message ?? body?.detail ?? body?.error;
      if (detail) return String(detail);
    } catch {
      // 不是 JSON：多半是网关的 HTML 错误页，截一段原文足够定位
    }
    const singleLine = text.replace(/\s+/g, ' ').trim();
    return singleLine.length <= 200 ? singleLine : `${singleLine.slice(0, 200)}…`;
  } catch {
    return fallback;
  }
}

/**
 * 拉取一份 DEM 的预览图。
 *
 * @param tiffKey DEM 的 `tiff_key`
 * @param options.ramp 配色，缺省交给服务端默认（灰度）
 * @param options.signal 用于取消（用户快速连点不同 DEM 时，避免旧请求回来覆盖新图）
 * @throws 请求失败、或后端没给出可用地理范围时
 */
export async function fetchDemPreview(
  tiffKey: string,
  options: { ramp?: DemRamp; signal?: AbortSignal } = {},
): Promise<DemPreview> {
  if (!tiffKey) throw new Error('缺少 DEM 标识');

  const query = new URLSearchParams({ tiff_key: tiffKey });
  if (options.ramp) query.set('ramp', options.ramp);

  const res = await fetch(`/v0/bank/tiffs/preview?${query.toString()}`, {
    headers: { ...authHeaders() },
    signal: options.signal,
    // 必须绕开 HTTP 缓存：这张图是按 URL 取回的「现场渲染结果」，但同一 URL 的内容会随
    // 重新切片 / 换配色 / nodata 画法而变。曾经后端给的 max-age=3600 让浏览器把灰度图
    // 存到 `?ramp=hypsometric` 名下，前端拿回的 X-Dem-Ramp 仍是 gray ⇒ Segmented 选中态
    // 立刻弹回灰度，看起来就是「点了没反应」。后端已改成 no-store，这里再加一道防止
    // 中间层（网关 / Service Worker）自己加缓存。
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(await readError(res));
  }

  const west = headerNumber(res.headers, 'X-Dem-West');
  const south = headerNumber(res.headers, 'X-Dem-South');
  const east = headerNumber(res.headers, 'X-Dem-East');
  const north = headerNumber(res.headers, 'X-Dem-North');
  if (west == null || south == null || east == null || north == null || west >= east || south >= north) {
    throw new Error('后端未返回有效的 DEM 地理范围，无法把它贴到地图上');
  }

  const blob = await res.blob();
  const imageUrl = URL.createObjectURL(blob);

  return {
    tiffKey,
    imageUrl,
    coordinates: [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ],
    meta: {
      west,
      south,
      east,
      north,
      width: headerNumber(res.headers, 'X-Dem-Width') ?? 0,
      height: headerNumber(res.headers, 'X-Dem-Height') ?? 0,
      min: headerNumber(res.headers, 'X-Dem-Min'),
      max: headerNumber(res.headers, 'X-Dem-Max'),
      low: headerNumber(res.headers, 'X-Dem-Low'),
      high: headerNumber(res.headers, 'X-Dem-High'),
      nodata: headerNumber(res.headers, 'X-Dem-Nodata'),
      nodataRatio: headerNumber(res.headers, 'X-Dem-Nodata-Ratio'),
      // 以服务端回显为准：它可能把不认识的配色回落成灰度，图例必须跟着实际渲染走
      ramp: isRamp(res.headers.get('X-Dem-Ramp')) ? (res.headers.get('X-Dem-Ramp') as DemRamp) : 'gray',
      legendStops: parseLegend(res.headers.get('X-Dem-Legend')),
    },
  };
}

/** 释放预览占用的内存。传 null/undefined 安全。 */
export function releaseDemPreview(preview: DemPreview | null | undefined): void {
  if (preview?.imageUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(preview.imageUrl);
  }
}

/**
 * 图例条的 CSS 渐变。
 *
 * <p>灰度配色用固定的两端色；分层设色用服务端给的断点，并按**本图**的 min~max
 * 映射到 0~100%（断点表覆盖 −80~20 m，而单份 DEM 往往只落在其中一段）。
 */
export function demLegendGradient(meta: DemPreviewMeta): string {
  const stops = meta.legendStops;
  if (stops.length < 2) {
    const { dark, light } = DEM_PREVIEW_COLORS;
    return `linear-gradient(90deg, rgb(${dark},${dark},${dark}), rgb(${light},${light},${light}))`;
  }
  const lo = meta.min ?? stops[0][0];
  const hi = meta.max ?? stops[stops.length - 1][0];
  const span = hi - lo || 1;
  const parts = stops.map(([metres, color]) => {
    const pct = Math.min(100, Math.max(0, ((metres - lo) / span) * 100));
    return `${color} ${pct.toFixed(1)}%`;
  });
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}
