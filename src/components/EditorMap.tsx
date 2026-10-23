import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import type { ExpressionSpecification } from 'mapbox-gl';
import * as turf from '@turf/turf';
import 'mapbox-gl/dist/mapbox-gl.css';
import { getBasemapStyle } from '../map/basemapStyle';
import { boxFromCorners, boxPolygon, isValidBox, type BoxBounds } from '../map/boxSelection';
import { sectionIdOfFeature } from '../map/sectionBoxDelete';
import { snapPointToBank, type BankAnchor, type LngLat } from '../map/sectionBankBinding';
import type { SelectionGroup } from '../types/selection';
import { getVerticalFootCoordsFromAny } from '../utils/verticalFootPoint';
import { useEditorStore } from '../store/useEditorStore';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

function buildCrossLineArrowPoints(
  data: GeoJSON.FeatureCollection | null,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  if (!data || !data.features.length) {
    return turf.featureCollection([]) as GeoJSON.FeatureCollection<GeoJSON.Point>;
  }

  const arrowPoints: GeoJSON.Feature<GeoJSON.Point>[] = [];

  const bearingDegrees = (start: number[], end: number[]) => {
    const lon1 = Number(start?.[0]);
    const lat1 = Number(start?.[1]);
    const lon2 = Number(end?.[0]);
    const lat2 = Number(end?.[1]);
    if (![lon1, lat1, lon2, lat2].every((v) => Number.isFinite(v))) return 0;

    const toRad = (d: number) => (d * Math.PI) / 180;
    const toDeg = (r: number) => (r * 180) / Math.PI;
    const φ1 = toRad(lat1);
    const φ2 = toRad(lat2);
    const Δλ = toRad(lon2 - lon1);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    const θ = Math.atan2(y, x);
    return (toDeg(θ) + 360) % 360;
  };

  data.features.forEach((feature, idx) => {
    if (feature.geometry.type !== 'LineString') return;
    const coords = feature.geometry.coordinates;
    if (!coords || coords.length < 2) return;

    const start = coords[0];
    const end = coords[coords.length - 1];
    const bearing = bearingDegrees(start as any, end as any);
    // 参考 Mapbox 图标默认朝向与正北夹角，做 -90 度修正
    const iconRotate = Number(bearing - 90);

    const props: any = feature.properties || {};

    arrowPoints.push({
      type: 'Feature',
      properties: {
        iconRotate,
        crossLineId: (feature as any)?.properties?.crossLineId ?? idx,
        validation_status: props.validation_status,
        is_valid: props.is_valid,
      },
      geometry: {
        type: 'Point',
        coordinates: end,
      },
    });
  });

  return turf.featureCollection(arrowPoints) as GeoJSON.FeatureCollection<GeoJSON.Point>;
}

function buildCrossLineEndpoints(
  data: GeoJSON.FeatureCollection | null,
  selectedIds: number[],
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  if (!data || selectedIds.length === 0) {
    return turf.featureCollection([]) as GeoJSON.FeatureCollection<GeoJSON.Point>;
  }

  const points: GeoJSON.Feature<GeoJSON.Point>[] = [];
  selectedIds.forEach((id) => {
    const feature = data.features[id];
    if (!feature || feature.geometry?.type !== 'LineString') return;
    const coords = feature.geometry.coordinates as number[][];
    if (!coords || coords.length < 2) return;

    points.push({
      type: 'Feature',
      properties: { crossLineId: id, vertexIndex: 0 },
      geometry: { type: 'Point', coordinates: [coords[0][0], coords[0][1]] },
    });
    points.push({
      type: 'Feature',
      properties: { crossLineId: id, vertexIndex: 1 },
      geometry: { type: 'Point', coordinates: [coords[coords.length - 1][0], coords[coords.length - 1][1]] },
    });
  });

  return turf.featureCollection(points) as GeoJSON.FeatureCollection<GeoJSON.Point>;
}

function buildValidationColorExpression() {
  // pending/unknown => yellow, valid => green, invalid => red
  return [
    'case',
    ['==', ['get', 'validation_status'], 'valid'],
    '#22c55e',
    ['==', ['get', 'validation_status'], 'invalid'],
    '#ef4444',
    ['==', ['get', 'is_valid'], true],
    '#22c55e',
    ['==', ['get', 'is_valid'], false],
    '#ef4444',
    '#f59e0b',
  ] as any;
}

function buildArrowIconImageData(color: string): ImageData {
  const size = 24;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.42;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.55, cy - r);
  ctx.lineTo(cx - r * 0.55, cy + r);
  ctx.lineTo(cx + r, cy);
  ctx.closePath();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = size * 0.14;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

const ARROW_ICON_DEFS: Array<[string, string]> = [
  ['cross-arrow-green', '#22c55e'],
  ['cross-arrow-red', '#ef4444'],
  ['cross-arrow-amber', '#f59e0b'],
];

function ensureArrowIcons(map: mapboxgl.Map) {
  ARROW_ICON_DEFS.forEach(([name, color]) => {
    if (!map.hasImage(name)) map.addImage(name, buildArrowIconImageData(color));
  });
}

function buildArrowIconExpression(): ExpressionSpecification {
  // pending/unknown => amber, valid => green, invalid => red（与 buildValidationColorExpression 同步）
  return [
    'case',
    ['==', ['get', 'validation_status'], 'valid'],
    'cross-arrow-green',
    ['==', ['get', 'validation_status'], 'invalid'],
    'cross-arrow-red',
    ['==', ['get', 'is_valid'], true],
    'cross-arrow-green',
    ['==', ['get', 'is_valid'], false],
    'cross-arrow-red',
    'cross-arrow-amber',
  ] as unknown as ExpressionSpecification;
}

/**
 * 把"已生效的框"和"命中的岸段"写进地图图层。
 *
 * <p>做成模块级函数（而不是组件内的闭包）有两个原因：地图 `load` 回调、两条同步 effect、
 * 以及换底图后的重建都要用它，闭包版本会被 `useEffect` 依赖检查反复逼着改写成 `useCallback`；
 * 而且它的全部输入都能从参数拿到，没有隐含状态。
 *
 * <p>命中岸段是从 `uploadedData` 里**摘出来**再画一遍，而不是给原图层加 filter：
 * 原图层的配置（着色开关、`_color` 属性、未来可能的透明度逻辑）不该为一个筛选视角让路。
 * 因此岸段被移出地图后，高亮会自动消失 —— 数据源里没有它，谁也不用记得清。
 */
function syncBoxSelectionLayers(
  map: mapboxgl.Map,
  bounds: BoxBounds | null | undefined,
  bankIds: string[] | null | undefined,
  uploaded: GeoJSON.FeatureCollection | null | undefined,
  sectionIds?: string[] | null,
  perpendicular?: GeoJSON.FeatureCollection | null,
  polygon?: GeoJSON.Feature<GeoJSON.Polygon> | null,
): void {
  const rectSource = map.getSource('box-select-rect') as mapboxgl.GeoJSONSource | undefined;
  if (rectSource) {
    // 多边形选区（框选分析）优先：它是"已经画好的一个面"，不能再被 bounds 覆盖成矩形。
    // 两者互斥由调用方保证（同一时刻只会有一种选区）。
    if (polygon?.geometry?.type === 'Polygon') {
      rectSource.setData(turf.featureCollection([polygon]));
    } else {
      rectSource.setData(
        isValidBox(bounds ?? null)
          ? turf.featureCollection([boxPolygon(bounds as BoxBounds)])
          : turf.featureCollection([]),
      );
    }
  }

  const bankSource = map.getSource('box-select-banks-source') as mapboxgl.GeoJSONSource | undefined;
  if (bankSource) {
    const ids = new Set(bankIds || []);
    const features = ids.size === 0
      ? []
      : ((uploaded?.features || []) as any[]).filter((f) => {
          if (f?.geometry?.type !== 'LineString') return false;
          return ids.has(String(f?.properties?.bank_id ?? f?.properties?.bankId ?? ''));
        });
    bankSource.setData(turf.featureCollection(features));
  }

  // 框选删除断面的预览：从 perpendicularData 里摘出命中项再画一遍（红色虚线段），
  // 不给原图层加 filter —— 断面层的配色/宽度还背着校验状态与箭头图层，动它会牵连一堆东西。
  const sectionSource = map.getSource('box-delete-sections-source') as mapboxgl.GeoJSONSource | undefined;
  if (sectionSource) {
    const ids = new Set(sectionIds || []);
    const features = ids.size === 0
      ? []
      : ((perpendicular?.features || []) as any[]).filter(
          (f) => f?.geometry?.type === 'LineString' && ids.has(sectionIdOfFeature(f)),
        );
    sectionSource.setData(turf.featureCollection(features));
  }
}


interface EditorMapProps {
  perpendicularData: GeoJSON.FeatureCollection | null;
  uploadedData: GeoJSON.FeatureCollection | null;
  groups: SelectionGroup[];
  showCrossLines: boolean;
  isFixingShoreLineReversed: boolean;
  onFixSelectedShoreLineReversed: (params: { shoreLineIndex: number; shoreLineId: string }) => void;
  isSelectingShoreLines: boolean;
  isSelectingStartEnd: boolean;
  isSelectingCrossLines: boolean;
  crossLineControlMode: 'shoreline' | 'free';
  crossLineEditMode: 'none' | 'select' | 'add';
  selectedLines: Set<string>;
  setSelectedLines: React.Dispatch<React.SetStateAction<Set<string>>>;
  setGroups: React.Dispatch<React.SetStateAction<SelectionGroup[]>>;
  selectedCrossLineIndex: number | null;
  setSelectedCrossLineIndex: (index: number | null) => void;
  selectedCrossLineIndices: Set<number>;
  setSelectedCrossLineIndices: React.Dispatch<React.SetStateAction<Set<number>>>;
  globalInterval: number;
  globalLength: number;
  createCrossLineAtPoint: (line: GeoJSON.Feature<GeoJSON.LineString>, distanceOnLine: number) => void;
  updateCrossLineGeometryLocal: (crossLineIndex: number, geometry: GeoJSON.LineString) => void;
  applyCrossLineGeometriesLocal?: (
    updates: Array<{ crossLineIndex: number; geometry: GeoJSON.LineString }>,
  ) => void;
  persistCrossLineGeometry: (crossLineIndex: number, geometry: GeoJSON.LineString) => Promise<void>;
  /**
   * 第三参数是起点吸附到的岸段（首点落在岸段上时才有）。
   * 断面归属哪条岸段以它为最高优先，避免「眼睛看到落在岸段上、写库却归到别处」。
   */
  createCrossLineByEndpoints: (start: number[], end: number[], anchor?: BankAnchor | null) => void;
  tiffBoundsData: GeoJSON.FeatureCollection | null;
  showTiffBounds: boolean;
  /** 长江河面范围（4326，来自 river_yangtze）；没开启过图层时为 null */
  riverSurfaceData?: GeoJSON.FeatureCollection | null;
  /** 是否绘制长江河面参考图层（规则：与长江河面相交） */
  showRiverSurface?: boolean;
  resizeTrigger: number;
  satellite?: boolean;
  colorBanks?: boolean;

