import * as turf from '@turf/turf';

/**
 * 断面 → 岸段的归属判定（唯一真源）。
 *
 * 背景：`cross_sections.bank_id` 是断面与岸段之间**唯一**的关联列，下游四条链
 * （地图岸段着色 `applyShorelineGradient`、岸段几何预加载 `GET /banks/{id}`、
 * 风险段导出 `RiskSegmentSummaryService`、任务→岸段反推 `selectDistinctRealBankIdsByTask`）
 * 全部按它做匹配。一旦写进去的是 `line-N`（前端上传数组的下标占位符），
 * 下游 `GET /banks/line-6` 恒 404，着色与导出**静默失效**——不报错、不留日志。
 *
 * 所以这里的规矩：
 * 1. **只认真实 `bank_id`**，绝不兜底造 `line-N`；
 * 2. 归不上就不归属（`bank_id` 写空串），**不硬绑最近的一条**；
 * 3. 判定顺序：地图吸附锚点 → 断面首点 → 中点，每一级都有距离门限。
 */

/** 判定点到岸段的最大归属距离（米）。超过即视为「未归属岸段」。 */
export const MAX_BIND_DISTANCE_M = 200;

export type LngLat = [number, number];

/** 归属是靠哪个点判定出来的：地图吸附点 / 首点 / 中点。 */
export type BindingMatchedBy = 'anchor' | 'start' | 'midpoint';

/** 地图上首次点击时吸附到的岸段信息（由 EditorMap 采集，跨两次点击保持）。 */
export interface BankAnchor {
  /** 吸附后的坐标（落在岸段线上） */
  point: LngLat;
  /** 命中的岸段真实 id；岸段没有 id 时为 null */
  bankId: string | null;
  /** 吸附点沿该岸段的里程（米） */
  distance: number | null;
}

export interface BankBinding {
  /** 归属岸段真实 id；归不上为 null（写库时落空串） */
  bankId: string | null;
  /** 沿该岸段的里程（米）；归不上为 null */
  distance: number | null;
  /** 岸段上的垂足坐标；归不上为 null */
  footPoint: LngLat | null;
  matchedBy: BindingMatchedBy | null;
  /** 命中的岸段在 features 里的下标 */
  bankIndex: number | null;
  /** 判定点到岸段的最短距离（米），未匹配到任何岸段为 null */
  distanceToBank: number | null;
}

export const UNBOUND_BINDING: BankBinding = {
  bankId: null,
  distance: null,
  footPoint: null,
  matchedBy: null,
  bankIndex: null,
  distanceToBank: null,
};

/**
 * `line-N` 是前端把上传岸段数组下标当 id 用的占位符（N 是数组下标，**跨任务、跨次加载都会变**）。
 * 这类值一旦写进库就永久失联，任何下游都匹配不上。
 */
export function isPlaceholderBankId(id: string | null | undefined): boolean {
  return typeof id === 'string' && /^line-\d+$/.test(id.trim());
}

/**
 * 取岸段 feature 的真实 `bank_id`。
 * 没有就是 null —— **不返回 `line-N` 兜底**，那正是历史脏数据的来源。
 */
export function bankIdOfFeature(feature: any, index?: number): string | null {
  void index;
  const props = feature?.properties || {};
  const raw = String(props.bank_id ?? props.bankId ?? '').trim();
  if (!raw || isPlaceholderBankId(raw)) return null;
  return raw;
}

/**
 * 前端渲染/选中用的 key：真实 id 优先，退化成 `line-index`。
 * ⚠ 这个 key **只允许出现在地图渲染、列表 key、选中集**里，绝不能写进接口请求体。
 */
export function renderKeyOfFeature(feature: any, index: number): string {
  return bankIdOfFeature(feature, index) ?? `line-${index}`;
}

function linesOfGeometry(geometry: any): GeoJSON.Feature<GeoJSON.LineString>[] {
  if (!geometry) return [];
  if (geometry.type === 'LineString') {
    const coords = geometry.coordinates as number[][];
    return Array.isArray(coords) && coords.length >= 2 ? [turf.lineString(coords)] : [];
  }
  if (geometry.type === 'MultiLineString') {
    return ((geometry.coordinates || []) as number[][][])
      .filter((c) => Array.isArray(c) && c.length >= 2)
      .map((c) => turf.lineString(c));
  }
  return [];
}

interface SnapResult {
  /** 沿该段线的里程（米） */
  distance: number;
  footPoint: LngLat;
  /** 点到线的最短距离（米） */
  meters: number;
}

