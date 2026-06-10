import * as turf from '@turf/turf';
import type { Dispatch, SetStateAction } from 'react';
import type { SectionParams } from '../../types/sections';
import { ensureDefaultBasicParams } from '../../services/basicParamsService';
import { fetchSectionParams } from './sectionApi';
import { getCurrentTaskId } from './taskState';
import {
  coordsToVerticalFootPoint,
  getVerticalFootCoordsFromAny,
} from '../../utils/verticalFootPoint';

export type CrossLineControlMode = 'shoreline' | 'free';

export async function reverseSelectedCrossLineAction(params: {
  selectedCrossLineIndex: number | null;
  perpendicularData: GeoJSON.FeatureCollection | null;
  setPerpendicularData: (v: GeoJSON.FeatureCollection | null) => void;
}) {
  const { selectedCrossLineIndex, perpendicularData, setPerpendicularData } = params;

  if (selectedCrossLineIndex === null || !perpendicularData) {
    alert('请先选择要反转的断面');
    return;
  }

  const selectedLine = perpendicularData.features[selectedCrossLineIndex];
  if (!selectedLine || selectedLine.geometry.type !== 'LineString') return;

  const coords = selectedLine.geometry.coordinates as number[][];
  const newCoords = [...coords].reverse();

  const newGeometry: GeoJSON.LineString = {
    type: 'LineString',
    coordinates: newCoords,
  };

  const sectionId = (selectedLine.properties as any)?.sectionId;

  if (!sectionId) {
    const updatedFeatures = [...perpendicularData.features];
    updatedFeatures[selectedCrossLineIndex] = {
      ...selectedLine,
      geometry: newGeometry,
      properties: {
        ...selectedLine.properties,
        leftPoint: (selectedLine.properties as any)?.rightPoint,
        rightPoint: (selectedLine.properties as any)?.leftPoint,
      },
    };
    setPerpendicularData(turf.featureCollection(updatedFeatures as GeoJSON.Feature<GeoJSON.LineString>[]));
    console.log('已在前端反转断面（未同步到后端）');
    return;
  }

  try {
    const response = await fetch(`/v0/bank/sections/${sectionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reverse: true }),
    });

    if (!response.ok) {
      throw new Error(`反转断面失败: ${response.statusText}`);
    }

    const updatedFeatures = [...perpendicularData.features];
    updatedFeatures[selectedCrossLineIndex] = {
      ...selectedLine,
      geometry: newGeometry,
      properties: {
        ...selectedLine.properties,
        leftPoint: (selectedLine.properties as any)?.rightPoint,
        rightPoint: (selectedLine.properties as any)?.leftPoint,
      },
    };
    setPerpendicularData(turf.featureCollection(updatedFeatures as GeoJSON.Feature<GeoJSON.LineString>[]));
    console.log(`已在后端反转断面: ${sectionId}`);
  } catch (err: any) {
    console.error('反转断面失败:', err);
    alert(`反转断面失败: ${err.message}`);
  }
}

export async function reverseCrossLinesInGroupAction(params: {
  group: { id: string; line: GeoJSON.Feature<GeoJSON.LineString>; start: number; end: number | null; length: number };
  perpendicularData: GeoJSON.FeatureCollection | null;
  globalLength: number;
  setPerpendicularData: (v: GeoJSON.FeatureCollection | null) => void;
}) {
  const { group, perpendicularData, globalLength, setPerpendicularData } = params;

  if (group.end === null) {
    alert('该段落尚未选择终点，无法反切');
    return;
  }

  if (!perpendicularData || perpendicularData.features.length === 0) {
    alert('当前没有断面可反切');
    return;
  }

  const start = Math.min(group.start, group.end);
  const end = Math.max(group.start, group.end);
  const distanceThreshold = Math.max(globalLength, group.length) / 2 + 100;

  const updatedFeatures = [...perpendicularData.features] as GeoJSON.Feature<GeoJSON.Geometry>[];
  const reversedIndices: number[] = [];

  updatedFeatures.forEach((feature, index) => {
    if (feature.geometry.type !== 'LineString') return;
    const coords = (feature.geometry.coordinates as number[][]) || [];
    if (coords.length < 2) return;

    const first = coords[0];
    const last = coords[coords.length - 1];
    const anchorPoint = getVerticalFootCoordsFromAny(feature.properties) ?? undefined;
    const p =
      Array.isArray(anchorPoint) && anchorPoint.length >= 2
        ? anchorPoint
        : [(first[0] + last[0]) / 2, (first[1] + last[1]) / 2];
    const mid = turf.point(p as any);

    try {
      const snapped = turf.nearestPointOnLine(group.line, mid, { units: 'meters' });
      const actualDist = snapped.properties.location ?? 0;
      const distToLine = turf.distance(mid, snapped, { units: 'meters' });

      if (distToLine > distanceThreshold) return;
      if (actualDist < start || actualDist > end) return;

      const reversedCoords = [...coords].reverse();
      const nextProps: any = { ...(feature.properties as any) };

      if (nextProps.leftPoint && nextProps.rightPoint) {
        const oldLeft = nextProps.leftPoint;
        nextProps.leftPoint = nextProps.rightPoint;
        nextProps.rightPoint = oldLeft;
      }

      updatedFeatures[index] = {
        ...feature,
        geometry: {
          type: 'LineString',
          coordinates: reversedCoords,
        },
        properties: nextProps,
      } as any;

      reversedIndices.push(index);
    } catch {
      // ignore matching failures
    }
  });

  if (reversedIndices.length === 0) {
    alert('在该段落范围内未找到可反切的断面');
    return;
  }

  setPerpendicularData(turf.featureCollection(updatedFeatures as any));

  const sectionsToSync = reversedIndices
    .map((idx) => {
      const f: any = updatedFeatures[idx];
      return f?.properties?.sectionId as string | undefined;
    })
    .filter(Boolean) as string[];

  if (sectionsToSync.length === 0) {
    alert(`已反切 ${reversedIndices.length} 条断面（未同步到后端）`);
    return;
  }

  const results = await Promise.allSettled(
    sectionsToSync.map((sectionId) =>
      fetch(`/v0/bank/sections/${sectionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reverse: true }),
      }).then((res) => {
        if (!res.ok) throw new Error(res.statusText);
        return true;
      }),
    ),
  );

  const successCount = results.filter((r) => r.status === 'fulfilled').length;
  const failedCount = results.length - successCount;

  if (failedCount > 0) {
    alert(`已反切 ${reversedIndices.length} 条断面；后端同步成功 ${successCount}，失败 ${failedCount}`);
  } else {
    alert(`已反切 ${reversedIndices.length} 条断面（已同步到后端）`);
  }
}

