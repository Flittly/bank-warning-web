/**
 * 长江河面范围图层（断面校验里「与长江河面相交」那条规则的可视化）。
 *
 * <p>后端 `GET /v0/bank/river-surface` 直接读断面校验用的那张 `river_yangtze` 表，
 * 所以这里拿到的是**判定用的同一份几何** —— 用户在地图上看到的边界就是规则边界，
 * 不存在"图上一套、判定一套"。
 *
 * <p>三个必须守住的点：
 * <ol>
 *   <li>坐标必须是 4326（经纬度）。库里的原始几何是 3857 米制坐标，后端已用
 *       {@code ST_Transform} 转好；万一哪天有人绕开后端直接吐 3857，画上去会整片飞出
 *       视野，所以这里做一次量级自检。</li>
 *   <li>结果按模块级缓存 —— 这份几何是全库唯一的长江河面（约 1.2 MB），
 *       开关图层/来回切页面不该反复走网络。</li>
 *   <li>并发去重：开着图层时 React StrictMode 会让 effect 跑两遍，
 *       真发两个请求。用 inflight 复用在途 Promise。</li>
 * </ol>
 */
import { authHeaders } from '../utils/apiClient';

const ENDPOINT = '/v0/bank/river-surface';

/**
 * 简化容差（米）。**0 = 不简化**。
 *
 * <p>曾经用 10 m 简化（255 KB），实测抽样 2000 条断面里有 2 条的"是否相交"结论与原几何相反；
 * 这个图层是「与长江河面相交」这条规则的可视化锚点，图上一个像素的错位都会让人以为系统判错，
 * 所以宁可多传 1 MB 也不简化。后端 `tol` 参数仍可调大。
 */
export const DEFAULT_RIVER_TOL_M = 0;

export interface RiverSurfaceLayer {
  collection: GeoJSON.FeatureCollection;
  /** 后端回带的元信息：来源表、实际容差、要素数/顶点数（用于自检与提示文案）。 */
  meta: {
    source: string;
    srid: number;
    tolM: number;
    features: number;
    points: number;
  };
}

let cache = new Map<string, RiverSurfaceLayer>();
let inflight = new Map<string, Promise<RiverSurfaceLayer>>();

export function invalidateRiverSurfaceCache(): void {
  cache = new Map();
  inflight = new Map();
}

function isPolygonGeometry(geometry: any): boolean {
  const type = String(geometry?.type ?? '');
  return (type === 'Polygon' || type === 'MultiPolygon') && Array.isArray(geometry?.coordinates);
}

/**
 * 坐标量级自检：经度绝对值必须 ≤ 180。
 *
 * <p>不写死的判断：「不在地图视野里」比「图层错了」更难排查，宁可显式报错。
 */
function assertLonLat(geometry: any): void {
  const coords = geometry?.coordinates;
  if (!Array.isArray(coords)) return;
  const first = coords;
  const probe = (arr: any): number[] | null => {
    if (!Array.isArray(arr)) return null;
    if (typeof arr[0] === 'number' && typeof arr[1] === 'number') return arr as number[];
    return probe(arr[0]);
  };
  const point = probe(first);
  if (!point) return;
  if (Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) {
    throw new Error(
      `长江范围坐标不是经纬度（首点 ${point[0]}, ${point[1]}），图层无法渲染`,
    );
  }
}

/** 归一化后端返回（导出是为了能在单测里直接喂各种脏数据，见 riverSurfaceApi.test.ts）。 */
export function normalizeRiverSurface(payload: any, tolM: number = DEFAULT_RIVER_TOL_M): RiverSurfaceLayer {
  const raw = payload?.data ?? payload;
  const features = Array.isArray(raw?.features) ? raw.features : [];
  const kept = features.filter((f: any) => {
    if (!f || !isPolygonGeometry(f.geometry)) return false;
    assertLonLat(f.geometry);
    return true;
  });

  const meta = payload?.meta ?? {};
  return {
    collection: { type: 'FeatureCollection', features: kept } as GeoJSON.FeatureCollection,
    meta: {
      source: String(meta.source ?? 'river_yangtze'),
      srid: Number(meta.srid ?? 4326),
      tolM: Number(meta.tol_m ?? tolM),
      features: Number(meta.features ?? kept.length),
      points: Number(meta.points ?? 0),
    },
  };
}

export function fetchRiverSurface(tolM: number = DEFAULT_RIVER_TOL_M): Promise<RiverSurfaceLayer> {
  const key = String(tolM);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);

  const pending = inflight.get(key);
  if (pending) return pending;

  const task = (async () => {
    const res = await fetch(`${ENDPOINT}?tol=${encodeURIComponent(key)}`, {
      headers: { ...authHeaders() },
    });
    if (!res.ok) {
      throw new Error(`长江范围图层加载失败：${res.status} ${res.statusText}`);
    }
    const json = await res.json();
    if (json?.success === false) {
      throw new Error(String(json?.error?.message ?? json?.message ?? '长江范围图层加载失败'));
    }
    const layer = normalizeRiverSurface(json, tolM);
    cache.set(key, layer);
    return layer;
  })();

  inflight.set(key, task);
  // 失败不要留在表里，否则下一次点开永远拿到同一个 rejected Promise
  task.finally(() => {
    if (inflight.get(key) === task) inflight.delete(key);
  }).catch(() => undefined);

  return task;
}
