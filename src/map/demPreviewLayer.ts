/**
 * DEM 预览栅格层：把「灰度高程 / 分层设色」那张 PNG 铺到地图上。
 *
 * <h3>为什么从 EditorMap 里抽出来</h3>
 * 三维地形（`raster-dem` + `hillshade`）本身**不带配色** —— 它只负责起伏与光照，
 * 表面颜色来自压在它下面的一层栅格。编辑器里看起来「立体感强」，一半功劳是这层
 * DEM 灰度图被地形表面拉伸后产生的明暗过渡；结果页早先只挂了 `hillshade`，
 * 表面是底图的浅色，阴影没东西可压，看起来就只是一张「有点灰的平板」。
 * 所以结果页的三维也要铺这一层，且必须与编辑器用**同一份实现**，否则两边的
 * 手感会再次分叉。
 *
 * <h3>图层次序</h3>
 * 栅格必须在 `hillshade` **下面**（阴影要盖在它上面才有明暗），又在业务图层
 * （岸段色带 / 断面线）**下面** —— 否则色带与断面全被糊住。
 * `addLayer(layer, beforeId)` 是插到 `beforeId` 之前（视觉上更靠下），所以候选
 * 要写「预览层上面那一层」。候选都没建出来（样式刚换）时退化成最上层。
 */

import type { ImageSource, Map as MapboxMap } from 'mapbox-gl';
import type { DemPreview } from '../services/demPreviewService';

export const DEM_PREVIEW_SOURCE = 'dem-preview';
export const DEM_PREVIEW_LAYER = 'dem-preview-layer';

/** 默认不透明度：完全实心会把底图地名压死，反而更难核对位置。 */
export const DEM_PREVIEW_OPACITY = 0.9;

export interface ApplyDemPreviewOptions {
  /** 插入位置候选，按顺序取第一个已存在的图层之前（见文件头「图层次序」） */
  beforeLayers?: string[];
  /** 不透明度，缺省 0.9 */
  opacity?: number;
}

/**
 * 铺上 / 换图 / 清掉 DEM 预览层。
 *
 * <p>source / layer 都按需创建、无数据即删，不留常驻空壳：Mapbox 的 `image` source
 * 创建时就必须拿到合法的 url 与四角坐标，空壳只能塞假数据，一旦哪条分支忘了替换，
 * 图上就会留一张错位的图。
 */
export function applyDemPreviewLayer(
  map: MapboxMap,
  preview: DemPreview | null | undefined,
  options: ApplyDemPreviewOptions = {},
): void {
  const beforeLayers = options.beforeLayers ?? ['river-surface-fill'];
  const opacity = options.opacity ?? DEM_PREVIEW_OPACITY;

  if (!preview) {
    // 先删层再删 source：反过来会因「source 仍被图层引用」而抛错
    if (map.getLayer(DEM_PREVIEW_LAYER)) map.removeLayer(DEM_PREVIEW_LAYER);
    if (map.getSource(DEM_PREVIEW_SOURCE)) map.removeSource(DEM_PREVIEW_SOURCE);
    return;
  }

  const ensureLayer = () => {
    if (map.getLayer(DEM_PREVIEW_LAYER)) {
      // 已有图层只改不透明度（两处调用方的取值可能不同），位置不动
      map.setPaintProperty(DEM_PREVIEW_LAYER, 'raster-opacity', opacity);
      return;
    }
    const beforeId = beforeLayers.find((id) => Boolean(map.getLayer(id)));
    map.addLayer(
      {
        id: DEM_PREVIEW_LAYER,
        type: 'raster',
        source: DEM_PREVIEW_SOURCE,
        paint: {
          'raster-opacity': opacity,
          'raster-resampling': 'linear',
          // 关掉淡入淡出，否则连续切换两份 DEM / 两种配色时会短暂看到两张图叠着
          'raster-fade-duration': 0,
        },
      },
      beforeId,
    );
  };

  const existing = map.getSource(DEM_PREVIEW_SOURCE) as ImageSource | undefined;
  if (existing) {
    // 换图只更新图片与坐标，不重建 source —— 重建会让图层闪一下
    existing.updateImage({ url: preview.imageUrl, coordinates: preview.coordinates });
    ensureLayer();
    return;
  }

  map.addSource(DEM_PREVIEW_SOURCE, {
    type: 'image',
    url: preview.imageUrl,
    coordinates: preview.coordinates,
  });
  ensureLayer();
}

/** 图层是否已经铺上（样式重建后自检用）。 */
export function hasDemPreviewLayer(map: MapboxMap): boolean {
  return Boolean(map.getLayer(DEM_PREVIEW_LAYER));
}
