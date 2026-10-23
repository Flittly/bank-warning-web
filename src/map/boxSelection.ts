/**
 * 地图矩形框选（框选岸段）的纯逻辑 —— 全部是不碰 DOM / Mapbox 的函数，便于单测。
 *
 * <p>为什么单独一个模块：框选的口径（哪些算"命中"、框与 DEM 范围的关系、提示文案）
 * 是业务规则，散在 `EditorMap` 的事件回调里既测不到、也没法复用。
 * `EditorMap` 只负责"把像素拖成一个矩形并回调 lng/lat"，
 * `EditorPage` 只负责"拿结果去加载/高亮"，判定全在这里。
 *
 * <h3>与「按 DEM 范围筛选岸段」的关系</h3>
 * 两件事互相独立、可以叠加：
 * <ul>
 *   <li>DEM 筛选是"一次性动作"：把与某个 DEM 范围相交的岸段加载到地图；</li>
 *   <li>框选是在**当前候选集**（默认就是地图上已加载的岸段，也就是 DEM 筛选的结果）
 *       上再收窄一层，并高亮命中项。</li>
 * </ul>
 * 所以先按 DEM 筛、再框选 = 交集；先框选、再改 DEM 筛选 = 框选高亮保持不变（不互相清空）。
 * 框选**不会**去动 `showTiffBounds` / `focusedDemKeys`，也不会清掉 DEM 加载进来的岸段。
 */

import * as turf from '@turf/turf';

/** 经纬度矩形（WGS84，单位：度）。`west < east`、`south < north` 由 {@link boxFromCorners} 保证。 */
export interface BoxBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** 框选候选集来自哪里：地图上已加载的岸段，还是资源库全量。 */
export type BoxScope = 'loaded' | 'library';

/** 矩形框与"当前显示的 DEM 范围"的关系。 */
export type BoxDemRelation = 'no-dem' | 'outside' | 'inside' | 'covers' | 'partial';

export interface BoxDemAssessment {
  relation: BoxDemRelation;
  /** 与矩形相交的 DEM 范围个数 */
  touched: number;
  /** 被矩形完整包住的 DEM 范围个数 */
  covered: number;
  /** 当前显示的 DEM 范围总数 */
  total: number;
}

/**
 * 框的最小边长（度）。
 *
 * <p>≈ 11 m（32°N）。它只是**兜底**：主要的"太小"判定在 `EditorMap` 里按像素做
 * （拖拽不足 4px 直接当误点取消），这里挡住的是"程序化传进来的退化矩形"。
 */
export const MIN_BOX_SPAN_DEG = 1e-4;

/** 把两个对角点规范成 `west/south/east/north`（拖拽方向任意，可能是右下往左上拖）。 */
export function boxFromCorners(a: [number, number], b: [number, number]): BoxBounds {
  const [ax, ay] = a;
  const [bx, by] = b;
  return {
    west: Math.min(ax, bx),
    south: Math.min(ay, by),
    east: Math.max(ax, bx),
    north: Math.max(ay, by),
  };
}

/** 四个边界都是有限数且 `west < east`、`south < north`。 */
export function isValidBox(box: BoxBounds | null | undefined): box is BoxBounds {
  if (!box) return false;
  const { west, south, east, north } = box;
  if (![west, south, east, north].every((v) => Number.isFinite(v))) return false;
  return west < east && south < north;
}

/** 任一边小于阈值 ⇒ 视为误点（不是有意的框选）。 */
export function isBoxTooSmall(box: BoxBounds | null | undefined, minSpanDeg = MIN_BOX_SPAN_DEG): boolean {
  if (!isValidBox(box)) return true;
  return box.east - box.west < minSpanDeg || box.north - box.south < minSpanDeg;
}

/** 矩形 → GeoJSON Polygon 要素（地图画框、相交判定共用同一份坐标）。 */
export function boxPolygon(box: BoxBounds): GeoJSON.Feature<GeoJSON.Polygon> {
  const { west, south, east, north } = box;
  return turf.polygon([[
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ]]);
}

/** `[west, south, east, north]`，与 turf.bbox 同序，方便直接 fitBounds。 */
export function boxToBbox(box: BoxBounds): [number, number, number, number] {
  return [box.west, box.south, box.east, box.north];
}

