/**
 * 框选批量设为无效：命中判定 + 地图高亮。
 *
 * <h3>为什么和「框选删除断面」不是同一套判定</h3>
 * `sectionBoxDelete.ts` 用的是**几何相交**（断面穿过框边界也算命中）—— 那条断面本来就短，
 * 框压到它就是想说"删掉它"。而这里框的是一个**区域**，用户心里想的是
 * 「这一段岸上的断面都先别算」，所以锚点必须是**断面起点**（岸侧端点）落在框内：
 *   · 用相交判：一条断面从框里穿过、起点却在三公里外的另一段岸上，会被顺手标记无效；
 *   · 用起点判：框住哪段岸线，就只有挂在那段岸上的断面被选中 —— 与"起点圆点"这个
 *     已经画在图上的视觉锚点一一对应，用户框的和他看到的是同一件事。
 *
 * <h3>边界算命中</h3>
 * `west <= lng <= east && south <= lat <= north`，与出图/报告分区、岸段框选、
 * 数据库里 `ST_MakeEnvelope` 用的是同一条契约（见 `docs` 里的跨语言约定）。
 * 用 turf 的 `booleanPointInPolygon` 也能得到"边界算内"，但它在边界上是浮点比较，
 * 与其它三处的判定在极端情况下会不一致 —— 一处不一致就是"地图上选了、报表里没有"。
 *
 * <h3>起点缺失怎么办</h3>
 * 退化几何（无坐标、单点、经纬度为 NaN）取不到起点，**一律不命中**，
 * 而不是退化成"线相交"或"几何中点"：静默换判据会让用户完全无法解释
 * 「我明明框住了它，为什么没变灰」。这类断面在面板里会提示去单条设置。
 */

import * as turf from '@turf/turf';
import type { GeoJSONSource, Map as MapboxMap } from 'mapbox-gl';

import { AREA_SELECTION_FILL_LAYER, AREA_SELECTION_LINE_LAYER } from './areaSelection';
import { boundsOfGeoJson, isValidBox, type BoxBounds } from './boxSelection';
import { sectionStartCoordinate } from './sectionStartPoints';

/** 高亮用的临时图层（拖拽期间每帧更新，退出框选就清空）。 */
export const SECTION_BOX_MATCH_SOURCE_ID = 'sections-box-match-src';
export const SECTION_BOX_MATCH_LINE_LAYER_ID = 'sections-box-match-line';
export const SECTION_BOX_MATCH_START_LAYER_ID = 'sections-box-match-start';
/** 三个 id 的公共前缀：判「哪些图层是我自己的」时用，避免把内容层错算进去。 */
const SECTION_BOX_MATCH_PREFIX = 'sections-box-match';

/**
 * 高亮色：琥珀 `#f59e0b`。
 *
 * 不能复用任何一种既有颜色，否则图上就是"又是一条红/灰断面"：
 *   · 四个风险等级占掉 绿/蓝/橙/红（`RISK_COLORS`）；
 *   · 「无数据/人工无效」占掉灰（`NO_DATA_RISK_COLOR`）；
 *   · 「框选分析」的选区占掉青（`AREA_SELECTION_COLOR`）；
 *   · 「框选岸段」是紫、「框选删除」是红。
 * 琥珀是唯一还剩的"警示但不属于任何等级"的色相，且与红色能一眼区分（红 = 高风险）。
 */
export const SECTION_BOX_MATCH_COLOR = '#f59e0b';

/** 判定只需要这三个字段；`SectionResult` 结构更宽，直接传进来即可。 */
export interface SectionBoxCandidate {
  section_id?: string | null;
  geometry?: unknown;
  manual_invalid?: boolean | null;
}

/** 选区（矩形 Polygon）→ 轴对齐外包矩形。退化/非矩形一律 null。 */
export function sectionBoxBoundsOf(selection: unknown): BoxBounds | null {
  if (!selection) return null;
  const bounds = boundsOfGeoJson(selection);
  return isValidBox(bounds) ? bounds : null;
}