export async function deleteCrossLinesInGroupAction(params: {
  group: { id: string; line: GeoJSON.Feature<GeoJSON.LineString>; start: number; end: number | null; length: number };
  perpendicularData: GeoJSON.FeatureCollection | null;
  globalLength: number;
  setPerpendicularData: (v: GeoJSON.FeatureCollection | null) => void;
  setSelectedCrossLineIndex?: (v: number | null) => void;
}) {
  const { group, perpendicularData, globalLength, setPerpendicularData, setSelectedCrossLineIndex } = params;

  if (group.end === null) {
    alert('该段落尚未选择终点，无法删除段内断面');
    return;
  }

  if (!perpendicularData || perpendicularData.features.length === 0) {
    alert('当前没有断面可删除');
    return;
  }

  const start = Math.min(group.start, group.end);
  const end = Math.max(group.start, group.end);
  const distanceThreshold = Math.max(globalLength, group.length) / 2 + 100;

  const indicesToDelete: number[] = [];
  const features = perpendicularData.features as GeoJSON.Feature<GeoJSON.Geometry>[];

  features.forEach((feature, index) => {
    if (feature.geometry.type !== 'LineString') return;
    const coords = (feature.geometry.coordinates as number[][]) || [];
    if (coords.length < 2) return;

    const first = coords[0];
    const last = coords[coords.length - 1];
    const anchorPoint = getVerticalFootCoordsFromAny(feature.properties) ?? undefined;
    const p =
      Array.isArray(anchorPoint) && anchorPoint.length >= 2
        ? anchorPoint
        : [(first[0] + last[0]) / 2, (first[1] + last[1]) / 2];
    const mid = turf.point(p as any);

    try {
      const snapped = turf.nearestPointOnLine(group.line, mid, { units: 'meters' });
      const actualDist = snapped.properties.location ?? 0;
      const distToLine = turf.distance(mid, snapped, { units: 'meters' });

      if (distToLine > distanceThreshold) return;
      if (actualDist < start || actualDist > end) return;

      indicesToDelete.push(index);
    } catch {
      // ignore matching failures
    }
  });

  if (indicesToDelete.length === 0) {
    alert('在该段落范围内未找到可删除的断面');
    return;
  }

  const ok = window.confirm(`确认删除该段落范围内的 ${indicesToDelete.length} 条断面？`);
  if (!ok) return;

  const deletedFeatures = indicesToDelete.map((idx) => features[idx]);

  const remaining = features.filter((_, idx) => !indicesToDelete.includes(idx)) as any[];
  remaining.forEach((f, idx) => {
    if (f?.properties) {
      (f.properties as any).crossLineId = idx;
    }
  });

  setPerpendicularData(turf.featureCollection(remaining as any));
  if (setSelectedCrossLineIndex) setSelectedCrossLineIndex(null);

  const sectionIdsToDelete = deletedFeatures
    .map((f: any) => {
      const p = f?.properties || {};
      return (p.sectionId ?? p.section_id ?? p.id) as string | undefined;
    })
    .filter(Boolean) as string[];

  if (sectionIdsToDelete.length === 0) {
    alert(`已删除 ${indicesToDelete.length} 条断面（未同步到后端）`);
    return;
  }

  const results = await Promise.allSettled(
    sectionIdsToDelete.map((sectionId) =>
      fetch(`/v0/bank/sections/${sectionId}`, {
        method: 'DELETE',
      }).then((res) => {
        if (!res.ok) throw new Error(res.statusText);
        return true;
      }),
    ),
  );

  const successCount = results.filter((r) => r.status === 'fulfilled').length;
  const failedCount = results.length - successCount;

  if (failedCount > 0) {
    alert(`已删除 ${indicesToDelete.length} 条断面；后端同步成功 ${successCount}，失败 ${failedCount}`);
  } else {
    alert(`已删除 ${indicesToDelete.length} 条断面（已同步到后端）`);
  }
}

