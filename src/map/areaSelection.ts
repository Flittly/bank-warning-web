/**
 * 地图「框选分析」的选区绘制 —— 矩形拖拽 / 多边形逐点闭合，结果是一个 Polygon。
 *
 * <h3>为什么单独一个模块</h3>
 * 结果页（`ResultPage`）与断面编辑器（`EditorMap`）是两张不同的 mapbox 实例：
 * 编辑器那张要复用 `box-select-rect` 给「框选岸段 / 框选删除断面」上色，耦合很重；
 * 结果页只需要「画一个圈子出来」这一件事。把绘制逻辑按「给定 map，画一个多边形」
 * 抽出来，结果页不必为了框选引入编辑器的整套图层与状态，也便于单独验证。
 *
 * <h3>与地图自身交互的冲突</h3>
 * 画框期间必须保住左键，否则用户一点就开始平移地图：
 * <ul>
 *   <li>监听器挂在**捕获阶段**并 `stopPropagation`：mapbox 的 click / mousedown 都绑在
 *       canvas 上，祖先捕获阶段先跑，停掉之后它收不到 —— 这样连"点中断面弹矩阵详情"
 *       也不会在画多边形时被误触发。</li>
 *   <li>`dragPan / boxZoom / dragRotate / doubleClickZoom` 临时关掉，退出时按原状态恢复
 *       （别无条件 enable：上层可能本来就关着某个交互）。</li>
 *   <li>mousemove / mouseup 挂 window：拖出画布甚至拖出窗口也要能收尾。</li>
 * </ul>
 *
 * <h3>图层</h3>
 * 专用的 `area-selection-*` source + fill/line 两层，独立于结果页的岸段 / 断面图层。
 * 换底图（`setStyle`）会把图层清空，所以调用方要在 `load` / `style.load` 时重新
 * `ensureAreaSelectionLayers()` + `setAreaSelection()` —— 这里只保证"幂等"，不做监听。
 */

import * as turf from '@turf/turf';
import type { GeoJSONSource, Map as MapboxMap } from 'mapbox-gl';

import { boxFromCorners, boxPolygon, isValidBox } from './boxSelection';

export const AREA_SELECTION_SOURCE = 'area-selection-src';
export const AREA_SELECTION_FILL_LAYER = 'area-selection-fill';
export const AREA_SELECTION_LINE_LAYER = 'area-selection-line';
/** 与编辑器版一致：框选分析统一青色，和"框选岸段(紫) / 框选删除(红)"区分开。 */
export const AREA_SELECTION_COLOR = '#0284c7';

export type AreaSelectionShape = 'rect' | 'polygon';
export type AreaSelectionCancelReason = 'escape' | 'contextmenu' | 'too-small';

export interface AttachAreaSelectionOptions {
  shape: AreaSelectionShape;
  /** 画完（矩形松手 / 多边形闭合）回调。给的是已闭合的 Polygon 要素。 */
  onDone: (polygon: GeoJSON.Feature<GeoJSON.Polygon>) => void;
  /** Esc / 右键 / 误点取消。`too-small` = 拖拽不足 4px。 */
  onCancel?: (reason: AreaSelectionCancelReason) => void;
}

/** 顶点数组 → 闭合 Polygon；不足 3 点或面积为 0 返回 null（"点两下"不算选区）。 */
export function polygonFromPoints(
  points: Array<[number, number]>,
): GeoJSON.Feature<GeoJSON.Polygon> | null {
  if (!Array.isArray(points) || points.length < 3) return null;
  const ring: Array<[number, number]> = [];
  for (const p of points) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
    // 相邻重复点会让 turf 的环判定退化，直接丢掉
    const prev = ring[ring.length - 1];
    if (prev && prev[0] === p[0] && prev[1] === p[1]) continue;
    ring.push([p[0], p[1]]);
  }
  if (ring.length < 3) return null;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  try {
    const feature = turf.polygon([ring]) as GeoJSON.Feature<GeoJSON.Polygon>;
    return turf.area(feature) > 0 ? feature : null;
  } catch {
    return null;
  }
}

/**
 * 建 source / 图层（幂等）。换底图后调用可把被清掉的图层补回来。
 *
 * <p>不加 `isStyleLoaded()` 守卫：换底图过程中（`styledata` 已触发但 style 仍在装载）
 * 这个判断会是 false，而 `addSource` 其实常常已经可用 —— 守太严会导致"图层永远补不回来"。
 * 改成逐段 try/catch：能加就加，不能加就等下一次事件/重试，绝不抛给调用方。
 */
