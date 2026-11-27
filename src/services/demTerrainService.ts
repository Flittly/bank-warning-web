/**
 * DEM 三维地形：状态查询与切片触发。
 *
 * <h3>数据流</h3>
 * 后端把 DEM 切成 Terrarium 瓦片金字塔，前端用 Mapbox 的 `raster-dem` 源 + `setTerrain`
 * 做三维地形。瓦片 URL 里带**金字塔指纹**（`fp`）：源 DEM 一换指纹就换，
 * 所以浏览器可以放心把瓦片缓存一年，刷新页面也不会再拉一遍。
 *
 * <h3>为什么状态要轮询</h3>
 * 切片是异步的（几秒到几分钟）。打开三维地形时若还没切好，就每 3 秒问一次；
 * `POST /terrain/build` 是幂等的 —— 已就绪且未过期时什么都不做，所以轮询期间
 * 反复调用它是安全的，顺便让后端替我们做「过期检查」。
 */

import { authHeaders } from '../utils/apiClient';

export type DemTerrainStatus =
  /** 库里有这份 DEM，但从没切过 */
  | 'none'
  /** 库里没有这份 DEM */
  | 'missing'
  /** 表结构没就绪（模型服务启动时没补上 terrain_* 列） */
  | 'unavailable'
  | 'pending'
  | 'building'
  | 'ready'
  | 'failed';

/** 瓦片覆盖范围（WGS84）。比 DEM 外包框大两圈瓦片：裙边要占地方。 */
export interface DemTerrainBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface DemTerrainInfo {
  tiff_key: string;
  status: DemTerrainStatus;
  /** 仅 ready 时有值；它是瓦片 URL 的一部分 */
  fingerprint: string | null;
  minzoom: number | null;
  maxzoom: number | null;
  bounds: DemTerrainBounds | null;
  tile_count: number | null;
  /** 仅 failed 时有值 */
  error: string | null;
  generated_at: string | null;
}

/** 能直接挂到地图上的最小描述：只有 ready 状态才拿得到。 */
export interface DemTerrainSpec {
  tiffKey: string;
  fingerprint: string;
  minzoom: number;
  maxzoom: number;
  /** Mapbox `bounds` 的顺序：[西, 南, 东, 北] */
  bounds: [number, number, number, number];
}

const STATUS_ENDPOINT = '/v0/bank/tiffs/terrain/status';
const BUILD_ENDPOINT = '/v0/bank/tiffs/terrain/build';

const byUrl = (tiffKey: string): string => `tiff_key=${encodeURIComponent(tiffKey)}`;

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return fallback;
    try {
      const body = JSON.parse(text) as { message?: unknown; detail?: unknown; error?: unknown } | null;
      const detail = body?.message ?? body?.detail ?? body?.error;
      if (detail) return String(detail);
    } catch {
      // 不是 JSON（多半是网关的 HTML 错误页）
    }
    const singleLine = text.replace(/\s+/g, ' ').trim();
    return singleLine.length <= 200 ? singleLine : `${singleLine.slice(0, 200)}…`;
  } catch {
    return fallback;
  }
}

function normalizeInfo(raw: unknown, tiffKey: string): DemTerrainInfo {
  const r = (raw ?? {}) as Record<string, unknown>;
  const b = (r.bounds ?? {}) as Record<string, unknown>;
  const [west, south, east, north] = [b.west, b.south, b.east, b.north].map(Number);
  return {
    tiff_key: tiffKey,
    status: (r.status as DemTerrainStatus) || 'none',
    fingerprint: (r.fingerprint as string | null) ?? null,
    minzoom: (r.minzoom as number | null) ?? null,
    maxzoom: (r.maxzoom as number | null) ?? null,
    bounds: [west, south, east, north].every((v) => Number.isFinite(v))
      ? { west, south, east, north }
      : null,
    tile_count: (r.tile_count as number | null) ?? null,
    error: (r.error as string | null) ?? null,
    generated_at: (r.generated_at as string | null) ?? null,
  };
}

async function callTerrainEndpoint(
  url: string,
  method: 'GET' | 'POST',
  tiffKey: string,
  signal?: AbortSignal,
): Promise<DemTerrainInfo> {
  const res = await fetch(url, { method, headers: { ...authHeaders() }, signal });
  if (!res.ok) throw new Error(await readError(res, `DEM 三维地形请求失败（HTTP ${res.status}）`));
  return normalizeInfo(await res.json(), tiffKey);
}

/** 查询某份 DEM 的三维地形状态（后端顺手做过期检查）。 */
export async function fetchDemTerrainStatus(tiffKey: string, signal?: AbortSignal): Promise<DemTerrainInfo> {
  if (!tiffKey) throw new Error('缺少 DEM 标识');
  return callTerrainEndpoint(`${STATUS_ENDPOINT}?${byUrl(tiffKey)}`, 'GET', tiffKey, signal);
}

/**
 * 触发（或确认）某份 DEM 的切片，返回当前状态。**幂等**：已就绪且未过期时不重新切。
 */
export async function requestDemTerrainBuild(tiffKey: string, signal?: AbortSignal): Promise<DemTerrainInfo> {
  if (!tiffKey) throw new Error('缺少 DEM 标识');
  return callTerrainEndpoint(`${BUILD_ENDPOINT}?${byUrl(tiffKey)}`, 'POST', tiffKey, signal);
}

/** 状态已就绪时换算成地图能用的描述；否则 null。 */
export function terrainSpecOf(info: DemTerrainInfo | null | undefined): DemTerrainSpec | null {
  if (!info || info.status !== 'ready') return null;
  const { fingerprint, minzoom, maxzoom, bounds } = info;
  if (!fingerprint || minzoom == null || maxzoom == null || !bounds) return null;
  return {
    tiffKey: info.tiff_key,
    fingerprint,
    minzoom,
    maxzoom,
    bounds: [bounds.west, bounds.south, bounds.east, bounds.north],
  };
}