/** 点是否落在框内 —— **边界算内**。抽出来是为了让单测能直接钉这一条。 */
export function pointInBoxInclusive(
  lng: number,
  lat: number,
  box: BoxBounds | null | undefined,
): boolean {
  if (!isValidBox(box ?? null)) return false;
  const b = box as BoxBounds;
  return lng >= b.west && lng <= b.east && lat >= b.south && lat <= b.north;
}

/**
 * 挑出**起点落在框内**的断面 id。
 *
 * <p>返回 id 而不是下标：批量接口按 id 提交，也不存在"删掉之后下标漂移"的问题
 * （`pickSectionIndicesInBox` 需要下标是因为调用方要重映射选中态）。
 */
export function pickSectionIdsByStartPoint(
  candidates: SectionBoxCandidate[] | null | undefined,
  box: BoxBounds | null | undefined,
): string[] {
  if (!isValidBox(box ?? null)) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const c of candidates ?? []) {
    const id = String(c?.section_id ?? '').trim();
    if (!id || seen.has(id)) continue;
    const start = sectionStartCoordinate(c?.geometry);
    if (!start) continue;
    if (!pointInBoxInclusive(start[0], start[1], box)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * 按**操作前**的状态把命中项分成两拨。
 *
 * <p>「撤销本次」必须只把 `toMark` 那拨改回有效：`alreadyInvalid` 那拨本来就无效，
 * 一起回滚等于顺手把用户之前手工关掉的断面放出来 —— 撤销变成一种破坏。
 */
export function splitBoxInvalidByPriorState(
  candidates: SectionBoxCandidate[] | null | undefined,
  ids: string[] | null | undefined,
): { toMark: string[]; alreadyInvalid: string[] } {
  const wasInvalid = new Set<string>();
  for (const c of candidates ?? []) {
    if (c?.manual_invalid === true) wasInvalid.add(String(c?.section_id ?? '').trim());
  }
  const toMark: string[] = [];
  const alreadyInvalid: string[] = [];
  for (const raw of ids ?? []) {
    const id = String(raw ?? '').trim();
    if (!id) continue;
    (wasInvalid.has(id) ? alreadyInvalid : toMark).push(id);
  }
  return { toMark, alreadyInvalid };
}

/** 高亮要素：命中断面整条线（含框外的部分）+ 起点圆。 */
export function boxMatchFeatures(
  candidates: SectionBoxCandidate[] | null | undefined,
  ids: string[] | null | undefined,
): GeoJSON.Feature[] {
  const want = new Set((ids ?? []).map((id) => String(id ?? '').trim()).filter(Boolean));
  if (want.size === 0) return [];
  const out: GeoJSON.Feature[] = [];
  for (const c of candidates ?? []) {
    const id = String(c?.section_id ?? '').trim();
    if (!want.has(id)) continue;
    if (c?.geometry) {
      out.push({
        type: 'Feature',
        properties: { id, kind: 'line' },
        geometry: c.geometry as GeoJSON.Geometry,
      });
    }
    const start = sectionStartCoordinate(c?.geometry);
    if (start) {
      out.push({
        type: 'Feature',
        properties: { id, kind: 'start' },
        geometry: { type: 'Point', coordinates: start },
      });
    }
  }
  return out;
}

/**
 * 建 source + 两层（幂等）。
 *
 * <p>**不要**用「插到选区图层下面」来定位 —— 这个假设是错的，而且错得很隐蔽：
 * 岸段色带（`bankline-result-*`）是按岸段**懒创建**的，每建一批就追加到图层栈顶；
 * 断面线（`sections-*`）在换任务时先被 `clearMapLayers` 删掉再重建，同样跑到顶上。
 * 于是「插在选区下面」等于「插在所有色带下面」—— 真机上表现就是 source 里有几百条
 * 要素、面板也在报数，但地图上一条高亮都看不见（2026-10-26 踩过）。
 *
 * 所以这里先加到栈顶，再由 {@link raiseSectionBoxMatchLayers} 按「内容层 < 高亮 < 选区框」
 * 统一排序。分两步是因为 `getStyle()` 很贵，只能节流跑，不能每帧跑。
 */
export function ensureSectionBoxMatchLayers(map: MapboxMap): void {
  try {
    if (!map.getSource(SECTION_BOX_MATCH_SOURCE_ID)) {
      map.addSource(SECTION_BOX_MATCH_SOURCE_ID, {
        type: 'geojson',
        data: turf.featureCollection([]) as any,
      });
    }
  } catch {
    return; // 样式正在换：调用方下一帧会重试
  }

  try {
    if (!map.getLayer(SECTION_BOX_MATCH_LINE_LAYER_ID)) {
      map.addLayer({
        id: SECTION_BOX_MATCH_LINE_LAYER_ID,
        type: 'line',
        source: SECTION_BOX_MATCH_SOURCE_ID,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': SECTION_BOX_MATCH_COLOR,
          // 比断面本体（5px）更粗：被选中的那条要能从"自己原来的颜色"上面透出来
          'line-width': 7,
          'line-opacity': 0.95,
        },
      });
    }
  } catch {
    /* 图层加不上：下一帧重试 */
  }

  try {
    if (!map.getLayer(SECTION_BOX_MATCH_START_LAYER_ID)) {
      map.addLayer({
        id: SECTION_BOX_MATCH_START_LAYER_ID,
        type: 'circle',
        source: SECTION_BOX_MATCH_SOURCE_ID,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 4, 14, 8, 17, 11] as any,
          'circle-color': SECTION_BOX_MATCH_COLOR,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.95,
        },
      });
    }
  } catch {
    /* 同上 */
  }
}

