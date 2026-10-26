/**
 * 岸段折点编辑的纯几何运算。
 *
 * <p>为什么单独一个模块：折点拖拽的全部难点不在「画个圆点」，而在
 * 「拖动之后那条线还成立吗」。这里把「改一个折点」「在线上插一个折点」
 * 「删一个折点」做成不可变函数，由 `bankGeometryEdit.test.ts` 逐条守边界，
 * 页面里只剩「把结果喂给 Mapbox」。反过来，如果这些逻辑内联在 mousemove 回调里，
 * NaN / 越界 / 折点不足这几种情况根本没法测，线上表现是「岸段凭空消失」。
 *
 * <h3>坐标口径</h3>
 * 全部用 GeoJSON 原生的 `[lng, lat]`，不转墨卡托。理由：岸段几何从库里取出来就是
 * 经纬度，保存时原样写回；一旦中途换了投影，回写就会引入微小抖动，
 * 而岸段长度参与色带区间切分（`sectionProgressAlongBank`），抖动会让色带边缘跳动。
 * 只有「点到线段的距离」这种比较才临时做平面近似（见 {@link nearestPointOnBank}），
 * 因为编辑时的拾取精度要求是「几米」，不需要大地测量。
 */

/** 编辑态的图层 / 数据源 id。集中定义，避免页面里散落字符串拼错后静默不生效。 */
export const BANK_EDIT_DRAFT_SOURCE_ID = 'bank-edit-draft-source';
export const BANK_EDIT_DRAFT_HALO_LAYER_ID = 'bank-edit-draft-halo';
export const BANK_EDIT_DRAFT_LAYER_ID = 'bank-edit-draft-line';
export const BANK_EDIT_VERTEX_SOURCE_ID = 'bank-edit-vertex-source';
export const BANK_EDIT_VERTEX_HIT_LAYER_ID = 'bank-edit-vertex-hit';
export const BANK_EDIT_VERTEX_LAYER_ID = 'bank-edit-vertex';

/** 草稿线颜色：刻意用青色而不是风险四色，避免被误读成某一档风险。 */
export const BANK_EDIT_DRAFT_COLOR = '#0ea5e9';

/** 折点圆点颜色。与草稿线同色系，但实心更亮，保证压在影像上也看得见。 */
export const BANK_EDIT_VERTEX_COLOR = '#0284c7';

/** 岸段折点。[lng, lat]，顺序不能反 —— 反了整条岸段会跑到地球另一侧。 */
export type BankCoord = [number, number];

type Coord = BankCoord;

/** 经纬度是否可用来构造几何：既要有值，也得在世界范围内。 */
function isUsableLngLat(lng: unknown, lat: unknown): boolean {
  if (typeof lng !== 'number' || typeof lat !== 'number') {
    // 后端 jsonb 偶尔把数值写成字符串（历史上出现过），这里只接受 number，
    // 不做字符串兼容 —— 让脏数据在保存时被后端 400 拦住，好过前端偷偷改写精度。
    return false;
  }
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  return lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
}

/**
 * 从岸段几何里取出可编辑的折点数组。
 *
 * <p>只接受 `LineString`：岸段在系统里处处按「一条首尾有序的线」对待
 * （里程投影、色带 gradient、按里程切片）。`MultiLineString` 在这里返回 `null`
 * 而不是拼成一条 —— 拼接会在段与段之间凭空造出一段不存在的岸线，
 * 而那段假岸线会立刻被算进长度、影响色带位置。
 */
export function normalizeBankCoords(geometry: unknown): Coord[] | null {
  if (!geometry || typeof geometry !== 'object') return null;
  const geo = geometry as { type?: unknown; coordinates?: unknown };
  if (geo.type !== 'LineString') return null;
  if (!Array.isArray(geo.coordinates) || geo.coordinates.length < 2) return null;

  const out: Coord[] = [];
  for (const point of geo.coordinates) {
    if (!Array.isArray(point) || point.length < 2) return null;
    const lng = point[0];
    const lat = point[1];
    if (!isUsableLngLat(lng, lat)) return null;
    out.push([lng as number, lat as number]);
  }
  return out;
}