export function ensureAreaSelectionLayers(map: MapboxMap): void {
  try {
    if (!map.getSource(AREA_SELECTION_SOURCE)) {
      map.addSource(AREA_SELECTION_SOURCE, {
        type: 'geojson',
        data: turf.featureCollection([]),
      });
    }
  } catch {
    return; // 样式还没就绪：调用方会重试
  }
  try {
    if (!map.getLayer(AREA_SELECTION_FILL_LAYER)) {
      map.addLayer({
        id: AREA_SELECTION_FILL_LAYER,
        type: 'fill',
        source: AREA_SELECTION_SOURCE,
        paint: {
          'fill-color': AREA_SELECTION_COLOR,
          'fill-opacity': 0.12,
        },
      });
    }
  } catch {
    /* 图层加不上：下一次重试会补 */
  }
  try {
    if (!map.getLayer(AREA_SELECTION_LINE_LAYER)) {
      map.addLayer({
        id: AREA_SELECTION_LINE_LAYER,
        type: 'line',
        source: AREA_SELECTION_SOURCE,
        paint: {
          'line-color': AREA_SELECTION_COLOR,
          'line-width': 2,
          'line-dasharray': [2, 1],
        },
      });
    }
  } catch {
    /* 同上 */
  }
}

/** 选区图层是否已经在地图上（换底图后会被清掉，调用方可据此重试）。 */
export function hasAreaSelectionLayers(map: MapboxMap): boolean {
  return Boolean(map.getSource(AREA_SELECTION_SOURCE));
}

/** 把选区（或 null = 清空）写到专用 source 上。 */
export function setAreaSelection(
  map: MapboxMap,
  polygon: GeoJSON.Feature<GeoJSON.Polygon> | GeoJSON.Geometry | null | undefined,
): void {
  const source = map.getSource(AREA_SELECTION_SOURCE) as GeoJSONSource | undefined;
  if (!source) return;
  if (!polygon) {
    source.setData(turf.featureCollection([]));
    return;
  }
  const geometry = (polygon as GeoJSON.Feature).type === 'Feature'
    ? (polygon as GeoJSON.Feature).geometry
    : (polygon as GeoJSON.Geometry);
  if (geometry?.type !== 'Polygon' && geometry?.type !== 'MultiPolygon') {
    source.setData(turf.featureCollection([]));
    return;
  }
  source.setData(turf.featureCollection([turf.feature(geometry) as any]));
}

/**
 * 装上绘制监听，返回卸载函数。
 *
 * <p>卸载必须调用：它负责把 dragPan 等交互恢复回去，否则地图会"再也拖不动"。
 */
