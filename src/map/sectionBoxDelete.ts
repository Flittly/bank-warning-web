/**
 * 框选删除断面：命中判定与文案。
 *
 * <p>与「框选岸段」（`boxSelection.ts`）刻意分开：
 *   · 岸段的命中对象是**线**，落在 `uploadedData` 里，结果是要"加载到地图"；
 *   · 断面的命中对象是**短垂线**，落在 `perpendicularData` 里，结果是"要不要删"。
 * 两者共用同一套画框交互（`EditorMap`），但判定与后果完全不同，混在一个模块里迟早
 * 会出现"框断面顺手把岸段也选了"这类错觉。
 *
 * <p>命中口径 = **相交**（断面穿过框边界也算），不是"完全包含"：
 * 断面本来就短，用户框的位置只要压到它，几乎必然是希望它被删掉；要求完全包含会让
 * 贴着框边的那批断面漏删，而漏删比多删更难发现（删错了有确认弹窗和地图红色预览兜着）。
 */
import * as turf from '@turf/turf';
import { boxPolygon, isValidBox, type BoxBounds } from './boxSelection';

/**
 * 断面的身份标识。
 *
 * <p>必须与 `EditorPage` 里那个同名局部函数**完全一致**（只认 `sectionId` / `section_id`）：
 * 这里有 `id` 兜底就会算出一条"地图上没有的断面 id"，删除时匹配不上，
 * 表现为「确认了但一条都没删掉」。
 */
export function sectionIdOfFeature(feature: any): string {
  const props = feature?.properties ?? {};
  return String(props.sectionId ?? props.section_id ?? '');
}

/** 点是否在框内（`w<=lng<=e and s<=lat<=n`，与出图/报告分区同一套契约）。 */
function pointInBox(lng: number, lat: number, bounds: BoxBounds): boolean {
  return lng >= bounds.west && lng <= bounds.east && lat >= bounds.south && lat <= bounds.north;
}

/** 退化几何（无坐标 / 只有单点）时用来判定的锚点：首尾中点。 */
function anchorOf(feature: any): [number, number] | null {
  const coords = (feature?.geometry?.coordinates ?? []) as any[];
  if (!Array.isArray(coords) || coords.length === 0) return null;
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (!Array.isArray(first) || first.length < 2) return null;
  if (!Array.isArray(last) || last.length < 2) return [Number(first[0]), Number(first[1])];
  const lng = (Number(first[0]) + Number(last[0])) / 2;
  const lat = (Number(first[1]) + Number(last[1])) / 2;
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
}

/**
 * 挑出框内的断面，返回**在 features 里的下标**（不是 id）。
 *
 * <p>返回下标而不是 id：调用方（EditorPage）删除后要做选中态重映射，
 * 而下标本来就是"删之前的位置"，先转成 id 再转回下标会多绕一圈、还容易错。
 */
export function pickSectionIndicesInBox(
  features: any[] | null | undefined,
  bounds: BoxBounds | null | undefined,
): number[] {
  const list = features ?? [];
  if (!isValidBox(bounds ?? null) || list.length === 0) return [];

  const poly = boxPolygon(bounds as BoxBounds);
  const hits: number[] = [];

  list.forEach((feature, index) => {
    let hit = false;
    const geometry = feature?.geometry;

    if (geometry && (geometry.type === 'LineString' || geometry.type === 'MultiLineString')) {
      try {
        hit = turf.booleanIntersects(feature, poly as any);
      } catch {
        // 坐标里混进 NaN / 只有 1 个点时 booleanIntersects 会抛；交给下面的锚点兜底
        hit = false;
      }
    }

    if (!hit) {
      const anchor = anchorOf(feature);
      if (anchor) hit = pointInBox(anchor[0], anchor[1], bounds as BoxBounds);
    }

    if (hit) hits.push(index);
  });

  return hits;
}

/**
 * 删除确认文案。
 *
 * <p>为什么把"会同步删除后端记录"写进确认框：现有「清除断面」只清地图、不碰库，
 * 两者后果不同；不写清楚，用户会以为这也是一次可以刷新找回的操作。
 */
export function sectionBoxDeleteConfirmText(matched: number): string {
  return [
    `确认删除框内的 ${matched} 条断面？`,
    '',
    '会同时从地图和任务里移除，已生成的分析结果需要重新计算。',
  ].join('\n');
}

/** 框内一条都没命中时给的解释（不是报错，所以不打断操作）。 */
export function sectionBoxDeleteEmptyHint(loadedCount: number): string {
  if (loadedCount <= 0) return '地图上没有断面，无法框选删除';
  return `框内没有断面：请重新框选，或按 Esc 退出（地图上共 ${loadedCount} 条）`;
}