/** 折点数组 → GeoJSON Feature。颜色/属性由图层表达式决定，这里只带 `bank_id`。 */
export function coordsToLineFeature(coords: Coord[], bankId?: string): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: 'Feature',
    properties: bankId ? { bank_id: bankId } : {},
    geometry: { type: 'LineString', coordinates: coords.map(c => [c[0], c[1]]) },
  };
}

/** 折点数组 → 每个折点一个 Point Feature，`index` 是拖拽时回写位置的唯一依据。 */
export function vertexFeatures(coords: Coord[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: coords.map((c, index) => ({
      type: 'Feature' as const,
      // index 必须写成 number：写成字符串后 `Number(...)` 在回调里还能用，
      // 但 Mapbox 的 filter 表达式 `['==', ['get','index'], 3]` 会静默不匹配。
      properties: { index },
      geometry: { type: 'Point' as const, coordinates: [c[0], c[1]] },
    })),
  };
}

/** 移动第 index 个折点。返回新数组，绝不原地改（React 依赖引用变化判断重绘）。 */
export function moveVertex(coords: Coord[], index: number, lng: number, lat: number): Coord[] {
  if (index < 0 || index >= coords.length) return coords.slice();
  if (!isUsableLngLat(lng, lat)) return coords.slice();
  const next = coords.slice();
  next[index] = [lng, lat];
  return next;
}

/**
 * 在第 `segmentIndex` 段**内部**插入折点（该段由 `coords[segmentIndex]` 与
 * `coords[segmentIndex + 1]` 两个折点构成），插入后新折点的下标是 `segmentIndex + 1`。
 *
 * <p>用「段起点下标 + 1」而不是「按段终点下标插入」：段终点的下标随插入点是否为末段而分叉，
 * 写成两套分支后必然有一支错位。注意它**不是追加**——追加到末尾用
 * `insertVertexAfter(coords, coords.length - 2, …)`。
 */
export function insertVertexAfter(coords: Coord[], segmentIndex: number, lng: number, lat: number): Coord[] {
  const next = coords.slice();
  if (segmentIndex < 0 || segmentIndex >= coords.length - 1) return next;
  if (!isUsableLngLat(lng, lat)) return next;
  next.splice(segmentIndex + 1, 0, [lng, lat]);
  return next;
}

/**
 * 删除第 index 个折点。
 *
 * <p>剩不到 2 个点时返回 `null` —— 调用方据此拒绝这次删除。
 * 不能「删到只剩 1 个点再让后端报错」：那时草稿线已经画不出来了，
 * 用户看到的是岸段突然消失，而不是「这一步不允许」。
 */
export function deleteVertex(coords: Coord[], index: number): Coord[] | null {
  if (index < 0 || index >= coords.length) return coords.slice();
  if (coords.length <= 2) return null;
  const next = coords.slice();
  next.splice(index, 1);
  return next;
}

/**
 * 去掉「严重重合」的相邻折点（默认 0.1 mm 量级）。
 *
 * <p>拖拽时手一抖就会在两个折点上落下同一个坐标，而重合折点会让
 * `turf.length` 出现 0 长度段，进而让色带的 `lineSliceAlong` 抛错。
 * 只清中间点，首尾一律保留：岸段两端是里程基准，动了会让整条线整体偏移。
 */
export function dropCoincidentVertices(coords: Coord[], toleranceDeg = 1e-9): Coord[] {
  if (coords.length <= 2) return coords.slice();
  const next: Coord[] = [coords[0]];
  for (let i = 1; i < coords.length - 1; i++) {
    const prev = next[next.length - 1];
    const cur = coords[i];
    if (Math.abs(cur[0] - prev[0]) <= toleranceDeg && Math.abs(cur[1] - prev[1]) <= toleranceDeg) continue;
    next.push(cur);
  }
  next.push(coords[coords.length - 1]);

  // 保底：清理后若**一个有效段都不剩**（全点重合），原样返回。
  // 此时返回清理后的 2 个重合点在几何上同样退化，但会把「3 个点」变成「2 个点」——
  // 用户看到折点数莫名变少，却还是画不出线。保留原样才能让后端那侧的
  // 「所有折点重合」校验给出可解释的报错。
  const hasDistinctSegment = next.some((cur, i) =>
    i > 0 && (Math.abs(cur[0] - next[i - 1][0]) > toleranceDeg || Math.abs(cur[1] - next[i - 1][1]) > toleranceDeg));
  return hasDistinctSegment ? next : coords.slice();
}