export function attachAreaSelection(
  map: MapboxMap,
  options: AttachAreaSelectionOptions,
): () => void {
  const { shape } = options;
  const container = map.getCanvasContainer();
  const canvas = map.getCanvas();
  const prevCursor = canvas.style.cursor;

  const wasDragPan = map.dragPan.isEnabled();
  const wasBoxZoom = map.boxZoom.isEnabled();
  const wasDragRotate = map.dragRotate.isEnabled();
  const wasDoubleClickZoom = map.doubleClickZoom.isEnabled();
  map.dragPan.disable();
  map.boxZoom.disable();
  map.dragRotate.disable();
  map.doubleClickZoom.disable();
  canvas.style.cursor = 'crosshair';

  /**
   * 鼠标事件 → 经纬度。
   *
   * <p>不用 `map.mouseEventToLngLat`：v3 的类型里已经没有它，直接用会让 `tsc -b` 挂掉。
   * 用容器矩形 + `unproject`，顺便把"拖到容器外"（clientX 为负）算对。
   */
  const toLngLat = (clientX: number, clientY: number): [number, number] => {
    const rect = container.getBoundingClientRect();
    const p = map.unproject([clientX - rect.left, clientY - rect.top]);
    return [p.lng, p.lat];
  };

  const preview = (polygon: GeoJSON.Feature<GeoJSON.Polygon> | null) => {
    setAreaSelection(map, polygon);
  };

  const finish = (polygon: GeoJSON.Feature<GeoJSON.Polygon> | null) => {
    if (!polygon) {
      options.onCancel?.('too-small');
      return;
    }
    preview(polygon);
    options.onDone(polygon);
  };

  const detachFns: Array<() => void> = [];
  const on = (
    target: EventTarget,
    type: string,
    handler: EventListener,
    capture = false,
  ) => {
    target.addEventListener(type, handler, capture);
    detachFns.push(() => target.removeEventListener(type, handler, capture));
  };

  if (shape === 'polygon') {
    let points: Array<[number, number]> = [];
    let cursor: [number, number] | null = null;
    /** 上一次单击的时间与位置：识别"双击的第二下"，避免闭合处多一个重复顶点 */
    let lastClickAt = 0;
    let lastClickPos: [number, number] | null = null;

    const paintPreview = () => {
      const ring = cursor ? [...points, cursor] : [...points];
      if (ring.length < 2) {
        preview(null);
        return;
      }
      try {
        preview(turf.polygon([[...ring, ring[0]]]) as GeoJSON.Feature<GeoJSON.Polygon>);
      } catch {
        /* 退化几何（顶点重合）：这一帧不画，下一次 mousemove 会重试 */
      }
    };

    on(container, 'mousedown', ((ev: MouseEvent) => {
      if (ev.button !== 0) return;
      // 捕获阶段拦下：否则 mapbox 会把这一下当作拖拽起点，画完一次地图就跳一下
      ev.preventDefault();
      ev.stopPropagation();
    }) as EventListener, true);

    on(container, 'click', ((ev: MouseEvent) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      const pos = toLngLat(ev.clientX, ev.clientY);
      const now = Date.now();
      const isDoubleSecond = !!lastClickPos
        && now - lastClickAt < 350
        && Math.abs(pos[0] - lastClickPos[0]) < 1e-6
        && Math.abs(pos[1] - lastClickPos[1]) < 1e-6;
      lastClickAt = now;
      lastClickPos = pos;
      if (isDoubleSecond) return;
      points.push(pos);
      cursor = pos;
      paintPreview();
    }) as EventListener, true);

    const closeRing = () => {
      const polygon = polygonFromPoints(points);
      if (!polygon) return false;
      points = [];
      cursor = null;
      finish(polygon);
      return true;
    };

    on(container, 'dblclick', ((ev: MouseEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      closeRing();
    }) as EventListener, true);

    on(window, 'mousemove', ((ev: MouseEvent) => {
      if (points.length === 0) return;
      cursor = toLngLat(ev.clientX, ev.clientY);
      paintPreview();
    }) as EventListener);

    on(window, 'keydown', ((ev: KeyboardEvent) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        closeRing();
        return;
      }
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      points = [];
      cursor = null;
      options.onCancel?.('escape');
    }) as EventListener, true);
  } else {
    let anchor: [number, number] | null = null;
    let anchorPx: [number, number] | null = null;
    let dragging = false;

    const writeRect = (a: [number, number], b: [number, number]) => {
      const bounds = boxFromCorners(a, b);
      preview(isValidBox(bounds) ? boxPolygon(bounds) : null);
    };

    on(container, 'mousedown', ((ev: MouseEvent) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      dragging = true;
      anchorPx = [ev.clientX, ev.clientY];
      anchor = toLngLat(ev.clientX, ev.clientY);
      writeRect(anchor, anchor);
    }) as EventListener, true);

    on(window, 'mousemove', ((ev: MouseEvent) => {
      if (!dragging || !anchor) return;
      ev.preventDefault();
      writeRect(anchor, toLngLat(ev.clientX, ev.clientY));
    }) as EventListener);

    on(window, 'mouseup', ((ev: MouseEvent) => {
      if (!dragging || !anchor || !anchorPx) return;
      dragging = false;
      const from = anchor;
      const startPx = anchorPx;
      const to = toLngLat(ev.clientX, ev.clientY);
      anchor = null;
      anchorPx = null;

      // 4px 像素门限：手抖点一下不该产生一个"选中 0 条"的框
      if (Math.abs(ev.clientX - startPx[0]) < 4 || Math.abs(ev.clientY - startPx[1]) < 4) {
        options.onCancel?.('too-small');
        return;
      }
      const bounds = boxFromCorners(from, to);
      if (!isValidBox(bounds)) {
        options.onCancel?.('too-small');
        return;
      }
      finish(boxPolygon(bounds));
    }) as EventListener);

    on(window, 'keydown', ((ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      dragging = false;
      anchor = null;
      anchorPx = null;
      options.onCancel?.('escape');
    }) as EventListener, true);
  }

  on(container, 'contextmenu', ((ev: MouseEvent) => {
    // 不 preventDefault 会弹出浏览器菜单，选择时打断当前操作
    ev.preventDefault();
    ev.stopPropagation();
    options.onCancel?.('contextmenu');
  }) as EventListener, true);

  return () => {
    for (const fn of detachFns) fn();
    try {
      if (wasDragPan) map.dragPan.enable();
      if (wasBoxZoom) map.boxZoom.enable();
      if (wasDragRotate) map.dragRotate.enable();
      if (wasDoubleClickZoom) map.doubleClickZoom.enable();
      canvas.style.cursor = prevCursor;
    } catch {
      /* 地图已销毁（换底图 / 离开页面）：handler 跟着 map 一起没了，不用再恢复 */
    }
  };
}