/** 上一次做层序检查的时间（`getStyle()` 是深拷贝，不能每帧调）。 */
let lastRaiseAt = 0;

/**
 * 把层序摆正：**内容层（断面线 / 色带）< 命中断面高亮 < 选区矩形**。
 *
 * <p>为什么高亮要在内容层之上：它表达的是"这几条会被隐藏"，压在线下面等于没画。
 * 为什么选区框又要在高亮之上：高亮是 7px 粗线，贴着框边的那一批会把虚线边框整段盖掉，
 * 用户就看不出自己框到哪儿了。
 *
 * <p>`getStyle()` 每次都会序列化整个 style（30+ 图层、几毫秒），拖拽每秒 60 帧，
 * 无条件调会明显掉帧。所以按 `intervalMs` 节流（默认 400ms）：
 * 色带只可能在换任务时批量出现（那时还没开始框），节流完全够用。
 *
 * @returns 是否真的动了图层顺序
 */
export function raiseSectionBoxMatchLayers(
  map: MapboxMap | null | undefined,
  options: { intervalMs?: number; now?: number } = {},
): boolean {
  if (!map || typeof map.getLayer !== 'function' || typeof map.moveLayer !== 'function') return false;
  if (!map.getLayer(SECTION_BOX_MATCH_LINE_LAYER_ID)) return false;

  const intervalMs = options.intervalMs ?? 400;
  const now = options.now ?? Date.now();
  if (now - lastRaiseAt < intervalMs) return false;
  lastRaiseAt = now;

  let layers: Array<{ id?: string }> = [];
  try {
    layers = map.getStyle()?.layers ?? [];
  } catch {
    return false; // 样式正在卸载
  }
  const indexOf = (id: string) => layers.findIndex((l) => l?.id === id);

  // 「内容层」= 断面线与岸段色带。必须排除自己的 `sections-box-match-*`，
  // 否则永远判定为"需要重排"，等于没节流。
  let maxContent = -1;
  layers.forEach((layer, i) => {
    const id = String(layer?.id ?? '');
    if (!id) return;
    if (id.startsWith(SECTION_BOX_MATCH_PREFIX)) return;
    if (id.startsWith('bankline-') || id.startsWith('sections-')) maxContent = Math.max(maxContent, i);
  });

  const iLine = indexOf(SECTION_BOX_MATCH_LINE_LAYER_ID);
  const iStart = indexOf(SECTION_BOX_MATCH_START_LAYER_ID);
  const iFill = indexOf(AREA_SELECTION_FILL_LAYER);
  const iAreaLine = indexOf(AREA_SELECTION_LINE_LAYER);

  const highlightBelow = iLine < maxContent || (iStart >= 0 && iStart < maxContent);
  const areaAbove = iFill < 0 || (iFill > Math.max(iLine, iStart) && (iAreaLine < 0 || iAreaLine > iFill));
  if (!highlightBelow && areaAbove) return false;

  // 依次提到栈顶 ⇒ 最终顺序：line → start → fill → area-line
  try {
    map.moveLayer(SECTION_BOX_MATCH_LINE_LAYER_ID);
    if (map.getLayer(SECTION_BOX_MATCH_START_LAYER_ID)) map.moveLayer(SECTION_BOX_MATCH_START_LAYER_ID);
    if (iFill >= 0) map.moveLayer(AREA_SELECTION_FILL_LAYER);
    if (iAreaLine >= 0) map.moveLayer(AREA_SELECTION_LINE_LAYER);
  } catch {
    return false;
  }
  return true;
}

