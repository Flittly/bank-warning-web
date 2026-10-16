/**
 * 「地图上要画哪几条 DEM 范围」的推导。
 *
 * 从 `EditorPage` 里抽出来，只为一件事：**可测**。它替代了原来的三段内联判断。
 *
 * 之所以要认真对待，是因为踩过一次真事故：
 * 地图图层的「数据」和「可见性」分在两个 effect 里，而可见性那个用
 * `isStyleLoaded()` 守卫后**直接 return**（`EditorMap` 里其余 5 处同类 effect 都有
 * `map.once('idle', ...)` 补偿，只有它没有）。于是「第二次点同一条 DEM」时：
 * 数据被换成全量、可见性却停在 visible ⇒ 地图上把全库 DEM 的框全画了出来。
 *
 * 这里在**关闭时直接喂空集合**：即使地图那边的可见性更新滞后，也没有任何东西可画 —— 双保险。
 */

import type { FeatureCollection } from 'geojson';

export interface TiffBoundsViewInput {
  /** 是否要在地图上显示 TIF 范围（资源树/侧栏的开关） */
  showTiffBounds: boolean;
  /** 全库 DEM 范围（还没取到时为 null） */
  tiffBoundsData: FeatureCollection | null;
  /** 只显示这几条 DEM；null 或空数组表示「不过滤」，即全部 */
  focusedDemKeys: string[] | null | undefined;
}

/**
 * 资源树里那条「显示/隐藏 TIF 范围」的开关状态。
 *
 * `focusedDemKeys === null`（或空数组）表示**不过滤 = 全部** —— 那个语义只由
 * 经典面板的「显示 TIF 范围」总按钮产生，不从这里来。
 */
export interface DemBoundsToggleState {
  showTiffBounds: boolean;
  focusedDemKeys: string[] | null;
}

function normalizeDemKey(key: unknown): string {
  return String(key ?? '').trim();
}

/** 这一条 DEM 的范围现在是否画在图上（含「全部」模式）。 */
export function isDemBoundsShown(
  { showTiffBounds, focusedDemKeys }: DemBoundsToggleState,
  key: unknown,
): boolean {
  if (!showTiffBounds) return false;
  const k = normalizeDemKey(key);
  if (!k) return false;
  // 全部模式：每条都算"在显示"
  if (!focusedDemKeys || focusedDemKeys.length === 0) return true;
  return focusedDemKeys.some((x) => normalizeDemKey(x) === k);
}

/**
 * 点资源树里**某一条** DEM 的开关 ⇒ 只切这一条，不动别的。
 *
 * 语义与用户预期一致（"这条的开关就管这条"）：
 *   - 本来没开 → 打开这一条（若当前是"全部"，则收窄到这一条）
 *   - 本来是开的 → 关掉这一条；关到一条不剩时把总开关一起关掉
 * 传空 key（目录行/文件夹的开关）时退化成总开关。
 */
export function toggleDemBounds(
  state: DemBoundsToggleState,
  key: unknown,
): DemBoundsToggleState {
  const k = normalizeDemKey(key);
  if (!k) return { ...state, showTiffBounds: !state.showTiffBounds };

  const showingAll = state.showTiffBounds && !state.focusedDemKeys?.length;
  if (!state.showTiffBounds || showingAll) {
    return { showTiffBounds: true, focusedDemKeys: [k] };
  }

  const current = (state.focusedDemKeys || []).map(normalizeDemKey).filter(Boolean);
  const next = current.includes(k)
    ? current.filter((x) => x !== k)
    : [...current, k];

  // 一条都不剩 ⇒ 连总开关一起关，避免"开关亮着但图上什么都没有"
  return next.length === 0
    ? { showTiffBounds: false, focusedDemKeys: null }
    : { showTiffBounds: true, focusedDemKeys: next };
}

export function resolveVisibleTiffBounds({
  showTiffBounds,
  tiffBoundsData,
  focusedDemKeys,
}: TiffBoundsViewInput): FeatureCollection | null {
  if (!tiffBoundsData) return null;

  // 关闭状态一律喂空集合，而不是把全量留在 source 里指望图层被隐藏。
  // 图层可见性一旦因 style 重载/时序问题没更新到，留下的就是「上一次的全量」。
  if (!showTiffBounds) {
    return { type: 'FeatureCollection', features: [] } as FeatureCollection;
  }

  if (!focusedDemKeys || focusedDemKeys.length === 0) return tiffBoundsData;

  const wanted = new Set(focusedDemKeys.map(String));
  return {
    type: 'FeatureCollection',
    features: (tiffBoundsData.features || []).filter((f) =>
      wanted.has(String(f?.properties?.tiff_key)),
    ),
  } as FeatureCollection;
}