export async function createCrossLineAtPointAction(params: {
  line: GeoJSON.Feature<GeoJSON.LineString>;
  distanceOnLine: number;
  globalLength: number;
  perpendicularData: GeoJSON.FeatureCollection | null;
  globalProperties: SectionParams | null;
  setGlobalProperties: (v: SectionParams | null) => void;
  setPerpendicularData: Dispatch<SetStateAction<GeoJSON.FeatureCollection | null>>;
}) {
  const {
    line,
    distanceOnLine,
    globalLength,
    perpendicularData,
    globalProperties,
    setGlobalProperties,
    setPerpendicularData,
  } = params;

  const taskId = getCurrentTaskId();
  if (!taskId) {
    alert('未找到任务ID，请先创建任务');
    return;
  }

  const basicParamId = await ensureDefaultBasicParams();
  if (!basicParamId) {
    alert('获取默认参数失败');
    return;
  }

  const pointOnLine = turf.along(line, distanceOnLine, { units: 'meters' });
  const anchorCoords = pointOnLine.geometry.coordinates as number[];
  const verticalFootPoint = coordsToVerticalFootPoint(anchorCoords);
  const lineLength = turf.length(line, { units: 'meters' });
  const nextDist = Math.min(distanceOnLine + 0.1, lineLength);
  const nextPoint = turf.along(line, nextDist, { units: 'meters' });

  let bearing = 0;
  if (distanceOnLine >= lineLength - 0.1) {
    const prevPoint = turf.along(line, Math.max(0, distanceOnLine - 0.1), { units: 'meters' });
    bearing = turf.bearing(prevPoint, pointOnLine);
  } else {
    bearing = turf.bearing(pointOnLine, nextPoint);
  }

  const currentLength = globalLength;
  const leftEnd = turf.destination(pointOnLine, currentLength / 2, bearing - 90, { units: 'meters' });
  const rightEnd = turf.destination(pointOnLine, currentLength / 2, bearing + 90, { units: 'meters' });

  const leftCoords = leftEnd.geometry.coordinates;
  const rightCoords = rightEnd.geometry.coordinates;

  const parentIndex = (line.properties as any)?.index;
  const parentId =
    (line.properties as any)?.bank_id || (line.properties as any)?.bankId || (parentIndex !== undefined ? `line-${parentIndex}` : undefined);

  const newGeometry: GeoJSON.LineString = {
    type: 'LineString',
    coordinates: [leftCoords, rightCoords],
  };

  try {
    const sectionId = `sec-${taskId}-new-${Date.now()}`;
    const newSectionIndex = perpendicularData ? perpendicularData.features.length : 0;

    const sectionsPayload = {
      task_id: taskId,
      sections: [
        {
          section_id: sectionId,
          section_name: `新建断面${newSectionIndex + 1}`,
          distance: distanceOnLine,
          bank_id: parentId || 'line-0',
          region_code: 'Mzs',
          segment_index: newSectionIndex,
          geometry: newGeometry,
          section_geometry: newGeometry,
          ...(verticalFootPoint ? { vertical_foot_point: verticalFootPoint } : {}),
          basic_param_id: basicParamId,
        },
      ],
      inherit_from_basic_param: true,
      overwrite: false,
    };

    const response = await fetch('/v0/bank/sections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sectionsPayload),
    });

    if (!response.ok) {
      throw new Error(`创建断面失败: ${response.statusText}`);
    }

    const result = await response.json();
    console.log('断面创建成功:', result);

    if (result.success && result.sections && result.sections.length > 0) {
      const createdSection = result.sections[0];
      const fetched = await fetchSectionParams(createdSection.section_id);
      if (fetched) {
        console.log('获取到断面参数:', fetched);
        if (!globalProperties) {
          setGlobalProperties(fetched);
        }
      }
    }

    setPerpendicularData((prev) => {
      const existing = prev ? (prev.features as GeoJSON.Feature<GeoJSON.LineString>[]) : [];
      const newCrossLineId = existing.length;

      const newCrossLine: GeoJSON.Feature<GeoJSON.LineString> = {
        type: 'Feature',
        properties: {
          sectionId,
          crossLineId: newCrossLineId,
          distance: distanceOnLine,
          shoreLineIndex: parentIndex,
          shoreLineId: parentId,
          ...(verticalFootPoint ? { vertical_foot_point: verticalFootPoint } : {}),
          leftPoint: leftCoords,
          rightPoint: rightCoords,
        },
        geometry: newGeometry,
      };

      const newFeatures = [...existing, newCrossLine];
      console.log(
        `新建断面 #${newCrossLineId + 1}，位置: ${distanceOnLine.toFixed(2)}m，当前总数: ${newFeatures.length}`,
      );
      return turf.featureCollection(newFeatures);
    });
  } catch (err: any) {
    console.error('新建断面失败:', err);
    alert(`新建断面失败: ${err.message}`);
  }
}