/** 把命中集合画到地图上（ids 为空即清空，但保留图层以便下一帧继续用）。 */
export function paintSectionBoxMatch(
  map: MapboxMap | null | undefined,
  candidates: SectionBoxCandidate[] | null | undefined,
  ids: string[] | null | undefined,
): void {
  if (!map) return;
  ensureSectionBoxMatchLayers(map);
  const source = map.getSource(SECTION_BOX_MATCH_SOURCE_ID) as GeoJSONSource | undefined;
  if (!source) return;
  try {
    source.setData(turf.featureCollection(boxMatchFeatures(candidates, ids)) as any);
  } catch {
    /* setData 在样式卸载瞬间会抛：拖拽期间忽略，下一次 mousemove 会重写 */
  }
  // 数据写完后修层序（内部节流）：不修的话，晚于它创建的色带会把它整片压住。
  raiseSectionBoxMatchLayers(map);
}

/** 清空高亮（图层留着，重新框选时直接复用，避免每帧 addLayer/removeLayer 抖动）。 */
export function clearSectionBoxMatch(map: MapboxMap | null | undefined): void {
  if (!map) return;
  const source = map.getSource(SECTION_BOX_MATCH_SOURCE_ID) as GeoJSONSource | undefined;
  if (!source) return;
  try {
    source.setData(turf.featureCollection([]) as any);
  } catch {
    /* 地图已销毁 */
  }
}

/** 换任务时彻底删掉（`clearMapLayers` 里调用），否则新任务地图上会留着旧高亮。 */
export function removeSectionBoxMatchLayers(map: MapboxMap | null | undefined): void {
  if (!map) return;
  [SECTION_BOX_MATCH_START_LAYER_ID, SECTION_BOX_MATCH_LINE_LAYER_ID].forEach((id) => {
    try {
      if (map.getLayer(id)) map.removeLayer(id);
    } catch {
      /* 样式正在重建 */
    }
  });
  try {
    if (map.getSource(SECTION_BOX_MATCH_SOURCE_ID)) map.removeSource(SECTION_BOX_MATCH_SOURCE_ID);
  } catch {
    /* 同上 */
  }
}

/** 应用前的确认文案：把「隐藏而非删除」「可撤销」两件事说清楚。 */
export function sectionBoxInvalidConfirmText(matched: number, alreadyInvalid: number): string {
  const lines = [
    `把框内的 ${matched} 条断面设为「无效」？`,
    '',
    '· 这些断面与它们各自管辖的那段岸线会变成灰色虚线；',
    '· 不再参与着色、框选统计、报告配图与导出；',
    '· 计算结果全部保留，可用「撤销本次」一键恢复，不需要重算。',
  ];
  if (alreadyInvalid > 0) {
    lines.push('', `其中 ${alreadyInvalid} 条此前已是无效；撤销时不会把它们改回有效。`);
  }
  return lines.join('\n');
}

/** 框内一条都没命中时的解释（不是报错，所以不打断操作）。 */
export function sectionBoxInvalidEmptyHint(loadedCount: number): string {
  if (loadedCount <= 0) return '地图上没有断面，无法框选';
  return `框内没有断面起点：断面是横跨河道的线，只有「岸边那一端」落在框里才算选中（共 ${loadedCount} 条）`;
}

/** 面板与提示条共用的口径说明（别在两处各写一遍）。 */
export const SECTION_BOX_INVALID_RULE_TEXT =
  '判定：断面起点（岸边端点）落在框内即选中，贴边也算';
