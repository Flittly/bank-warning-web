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
  /** 实际用于灰度拉伸的端点（分位数截断后） */
  low: number | null;
  high: number | null;
  /** DEM 声明的 nodata 值 */
  nodata: number | null;
  /** 无数据像素占比（0~1） */
  nodataRatio: number | null;
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
 * @param signal 用于取消（用户快速连点不同 DEM 时，避免旧请求回来覆盖新图）
 * @throws 请求失败、或后端没给出可用地理范围时
 */
export async function fetchDemPreview(tiffKey: string, signal?: AbortSignal): Promise<DemPreview> {
  if (!tiffKey) throw new Error('缺少 DEM 标识');

  const res = await fetch(`/v0/bank/tiffs/preview?tiff_key=${encodeURIComponent(tiffKey)}`, {
    headers: { ...authHeaders() },
    signal,
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
    },
  };
}

/** 释放预览占用的内存。传 null/undefined 安全。 */
export function releaseDemPreview(preview: DemPreview | null | undefined): void {
  if (preview?.imageUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(preview.imageUrl);
  }
}