export async function deleteSelectedCrossLineAction(params: {
  selectedCrossLineIndex: number | null;
  perpendicularData: GeoJSON.FeatureCollection | null;
  setPerpendicularData: (v: GeoJSON.FeatureCollection | null) => void;
  setSelectedCrossLineIndex: (v: number | null) => void;
}) {
  const { selectedCrossLineIndex, perpendicularData, setPerpendicularData, setSelectedCrossLineIndex } = params;

  if (selectedCrossLineIndex === null || !perpendicularData) {
    alert('请先选择要删除的断面');
    return;
  }

  const features = perpendicularData.features as GeoJSON.Feature<GeoJSON.LineString>[];
  const selectedFeature = features[selectedCrossLineIndex];
  const sectionId = (selectedFeature.properties as any)?.sectionId;

  if (!sectionId) {
    const updatedFeatures = perpendicularData.features.filter((_, index) => index !== selectedCrossLineIndex);
    updatedFeatures.forEach((feature, index) => {
      if (feature.properties) {
        (feature.properties as any).crossLineId = index;
      }
    });
    setPerpendicularData(turf.featureCollection(updatedFeatures));
    setSelectedCrossLineIndex(null);
    console.log('已删除未同步断面');
    alert('已删除选中的断面');
    return;
  }

  try {
    const response = await fetch(`/v0/bank/sections/${sectionId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error(`删除断面失败: ${response.statusText}`);
    }

    const updatedFeatures = perpendicularData.features.filter((_, index) => index !== selectedCrossLineIndex);
    updatedFeatures.forEach((feature, index) => {
      if (feature.properties) {
        (feature.properties as any).crossLineId = index;
      }
    });
    setPerpendicularData(turf.featureCollection(updatedFeatures));
    setSelectedCrossLineIndex(null);
    console.log(`已从后端删除断面: ${sectionId}`);
    alert('已删除选中的断面');
  } catch (err: any) {
    console.error('删除断面失败:', err);
    alert(`删除断面失败: ${err.message}`);
  }
}

export async function deleteSelectedCrossLinesAction(params: {
  selectedCrossLineIndices: number[];
  perpendicularData: GeoJSON.FeatureCollection | null;
  setPerpendicularData: (v: GeoJSON.FeatureCollection | null) => void;
  setSelectedCrossLineIndex: (v: number | null) => void;
}) {
  const { selectedCrossLineIndices, perpendicularData, setPerpendicularData, setSelectedCrossLineIndex } = params;

  if (!perpendicularData || !Array.isArray(perpendicularData.features) || perpendicularData.features.length === 0) {
    alert('当前没有断面可删除');
    return;
  }

  const max = perpendicularData.features.length;
  const unique = Array.from(new Set(selectedCrossLineIndices))
    .filter((i) => Number.isFinite(i) && i >= 0 && i < max)
    .sort((a, b) => b - a);

  if (unique.length === 0) {
    alert('请先选择要删除的断面');
    return;
  }

  const ok = window.confirm(`确认删除选中的 ${unique.length} 条断面？`);
  if (!ok) return;

  const toDelete = new Set(unique);
  const features = perpendicularData.features as GeoJSON.Feature<GeoJSON.Geometry>[];
  const deletedFeatures = unique.map((idx) => features[idx]).filter(Boolean) as any[];

  // 先更新前端（删除后索引会重排）
  const remaining = features.filter((_, idx) => !toDelete.has(idx)) as any[];
  remaining.forEach((f, idx) => {
    if (f?.properties) (f.properties as any).crossLineId = idx;
  });
  setPerpendicularData(turf.featureCollection(remaining as any));
  setSelectedCrossLineIndex(null);

  // 再同步后端（仅删除有 sectionId 的）
  const sectionIds = deletedFeatures
    .map((f) => {
      const p = f?.properties || {};
      return (p.sectionId ?? p.section_id ?? p.id) as string | undefined;
    })
    .filter(Boolean)
    .map((s) => String(s));

  if (sectionIds.length === 0) {
    alert(`已删除 ${unique.length} 条断面（未同步到后端）`);
    return;
  }

  const results = await Promise.allSettled(
    sectionIds.map((sectionId) =>
      fetch(`/v0/bank/sections/${encodeURIComponent(sectionId)}`, {
        method: 'DELETE',
      }).then((res) => {
        if (!res.ok) throw new Error(res.statusText);
        return true;
      }),
    ),
  );

  const failCount = results.filter((r) => r.status === 'rejected').length;
  if (failCount > 0) {
    alert(`已删除 ${unique.length} 条断面；后端同步成功 ${sectionIds.length - failCount}，失败 ${failCount}`);
  } else {
    alert(`已删除 ${unique.length} 条断面（已同步到后端）`);
  }
}

export async function translateSelectedCrossLineAction(params: {
  offsetMeters: number;
  selectedCrossLineIndex: number | null;
  perpendicularData: GeoJSON.FeatureCollection | null;
  uploadedData: GeoJSON.FeatureCollection | null;
  setPerpendicularData: (v: GeoJSON.FeatureCollection | null) => void;
}) {
  const { offsetMeters, selectedCrossLineIndex, perpendicularData, uploadedData, setPerpendicularData } = params;

  if (selectedCrossLineIndex === null || !perpendicularData) {
    alert('请先选择要平移的断面');
    return;
  }

  const selectedLine = perpendicularData.features[selectedCrossLineIndex];
  if (!selectedLine || selectedLine.geometry.type !== 'LineString') return;

  const coords = selectedLine.geometry.coordinates as number[][];
  const leftPoint = coords[0];
  const rightPoint = coords[1];

  const currentDistance = (selectedLine.properties as any)?.distance;
  const shoreLineIndex = (selectedLine.properties as any)?.shoreLineIndex;

  if (currentDistance === undefined || shoreLineIndex === undefined || !uploadedData) {
    alert('无法获取断面对应的岸线信息，平移操作暂不可用');
    return;
  }

  const shoreLine = uploadedData.features[shoreLineIndex] as GeoJSON.Feature<GeoJSON.LineString>;
  if (!shoreLine || shoreLine.geometry.type !== 'LineString') return;

  const shoreLineLength = turf.length(shoreLine, { units: 'meters' });
  const newDistance = Math.max(0, Math.min(shoreLineLength, currentDistance + offsetMeters));

  const pointOnLine = turf.along(shoreLine, newDistance, { units: 'meters' });
  const nextDist = Math.min(newDistance + 0.1, shoreLineLength);
  const nextPoint = turf.along(shoreLine, nextDist, { units: 'meters' });

  let bearing = 0;
  if (newDistance >= shoreLineLength - 0.1) {
    const prevPoint = turf.along(shoreLine, Math.max(0, newDistance - 0.1), { units: 'meters' });
    bearing = turf.bearing(prevPoint, pointOnLine);
  } else {
    bearing = turf.bearing(pointOnLine, nextPoint);
  }

  const currentTotalLength = turf.distance(turf.point(leftPoint), turf.point(rightPoint), { units: 'meters' });
  const halfLength = currentTotalLength / 2;

  const newLeftPoint = turf.destination(pointOnLine, halfLength, bearing - 90, { units: 'meters' });
  const newRightPoint = turf.destination(pointOnLine, halfLength, bearing + 90, { units: 'meters' });

  const newGeometry: GeoJSON.LineString = {
    type: 'LineString',
    coordinates: [newLeftPoint.geometry.coordinates, newRightPoint.geometry.coordinates],
  };

  const sectionId = (selectedLine.properties as any)?.sectionId;

  if (!sectionId) {
    const updatedFeatures = [...perpendicularData.features];
    updatedFeatures[selectedCrossLineIndex] = {
      ...selectedLine,
      geometry: newGeometry,
      properties: {
        ...selectedLine.properties,
        distance: newDistance,
        crossLineId: (selectedLine.properties as any)?.crossLineId ?? selectedCrossLineIndex,
        leftPoint: newLeftPoint.geometry.coordinates,
        rightPoint: newRightPoint.geometry.coordinates,
      },
    };
    setPerpendicularData(turf.featureCollection(updatedFeatures as GeoJSON.Feature<GeoJSON.LineString>[]));
    console.log('已平移未同步断面');
    return;
  }

  try {
    const response = await fetch(`/v0/bank/sections/${sectionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        distance: newDistance,
        geometry: newGeometry,
        section_geometry: newGeometry,
      }),
    });

    if (!response.ok) {
      throw new Error(`更新断面几何失败: ${response.statusText}`);
    }

    const updatedFeatures = [...perpendicularData.features];
    updatedFeatures[selectedCrossLineIndex] = {
      ...selectedLine,
      geometry: newGeometry,
      properties: {
        ...selectedLine.properties,
        distance: newDistance,
        crossLineId: (selectedLine.properties as any)?.crossLineId ?? selectedCrossLineIndex,
        leftPoint: newLeftPoint.geometry.coordinates,
        rightPoint: newRightPoint.geometry.coordinates,
      },
    };
    setPerpendicularData(turf.featureCollection(updatedFeatures as GeoJSON.Feature<GeoJSON.LineString>[]));
    console.log(`已更新后端断面几何: ${sectionId}`);
  } catch (err: any) {
    console.error('平移断面失败:', err);
    alert(`平移断面失败: ${err.message}`);
  }
}