/** 两个矩形是否相交（含相切）。用来判断"框是否压在 DEM 范围上"。 */
export function boxesIntersect(a: BoxBounds, b: BoxBounds): boolean {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
}

/**
 * 从任意几何/要素里取外包矩形。
 *
 * <p>支持 `Geometry`、`Feature`、`FeatureCollection` 三种输入 —— 岸段几何在库里是裸
 * `LineString`，DEM 范围是 `Polygon`，画到地图上又都裹成了 `Feature`，
 * 调用方不该为这点差异各写一份。取不到有效坐标返回 null（而不是抛错）。
 */
export function boundsOfGeoJson(input: any): BoxBounds | null {
  if (!input) return null;
  try {
    let geom = input;
    if (geom?.type === 'Feature') geom = geom.geometry;
    if (geom?.type === 'FeatureCollection') {
      let merged: BoxBounds | null = null;
      for (const f of geom.features || []) {
        const b = boundsOfGeoJson(f);
        if (!b) continue;
        merged = merged
          ? {
              west: Math.min(merged.west, b.west),
              south: Math.min(merged.south, b.south),
              east: Math.max(merged.east, b.east),
              north: Math.max(merged.north, b.north),
            }
          : b;
      }
      return merged;
    }
    if (!geom?.type) return null;
    const [w, s, e, n] = turf.bbox(geom);
    if (![w, s, e, n].every((v) => Number.isFinite(v))) return null;
    return { west: w, south: s, east: e, north: n };
  } catch {
    return null;
  }
}

/** 取"当前显示的 DEM 范围"的外包矩形清单（每个要素一个）。 */
export function demBoundsOf(tiffBoundsData: any): BoxBounds[] {
  const features = tiffBoundsData?.features;
  if (!Array.isArray(features)) return [];
  const out: BoxBounds[] = [];
  for (const f of features) {
    const b = boundsOfGeoJson(f);
    if (b) out.push(b);
  }
  return out;
}

/** DEM 范围是否完整落在框内（含相切）。 */
function boxCovers(target: BoxBounds, outer: BoxBounds): boolean {
  return outer.west <= target.west && outer.east >= target.east
    && outer.south <= target.south && outer.north >= target.north;
}

/**
 * 判断矩形与 DEM 范围的关系。
 *
 * <p>只用于**提示**，不用于决定选不选：即使框完全落在 DEM 范围之外也照常按矩形选，
 * 因为本功能与 DEM 筛选相互独立。但用户需要一句解释，否则会以为"按 DEM 筛选失效了"。
 */
export function assessBoxAgainstDems(box: BoxBounds, demBoxes: BoxBounds[]): BoxDemAssessment {
  const list = (demBoxes || []).filter(isValidBox);
  if (list.length === 0) return { relation: 'no-dem', touched: 0, covered: 0, total: 0 };
  const touched = list.filter((d) => boxesIntersect(box, d));
  const covered = touched.filter((d) => boxCovers(d, box)).length;
  if (touched.length === 0) return { relation: 'outside', touched: 0, covered: 0, total: list.length };
  if (covered > 0) return { relation: 'covers', touched: touched.length, covered, total: list.length };
  if (list.some((d) => boxCovers(box, d))) {
    return { relation: 'inside', touched: touched.length, covered: 0, total: list.length };
  }
  return { relation: 'partial', touched: touched.length, covered: 0, total: list.length };
}

// ——————————————————————————————————————————————————————————————
// 岸段候选集与命中判定
// ——————————————————————————————————————————————————————————————

/** 参与框选判定的最小单元：id + 几何（几何可以是裸 Geometry / Feature）。 */
export interface BankCandidate {
  id: string;
  geometry: any;
}

/** 从资源库的岸段清单构造候选集。几何字段在库里有 `bank_geometry` / `geometry` / `geom` 三种写法。 */
export function bankCandidatesFromBanks(banks: any[] | null | undefined): BankCandidate[] {
  const out: BankCandidate[] = [];
  const seen = new Set<string>();
  for (const b of banks || []) {
    const id = String(b?.bank_id ?? b?.bankId ?? b?.id ?? '').trim();
    if (!id || seen.has(id)) continue;
    const raw = b?.bank_geometry ?? b?.bankGeometry ?? b?.geometry ?? b?.geom;
    if (!raw) continue;
    let geometry = raw;
    if (typeof raw === 'string') {
      try {
        geometry = JSON.parse(raw);
      } catch {
        continue;
      }
    }
    seen.add(id);
    out.push({ id, geometry });
  }
  return out;
}