/** 平面近似下的点—线段距离（米）。只在拾取时用，不参与任何入库计算。 */
function distancePointToSegmentMeters(
  lng: number, lat: number,
  a: Coord, b: Coord,
): { distance: number; point: Coord } {
  const metersPerDegLat = 110540;
  const metersPerDegLng = 111320 * Math.cos((lat * Math.PI) / 180);
  const ax = (a[0] - lng) * metersPerDegLng;
  const ay = (a[1] - lat) * metersPerDegLat;
  const bx = (b[0] - lng) * metersPerDegLng;
  const by = (b[1] - lat) * metersPerDegLat;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  // 零长度段（相邻折点重合）：退化为到端点的距离
  if (lenSq <= 1e-12) {
    return { distance: Math.hypot(ax, ay), point: [a[0], a[1]] };
  }
  // 投影参数夹到 [0,1]：落在段外时取最近端点，这样插点不会跑到延长线上去
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lenSq));
  const px = ax + t * dx;
  const py = ay + t * dy;
  return {
    distance: Math.hypot(px, py),
    point: [lng + px / metersPerDegLng, lat + py / metersPerDegLat],
  };
}

/**
 * 找离给定经纬度最近的那一段岸线。
 *
 * <p>返回的 `point` 是**投影到线段上的点**，不是用户点击的位置 —— 双击插点必须落在线上，
 * 否则插入的折点会把岸线拽出一个尖角。
 */
export function nearestPointOnBank(
  coords: Coord[],
  lng: number,
  lat: number,
): { segmentIndex: number; point: Coord; distance: number } | null {
  if (coords.length < 2) return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;

  let best: { segmentIndex: number; point: Coord; distance: number } | null = null;
  for (let i = 0; i < coords.length - 1; i++) {
    const candidate = distancePointToSegmentMeters(lng, lat, coords[i], coords[i + 1]);
    if (!best || candidate.distance < best.distance) {
      best = { segmentIndex: i, point: candidate.point, distance: candidate.distance };
    }
  }
  return best;
}

/** 折点数组的指纹：坐标保留 7 位小数（约 1 cm），用于判断「是否改过」。 */
export function coordsSignature(coords: Coord[]): string {
  return coords.map(c => `${c[0].toFixed(7)},${c[1].toFixed(7)}`).join(';');
}

/** 草稿线 paint。线宽不随缩放插值：编辑时这条线是「正在改的那条」，粗细应恒定。 */
export function bankEditDraftPaint(): Record<string, unknown> {
  return {
    'line-color': BANK_EDIT_DRAFT_COLOR,
    'line-width': 3,
    'line-opacity': 0.95,
  };
}

/** 草稿线外描边：卫星底图上青色细线会被影像吃掉，垫一层白边保证任何底图都看得见。 */
export function bankEditDraftHaloPaint(): Record<string, unknown> {
  return {
    'line-color': '#ffffff',
    'line-width': 6,
    'line-opacity': 0.55,
  };
}

/**
 * 折点圆点 paint。
 *
 * <p>低缩放只给小点：一条岸段平均上百个折点（最长 1757 个），
 * 半径给大了在省市级视图上会糊成一条粗带，反而看不出岸线走向。
 */
export function bankEditVertexPaint(): Record<string, unknown> {
  return {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 2, 12, 3.5, 16, 5],
    'circle-color': BANK_EDIT_VERTEX_COLOR,
    'circle-stroke-width': 1.2,
    'circle-stroke-color': '#ffffff',
    'circle-opacity': 0.95,
  };
}

/** 折点命中层 paint：完全透明但比圆点大一圈，给鼠标留容错。 */
export function bankEditVertexHitPaint(): Record<string, unknown> {
  return {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 8, 12, 11, 16, 14],
    'circle-color': '#000000',
    'circle-opacity': 0,
  };
}