function snapToLines(point: LngLat, lines: GeoJSON.Feature<GeoJSON.LineString>[]): SnapResult | null {
  let best: SnapResult | null = null;
  for (const line of lines) {
    try {
      const snap = turf.nearestPointOnLine(line, turf.point(point), { units: 'meters' });
      const meters = turf.distance(turf.point(point), snap, { units: 'meters' });
      if (!Number.isFinite(meters)) continue;
      if (best !== null && meters >= best.meters) continue;
      const coords = snap.geometry.coordinates as number[];
      best = {
        distance: Number(snap.properties?.location ?? 0),
        footPoint: [Number(coords[0]), Number(coords[1])],
        meters,
      };
    } catch {
      // 单条岸段几何异常（坐标损坏等）不该拖垮整次匹配
    }
  }
  return best;
}

/**
 * 把一个点吸附到指定岸段上。
 * 用于地图上「首点落在岸段上」的场景：返回落在岸段线上的坐标 + 沿程里程。
 */
export function snapPointToBank(point: LngLat, feature: any, index = 0): (SnapResult & { bankId: string | null }) | null {
  const snap = snapToLines(point, linesOfGeometry(feature?.geometry));
  if (!snap) return null;
  return { ...snap, bankId: bankIdOfFeature(feature, index) };
}

interface Candidate extends SnapResult {
  bankId: string | null;
  bankIndex: number;
}

function nearestOnBanks(point: LngLat, features: any[]): Candidate | null {
  let best: Candidate | null = null;
  for (let i = 0; i < features.length; i += 1) {
    const snap = snapToLines(point, linesOfGeometry(features[i]?.geometry));
    if (!snap) continue;
    if (best !== null && snap.meters >= best.meters) continue;
    best = { ...snap, bankId: bankIdOfFeature(features[i], i), bankIndex: i };
  }
  return best;
}

function toBinding(candidate: Candidate, matchedBy: BindingMatchedBy): BankBinding {
  return {
    bankId: candidate.bankId,
    distance: candidate.distance,
    footPoint: candidate.footPoint,
    matchedBy,
    bankIndex: candidate.bankIndex,
    distanceToBank: candidate.meters,
  };
}

/**
 * 解析断面归属的岸段。
 *
 * 判定顺序（前一级命中就不再往下走）：
 * 1. `anchor`：地图上首次点击时吸附到的岸段，**显式 id 优先**（用户眼睛看到的第一落点最可信）；
 * 2. `start`：断面首点，距离 ≤ `maxDistanceM` 才算；
 * 3. `midpoint`：两端点中点（保留原有能力，用于首点悬空但断面确实跨过岸段的画法）。
 *
 * 三级都超出阈值 ⇒ 返回未归属。宁可「未归属岸段」（下游显示为未归属、不画色带），
 * 也不要把断面硬绑到几百米外的一条岸段上——错绑会画出位置错误的色带，比不画更难发现。
 */
export function resolveBankBinding(params: {
  start: LngLat;
  end: LngLat;
  banks?: GeoJSON.FeatureCollection | any[] | null;
  anchor?: BankAnchor | null;
  maxDistanceM?: number;
}): BankBinding {
  const features = Array.isArray(params.banks) ? params.banks : (params.banks?.features ?? []);
  const maxD = Number.isFinite(params.maxDistanceM) ? Number(params.maxDistanceM) : MAX_BIND_DISTANCE_M;
  if (!Array.isArray(features) || features.length === 0) return UNBOUND_BINDING;

  const anchor = params.anchor ?? null;
  if (anchor?.bankId) {
    for (let i = 0; i < features.length; i += 1) {
      if (bankIdOfFeature(features[i], i) !== anchor.bankId) continue;
      const snap = snapPointToBank(anchor.point, features[i], i);
      if (snap && snap.bankId && snap.meters <= maxD) {
        return {
          bankId: snap.bankId,
          distance: snap.distance,
          footPoint: snap.footPoint,
          matchedBy: 'anchor',
          bankIndex: i,
          distanceToBank: snap.meters,
        };
      }
      break;
    }
  }

  const byStart = nearestOnBanks(params.start, features);
  if (byStart && byStart.bankId && byStart.meters <= maxD) return toBinding(byStart, 'start');

  const mid: LngLat = [
    (params.start[0] + params.end[0]) / 2,
    (params.start[1] + params.end[1]) / 2,
  ];
  const byMid = nearestOnBanks(mid, features);
  if (byMid && byMid.bankId && byMid.meters <= maxD) return toBinding(byMid, 'midpoint');

  return { ...UNBOUND_BINDING, distanceToBank: byStart?.meters ?? null };
}

/** 归属失败时给用户看的提示文案（落在 action 里拼，统一口径）。 */
export function describeUnbound(binding: BankBinding): string {
  if (binding.distanceToBank === null) {
    return '断面已创建，但地图上没有带 bank_id 的岸段，无法关联（结果不会影响任何岸段）';
  }
  return `断面已创建，但首点离最近的岸段约 ${Math.round(binding.distanceToBank)} m（超过 ${MAX_BIND_DISTANCE_M} m），未归属岸段：结果不会影响岸段着色与风险段导出`;
}