export async function configureSelectedCrossLinePropertiesAction(params: {
  selectedCrossLineIndex: number | null;
  perpendicularData: GeoJSON.FeatureCollection | null;
  setEditingPropertiesGroupId: (v: string | null) => void;
}) {
  const { selectedCrossLineIndex, perpendicularData, setEditingPropertiesGroupId } = params;

  if (selectedCrossLineIndex === null || !perpendicularData) {
    alert('请先选择要配置的断面');
    return;
  }

  const selectedLine = perpendicularData.features[selectedCrossLineIndex];
  const sectionId = (selectedLine.properties as any)?.sectionId;

  if (!sectionId) {
    alert('未找到断面ID，请先重新生成断面');
    return;
  }

  try {
    const response = await fetch(`/v0/bank/sections/${sectionId}`);
    if (!response.ok) {
      throw new Error(`获取断面参数失败: ${response.statusText}`);
    }

    const data = await response.json();
    if (data.success && data.section) {
      const backendParams = data.section;
      (selectedLine.properties as any).backendParams = backendParams;
      setEditingPropertiesGroupId(`cross-line-${selectedCrossLineIndex}`);
    }
  } catch (err: any) {
    console.error('获取断面参数失败:', err);
    alert(`获取断面参数失败: ${err.message}`);
  }
}