  // —— 矩形框选（地图上按住鼠标拖一个框，由上层判定命中哪些岸段）——
  /** 是否处于「等待用户画框」状态：会关掉拖拽平移并换成十字光标 */
  boxSelectMode?: boolean;
  /** 画完一个框（已经过"太小则丢弃"的判定）。坐标是 WGS84 经纬度 */
  onBoxSelectDone?: (bounds: BoxBounds) => void;
  /**
   * 画框被取消。
   *
   * @param reason `escape` = 按 Esc；`contextmenu` = 右键；`too-small` = 拖动距离不足 4px（当误点）
   */
  onBoxSelectCancel?: (reason: 'escape' | 'contextmenu' | 'too-small') => void;
  /** 已生效的框（保留在图上直到清除） */
  boxSelectionBounds?: BoxBounds | null;
  /** 框选命中的岸段 id：这些线用高亮层再画一遍 */
  boxSelectionBankIds?: string[] | null;
  /**
   * 画框的目的。只影响**提示文案**与**预览高亮**，交互完全一致：
   * `banks` = 框选岸段（紫，结果是加载/高亮）；`sections` = 框选删除断面（红，结果是待删预览）。
   *
   * <p>用一个 purpose 而不是两个独立的 `xxxMode` 布尔：画框的监听器、拖拽平移开关、
   * 十字光标、4px 门限这些只有一份，两套布尔迟早会同时为 true（右键菜单和工具栏都能进），
   * 那时同一块画布会被两个 effect 抢事件。
   */
  boxSelectPurpose?: 'banks' | 'sections';
  /** 框选删除断面：预览中待删的断面 id（红色虚线再画一遍） */
  sectionBoxDeleteIds?: string[] | null;
  /** 框选删除断面：预览中的框（画完到确认之间一直留着） */
  sectionBoxDeleteBounds?: BoxBounds | null;
}