/**
 * 从地图上的岸段要素构造候选集。
 *
 * <p>只认 `LineString` / `MultiLineString`，与 `uploaded-lines` 图层的过滤条件一致
 * （`$type == LineString`；上传时也只把线转成岸段），否则面板里数出来的条数会和地图对不上。
 * 没有 `bank_id` 的岸线是未入库的占位（`line-N`），不参与框选 —— 它们没法按 id 回查/加载。
 */
export function bankCandidatesFromFeatures(fc: any): BankCandidate[] {
  const out: BankCandidate[] = [];
  const seen = new Set<string>();
  for (const f of (fc?.features || []) as any[]) {
    const type = f?.geometry?.type;
    if (type !== 'LineString' && type !== 'MultiLineString') continue;
    const id = String(f?.properties?.bank_id ?? f?.properties?.bankId ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, geometry: f.geometry });
  }
  return out;
}

/**
 * 命中判定：岸段几何与矩形**是否相交**（而不是"完全被包含"）。
 *
 * <p>岸段动辄几公里、几十公里，要求整条线落在框里等于让用户把整条江框住，
 * 实际操作中几乎选不中任何东西。相交是地图框选的通行口径（ArcGIS / QGIS 默认行为）。
 *
 * <p>先用 bbox 粗筛再交给 turf 做精确判定：几百条岸段逐条做多边形相交在拖拽结束时
 * 一次性执行还行，但抽出来做实时预览时 bbox 粗筛能省掉 90% 的精确计算。
 */
export function pickBankIdsInBox(candidates: BankCandidate[], box: BoxBounds): string[] {
  if (!isValidBox(box)) return [];
  const polygon = boxPolygon(box);
  const ids: string[] = [];
  for (const c of candidates) {
    const bbox = boundsOfGeoJson(c.geometry);
    if (!bbox || !boxesIntersect(bbox, box)) continue;
    try {
      const feature = c.geometry?.type === 'Feature' ? c.geometry : turf.feature(c.geometry as any);
      if (turf.booleanIntersects(feature as any, polygon as any)) ids.push(c.id);
    } catch {
      /* 几何非法：跳过，不让一条坏数据毁掉整次框选 */
    }
  }
  return ids;
}

// ——————————————————————————————————————————————————————————————
// 结果摘要（提示文案）
// ——————————————————————————————————————————————————————————————

export interface BoxSummaryInput {
  matched: number;
  /** 参与判定的候选条数 */
  candidates: number;
  scope: BoxScope;
  dem: BoxDemAssessment;
}

export interface BoxSummary {
  ok: boolean;
  text: string;
}

/** DEM 关系那一句附加说明（只在需要解释时出现）。 */
export function demNote(dem: BoxDemAssessment): string {
  switch (dem?.relation) {
    case 'covers':
      return `；框选范围已覆盖 ${dem.covered} 个 DEM 范围（大于 DEM 范围时按矩形全取）`;
    case 'outside':
      return '；该框不在任何已显示的 DEM 范围内（与 DEM 筛选互不影响，仍按矩形选）';
    case 'inside':
      return '；框选范围小于 DEM 范围，已在 DEM 结果内收窄';
    case 'partial':
      return `；与 ${dem.touched} 个 DEM 范围部分重叠`;
    default:
      return '';
  }
}

/** 一次框选之后该给用户看什么。成功与失败都返回可直接 `message.xxx` 的整句。 */
export function summarizeBoxSelection(input: BoxSummaryInput): BoxSummary {
  const { matched, candidates, scope, dem } = input;
  if (matched > 0) {
    const base = scope === 'library'
      ? `框选命中 ${matched} 条岸段（全库 ${candidates} 条），已加载到地图`
      : `框选命中 ${matched} 条岸段（已加载 ${candidates} 条）`;
    return { ok: true, text: base + demNote(dem) };
  }
  if (candidates === 0) {
    return { ok: false, text: '没有可框选的岸段：先把岸段加载到地图，或用「框选全库岸段」' };
  }
  const tail = dem?.relation === 'outside' ? '，且该框不在任何已显示的 DEM 范围内' : '';
  return {
    ok: false,
    text: `框选范围内没有岸段（候选 ${candidates} 条${tail}）`,
  };
}
