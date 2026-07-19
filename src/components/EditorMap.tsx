import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import * as turf from '@turf/turf';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { SelectionGroup } from '../types/selection';
import { getVerticalFootCoordsFromAny } from '../utils/verticalFootPoint';

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
  createCrossLineByEndpoints: (start: number[], end: number[]) => void;
  tiffBoundsData: GeoJSON.FeatureCollection | null;
  showTiffBounds: boolean;
  resizeTrigger: number;
  satellite?: boolean;
  colorBanks?: boolean;
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
    resizeTrigger,
  } = props;

  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  const perpendicularDataRef = useRef<GeoJSON.FeatureCollection | null>(perpendicularData);
  useEffect(() => {
    perpendicularDataRef.current = perpendicularData;
  }, [perpendicularData]);

  const uploadedDataRef = useRef<GeoJSON.FeatureCollection | null>(uploadedData);
  const tiffBoundsDataRef = useRef<GeoJSON.FeatureCollection | null>(tiffBoundsData);
  useEffect(() => { uploadedDataRef.current = uploadedData; }, [uploadedData]);
  useEffect(() => { tiffBoundsDataRef.current = tiffBoundsData; }, [tiffBoundsData]);

  const groupsRef = useRef<SelectionGroup[]>(groups);
  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  const isSelectingShoreLinesRef = useRef(isSelectingShoreLines);
  useEffect(() => {
    isSelectingShoreLinesRef.current = isSelectingShoreLines;
  }, [isSelectingShoreLines]);

  const isFixingShoreLineReversedRef = useRef(isFixingShoreLineReversed);
  useEffect(() => {
    isFixingShoreLineReversedRef.current = isFixingShoreLineReversed;
  }, [isFixingShoreLineReversed]);

  const onFixSelectedShoreLineReversedRef = useRef(onFixSelectedShoreLineReversed);
  useEffect(() => {
    onFixSelectedShoreLineReversedRef.current = onFixSelectedShoreLineReversed;
  }, [onFixSelectedShoreLineReversed]);

  const isSelectingStartEndRef = useRef(isSelectingStartEnd);
  useEffect(() => {
    isSelectingStartEndRef.current = isSelectingStartEnd;
  }, [isSelectingStartEnd]);

  const isSelectingCrossLinesRef = useRef(isSelectingCrossLines);
  useEffect(() => {
    isSelectingCrossLinesRef.current = isSelectingCrossLines;
  }, [isSelectingCrossLines]);

  // 记录上一次上传数据要素数量，用于判断是否为“首次加载”以决定是否 fitBounds
  const prevUploadedCountRef = useRef<number>(0);

  const crossLineControlModeRef = useRef<'shoreline' | 'free'>(crossLineControlMode);
  useEffect(() => {
    crossLineControlModeRef.current = crossLineControlMode;
  }, [crossLineControlMode]);

  const crossLineEditModeRef = useRef<'none' | 'select' | 'add'>(crossLineEditMode);
  useEffect(() => {
    crossLineEditModeRef.current = crossLineEditMode;
  }, [crossLineEditMode]);

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
  useEffect(() => {
    selectedCrossLineIndexRef.current = selectedCrossLineIndex;
  }, [selectedCrossLineIndex]);

  const selectedCrossLineIndicesRef = useRef<Set<number>>(selectedCrossLineIndices);
  useEffect(() => {
    selectedCrossLineIndicesRef.current = selectedCrossLineIndices;
  }, [selectedCrossLineIndices]);

  const configRef = useRef({ interval: globalInterval, length: globalLength });
  const lastCenterRef = useRef({ lng: 119.896, lat: 32.229, zoom: 7 });
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
    } else {
      map.once('idle', updateMapSources);
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
    if (!map || !map.isStyleLoaded()) return;
    map.setLayoutProperty('tiff-bounds-fill', 'visibility', showTiffBounds ? 'visible' : 'none');
    map.setLayoutProperty('tiff-bounds-line', 'visibility', showTiffBounds ? 'visible' : 'none');
  }, [showTiffBounds]);

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
    } else {
      map.once('idle', updateSource);
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
    } else {
      map.once('idle', updateSelectedLines);
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
    } else {
      map.once('idle', updateMapSources);
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
    } else {
      map.once('idle', updateSelectedCrossLine);
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

  let mapStyle = 'mapbox://styles/mapbox/light-v10';
  if (props.satellite) mapStyle = 'mapbox://styles/mapbox/satellite-v9';

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

    map.on('load', () => {
      map.addSource('perpendicular-lines', { type: 'geojson', data: turf.featureCollection([]) });
      map.addSource('perpendicular-arrows', { type: 'geojson', data: turf.featureCollection([]) });
      map.addSource('uploaded-data', { type: 'geojson', data: turf.featureCollection([]) });
      map.addSource('selection-points', { type: 'geojson', data: turf.featureCollection([]) });
      map.addSource('snap-point', { type: 'geojson', data: turf.featureCollection([]) });
      map.addSource('active-line', { type: 'geojson', data: turf.featureCollection([]), lineMetrics: true });
      map.addSource('selected-shore-lines', { type: 'geojson', data: turf.featureCollection([]) });
      map.addSource('tiff-bounds', { type: 'geojson', data: turf.featureCollection([]) });
      // 如果已有数据，立刻恢复
      if (tiffBoundsDataRef.current) {
        const src = map.getSource('tiff-bounds') as mapboxgl.GeoJSONSource;
        if (src) src.setData(tiffBoundsDataRef.current);
      }
      if (uploadedDataRef.current) {
        const src = map.getSource('uploaded-data') as mapboxgl.GeoJSONSource;
        if (src) src.setData(uploadedDataRef.current);
      }
      if (perpendicularDataRef.current) {
        const src = map.getSource('perpendicular-lines') as mapboxgl.GeoJSONSource;
        if (src) src.setData(perpendicularDataRef.current);
      }

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

      map.addLayer({
        id: 'perpendicular-arrows-layer',
        type: 'symbol',
        source: 'perpendicular-arrows',
        layout: {
          'text-field': '▶',
          'text-size': 20,
          'text-rotate': ['get', 'iconRotate'],
          'text-rotation-alignment': 'map',
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': buildValidationColorExpression(),
          'text-halo-color': '#ffffff',
          'text-halo-width': 2,
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

      const hitLayers = ['uploaded-lines-hit-target'];
      const crossLineHitLayers = ['perpendicular-lines-hit-target'];

      const freeAddStartRef: { current: number[] | null } = { current: null };

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
          detailHtml.push(
            `<p style="margin:4px 0 0; font-size:12px; color:#64748b;">上次请求失败: ${escapeHtml(error)}</p>`,
          );
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
            rafId: number | null;
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
      };

      const scheduleDragRender = (ds: NonNullable<typeof dragState>) => {
        if (ds.rafId !== null) return;
        ds.rafId = window.requestAnimationFrame(() => {
          const active = dragState;
          if (!active) return;
          active.rafId = null;
          const pending = active.pendingDelta;
          if (!pending) return;
          active.pendingDelta = null;
          applyDragFrame(active, pending.dx, pending.dy);

          // 如果在本帧渲染时又积累了新的 delta，继续排队下一帧
          if (active.pendingDelta) {
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
        scheduleDragRender(ds);
      };

      const endDrag = () => {
        const ds = dragState;
        if (!ds) return;

        // 确保最后一次鼠标位置能落盘到地图上
        if (ds.pendingDelta) {
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
        dragState = null;
      };

      map.on('mousedown', 'perpendicular-lines-hit-target', (e) => {
        if (!isSelectingCrossLinesRef.current) return;
        if (crossLineControlModeRef.current !== 'free') return;
        if (crossLineEditModeRef.current !== 'select') return;

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
          rafId: null,
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
              const clicked = [e.lngLat.lng, e.lngLat.lat] as number[];
              if (!freeAddStartRef.current) {
                freeAddStartRef.current = clicked;
                const source = map.getSource('snap-point') as mapboxgl.GeoJSONSource;
                if (source) source.setData(turf.point(clicked));
                console.log('自由模式：已选择断面起点');
              } else {
                const start = freeAddStartRef.current;
                freeAddStartRef.current = null;
                const source = map.getSource('snap-point') as mapboxgl.GeoJSONSource;
                if (source) source.setData(turf.featureCollection([]));
                console.log('自由模式：已选择断面终点，开始创建断面');
                createCrossLineByEndpointsRef.current(start, clicked);
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

      map.on('mousemove', crossLineHitLayers, (e) => {
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
        const source = map.getSource('snap-point') as mapboxgl.GeoJSONSource;
        if (source) source.setData(turf.featureCollection([]));

        map.getCanvas().style.cursor = '';
      });

      map.on('mousemove', crossLineHitLayers, (e) => {
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

  return <div ref={mapContainer} className="map-full" />;
}

export default EditorMap;