function EditorMap(props: EditorMapProps) {
  const {
    perpendicularData,
    uploadedData,
    groups,
    showCrossLines,
    isFixingShoreLineReversed,
    onFixSelectedShoreLineReversed,
    isSelectingShoreLines,
    isSelectingStartEnd,
    isSelectingCrossLines,
    crossLineControlMode,
    crossLineEditMode,
    selectedLines,
    setSelectedLines,
    setGroups,
    selectedCrossLineIndex,
    setSelectedCrossLineIndex,
    selectedCrossLineIndices,
    setSelectedCrossLineIndices,
    globalInterval,
    globalLength,
    createCrossLineAtPoint,
    updateCrossLineGeometryLocal,
    applyCrossLineGeometriesLocal,
    persistCrossLineGeometry,
    createCrossLineByEndpoints,
    tiffBoundsData,
    showTiffBounds,
    riverSurfaceData,
    showRiverSurface = false,
    resizeTrigger,
  } = props;
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  const perpendicularDataRef = useRef<GeoJSON.FeatureCollection | null>(perpendicularData);
  perpendicularDataRef.current = perpendicularData;
  useEffect(() => {
    perpendicularDataRef.current = perpendicularData;
  }, [perpendicularData]);

  const uploadedDataRef = useRef<GeoJSON.FeatureCollection | null>(uploadedData);
  const tiffBoundsDataRef = useRef<GeoJSON.FeatureCollection | null>(tiffBoundsData);
  const riverSurfaceDataRef = useRef<GeoJSON.FeatureCollection | null>(riverSurfaceData ?? null);
  useEffect(() => { uploadedDataRef.current = uploadedData; }, [uploadedData]);
  useEffect(() => { tiffBoundsDataRef.current = tiffBoundsData; }, [tiffBoundsData]);
  useEffect(() => { riverSurfaceDataRef.current = riverSurfaceData ?? null; }, [riverSurfaceData]);

  // —— 框选：回调与状态都走 ref ——
  // 交互是在 `map.on('load')` 里注册的长生命周期监听器，直接用 props 闭包会读到首次渲染时的值；
  // 而按 props 作依赖重建监听器又会在拖拽中途把 handlers 换掉（画框突然中断）。
  const boxSelectModeRef = useRef(false);
  boxSelectModeRef.current = props.boxSelectMode === true;
  const onBoxSelectDoneRef = useRef(props.onBoxSelectDone);
  onBoxSelectDoneRef.current = props.onBoxSelectDone;
  const onBoxSelectCancelRef = useRef(props.onBoxSelectCancel);
  onBoxSelectCancelRef.current = props.onBoxSelectCancel;

  // 当前画框的目的：决定"上一次的框"到底是岸段框（紫）还是断面待删框（红）。
  // 同一时刻只有一个框能占用 `box-select-rect`，所以这里必须二选一，
  // 退出断面删除后 purpose 回到 banks，岸段框会自动重画回来（见下面的同步 effect）。
  const boxPurpose: 'banks' | 'sections' =
    props.boxSelectPurpose === 'sections' ? 'sections' : 'banks';
  const boxPurposeRef = useRef(boxPurpose);
  boxPurposeRef.current = boxPurpose;

  const committedBounds = boxPurpose === 'sections'
    ? (props.sectionBoxDeleteBounds ?? null)
    : (props.boxSelectionBounds ?? null);
  const committedBankIds = boxPurpose === 'banks' ? (props.boxSelectionBankIds ?? []) : [];
  const committedSectionIds = boxPurpose === 'sections' ? (props.sectionBoxDeleteIds ?? []) : [];

  const boxBoundsRef = useRef<BoxBounds | null>(committedBounds);
  const boxBankIdsRef = useRef<string[]>(committedBankIds);
  const boxSectionIdsRef = useRef<string[]>(committedSectionIds);
  boxBoundsRef.current = committedBounds;
  boxBankIdsRef.current = committedBankIds;
  boxSectionIdsRef.current = committedSectionIds;
  const selectedLinesRef = useRef<Set<string>>(selectedLines);
  useEffect(() => { selectedLinesRef.current = selectedLines; }, [selectedLines]);

  const groupsRef = useRef<SelectionGroup[]>(groups);
  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  const isSelectingShoreLinesRef = useRef(isSelectingShoreLines);
  isSelectingShoreLinesRef.current = isSelectingShoreLines;

  const isFixingShoreLineReversedRef = useRef(isFixingShoreLineReversed);
  isFixingShoreLineReversedRef.current = isFixingShoreLineReversed;

  const onFixSelectedShoreLineReversedRef = useRef(onFixSelectedShoreLineReversed);
  useEffect(() => {
    onFixSelectedShoreLineReversedRef.current = onFixSelectedShoreLineReversed;
  }, [onFixSelectedShoreLineReversed]);

  const isSelectingStartEndRef = useRef(isSelectingStartEnd);
  isSelectingStartEndRef.current = isSelectingStartEnd;

  const isSelectingCrossLinesRef = useRef(isSelectingCrossLines);
  isSelectingCrossLinesRef.current = isSelectingCrossLines;

  // 记录上一次上传数据要素数量，用于判断是否为“首次加载”以决定是否 fitBounds
  const prevUploadedCountRef = useRef<number>(0);

  const crossLineControlModeRef = useRef<'shoreline' | 'free'>(crossLineControlMode);
  // 同步更新 ref，避免 useEffect 异步更新导致事件处理器读到过期值
  crossLineControlModeRef.current = crossLineControlMode;

  const crossLineEditModeRef = useRef<'none' | 'select' | 'add'>(crossLineEditMode);
  // 同步更新 ref，避免 useEffect 异步更新导致事件处理器读到过期值
  crossLineEditModeRef.current = crossLineEditMode;

  // 在自由模式断面精调时，Ctrl 键要用于多选；Mapbox 默认 Ctrl+左键会触发 dragRotate，需禁用以免抢占事件
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const shouldDisableRotate =
      isSelectingCrossLines && crossLineControlMode === 'free' && crossLineEditMode === 'select';

    try {
      if (shouldDisableRotate) {
        map.dragRotate?.disable();
      } else {
        map.dragRotate?.enable();
      }
    } catch {
      // ignore
    }
  }, [isSelectingCrossLines, crossLineControlMode, crossLineEditMode]);

  // 退出断面精调/释放选择时，清理吸附点与鼠标样式
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (isSelectingCrossLines) return;

    const source = map.getSource('snap-point') as mapboxgl.GeoJSONSource;
    if (source) source.setData(turf.featureCollection([]));
    map.getCanvas().style.cursor = '';
  }, [isSelectingCrossLines]);

  const updateCrossLineGeometryLocalRef = useRef(updateCrossLineGeometryLocal);
  useEffect(() => {
    updateCrossLineGeometryLocalRef.current = updateCrossLineGeometryLocal;
  }, [updateCrossLineGeometryLocal]);

  const applyCrossLineGeometriesLocalRef = useRef(applyCrossLineGeometriesLocal);
  useEffect(() => {
    applyCrossLineGeometriesLocalRef.current = applyCrossLineGeometriesLocal;
  }, [applyCrossLineGeometriesLocal]);

  const persistCrossLineGeometryRef = useRef(persistCrossLineGeometry);
  useEffect(() => {
    persistCrossLineGeometryRef.current = persistCrossLineGeometry;
  }, [persistCrossLineGeometry]);

  const createCrossLineByEndpointsRef = useRef(createCrossLineByEndpoints);
  useEffect(() => {
    createCrossLineByEndpointsRef.current = createCrossLineByEndpoints;
  }, [createCrossLineByEndpoints]);

  const selectedCrossLineIndexRef = useRef<number | null>(selectedCrossLineIndex);
  selectedCrossLineIndexRef.current = selectedCrossLineIndex;

  const selectedCrossLineIndicesRef = useRef<Set<number>>(selectedCrossLineIndices);
  selectedCrossLineIndicesRef.current = selectedCrossLineIndices;

  const configRef = useRef({ interval: globalInterval, length: globalLength });
  const savedLng = useEditorStore((s) => s.mapLng);
  const savedLat = useEditorStore((s) => s.mapLat);
  const savedZoom = useEditorStore((s) => s.mapZoom);
  const setMapView = useEditorStore((s) => s.setMapView);
  const lastCenterRef = useRef({ lng: savedLng, lat: savedLat, zoom: savedZoom });
  useEffect(() => {
    configRef.current = { interval: globalInterval, length: globalLength };
  }, [globalInterval, globalLength]);

  const getShoreLineId = (feature: any, index: number) => {
    const p = feature?.properties || {};
    return String(p.bank_id || p.bankId || `line-${index}`);
  };

  // 同步垂线到地图数据源
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const updateMapSources = () => {
      const crossLinesSource = map.getSource('perpendicular-lines') as mapboxgl.GeoJSONSource;
      if (crossLinesSource) {
        crossLinesSource.setData(perpendicularData || turf.featureCollection([]));
      }

      const crossArrowsSource = map.getSource('perpendicular-arrows') as mapboxgl.GeoJSONSource;
      if (crossArrowsSource) {
        crossArrowsSource.setData(buildCrossLineArrowPoints(perpendicularData));
      }
    };

    if (map.isStyleLoaded()) {
      updateMapSources();
      return undefined;
    } else {
      map.once('idle', updateMapSources);
      return () => {
        map.off('idle', updateMapSources);
      };
    }
  }, [perpendicularData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource('tiff-bounds') as mapboxgl.GeoJSONSource;
    if (source) {
      source.setData(tiffBoundsData || turf.featureCollection([]));
    }
  }, [tiffBoundsData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const applyVisibility = () => {
      // 图层可能还没建出来（style 未 load）或已被 style 重建，两种情况都要防
      if (!map.getLayer('tiff-bounds-fill') || !map.getLayer('tiff-bounds-line')) return;
      const visibility = showTiffBounds ? 'visible' : 'none';
      map.setLayoutProperty('tiff-bounds-fill', 'visibility', visibility);
      map.setLayoutProperty('tiff-bounds-line', 'visibility', visibility);
    };

    // 这里**不能**写成 `if (!map.isStyleLoaded()) return;` 直接早退：
    // 依赖只有 [showTiffBounds]，值不再变化就不会重跑 ⇒ 这一步会永久丢失。
    // 而数据 effect 是独立的、无条件执行，已经先把 source 换成了新的集合
    // ⇒ 「第二次点同一条 DEM」时数据变成全量、可见性却停在 visible，
    //    地图上就把全库 DEM 的框全画出来了。
    // 与同文件其余同类 effect 保持一致：style 未就绪就挂一次 idle 再补。
    if (map.isStyleLoaded()) {
      applyVisibility();
      return undefined;
    }
    map.once('idle', applyVisibility);
    return () => {
      map.off('idle', applyVisibility);
    };
  }, [showTiffBounds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource('river-surface') as mapboxgl.GeoJSONSource;
    if (source) {
      source.setData(riverSurfaceData || turf.featureCollection([]));
    }
  }, [riverSurfaceData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const applyVisibility = () => {
      if (!map.getLayer('river-surface-fill') || !map.getLayer('river-surface-line')) return;
      const visibility = showRiverSurface ? 'visible' : 'none';
      map.setLayoutProperty('river-surface-fill', 'visibility', visibility);
      map.setLayoutProperty('river-surface-line', 'visibility', visibility);
    };

    // 同 tiff-bounds：`isStyleLoaded()` 为 false 时不能直接早退 —— 依赖只有
    // [showRiverSurface]，值不再变化就不会重跑，可见性会永久停在初始值。
    if (map.isStyleLoaded()) {
      applyVisibility();
      return undefined;
    }
    map.once('idle', applyVisibility);
    return () => {
      map.off('idle', applyVisibility);
    };
  }, [showRiverSurface]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    requestAnimationFrame(() => map.resize());
  }, [resizeTrigger]);

  // 同步上传的数据到地图，并在首次上传时适配视图范围
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !uploadedData) return;

    const updateSource = () => {
      const source = map.getSource('uploaded-data') as mapboxgl.GeoJSONSource;
      if (source) {
        source.setData(uploadedData);
      }

      // 仅在从“无要素 -> 有要素”时自动适配视图范围，避免后续对 uploadedData 的小改动（如 reversed 标记切换）触发多次缩放
      try {
        const prevCount = prevUploadedCountRef.current || 0;
        const currCount = (uploadedData.features && uploadedData.features.length) || 0;
        if (currCount > 0 && prevCount !== currCount) {
          const bbox = turf.bbox(uploadedData);
          map.fitBounds([bbox[0], bbox[1], bbox[2], bbox[3]], { padding: 50 });
        }
        prevUploadedCountRef.current = currCount;
      } catch (err) {
        // 保守处理：若计算 bbox 失败则忽略
        console.warn('更新 uploadedData 时适配视图范围失败', err);
      }
    };

    if (map.isStyleLoaded()) {
      updateSource();
      return undefined;
    } else {
      map.once('idle', updateSource);
      return () => {
        map.off('idle', updateSource);
      };
    }
  }, [uploadedData]);

  // 同步选中线段的高亮显示
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !uploadedData) return;

    const updateSelectedLines = () => {
      const selectedSource = map.getSource('selected-shore-lines') as mapboxgl.GeoJSONSource;
      if (selectedSource) {
        const selectedFeatures = uploadedData.features.filter((f: any, index: number) =>
          selectedLines.has(getShoreLineId(f, index)),
        );
        selectedSource.setData(turf.featureCollection(selectedFeatures));
      }
    };

    if (map.isStyleLoaded()) {
      updateSelectedLines();
      return undefined;
    } else {
      map.once('idle', updateSelectedLines);
      return () => {
        map.off('idle', updateSelectedLines);
      };
    }
  }, [selectedLines, uploadedData]);


  // 同步选择组数据到地图
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const updateMapSources = () => {
      const pointSource = map.getSource('selection-points') as mapboxgl.GeoJSONSource;
      if (pointSource) {
        const allPoints: GeoJSON.Feature<GeoJSON.Point>[] = [];
        groups.forEach((group) => {
          if (group.start !== null) {
            allPoints.push(turf.along(group.line, group.start, { units: 'meters' }) as GeoJSON.Feature<GeoJSON.Point>);
          }
          if (group.end !== null) {
            allPoints.push(turf.along(group.line, group.end, { units: 'meters' }) as GeoJSON.Feature<GeoJSON.Point>);
          }
        });
        pointSource.setData(turf.featureCollection(allPoints));
      }

      const activeLineSource = map.getSource('active-line') as mapboxgl.GeoJSONSource;
      if (activeLineSource) {
        const segments: GeoJSON.Feature<GeoJSON.LineString>[] = [];
        groups.forEach((group) => {
          if (group.start !== null && group.end !== null) {
            try {
              const start = Math.min(group.start, group.end);
              const end = Math.max(group.start, group.end);
              const segment = turf.lineSliceAlong(group.line, start, end, { units: 'meters' });
              segment.properties = { groupId: group.id };
              segments.push(segment as GeoJSON.Feature<GeoJSON.LineString>);
            } catch (err) {
              console.warn('切割线段失败', err);
            }
          }
        });
        activeLineSource.setData(turf.featureCollection(segments));
      }
    };

    if (map.isStyleLoaded()) {
      updateMapSources();
      return undefined;
    } else {
      map.once('idle', updateMapSources);
      return () => {
        map.off('idle', updateMapSources);
      };
    }
  }, [groups]);

  // 控制垂线图层显隐
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (map.getLayer('perpendicular-lines-layer')) {
      map.setLayoutProperty('perpendicular-lines-layer', 'visibility', showCrossLines ? 'visible' : 'none');
    }
    if (map.getLayer('perpendicular-lines-hit-target')) {
      map.setLayoutProperty('perpendicular-lines-hit-target', 'visibility', showCrossLines ? 'visible' : 'none');
    }
    if (map.getLayer('perpendicular-arrows-layer')) {
      map.setLayoutProperty('perpendicular-arrows-layer', 'visibility', showCrossLines ? 'visible' : 'none');
    }
  }, [showCrossLines]);

  // 同步选中断面的高亮显示
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !perpendicularData) return;

    const updateSelectedCrossLine = () => {
      const selectedSource = map.getSource('selected-cross-line') as mapboxgl.GeoJSONSource;
      if (selectedSource) {
        const ids = Array.from(selectedCrossLineIndices);
        const features = ids
          .map((idx) => perpendicularData.features[idx])
          .filter(Boolean) as GeoJSON.Feature<GeoJSON.Geometry>[];

        if (features.length > 0) {
          selectedSource.setData(turf.featureCollection(features as any));
        } else if (selectedCrossLineIndex !== null && perpendicularData.features[selectedCrossLineIndex]) {
          // 兼容：若外部只维护了主选中索引
          selectedSource.setData(turf.featureCollection([perpendicularData.features[selectedCrossLineIndex]]));
        } else {
          selectedSource.setData(turf.featureCollection([]));
        }
      }
    };

    if (map.isStyleLoaded()) {
      updateSelectedCrossLine();
      return undefined;
    } else {
      map.once('idle', updateSelectedCrossLine);
      return () => {
        map.off('idle', updateSelectedCrossLine);
      };
    }
  }, [selectedCrossLineIndex, selectedCrossLineIndices, perpendicularData]);

  // 同步选中断面的端点手柄（起点/终点）
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource('perpendicular-endpoints') as mapboxgl.GeoJSONSource | null;
    if (!source) return;

    const ids =
      selectedCrossLineIndices.size > 0
        ? Array.from(selectedCrossLineIndices)
        : selectedCrossLineIndex !== null
          ? [selectedCrossLineIndex]
          : [];

    const updateEndpoints = () => {
      source.setData(buildCrossLineEndpoints(perpendicularData, ids));
    };

    if (map.isStyleLoaded()) {
      updateEndpoints();
      return undefined;
    } else {
      map.once('idle', updateEndpoints);
      return () => {
        map.off('idle', updateEndpoints);
      };
    }
  }, [selectedCrossLineIndex, selectedCrossLineIndices, perpendicularData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer('uploaded-lines')) return;
    if (props.colorBanks) {
      const src = map.getSource('uploaded-data') as mapboxgl.GeoJSONSource;
      if (!src) return;
      const data = uploadedDataRef.current;
      if (!data) return;
      const colors = ['#ef4444','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ec4899','#14b8a6','#f97316'];
      const hashBankId = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0; return Math.abs(h); };
      const updated = { ...data, features: data.features?.map((f: any) => ({
        ...f,
        properties: { ...f.properties, _color: colors[hashBankId(String(f.properties?.bank_id || '')) % colors.length] }
      })) };
      src.setData(updated);
      map.setPaintProperty('uploaded-lines', 'line-color', ['get', '_color']);
    } else {
      map.setPaintProperty('uploaded-lines', 'line-color', '#94a3b8');
    }
  }, [props.colorBanks]);

  const mapStyle = getBasemapStyle(props.satellite ? 'satellite' : 'standard');

  // 初始化地图和交互
  useEffect(() => {
    if (!mapContainer.current) return;

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: mapStyle,
      center: [lastCenterRef.current.lng, lastCenterRef.current.lat],
      zoom: lastCenterRef.current.zoom,
    });

    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl(), 'top-left');

    // 持久化地图视角
    map.on('moveend', () => {
      const c = map.getCenter();
      setMapView(c.lng, c.lat, map.getZoom());
    });

    map.on('load', () => {
      map.addSource('perpendicular-lines', { type: 'geojson', data: turf.featureCollection([]) });
      map.addSource('perpendicular-arrows', { type: 'geojson', data: turf.featureCollection([]) });
      map.addSource('perpendicular-endpoints', { type: 'geojson', data: turf.featureCollection([]) });
      map.addSource('uploaded-data', { type: 'geojson', data: turf.featureCollection([]) });
      map.addSource('selection-points', { type: 'geojson', data: turf.featureCollection([]) });
      map.addSource('snap-point', { type: 'geojson', data: turf.featureCollection([]) });
      map.addSource('active-line', { type: 'geojson', data: turf.featureCollection([]), lineMetrics: true });
      map.addSource('selected-shore-lines', { type: 'geojson', data: turf.featureCollection([]) });
      map.addSource('tiff-bounds', { type: 'geojson', data: turf.featureCollection([]) });
      map.addSource('river-surface', { type: 'geojson', data: turf.featureCollection([]) });
      // 框选：`box-select-rect` 画矩形，`box-select-banks-source` 只放命中的岸段（从 uploaded-data 里摘出来）
      map.addSource('box-select-rect', { type: 'geojson', data: turf.featureCollection([]) });
      map.addSource('box-select-banks-source', { type: 'geojson', data: turf.featureCollection([]) });
      // 框选删除断面的预览层：同样单独一条 source，删掉命中项后 source 自然空掉，不用额外清理。
      map.addSource('box-delete-sections-source', { type: 'geojson', data: turf.featureCollection([]) });
      // 如果已有数据，立刻恢复
      if (tiffBoundsDataRef.current) {
        const src = map.getSource('tiff-bounds') as mapboxgl.GeoJSONSource;
        if (src) src.setData(tiffBoundsDataRef.current);
      }
      if (riverSurfaceDataRef.current) {
        const src = map.getSource('river-surface') as mapboxgl.GeoJSONSource;
        if (src) src.setData(riverSurfaceDataRef.current);
      }
      if (uploadedDataRef.current) {
        const src = map.getSource('uploaded-data') as mapboxgl.GeoJSONSource;
        if (src) src.setData(uploadedDataRef.current);
      }
      if (perpendicularDataRef.current) {
        const src = map.getSource('perpendicular-lines') as mapboxgl.GeoJSONSource;
        if (src) src.setData(perpendicularDataRef.current);

        const arrowSrc = map.getSource('perpendicular-arrows') as mapboxgl.GeoJSONSource;
        if (arrowSrc) arrowSrc.setData(buildCrossLineArrowPoints(perpendicularDataRef.current));
      }

      // 刷新后恢复“已选岸段”高亮与段落选择组（同步 effect 早于地图创建执行时会被跳过）
      if (uploadedDataRef.current && selectedLinesRef.current && selectedLinesRef.current.size > 0) {
        const selectedSrc = map.getSource('selected-shore-lines') as mapboxgl.GeoJSONSource;
        if (selectedSrc) {
          const selectedFeatures = uploadedDataRef.current.features.filter((f: any, index: number) =>
            selectedLinesRef.current.has(getShoreLineId(f, index)),
          );
          selectedSrc.setData(turf.featureCollection(selectedFeatures));
        }
      }
      if (groupsRef.current && groupsRef.current.length > 0) {
        const pointSource = map.getSource('selection-points') as mapboxgl.GeoJSONSource;
        if (pointSource) {
          const allPoints: GeoJSON.Feature<GeoJSON.Point>[] = [];
          groupsRef.current.forEach((group) => {
            if (group.start !== null) {
              allPoints.push(turf.along(group.line, group.start, { units: 'meters' }) as GeoJSON.Feature<GeoJSON.Point>);
            }
            if (group.end !== null) {
              allPoints.push(turf.along(group.line, group.end, { units: 'meters' }) as GeoJSON.Feature<GeoJSON.Point>);
            }
          });
          pointSource.setData(turf.featureCollection(allPoints));
        }
        const activeLineSource = map.getSource('active-line') as mapboxgl.GeoJSONSource;
        if (activeLineSource) {
          const segments: GeoJSON.Feature<GeoJSON.LineString>[] = [];
          groupsRef.current.forEach((group) => {
            if (group.start !== null && group.end !== null) {
              try {
                const start = Math.min(group.start, group.end);
                const end = Math.max(group.start, group.end);
                const segment = turf.lineSliceAlong(group.line, start, end, { units: 'meters' });
                segment.properties = { groupId: group.id };
                segments.push(segment as GeoJSON.Feature<GeoJSON.LineString>);
              } catch (err) {
                console.warn('切割线段失败', err);
              }
            }
          });
          activeLineSource.setData(turf.featureCollection(segments));
        }
      }

      // 长江河面参考图层：**第一个** addLayer，所以永远压在岸段/断面/其余参考层下面。
      // 只做底衬，不注册任何 click/hover 处理器 —— 断面拾取、拖拽、自由绘制都不受影响。
      // 这里刻意不加 `$type` 过滤器：source 里只放 Polygon/MultiPolygon，而 `$type`
      // 对两者返回的字符串不同（'Polygon' / 'MultiPolygon'），加过滤反而会在
      // 哪天后端回 MultiPolygon 时把整层藏掉。
      map.addLayer({
        id: 'river-surface-fill',
        type: 'fill',
        source: 'river-surface',
        paint: {
          'fill-color': '#22d3ee',
          'fill-opacity': 0.22,
        },
        layout: {
          'visibility': showRiverSurface ? 'visible' : 'none',
        },
      });
      map.addLayer({
        id: 'river-surface-line',
        type: 'line',
        source: 'river-surface',
        paint: {
          'line-color': '#0891b2',
          'line-width': 1.4,
          'line-opacity': 0.9,
        },
        layout: {
          'visibility': showRiverSurface ? 'visible' : 'none',
        },
      });

      map.addLayer({
        id: 'uploaded-lines-hit-target',
        type: 'line',
        source: 'uploaded-data',
        filter: ['==', '$type', 'LineString'],
        paint: {
          'line-width': 30,
          'line-opacity': 0,
        },
      });

      map.addLayer({
        id: 'uploaded-lines',
        type: 'line',
        source: 'uploaded-data',
        filter: ['==', '$type', 'LineString'],
        paint: {
          'line-color': '#94a3b8',
          'line-width': 2,
        },
      });

      // —— 矩形框选命中的岸段：单独的数据源 + 单独一层，不改 uploaded-lines 的配色，也不动 selectedLines ——
      // 为什么不复用 `selected-shore-lines`（琥珀色那层）：那层的语义是"手选岸段、准备截取/生成断面"，
      // 由 isSelectingShoreLines 模式维护；框选是筛选视角，混用会让「截取岸段」吃进一批意料之外的线。
      // 宽而淡的底层 = 外发光，窄而实的顶层 = 线本身，卫星底图上也看得清。
      map.addLayer({
        id: 'box-select-banks-glow',
        type: 'line',
        source: 'box-select-banks-source',
        filter: ['==', '$type', 'LineString'],
        paint: {
          'line-color': '#7c3aed',
          'line-width': 10,
          'line-opacity': 0.22,
          'line-blur': 1,
        },
      });
      map.addLayer({
        id: 'box-select-banks',
        type: 'line',
        source: 'box-select-banks-source',
        filter: ['==', '$type', 'LineString'],
        paint: {
          'line-color': '#7c3aed',
          'line-width': 3.5,
        },
      });

      // —— 框选删除断面的待删预览：红色，且刻意做成虚线 ——
      // 与断面本身的校验配色（绿/黄/红实线）区分开：这里表达的是"即将消失"，
      // 用实线会和"无效断面（红实线）"撞语义。
      map.addLayer({
        id: 'box-delete-sections-glow',
        type: 'line',
        source: 'box-delete-sections-source',
        filter: ['==', '$type', 'LineString'],
        paint: {
          'line-color': '#ef4444',
          'line-width': 11,
          'line-opacity': 0.22,
          'line-blur': 1,
        },
      });
      map.addLayer({
        id: 'box-delete-sections',
        type: 'line',
        source: 'box-delete-sections-source',
        filter: ['==', '$type', 'LineString'],
        paint: {
          'line-color': '#ef4444',
          'line-width': 3.5,
          'line-dasharray': [2, 1.2],
        },
      });

      map.addLayer({
        id: 'selected-shore-lines-layer',
        type: 'line',
        source: 'selected-shore-lines',
        filter: ['==', '$type', 'LineString'],
        paint: {
          'line-color': '#f59e0b',
          'line-width': 4,
        },
      });

      map.addLayer({
        id: 'active-line-layer',
        type: 'line',
        source: 'active-line',
        paint: {
          'line-color': '#10b981',
          'line-width': 6,
        },
      });

      map.addLayer({
        id: 'tiff-bounds-fill',
        type: 'fill',
        source: 'tiff-bounds',
        filter: ['==', '$type', 'Polygon'],
        paint: {
          'fill-color': '#3b82f6',
          'fill-opacity': 0.15,
        },
        layout: {
          'visibility': showTiffBounds ? 'visible' : 'none',
        },
      });
      map.addLayer({
        id: 'tiff-bounds-line',
        type: 'line',
        source: 'tiff-bounds',
        filter: ['==', '$type', 'Polygon'],
        paint: {
          'line-color': '#2563eb',
          'line-width': 2,
        },
        layout: {
          'visibility': showTiffBounds ? 'visible' : 'none',
        },
      });

      map.addLayer({
        id: 'perpendicular-lines-hit-target',
        type: 'line',
        source: 'perpendicular-lines',
        paint: {
          'line-width': 20,
          'line-opacity': 0,
        },
      });

      map.addLayer({
        id: 'perpendicular-lines-layer',
        type: 'line',
        source: 'perpendicular-lines',
        paint: { 'line-color': buildValidationColorExpression(), 'line-width': 4 },
      });

      ensureArrowIcons(map);
      map.addLayer({
        id: 'perpendicular-arrows-layer',
        type: 'symbol',
        source: 'perpendicular-arrows',
        layout: {
          'icon-image': buildArrowIconExpression(),
          'icon-size': 1,
          'icon-rotate': ['get', 'iconRotate'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });

      map.addSource('selected-cross-line', { type: 'geojson', data: turf.featureCollection([]) });
      map.addLayer({
        id: 'selected-cross-line-layer',
        type: 'line',
        source: 'selected-cross-line',
        paint: { 'line-color': '#3b82f6', 'line-width': 4 },
      });

      map.addLayer({
        id: 'perpendicular-endpoints-layer',
        type: 'circle',
        source: 'perpendicular-endpoints',
        paint: {
          'circle-radius': 6,
          'circle-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#3b82f6',
        },
      });

      map.addLayer({
        id: 'points-layer',
        type: 'circle',
        source: 'selection-points',
        paint: {
          'circle-radius': 8,
          'circle-color': '#3b82f6',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });

      map.addLayer({
        id: 'snap-point-layer',
        type: 'circle',
        source: 'snap-point',
        paint: {
          'circle-radius': 5,
          'circle-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#3b82f6',
        },
      });

      // —— 框选的矩形边框：置顶，任何图层（含断面箭头、端点、弹窗锚点）都不能压住它 ——
      // 拖拽过程中直接写 source（不走 React setState），否则 mousemove 每帧一次渲染，
      // 几百条岸段的地图会被拖到卡死。
      map.addLayer({
        id: 'box-select-rect-fill',
        type: 'fill',
        source: 'box-select-rect',
        filter: ['==', '$type', 'Polygon'],
        paint: { 'fill-color': '#7c3aed', 'fill-opacity': 0.08 },
      });
      map.addLayer({
        id: 'box-select-rect-line',
        type: 'line',
        source: 'box-select-rect',
        filter: ['==', '$type', 'Polygon'],
        paint: {
          'line-color': '#7c3aed',
          'line-width': 1.6,
          'line-dasharray': [2, 1.5],
        },
      });

      // 图层重建（换底图 / 首次 load）后把已经生效的框与命中岸段画回来
      syncBoxSelectionLayers(
        map,
        boxBoundsRef.current,
        boxBankIdsRef.current,
        uploadedDataRef.current,
        boxSectionIdsRef.current,
        perpendicularDataRef.current,
      );

      const hitLayers = ['uploaded-lines-hit-target'];
      const crossLineHitLayers = ['perpendicular-lines-hit-target'];

      const freeAddStartRef: { current: number[] | null } = { current: null };
      /** 首点吸附到的岸段；等终点落点后一起交给创建动作，作为 bank_id 的最高优先真源 */
      const freeAddAnchorRef: { current: BankAnchor | null } = { current: null };

      let infoPopup: mapboxgl.Popup | null = null;

      const closeInfoPopup = () => {
        if (!infoPopup) return;
        infoPopup.remove();
        infoPopup = null;
      };

      const escapeHtml = (value: any) => {
        const s = value === null || value === undefined ? '' : String(value);
        return s
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#039;');
      };

      const openCrossLineInfoPopup = (lngLat: mapboxgl.LngLat, props: any) => {
        closeInfoPopup();

        const sectionId = props?.sectionId ?? props?.section_id ?? props?.id;
        const isValid = props?.is_valid;
        const status = props?.validation_status;
        const rawStatus = props?.validation_status_raw;
        const message = props?.validation_message;
        const error = props?.validation_error;

        let label = '未验证';
        let color = '#f59e0b';
        if (status === 'valid' || isValid === true) {
          label = '通过';
          color = '#22c55e';
        } else if (status === 'invalid' || isValid === false) {
          label = '未通过';
          color = '#ef4444';
        }

        const detailHtml: string[] = [];
        if (label === '未通过') {
          const detail = message || rawStatus;
          if (detail) {
            detailHtml.push(
              `<p style="margin:4px 0 0; font-size:12px; color:#64748b;">问题: ${escapeHtml(detail)}</p>`,
            );
          }
        } else if (label === '未验证' && error) {
          // 「Failed to fetch」不是后端返回的错误码，而是请求根本没发出去/被浏览器掐断
          // （典型：批量校验并发过多触发 net::ERR_INSUFFICIENT_RESOURCES）。
          // 直接甩这句英文很容易被误读成「后端有问题」，这里补一句可操作的提示。
          const isNetworkLayer = /Failed to fetch|NetworkError|Load failed|ERR_/i.test(String(error));
          detailHtml.push(
            `<p style="margin:4px 0 0; font-size:12px; color:#64748b;">上次请求失败: ${escapeHtml(error)}</p>`,
          );
          if (isNetworkLayer) {
            detailHtml.push(
              `<p style="margin:2px 0 0; font-size:12px; color:#94a3b8;">（请求未到达后端，多为浏览器并发上限/网络中断；点「断面检查」重试即可）</p>`,
            );
          }
        }

        infoPopup = new mapboxgl.Popup()
          .setLngLat(lngLat)
          .setHTML(`
            <div style="padding: 4px; font-family: sans-serif;">
              <p style="margin:0; font-weight:bold; color:#1e293b;">断面校验状态</p>
              <p style="margin:4px 0 0; font-size:12px; color:#64748b;">断面ID: ${escapeHtml(sectionId || '未知')}</p>
              <p style="margin:4px 0 0; font-size:12px; color:#64748b;">状态: <span style="color:${color}; font-weight:bold;">${label}</span></p>
              ${detailHtml.join('')}
            </div>
          `)
          .addTo(map);
      };

      let dragState:
        | {
            crossLineIds: number[];
            startLngLat: mapboxgl.LngLat;
            startCoordsById: Map<number, number[][]>;
            lastCoordsById: Map<number, number[][]>;
            // 拖拽期间只更新 Mapbox source（不触发 React setState），避免多选时卡顿
            workingCrossLinesData: GeoJSON.FeatureCollection;
            workingArrowData: GeoJSON.FeatureCollection<GeoJSON.Point>;
            arrowIndexByCrossLineId: Map<number, number>;
            crossLinesSource: mapboxgl.GeoJSONSource | null;
            crossArrowsSource: mapboxgl.GeoJSONSource | null;
            selectedCrossLineSource: mapboxgl.GeoJSONSource | null;
            pendingDelta: { dx: number; dy: number } | null;
            pendingPosition: { lng: number; lat: number } | null;
            rafId: number | null;
            draggedHandle: { crossLineId: number; vertexIndex: 0 | 1 } | null;
            endpointsSource: mapboxgl.GeoJSONSource | null;
          }
        | null = null;

      const bearingDegrees = (start: number[], end: number[]) => {
        const lon1 = Number(start?.[0]);
        const lat1 = Number(start?.[1]);
        const lon2 = Number(end?.[0]);
        const lat2 = Number(end?.[1]);
        if (![lon1, lat1, lon2, lat2].every((v) => Number.isFinite(v))) return 0;
        const toRad = (d: number) => (d * Math.PI) / 180;
        const toDeg = (r: number) => (r * 180) / Math.PI;
        const φ1 = toRad(lat1);
        const φ2 = toRad(lat2);
        const Δλ = toRad(lon2 - lon1);
        const y = Math.sin(Δλ) * Math.cos(φ2);
        const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
        const θ = Math.atan2(y, x);
        return (toDeg(θ) + 360) % 360;
      };

      const applyDragFrame = (ds: NonNullable<typeof dragState>, dx: number, dy: number) => {
        ds.crossLineIds.forEach((id) => {
          const startCoords = ds.startCoordsById.get(id);
          if (!startCoords) return;
          const nextCoords = startCoords.map((c) => [c[0] + dx, c[1] + dy]);
          ds.lastCoordsById.set(id, nextCoords);

          const f: any = ds.workingCrossLinesData.features?.[id];
          if (f?.geometry?.type === 'LineString') {
            f.geometry.coordinates = nextCoords;
          }

          const arrowIdx = ds.arrowIndexByCrossLineId.get(id);
          if (arrowIdx !== undefined) {
            const arrow: any = ds.workingArrowData.features?.[arrowIdx];
            if (arrow?.geometry?.type === 'Point') {
              const start = nextCoords[0];
              const end = nextCoords[nextCoords.length - 1];
              arrow.geometry.coordinates = end;
              arrow.properties = {
                ...(arrow.properties || {}),
                iconRotate: Number(bearingDegrees(start as any, end as any) - 90),
              };
            }
          }
        });

        ds.crossLinesSource?.setData(ds.workingCrossLinesData);
        ds.crossArrowsSource?.setData(ds.workingArrowData);

        if (ds.selectedCrossLineSource) {
          const selectedFeatures = ds.crossLineIds
            .map((id) => ds.workingCrossLinesData.features?.[id])
            .filter(Boolean) as GeoJSON.Feature<GeoJSON.Geometry>[];
          ds.selectedCrossLineSource.setData({ type: 'FeatureCollection', features: selectedFeatures } as any);
        }

        if (ds.endpointsSource) {
          ds.endpointsSource.setData(buildCrossLineEndpoints(ds.workingCrossLinesData, ds.crossLineIds));
        }
      };

      // 端点拖拽：仅移动被拖拽的端点，另一端保持不动；沿原始线段方向约束
      const applyEndpointDragFrame = (ds: NonNullable<typeof dragState>, lng: number, lat: number) => {
        const handle = ds.draggedHandle;
        if (!handle) return;
        const { crossLineId, vertexIndex } = handle;

        const f: any = ds.workingCrossLinesData.features?.[crossLineId];
        if (!f || f.geometry?.type !== 'LineString') return;
        const coords = f.geometry.coordinates as number[][];
        if (!coords || coords.length < 2) return;

        // 获取拖拽前的原始坐标，用于确定约束方向
        const originalCoords = ds.startCoordsById.get(crossLineId);
        if (!originalCoords || originalCoords.length < 2) return;

        // 固定端（未被拖拽的一端）和原始拖拽端
        const fixedPoint = vertexIndex === 0
          ? originalCoords[originalCoords.length - 1]
          : originalCoords[0];
        const originalDragged = vertexIndex === 0
          ? originalCoords[0]
          : originalCoords[originalCoords.length - 1];

        // 沿原始线段方向构造一条长轴线，将鼠标位置投影到轴线上
        const fixedPt = turf.point(fixedPoint as [number, number]);
        const bearing = turf.bearing(fixedPt, turf.point(originalDragged as [number, number]));
        const far1 = turf.destination(fixedPt, 10000, bearing, { units: 'meters' }).geometry.coordinates as number[];
        const far2 = turf.destination(fixedPt, 10000, bearing + 180, { units: 'meters' }).geometry.coordinates as number[];
        const axisLine = turf.lineString([far1, far2]);
        const projected = turf.nearestPointOnLine(axisLine, turf.point([lng, lat]));
        const newLng = projected.geometry.coordinates[0];
        const newLat = projected.geometry.coordinates[1];

        // 仅更新被拖拽的端点，另一端保持不动
        if (vertexIndex === 0) {
          coords[0] = [newLng, newLat];
        } else {
          coords[coords.length - 1] = [newLng, newLat];
        }
        ds.lastCoordsById.set(crossLineId, coords.map((c) => [c[0], c[1]]));

        // 更新箭头位置/朝向
        const arrowIdx = ds.arrowIndexByCrossLineId.get(crossLineId);
        if (arrowIdx !== undefined) {
          const arrow: any = ds.workingArrowData.features?.[arrowIdx];
          if (arrow?.geometry?.type === 'Point') {
            const start = coords[0];
            const end = coords[coords.length - 1];
            arrow.geometry.coordinates = end;
            arrow.properties = {
              ...(arrow.properties || {}),
              iconRotate: Number(bearingDegrees(start as any, end as any) - 90),
            };
          }
        }

        ds.crossLinesSource?.setData(ds.workingCrossLinesData);
        ds.crossArrowsSource?.setData(ds.workingArrowData);

        if (ds.selectedCrossLineSource) {
          ds.selectedCrossLineSource.setData({ type: 'FeatureCollection', features: [f] } as any);
        }
        if (ds.endpointsSource) {
          ds.endpointsSource.setData(buildCrossLineEndpoints(ds.workingCrossLinesData, [crossLineId]));
        }
      };

      const scheduleDragRender = (ds: NonNullable<typeof dragState>) => {
        if (ds.rafId !== null) return;
        ds.rafId = window.requestAnimationFrame(() => {
          const active = dragState;
          if (!active) return;
          active.rafId = null;

          if (active.draggedHandle) {
            const pending = active.pendingPosition;
            if (!pending) return;
            active.pendingPosition = null;
            applyEndpointDragFrame(active, pending.lng, pending.lat);
          } else {
            const pending = active.pendingDelta;
            if (!pending) return;
            active.pendingDelta = null;
            applyDragFrame(active, pending.dx, pending.dy);
          }

          if (active.pendingDelta || active.pendingPosition) {
            scheduleDragRender(active);
          }
        });
      };

      const onDragMove = (ev: mapboxgl.MapMouseEvent) => {
        const ds = dragState;
        if (!ds) return;
        const dx = ev.lngLat.lng - ds.startLngLat.lng;
        const dy = ev.lngLat.lat - ds.startLngLat.lat;

        ds.pendingDelta = { dx, dy };
        ds.pendingPosition = { lng: ev.lngLat.lng, lat: ev.lngLat.lat };
        scheduleDragRender(ds);
      };

      const endDrag = () => {
        const ds = dragState;
        if (!ds) return;
        wasDragging = true;

        // 确保最后一次鼠标位置能落盘到地图上
        if (ds.draggedHandle) {
          // 端点拖拽：仅 flush pendingPosition（若已被 RAF 消费则跳过）
          if (ds.pendingPosition) {
            const { lng, lat } = ds.pendingPosition;
            ds.pendingPosition = null;
            applyEndpointDragFrame(ds, lng, lat);
          }
        } else if (ds.pendingDelta) {
          const { dx, dy } = ds.pendingDelta;
          ds.pendingDelta = null;
          applyDragFrame(ds, dx, dy);
        }
        if (ds.rafId !== null) {
          window.cancelAnimationFrame(ds.rafId);
          ds.rafId = null;
        }

        map.dragPan.enable();
        map.off('mousemove', onDragMove);
        map.getCanvas().style.cursor = '';

        // 拖动结束：一次性写回 React 状态（避免 N 次 setState）
        const updates: Array<{ crossLineIndex: number; geometry: GeoJSON.LineString }> = [];
        ds.crossLineIds.forEach((id) => {
          const coords = ds.lastCoordsById.get(id);
          if (!coords) return;
          updates.push({
            crossLineIndex: id,
            geometry: { type: 'LineString', coordinates: coords },
          });
        });

        const applier = applyCrossLineGeometriesLocalRef.current;
        if (applier) {
          applier(updates);
        } else {
          // 兼容旧接口：逐条回写
          updates.forEach((u) => updateCrossLineGeometryLocalRef.current(u.crossLineIndex, u.geometry));
        }

        const tasks: Array<Promise<any>> = [];
        ds.crossLineIds.forEach((id) => {
          const coords = ds.lastCoordsById.get(id);
          if (!coords) return;
          const finalGeometry: GeoJSON.LineString = {
            type: 'LineString',
            coordinates: coords,
          };
          tasks.push(persistCrossLineGeometryRef.current(id, finalGeometry));
        });
        // 不阻塞 UI；后台同步即可
        Promise.allSettled(tasks);

        // 拖拽结束后立即刷新箭头数据源，避免 React effect 异步更新导致的残留
        if (ds.crossArrowsSource) {
          ds.crossArrowsSource.setData(buildCrossLineArrowPoints(ds.workingCrossLinesData));
        }

        dragState = null;
      };

      // 端点拖拽：点击断面起点/终点手柄，拖动以自由调整长度和方向
      let wasDragging = false;
      map.on('mousedown', 'perpendicular-endpoints-layer', (e) => {
        // 框选模式下左键属于"画框"，不能被端点拖拽认领（否则从断面上起手就拖不动框）
        if (boxSelectModeRef.current) return;
        if (!isSelectingCrossLinesRef.current) return;
        if (crossLineEditModeRef.current !== 'select') return;

        // 清除自由创建模式的残留状态，防止后续误创建断面
        freeAddStartRef.current = null;

        const feature = e.features?.[0];
        const crossLineId = Number(feature?.properties?.crossLineId);
        const rawVertex = Number(feature?.properties?.vertexIndex);
        if (!Number.isFinite(crossLineId)) return;
        if (rawVertex !== 0 && rawVertex !== 1) return;
        const vertexIndex = rawVertex as 0 | 1;

        const currentData = perpendicularDataRef.current;
        const currentFeature: any = currentData?.features?.[crossLineId];
        if (!currentFeature || currentFeature.geometry?.type !== 'LineString') return;

        const startCoords = (currentFeature.geometry.coordinates as number[][]) || [];
        if (startCoords.length < 2) return;

        // 选中此断面（单选）
        setSelectedCrossLineIndex(crossLineId);
        setSelectedCrossLineIndices(new Set([crossLineId]));

        const copied = startCoords.map((c) => [c[0], c[1]]);
        const startCoordsById = new Map<number, number[][]>();
        const lastCoordsById = new Map<number, number[][]>();
        startCoordsById.set(crossLineId, copied);
        lastCoordsById.set(crossLineId, copied.map((c) => [c[0], c[1]]));

        // 构建工作副本
        const base = perpendicularDataRef.current;
        const workingFeatures = (base?.features ? base.features.slice() : []) as any[];
        const original = workingFeatures[crossLineId];
        if (original) {
          workingFeatures[crossLineId] = {
            ...original,
            geometry: {
              ...(original.geometry || {}),
              type: 'LineString',
              coordinates: copied.map((c) => [c[0], c[1]]),
            },
            properties: {
              ...(original.properties || {}),
              crossLineId: (original.properties as any)?.crossLineId ?? crossLineId,
            },
          };
        }
        const workingCrossLinesData: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: workingFeatures as any,
        };
        const workingArrowData = buildCrossLineArrowPoints(workingCrossLinesData);
        const arrowIndexByCrossLineId = new Map<number, number>();
        (workingArrowData.features as any[]).forEach((f, idx) => {
          const cid = Number(f?.properties?.crossLineId);
          if (Number.isFinite(cid)) arrowIndexByCrossLineId.set(cid, idx);
        });

        const crossLinesSource = map.getSource('perpendicular-lines') as mapboxgl.GeoJSONSource | null;
        const crossArrowsSource = map.getSource('perpendicular-arrows') as mapboxgl.GeoJSONSource | null;
        const selectedCrossLineSource = map.getSource('selected-cross-line') as mapboxgl.GeoJSONSource | null;
        const endpointsSource = map.getSource('perpendicular-endpoints') as mapboxgl.GeoJSONSource | null;

        dragState = {
          crossLineIds: [crossLineId],
          startLngLat: e.lngLat,
          startCoordsById,
          lastCoordsById,
          workingCrossLinesData,
          workingArrowData,
          arrowIndexByCrossLineId,
          crossLinesSource,
          crossArrowsSource,
          selectedCrossLineSource,
          pendingDelta: null,
          pendingPosition: null,
          rafId: null,
          draggedHandle: { crossLineId, vertexIndex },
          endpointsSource,
        };

        map.dragPan.disable();
        map.getCanvas().style.cursor = 'grabbing';

        map.on('mousemove', onDragMove);
        map.once('mouseup', endDrag);
      });

      map.on('mousedown', 'perpendicular-lines-hit-target', (e) => {
        if (boxSelectModeRef.current) return;
        if (!isSelectingCrossLinesRef.current) return;
        if (crossLineControlModeRef.current !== 'free') return;
        if (crossLineEditModeRef.current !== 'select') return;

        // 如果端点拖拽已经认领了本次 mousedown，跳过整线拖拽
        if (dragState) return;

        // 如果点击位置命中的是端点手柄，则交给端点拖拽逻辑处理
        const endpointHits = map.queryRenderedFeatures(e.point, {
          layers: ['perpendicular-endpoints-layer'],
        });
        if (endpointHits.length > 0) return;

        const oe = e.originalEvent as MouseEvent | undefined;
        const isCtrl = !!oe?.ctrlKey;

        const feature = e.features?.[0];
        const crossLineId = feature?.properties?.crossLineId as number | undefined;
        if (crossLineId === undefined || crossLineId === null) return;

        const currentData = perpendicularDataRef.current;
        const currentFeature: any = currentData?.features?.[crossLineId];
        if (!currentFeature || currentFeature.geometry?.type !== 'LineString') return;

        const startCoords = (currentFeature.geometry.coordinates as number[][]) || [];
        if (startCoords.length < 2) return;

        // Ctrl+点选未选中的断面：交由 click 逻辑做“多选切换”，避免误触拖拽
        const currentSelected = selectedCrossLineIndicesRef.current;
        const clickedIsSelected = currentSelected.has(crossLineId);
        if (isCtrl && !clickedIsSelected) return;

        // 拖拽逻辑：
        // - 如果点击的是已选中断面（无论是否按 Ctrl），则拖拽整个多选集合
        // - 如果点击的是未选中断面，则先单选它再拖拽
        const willUseIds = clickedIsSelected ? Array.from(currentSelected) : [crossLineId];

        if (!clickedIsSelected) {
          setSelectedCrossLineIndex(crossLineId);
          setSelectedCrossLineIndices(new Set([crossLineId]));
        }

        const startCoordsById = new Map<number, number[][]>();
        const lastCoordsById = new Map<number, number[][]>();
        willUseIds.forEach((id) => {
          const f: any = perpendicularDataRef.current?.features?.[id];
          if (!f || f.geometry?.type !== 'LineString') return;
          const coords = (f.geometry.coordinates as number[][]) || [];
          if (coords.length < 2) return;
          const copied = coords.map((c) => [c[0], c[1]]);
          startCoordsById.set(id, copied);
          lastCoordsById.set(id, copied.map((c) => [c[0], c[1]]));
        });

        // 为拖拽创建一次性的工作副本：只 clone 被拖拽的要素，避免污染 React state
        const base = perpendicularDataRef.current;
        const workingFeatures = (base?.features ? base.features.slice() : []) as any[];
        Array.from(startCoordsById.entries()).forEach(([id, coords]) => {
          const original: any = workingFeatures[id];
          if (!original) return;
          workingFeatures[id] = {
            ...original,
            geometry: {
              ...(original.geometry || {}),
              type: 'LineString',
              coordinates: coords.map((c) => [c[0], c[1]]),
            },
            properties: {
              ...(original.properties || {}),
              crossLineId: (original.properties as any)?.crossLineId ?? id,
            },
          };
        });
        const workingCrossLinesData: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: workingFeatures as any,
        };

        const workingArrowData = buildCrossLineArrowPoints(workingCrossLinesData);
        const arrowIndexByCrossLineId = new Map<number, number>();
        (workingArrowData.features as any[]).forEach((f, idx) => {
          const cid = Number(f?.properties?.crossLineId);
          if (Number.isFinite(cid)) arrowIndexByCrossLineId.set(cid, idx);
        });

        const crossLinesSource = map.getSource('perpendicular-lines') as mapboxgl.GeoJSONSource | null;
        const crossArrowsSource = map.getSource('perpendicular-arrows') as mapboxgl.GeoJSONSource | null;
        const selectedCrossLineSource = map.getSource('selected-cross-line') as mapboxgl.GeoJSONSource | null;
        const endpointsSource = map.getSource('perpendicular-endpoints') as mapboxgl.GeoJSONSource | null;

        dragState = {
          crossLineIds: Array.from(startCoordsById.keys()),
          startLngLat: e.lngLat,
          startCoordsById,
          lastCoordsById,
          workingCrossLinesData,
          workingArrowData,
          arrowIndexByCrossLineId,
          crossLinesSource,
          crossArrowsSource,
          selectedCrossLineSource,
          pendingDelta: null,
          pendingPosition: null,
          rafId: null,
          draggedHandle: null,
          endpointsSource,
        };

        if (dragState.crossLineIds.length === 0) {
          dragState = null;
          return;
        }

        map.dragPan.disable();
        map.getCanvas().style.cursor = 'move';

        map.on('mousemove', onDragMove);
        map.once('mouseup', endDrag);
      });

      map.on('click', (e) => {
        // 画框期间（含松手那一下产生的 click）一律不交给选择/创建逻辑：
        // 否则框选完会顺手在框角处"选中一条断面"或"落一个自由绘制起点"。
        if (boxSelectModeRef.current) return;
        // 拖拽刚结束后的第一次 click 事件需要抑制，避免误触选择/创建逻辑
        if (wasDragging) {
          wasDragging = false;
          freeAddStartRef.current = null;
          return;
        }
        // 所有编辑操作未激活时：点击断面只展示状态，不进入选择/编辑
        const noEditingActive =
          !isSelectingShoreLinesRef.current &&
          !isSelectingStartEndRef.current &&
          !isSelectingCrossLinesRef.current;

        // 岸段修正选择开启时，禁用断面信息弹窗（避免干扰点击岸段）
        if (noEditingActive && !isFixingShoreLineReversedRef.current) {
          const crossLineFeatures = map.queryRenderedFeatures(e.point, { layers: crossLineHitLayers });
          const hit = crossLineFeatures?.[0];
          if (hit) {
            openCrossLineInfoPopup(e.lngLat, hit.properties || {});
            return;
          }
        }

        if (isSelectingCrossLinesRef.current) {
          // 进入断面编辑时，关闭信息弹窗，避免遮挡
          closeInfoPopup();
          const editMode = crossLineEditModeRef.current;
          const controlMode = crossLineControlModeRef.current;

          if (editMode === 'none') {
            setSelectedCrossLineIndex(null);
            setSelectedCrossLineIndices(new Set());
            return;
          }

          if (editMode === 'select') {
            const crossLineFeatures = map.queryRenderedFeatures(e.point, { layers: crossLineHitLayers });
            console.log(`点击断面，查询到 ${crossLineFeatures?.length || 0} 个要素`);

            if (crossLineFeatures && crossLineFeatures.length > 0) {
              const clickedFeature = crossLineFeatures[0];
              const crossLineId = clickedFeature.properties?.crossLineId as number | undefined;

              console.log(`点击的断面ID: ${crossLineId}`);

              if (crossLineId !== undefined && crossLineId !== null) {
                const oe = e.originalEvent as MouseEvent | undefined;
                const isCtrl = !!oe?.ctrlKey;

                if (!isCtrl) {
                  setSelectedCrossLineIndex(crossLineId);
                  setSelectedCrossLineIndices(new Set([crossLineId]));
                } else {
                  setSelectedCrossLineIndices((prev) => {
                    const next = new Set(prev);
                    if (next.has(crossLineId)) {
                      next.delete(crossLineId);
                    } else {
                      next.add(crossLineId);
                    }

                    // 主选中索引同步
                    if (next.size === 0) {
                      setSelectedCrossLineIndex(null);
                    } else if (!next.has(selectedCrossLineIndexRef.current ?? -1)) {
                      // 如果当前主选中被移除，则选一个剩余的作为主选中
                      const first = Array.from(next)[0];
                      setSelectedCrossLineIndex(first);
                    } else {
                      // 保持主选中不变；若是新增则更新为新点选
                      if (!prev.has(crossLineId)) setSelectedCrossLineIndex(crossLineId);
                    }

                    return next;
                  });
                }
                console.log(`选中断面索引: ${crossLineId}`);
              } else {
                console.warn('断面没有crossLineId属性，尝试坐标匹配');
              }
            }
          } else if (editMode === 'add') {
            if (controlMode === 'shoreline') {
              const shoreLineFeatures = map.queryRenderedFeatures(e.point, { layers: hitLayers });

              if (shoreLineFeatures && shoreLineFeatures.length > 0) {
                const clickedFeature = shoreLineFeatures[0];
                const lineGeo = clickedFeature.geometry as GeoJSON.LineString;
                const lineFeature = turf.feature(lineGeo, clickedFeature.properties) as GeoJSON.Feature<GeoJSON.LineString>;

                const snapped = turf.nearestPointOnLine(lineFeature, [e.lngLat.lng, e.lngLat.lat], { units: 'meters' });
                const distanceOnLine = snapped.properties.location ?? 0;

                console.log(`点击岸段新建断面，距离: ${distanceOnLine.toFixed(2)}m`);
                createCrossLineAtPoint(lineFeature, distanceOnLine);
              }
            } else {
              const rawPoint: LngLat = [e.lngLat.lng, e.lngLat.lat];
              if (!freeAddStartRef.current) {
                // 首点若落在岸段上：吸附到岸段线，并记住「归到哪条岸段」。
                // 少了这一步，用户眼睛看到的落点和实际存的坐标能差十几米（命中区是按屏幕像素算的），
                // 归属判定就会漂到隔壁岸段，或者干脆归不上。
                let anchor: BankAnchor | null = null;
                const hit = map.queryRenderedFeatures(e.point, { layers: hitLayers })?.[0];
                if (hit) {
                  const hitIndex = Number(hit.properties?.index);
                  // 优先用 uploadedData 里的原始几何：渲染用的 feature 可能已被裁切/简化
                  const bankFeature = Number.isFinite(hitIndex)
                    ? ((uploadedDataRef.current?.features?.[hitIndex] as any) ?? hit)
                    : hit;
                  const snapped = snapPointToBank(rawPoint, bankFeature, Number.isFinite(hitIndex) ? hitIndex : 0);
                  if (snapped) {
                    anchor = {
                      point: snapped.footPoint,
                      bankId: snapped.bankId,
                      distance: snapped.distance,
                    };
                  }
                }
                freeAddStartRef.current = anchor ? anchor.point : rawPoint;
                freeAddAnchorRef.current = anchor;
                const source = map.getSource('snap-point') as mapboxgl.GeoJSONSource;
                if (source) source.setData(turf.point(freeAddStartRef.current));
                console.log(
                  anchor
                    ? `自由模式：起点已吸附到岸段 ${anchor.bankId ?? '(无 bank_id)'}，里程 ${(anchor.distance ?? 0).toFixed(1)}m`
                    : '自由模式：已选择断面起点（未落在岸段上）',
                );
              } else {
                const start = freeAddStartRef.current;
                const anchor = freeAddAnchorRef.current;
                freeAddStartRef.current = null;
                freeAddAnchorRef.current = null;
                const source = map.getSource('snap-point') as mapboxgl.GeoJSONSource;
                if (source) source.setData(turf.featureCollection([]));
                console.log('自由模式：已选择断面终点，开始创建断面');
                createCrossLineByEndpointsRef.current(start, rawPoint, anchor);
              }
            }
          }
          return;
        }

        // 点击到空白处时，收起信息弹窗
        closeInfoPopup();

        // 岸段修正选择：点击岸段触发批量反转（仅在外部回调中做选段过滤）
        if (isFixingShoreLineReversedRef.current) {
          const features = map.queryRenderedFeatures(e.point, { layers: hitLayers });
          const feature = features?.[0];
          if (!feature) return;

          const lineIndex = feature.properties?.index as number | undefined;
          if (lineIndex === undefined || lineIndex === null) return;
          const shoreLineId = getShoreLineId({ properties: feature.properties }, lineIndex);

          onFixSelectedShoreLineReversedRef.current({ shoreLineIndex: lineIndex, shoreLineId });
          return;
        }

        const features = map.queryRenderedFeatures(e.point, { layers: hitLayers });
        const feature = features?.[0];

        if (!feature) return;

        const lineGeo = feature.geometry.type === 'LineString'
            ? feature.geometry as GeoJSON.LineString
            : (feature.geometry as GeoJSON.MultiLineString).coordinates[0] as unknown as GeoJSON.LineString;
        const lineFeature = turf.feature(lineGeo, feature.properties) as GeoJSON.Feature<GeoJSON.LineString>;

        const lineIndex = feature.properties?.index as number | undefined;
        const lineId = getShoreLineId({ properties: feature.properties }, lineIndex ?? 0);

        if (isSelectingShoreLinesRef.current) {
          setSelectedLines((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(lineId)) {
              newSet.delete(lineId);
              console.log(`取消选择岸段: ${lineId}`);
            } else {
              newSet.add(lineId);
              console.log(`选择岸段: ${lineId}`);
            }
            return newSet;
          });
          return;
        }

        if (!isSelectingStartEndRef.current) {
          return;
        }

        const snapped = turf.nearestPointOnLine(lineFeature, [e.lngLat.lng, e.lngLat.lat], { units: 'meters' });
        const dist = snapped.properties.location ?? 0;
        const totalLineLength = turf.length(lineFeature, { units: 'meters' });

        const currentGroups = groupsRef.current;
        const activeIndex = currentGroups.findIndex((g) => g.end === null);
        const { interval, length } = configRef.current;

        if (activeIndex === -1) {
          console.log(
            `[设置起点] 线索引: ${lineIndex}, 距离: ${dist.toFixed(2)}m, 整线归一化: ${(dist / totalLineLength).toFixed(4)}`,
          );
          const newGroup: SelectionGroup = {
            id: Math.random().toString(36).substr(2, 9),
            line: lineFeature,
            lineIndex: lineIndex,
            start: dist,
            end: null,
            interval: interval,
            lastAppliedInterval: interval,
            length: length,
            crossData: [],
          };
          setGroups((prev) => [...prev, newGroup]);
        } else {
          const activeGroup = currentGroups[activeIndex];
          const isSameLine = lineIndex !== undefined && lineIndex === activeGroup.lineIndex;

          if (isSameLine) {
            console.log(
              `[设置终点] 线索引: ${lineIndex}, 距离: ${dist.toFixed(2)}m, 整线归一化: ${(dist / totalLineLength).toFixed(4)}`,
            );

            setGroups((prev) => {
              const updated = [...prev];
              const idx = updated.findIndex((g) => g.id === activeGroup.id);
              if (idx !== -1) {
                updated[idx] = { ...activeGroup, end: dist };
              }
              return updated;
            });
          } else {
            console.log(
              `[跨线点击] 从线${activeGroup.lineIndex}跳到线${lineIndex}，重置起点: ${dist.toFixed(2)}m`,
            );

            const newGroup: SelectionGroup = {
              id: Math.random().toString(36).substr(2, 9),
              line: lineFeature,
              lineIndex: lineIndex,
              start: dist,
              end: null,
              interval: interval,
              lastAppliedInterval: interval,
              length: length,
              crossData: [],
            };

            setGroups((prev) => {
              const filtered = prev.filter((g) => g.end !== null);
              return [...filtered, newGroup];
            });
          }
        }
      });

      map.on('mouseenter', 'perpendicular-lines-hit-target', () => {
        const noEditingActive =
          !isSelectingShoreLinesRef.current &&
          !isSelectingStartEndRef.current &&
          !isSelectingCrossLinesRef.current;
        if (noEditingActive) {
          map.getCanvas().style.cursor = 'pointer';
        }
      });

      map.on('mouseleave', 'perpendicular-lines-hit-target', () => {
        const noEditingActive =
          !isSelectingShoreLinesRef.current &&
          !isSelectingStartEndRef.current &&
          !isSelectingCrossLinesRef.current;
        if (noEditingActive) {
          map.getCanvas().style.cursor = '';
        }
      });

      map.on('mouseenter', 'perpendicular-endpoints-layer', () => {
        if (isSelectingCrossLinesRef.current && crossLineEditModeRef.current === 'select') {
          map.getCanvas().style.cursor = 'grab';
        }
      });

      map.on('mouseleave', 'perpendicular-endpoints-layer', () => {
        if (isSelectingCrossLinesRef.current && crossLineEditModeRef.current === 'select') {
          map.getCanvas().style.cursor = '';
        }
      });

      map.on('mousemove', crossLineHitLayers, (e) => {
        // 框选时不要让 hover 改光标：十字光标被顶回 pointer，用户会以为画不了框
        if (boxSelectModeRef.current) return;
        if (isSelectingCrossLinesRef.current && crossLineEditModeRef.current === 'select') {
          map.getCanvas().style.cursor = 'pointer';

          const features = e.features;
          if (features && features.length > 0) {
            const feature = features[0];
            const geometry = feature.geometry as GeoJSON.LineString;
            const coords = geometry.coordinates;

            const ap = getVerticalFootCoordsFromAny(feature.properties);
            const p =
              ap ??
              ([
                (coords[0][0] + coords[1][0]) / 2,
                (coords[0][1] + coords[1][1]) / 2,
              ] as any);
            const midPoint = turf.point(p as any);

            const source = map.getSource('snap-point') as mapboxgl.GeoJSONSource;
            if (source) source.setData(midPoint);
          }
        }
      });

      map.on('mousemove', hitLayers, (e) => {
        // 框选时不要让 hover 改光标：十字光标被顶回 pointer，用户会以为画不了框
        if (boxSelectModeRef.current) return;
        if (isSelectingCrossLinesRef.current && crossLineEditModeRef.current === 'add') {
          map.getCanvas().style.cursor = 'crosshair';

          const feature = e.features?.[0];
          if (!feature) return;

          const lineGeo = feature.geometry as GeoJSON.LineString;
          const lineFeature = turf.feature(lineGeo) as GeoJSON.Feature<GeoJSON.LineString>;

          const snapped = turf.nearestPointOnLine(lineFeature, [e.lngLat.lng, e.lngLat.lat], { units: 'meters' });
          const source = map.getSource('snap-point') as mapboxgl.GeoJSONSource;
          if (source) source.setData(snapped);
          return;
        }

        if (!isSelectingShoreLinesRef.current && !isSelectingStartEndRef.current) {
          return;
        }

        const feature = e.features?.[0];
        if (!feature) return;

        const lineGeo = feature.geometry as GeoJSON.LineString;
        const lineFeature = turf.feature(lineGeo) as GeoJSON.Feature<GeoJSON.LineString>;

        const snapped = turf.nearestPointOnLine(lineFeature, [e.lngLat.lng, e.lngLat.lat], { units: 'meters' });
        const source = map.getSource('snap-point') as mapboxgl.GeoJSONSource;
        if (source) source.setData(snapped);

        map.getCanvas().style.cursor = 'pointer';
      });

      map.on('mouseleave', hitLayers, () => {
        // 框选时不要让 hover 改光标：十字光标被顶回 pointer，用户会以为画不了框
        if (boxSelectModeRef.current) return;
        const source = map.getSource('snap-point') as mapboxgl.GeoJSONSource;
        if (source) source.setData(turf.featureCollection([]));

        map.getCanvas().style.cursor = '';
      });

      map.on('mousemove', crossLineHitLayers, (e) => {
        // 框选时不要让 hover 改光标：十字光标被顶回 pointer，用户会以为画不了框
        if (boxSelectModeRef.current) return;
        if (isSelectingCrossLinesRef.current) {
          map.getCanvas().style.cursor = 'pointer';

          const features = e.features;
          if (features && features.length > 0) {
            const feature = features[0];
            const geometry = feature.geometry as GeoJSON.LineString;
            const coords = geometry.coordinates;

            const ap = getVerticalFootCoordsFromAny(feature.properties);
            const p =
              ap ??
              ([
                (coords[0][0] + coords[1][0]) / 2,
                (coords[0][1] + coords[1][1]) / 2,
              ] as any);
            const midPoint = turf.point(p as any);

            const source = map.getSource('snap-point') as mapboxgl.GeoJSONSource;
            if (source) source.setData(midPoint);
          }
        }
      });

      map.on('mouseleave', crossLineHitLayers, () => {
        // 框选时不要让 hover 改光标：十字光标被顶回 pointer，用户会以为画不了框
        if (boxSelectModeRef.current) return;
        if (isSelectingCrossLinesRef.current) {
          map.getCanvas().style.cursor = '';

          const source = map.getSource('snap-point') as mapboxgl.GeoJSONSource;
          if (source) source.setData(turf.featureCollection([]));
        }
      });
    });

    return () => {
      const c = map.getCenter();
      lastCenterRef.current = { lng: c.lng, lat: c.lat, zoom: map.getZoom() };
      map.remove();
      mapRef.current = null;
    };
  }, [mapStyle]);

  // —— 框选结果同步：bounds / 命中 id / 岸段或断面数据任一变化都要重画 ——
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // 框的颜色跟着用途走：岸段筛选是紫（只是"挑出来看看"），断面删除是红（"要没了"）。
    // 只换颜色、不换图层：两套用途共用同一个 rect source，换色比维护两份图层省事，
    // 也不会出现"两个框同时在图上"的歧义。
    const accent = boxPurpose === 'sections' ? '#ef4444' : '#7c3aed';
    try {
      map.setPaintProperty('box-select-rect-fill', 'fill-color', accent);
      map.setPaintProperty('box-select-rect-line', 'line-color', accent);
    } catch {
      /* 图层还没建好（首次 load 前）：下面 syncBoxSelectionLayers 会在 load 后再画一次 */
    }
    const apply = () => syncBoxSelectionLayers(
      map,
      committedBounds,
      committedBankIds,
      uploadedDataRef.current,
      committedSectionIds,
      perpendicularDataRef.current,
    );
    // 与 uploadedData 的同步同一个套路：setData 之后 isStyleLoaded() 会短暂为 false，
    // 直接调用会丢一次更新（表现为"框画好了但高亮要等下一次才出现"）。
    if (map.isStyleLoaded()) {
      apply();
      return undefined;
    }
    map.once('idle', apply);
    return () => {
      map.off('idle', apply);
    };
  }, [
    boxPurpose,
    props.boxSelectionBounds,
    props.boxSelectionBankIds,
    props.sectionBoxDeleteBounds,
    props.sectionBoxDeleteIds,
    uploadedData,
    perpendicularData,
  ]);

  /**
   * 画框交互。
   *
   * <p>为什么不用 mapbox-gl-draw / mapbox-gl-draw-rectangle：为一个矩形引一个只在框选时
   * 才有用的插件，会把它的样式、模式栈、事件优先级一起带进来（和现有的断面拾取、端点拖拽
   * 打架的概率不低）。这里只需要「按下 → 拖 → 松开」三件事，自己接 DOM 事件更可控。
   *
   * <p>拖拽期间只写 GeoJSON source、不 setState：mousemove 每帧一次 React 渲染，
   * 在几百条岸段的地图上会明显掉帧。松手时才把最终 bounds 交给上层。
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.boxSelectMode) return;

    const container = map.getCanvasContainer();
    const canvas = map.getCanvas();
    const prevCursor = canvas.style.cursor;

    // 拖拽平移 / shift 框选缩放 / 双击缩放 / 拖拽旋转都会和画框抢同一批鼠标事件，
    // 先记下原始开关状态，退出时按原样恢复（断面拖拽结束时会 enable 回来，别把它弄丢）。
    const wasDragPan = map.dragPan.isEnabled();
    const wasBoxZoom = map.boxZoom.isEnabled();
    const wasDragRotate = map.dragRotate.isEnabled();
    const wasDoubleClickZoom = map.doubleClickZoom.isEnabled();
    map.dragPan.disable();
    map.boxZoom.disable();
    map.dragRotate.disable();
    map.doubleClickZoom.disable();
    canvas.style.cursor = 'crosshair';

    let anchor: mapboxgl.LngLat | null = null;
    let anchorPoint: [number, number] | null = null;
    let dragging = false;

    /**
     * 鼠标事件 → 经纬度。
     *
     * <p>不用 `map.mouseEventToLngLat`：mapbox-gl v3 的类型里已经没有它（运行时还在），
     * 直接用会让 `tsc -b` 挂掉。`unproject` 是公开且稳定的 API，配合容器矩形算一下即可 ——
     * 顺便也把"拖到容器外"的情况算对（clientX 可能为负）。
     */
    const toLngLat = (ev: MouseEvent): mapboxgl.LngLat => {
      const rect = container.getBoundingClientRect();
      return map.unproject([ev.clientX - rect.left, ev.clientY - rect.top]);
    };

    const writeRect = (a: mapboxgl.LngLat, b: mapboxgl.LngLat) => {
      const source = map.getSource('box-select-rect') as mapboxgl.GeoJSONSource | undefined;
      if (!source) return;
      const bounds = boxFromCorners([a.lng, a.lat], [b.lng, b.lat]);
      source.setData(
        isValidBox(bounds) ? turf.featureCollection([boxPolygon(bounds)]) : turf.featureCollection([]),
      );
    };

    /** 把图上的临时框擦掉，并恢复"上一次已生效的框"（否则取消一次会顺手把已有结果也抹掉）。 */
    const restoreCommittedBox = () => {
      syncBoxSelectionLayers(
        map,
        boxBoundsRef.current,
        boxBankIdsRef.current,
        uploadedDataRef.current,
        boxSectionIdsRef.current,
        perpendicularDataRef.current,
      );
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      dragging = true;
      anchor = toLngLat(e);
      anchorPoint = [e.clientX, e.clientY];
      writeRect(anchor, anchor);
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging || !anchor) return;
      e.preventDefault();
      writeRect(anchor, toLngLat(e));
    };

    const onMouseUp = (e: MouseEvent) => {
      if (!dragging || !anchor || !anchorPoint) return;
      dragging = false;
      const from = anchor;
      const startPoint = anchorPoint;
      const to = toLngLat(e);
      anchor = null;
      anchorPoint = null;

      // 4px 像素门限：手抖点一下不该产生一个"选中 0 条"的框，也不该把上一条结果清掉
      const dx = Math.abs(e.clientX - startPoint[0]);
      const dy = Math.abs(e.clientY - startPoint[1]);
      if (dx < 4 || dy < 4) {
        restoreCommittedBox();
        onBoxSelectCancelRef.current?.('too-small');
        return;
      }

      const bounds = boxFromCorners([from.lng, from.lat], [to.lng, to.lat]);
      if (!isValidBox(bounds)) {
        restoreCommittedBox();
        onBoxSelectCancelRef.current?.('too-small');
        return;
      }
      writeRect(from, to);
      onBoxSelectDoneRef.current?.(bounds);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      dragging = false;
      anchor = null;
      anchorPoint = null;
      restoreCommittedBox();
      onBoxSelectCancelRef.current?.('escape');
    };

    const onContextMenu = (e: MouseEvent) => {
      // 右键取消：不 preventDefault 的话会弹出浏览器菜单，选择时会打断当前操作
      e.preventDefault();
      e.stopPropagation();
      dragging = false;
      anchor = null;
      anchorPoint = null;
      restoreCommittedBox();
      onBoxSelectCancelRef.current?.('contextmenu');
    };

    container.addEventListener('mousedown', onMouseDown);
    // mousemove / mouseup 挂在 window 上：拖到画布外（甚至拖出窗口）也要能收尾，
    // 只挂 canvas 会出现"拖出去松手，画框状态卡住、地图再也拖不动"。
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown, true);
    container.addEventListener('contextmenu', onContextMenu);

    return () => {
      container.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown, true);
      container.removeEventListener('contextmenu', onContextMenu);
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
  }, [props.boxSelectMode, mapStyle]);


  return (
    <>
      <div ref={mapContainer} className="map-full" />
      {/* 画框提示条：只在"等用户拖框"时出现，Esc / 右键都能退，先把退路写给用户。
          框选删除比框选岸段更危险，配色与文案都单独区分，避免看错当前在做什么。 */}
      {props.boxSelectMode && (
        <div
          className={`map-box-select-hint${boxPurpose === 'sections' ? ' is-danger' : ''}`}
          data-tour="map-box-select-hint"
        >
          {boxPurpose === 'sections'
            ? '按住鼠标拖出矩形：框内的断面将被删除 · Esc 或右键取消'
            : '按住鼠标拖出矩形框选岸段 · Esc 或右键取消'}
        </div>
      )}
    </>
  );
}

export default EditorMap;