export async function persistCrossLineGeometryAction(params: {
  sectionId: string | undefined;
  geometry: GeoJSON.LineString;
  silent?: boolean;
}) {
  const { sectionId, geometry, silent } = params;

  if (!sectionId) {
    if (!silent) {
      console.log('断面无 sectionId，仅更新前端几何（未同步后端）');
    }
    return;
  }

  try {
    const response = await fetch(`/v0/bank/sections/${sectionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        geometry,
        section_geometry: geometry,
      }),
    });

    if (!response.ok) {
      throw new Error(`更新断面几何失败: ${response.statusText}`);
    }
  } catch (err: any) {
    console.error('同步断面几何到后端失败:', err);
    alert(`同步断面几何到后端失败: ${err.message}`);
  }
}

export function rotateCrossLineGeometry(params: {
  geometry: GeoJSON.LineString;
  angleDegrees: number;
}): GeoJSON.LineString {
  const { geometry, angleDegrees } = params;
  const coords = geometry.coordinates as number[][];
  if (!coords || coords.length < 2) return geometry;

  const left = coords[0];
  const right = coords[coords.length - 1];
  const mid = turf.midpoint(turf.point(left), turf.point(right));

  const distLeft = turf.distance(mid, turf.point(left), { units: 'meters' });
  const distRight = turf.distance(mid, turf.point(right), { units: 'meters' });
  const bearingLeft = turf.bearing(mid, turf.point(left));
  const bearingRight = turf.bearing(mid, turf.point(right));

  const newLeft = turf.destination(mid, distLeft, bearingLeft + angleDegrees, { units: 'meters' }).geometry.coordinates;
  const newRight = turf.destination(mid, distRight, bearingRight + angleDegrees, { units: 'meters' }).geometry.coordinates;

  return {
    type: 'LineString',
    coordinates: [newLeft, newRight],
  };
}

export function scaleCrossLineGeometry(params: {
  geometry: GeoJSON.LineString;
  deltaMeters: number;
  minLengthMeters?: number;
}): GeoJSON.LineString {
  const { geometry, deltaMeters, minLengthMeters = 1 } = params;
  const coords = geometry.coordinates as number[][];
  if (!coords || coords.length < 2) return geometry;

  const left = coords[0];
  const right = coords[coords.length - 1];
  const mid = turf.midpoint(turf.point(left), turf.point(right));

  const currentLen = turf.distance(turf.point(left), turf.point(right), { units: 'meters' });
  const nextLen = Math.max(minLengthMeters, currentLen + deltaMeters);
  const half = nextLen / 2;

  const bearingToLeft = turf.bearing(mid, turf.point(left));
  const newLeft = turf.destination(mid, half, bearingToLeft, { units: 'meters' }).geometry.coordinates;
  const newRight = turf.destination(mid, half, bearingToLeft + 180, { units: 'meters' }).geometry.coordinates;

  return {
    type: 'LineString',
    coordinates: [newLeft, newRight],
  };
}

export async function createCrossLineByEndpointsAction(params: {
  start: number[];
  end: number[];
  uploadedData: GeoJSON.FeatureCollection | null;
  perpendicularData: GeoJSON.FeatureCollection | null;
  setPerpendicularData: Dispatch<SetStateAction<GeoJSON.FeatureCollection | null>>;
}) {
  const { start, end, uploadedData, perpendicularData, setPerpendicularData } = params;

  const taskId = getCurrentTaskId();
  const basicParamId = await ensureDefaultBasicParams();

  const newGeometry: GeoJSON.LineString = {
    type: 'LineString',
    coordinates: [start, end],
  };

  // 尝试根据上传岸线推断 bank_id 与 distance（自由模式也可在无岸线情况下工作）
  let bankId = 'line-0';
  let distance = 0;
  let verticalFootPoint = coordsToVerticalFootPoint([(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]);

  if (uploadedData && uploadedData.features.length > 0) {
    const mid = turf.midpoint(turf.point(start), turf.point(end));
    let bestBankId: string | null = null;
    let bestDistance = 0;
    let bestD = Number.POSITIVE_INFINITY;
    let bestAnchorPoint: number[] | null = null;

    uploadedData.features.forEach((f, idx) => {
      if (!f.geometry || (f.geometry.type !== 'LineString' && f.geometry.type !== 'MultiLineString')) return;

      const handleLine = (line: GeoJSON.Feature<GeoJSON.LineString>, assumedBankId: string) => {
        try {
          const snapped = turf.nearestPointOnLine(line, mid, { units: 'meters' });
          const d = turf.distance(mid, snapped, { units: 'meters' });
          const loc = snapped.properties.location ?? 0;
          const ap = (snapped?.geometry?.coordinates as any) as number[] | undefined;

          if (d < bestD) {
            bestD = d;
            bestBankId = assumedBankId;
            bestDistance = loc;
            if (Array.isArray(ap) && ap.length >= 2) bestAnchorPoint = [Number(ap[0]), Number(ap[1])];
          }
        } catch {
          // ignore
        }
      };

      const assumedBankId = `line-${idx}`;
      if (f.geometry.type === 'LineString') {
        handleLine(f as GeoJSON.Feature<GeoJSON.LineString>, assumedBankId);
      } else {
        const multi = f.geometry as GeoJSON.MultiLineString;
        multi.coordinates.forEach((coords) => {
          const line = turf.lineString(coords) as GeoJSON.Feature<GeoJSON.LineString>;
          handleLine(line, assumedBankId);
        });
      }
    });

    if (bestBankId !== null) {
      bankId = bestBankId;
      distance = bestDistance;
    }

    // 记录垂足点（无匹配则回退到几何中点）
    if (bestAnchorPoint) verticalFootPoint = coordsToVerticalFootPoint(bestAnchorPoint);
  }

  const nextIndex = perpendicularData ? perpendicularData.features.length : 0;
  const sectionId = taskId ? `sec-${taskId}-free-${Date.now()}` : undefined;

  // 如果没有 taskId 或 basicParamId，则只做前端创建
  if (!taskId || !basicParamId || !sectionId) {
    setPerpendicularData((prev) => {
      const existing = prev ? (prev.features as GeoJSON.Feature<GeoJSON.LineString>[]) : [];
      const newCrossLineId = existing.length;
      const left = start;
      const right = end;

      const newFeature: GeoJSON.Feature<GeoJSON.LineString> = {
        type: 'Feature',
        properties: {
          crossLineId: newCrossLineId,
          distance,
          shoreLineId: bankId,
          ...(verticalFootPoint ? { vertical_foot_point: verticalFootPoint } : {}),
          leftPoint: left,
          rightPoint: right,
        },
        geometry: newGeometry,
      };

      return turf.featureCollection([...existing, newFeature]);
    });

    alert('已创建断面（未找到任务ID或默认参数，未同步后端）');
    return;
  }

  try {
    const sectionsPayload = {
      task_id: taskId,
      sections: [
        {
          section_id: sectionId,
          section_name: `自由断面${nextIndex + 1}`,
          distance,
          bank_id: bankId,
          region_code: 'Mzs',
          segment_index: nextIndex,
          geometry: newGeometry,
          section_geometry: newGeometry,
          ...(verticalFootPoint ? { vertical_foot_point: verticalFootPoint } : {}),
          basic_param_id: basicParamId,
        },
      ],
      inherit_from_basic_param: true,
      overwrite: false,
    };

    const response = await fetch('/v0/bank/sections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sectionsPayload),
    });

    if (!response.ok) {
      throw new Error(`创建断面失败: ${response.statusText}`);
    }

    setPerpendicularData((prev) => {
      const existing = prev ? (prev.features as GeoJSON.Feature<GeoJSON.LineString>[]) : [];
      const newCrossLineId = existing.length;

      const newFeature: GeoJSON.Feature<GeoJSON.LineString> = {
        type: 'Feature',
        properties: {
          sectionId,
          crossLineId: newCrossLineId,
          distance,
          shoreLineId: bankId,
          ...(verticalFootPoint ? { vertical_foot_point: verticalFootPoint } : {}),
          leftPoint: start,
          rightPoint: end,
        },
        geometry: newGeometry,
      };

      return turf.featureCollection([...existing, newFeature]);
    });
  } catch (err: any) {
    console.error('自由创建断面失败:', err);
    alert(`自由创建断面失败: ${err.message}`);
  }
}
