import * as turf from '@turf/turf';
import type { Dispatch, SetStateAction } from 'react';
import { generatePerpendicularLines } from '../../utils/geometry';
import type { SectionParams } from '../../types/sections';
import type { SelectionGroup } from '../../types/selection';
import { updateSectionParams } from './sectionApi';
import {
  coordsToVerticalFootPoint,
  getVerticalFootCoordsFromAny,
  getVerticalFootPointFromAny,
} from '../../utils/verticalFootPoint';

export async function applyCustomSegmentsAction(params: {
  editingGroupId: string | null;
  groups: SelectionGroup[];
  perpendicularData: GeoJSON.FeatureCollection | null;
  globalLength: number;
  globalProperties: SectionParams | null;
  setGroups: Dispatch<SetStateAction<SelectionGroup[]>>;
  setPerpendicularData: (v: GeoJSON.FeatureCollection | null) => void;
}) {
  const {
    editingGroupId,
    groups,
    perpendicularData,
    globalLength,
    globalProperties,
    setGroups,
    setPerpendicularData,
  } = params;

  if (!editingGroupId) {
    alert('请先点击编辑按钮选择要修改的组');
    return;
  }

  const editingGroup = groups.find((g) => g.id === editingGroupId);
  if (!editingGroup || editingGroup.end === null) {
    alert('选择的组未完成起止点选择');
    return;
  }

  if (!perpendicularData) {
    alert('请先绘制断面');
    return;
  }

  const start = Math.min(editingGroup.start, editingGroup.end);
  const end = Math.max(editingGroup.start, editingGroup.end);
  const sectionParamsToApply = (editingGroup.properties || globalProperties || null) as SectionParams | null;

  const getSectionIdFromProps = (props: any): string | null => {
    const id = props?.sectionId ?? props?.section_id ?? props?.id;
    if (!id) return null;
    return String(id);
  };

  const collectTargetSectionIds = (): string[] => {
    const ids = new Set<string>();
    (perpendicularData.features as any[]).forEach((line) => {
      const lineProp: any = line?.properties || {};
      const leftPoint = lineProp.leftPoint as number[] | undefined;
      const rightPoint = lineProp.rightPoint as number[] | undefined;
      const anchorPoint = getVerticalFootCoordsFromAny(lineProp) ?? undefined;
      if (!leftPoint || !rightPoint) return;

      try {
        const p =
          Array.isArray(anchorPoint) && anchorPoint.length >= 2
            ? anchorPoint
            : [(leftPoint[0] + rightPoint[0]) / 2, (leftPoint[1] + rightPoint[1]) / 2];
        const pt = turf.point(p as any);
        const distOnLine = turf.nearestPointOnLine(editingGroup.line, pt, { units: 'meters' });
        const actualDist = distOnLine.properties.location ?? 0;
        const distToLine = turf.distance(pt, distOnLine, { units: 'meters' });

        if (distToLine > Math.max(globalLength, editingGroup.length) / 2 + 100) return;
        if (actualDist < start || actualDist > end) return;

        const sectionId = getSectionIdFromProps(lineProp);
        if (sectionId) ids.add(sectionId);
      } catch {
        // ignore matching failures
      }
    });
    return Array.from(ids);
  };

  const targetSectionIds = collectTargetSectionIds();

  const intervalChanged = editingGroup.interval !== editingGroup.lastAppliedInterval;

  let updatedLines = [...perpendicularData.features] as GeoJSON.Feature<GeoJSON.LineString>[];

  if (!intervalChanged) {
    const newCrossData: { distance: number; left: number[]; right: number[] }[] = [];

    updatedLines = updatedLines.map((line) => {
      const lineProp: any = line.properties || {};
      const leftPoint = lineProp.leftPoint as number[] | undefined;
      const rightPoint = lineProp.rightPoint as number[] | undefined;
      if (!leftPoint || !rightPoint) return line;

      try {
        const mid = [(leftPoint[0] + rightPoint[0]) / 2, (leftPoint[1] + rightPoint[1]) / 2];
        const midPoint = turf.point(mid);
        const snapped = turf.nearestPointOnLine(editingGroup.line, midPoint, { units: 'meters' });
        const actualDist = snapped.properties.location ?? 0;
        const distToLine = turf.distance(midPoint, snapped, { units: 'meters' });

        if (distToLine > Math.max(globalLength, editingGroup.length) / 2 + 100) {
          return line;
        }
        if (actualDist < start || actualDist > end) {
          return line;
        }

        const centerPoint = snapped as GeoJSON.Feature<GeoJSON.Point>;
        const bearingToLeft = turf.bearing(centerPoint, turf.point(leftPoint));
        const halfLen = editingGroup.length / 2;

        const leftEnd = turf.destination(centerPoint, halfLen, bearingToLeft, { units: 'meters' });
        const rightEnd = turf.destination(centerPoint, halfLen, bearingToLeft + 180, { units: 'meters' });

        const newLeft = leftEnd.geometry.coordinates as number[];
        const newRight = rightEnd.geometry.coordinates as number[];

        const nextGeometry: GeoJSON.LineString = {
          type: 'LineString',
          coordinates: [newLeft, newRight],
        };

        const verticalFootPoint = coordsToVerticalFootPoint(centerPoint.geometry.coordinates as any);
        const nextProps: any = {
          ...lineProp,
          crossLineId: lineProp.crossLineId,
          distance: lineProp.distance,
          shoreLineIndex: lineProp.shoreLineIndex ?? editingGroup.lineIndex,
          shoreLineId:
            lineProp.shoreLineId ?? (editingGroup.lineIndex !== undefined ? `line-${editingGroup.lineIndex}` : undefined),
          leftPoint: newLeft,
          rightPoint: newRight,
          ...(verticalFootPoint ? { vertical_foot_point: verticalFootPoint } : {}),
          analysisConfig: editingGroup.properties || { ...(globalProperties || {}) },
        };

        newCrossData.push({ distance: actualDist, left: newLeft, right: newRight });

        return {
          ...line,
          geometry: nextGeometry,
          properties: nextProps,
        };
      } catch {
        return line;
      }
    });

    newCrossData.sort((a, b) => a.distance - b.distance);

    setGroups((prev) => {
      const updated = [...prev];
      const idx = updated.findIndex((g) => g.id === editingGroup.id);
      if (idx !== -1) {
        updated[idx] = {
          ...editingGroup,
          crossData: newCrossData,
          lastAppliedInterval: editingGroup.interval,
        };
      }
      return updated;
    });

    setPerpendicularData(turf.featureCollection(updatedLines));

    let backendSyncSummary = '（未同步后端属性）';
    if (sectionParamsToApply && targetSectionIds.length > 0) {
      const results = await Promise.allSettled(
        targetSectionIds.map((sectionId) => updateSectionParams(sectionId, sectionParamsToApply)),
      );
      const successCount = results.filter((r) => r.status === 'fulfilled').length;
      const failedCount = results.length - successCount;
      backendSyncSummary =
        failedCount > 0
          ? `（后端属性同步成功 ${successCount}，失败 ${failedCount}）`
          : `（已同步后端属性 ${successCount} 条）`;
    }

    alert(
      `已更新组 ${groups.findIndex((g) => g.id === editingGroupId) + 1} 的垂线长度（未修改间距）${backendSyncSummary}`,
    );
    return;
  }

  updatedLines = updatedLines.filter((line) => {
    const lineProp = line.properties as any;
    if (!lineProp) return true;

    const leftPoint = lineProp.leftPoint as number[] | undefined;
    const rightPoint = lineProp.rightPoint as number[] | undefined;
    const anchorPoint = getVerticalFootCoordsFromAny(lineProp) ?? undefined;
    if (!leftPoint || !rightPoint) return true;

    try {
      const p =
        Array.isArray(anchorPoint) && anchorPoint.length >= 2
          ? anchorPoint
          : [(leftPoint[0] + rightPoint[0]) / 2, (leftPoint[1] + rightPoint[1]) / 2];
      const pt = turf.point(p as any);
      const distOnLine = turf.nearestPointOnLine(editingGroup.line, pt, { units: 'meters' });
      const actualDist = distOnLine.properties.location ?? 0;

      const distToLine = turf.distance(pt, distOnLine, { units: 'meters' });

      if (distToLine > Math.max(globalLength, editingGroup.length) / 2 + 100) {
        return true;
      }

      if (actualDist >= start && actualDist <= end) {
        return false;
      }

      return true;
    } catch {
      return true;
    }
  });

  const { featureCollection, endpointData } = generatePerpendicularLines(
    editingGroup.line,
    start,
    end,
    editingGroup.interval,
    editingGroup.length,
  );

  const startId = updatedLines.length;
  featureCollection.features.forEach((line, idx) => {
    const props: any = line.properties || {};
    const leftPoint = props.leftPoint;
    const rightPoint = props.rightPoint;
    const verticalFootPoint = getVerticalFootPointFromAny(props);
    line.properties = {
      crossLineId: startId + idx,
      distance: props.distance,
      shoreLineIndex: editingGroup.lineIndex,
      shoreLineId: editingGroup.lineIndex !== undefined ? `line-${editingGroup.lineIndex}` : undefined,
      leftPoint,
      rightPoint,
      ...(verticalFootPoint ? { vertical_foot_point: verticalFootPoint } : {}),
      analysisConfig: editingGroup.properties || { ...globalProperties },
    };
  });

  setGroups((prev) => {
    const updated = [...prev];
    const idx = updated.findIndex((g) => g.id === editingGroup.id);
    if (idx !== -1) {
      updated[idx] = {
        ...editingGroup,
        crossData: endpointData,
        lastAppliedInterval: editingGroup.interval,
      };
    }
    return updated;
  });

  updatedLines.push(...(featureCollection.features as GeoJSON.Feature<GeoJSON.LineString>[]));

  setPerpendicularData(turf.featureCollection(updatedLines));

  let backendSyncSummary = '（未同步后端属性）';
  if (sectionParamsToApply && targetSectionIds.length > 0) {
    const results = await Promise.allSettled(
      targetSectionIds.map((sectionId) => updateSectionParams(sectionId, sectionParamsToApply)),
    );
    const successCount = results.filter((r) => r.status === 'fulfilled').length;
    const failedCount = results.length - successCount;
    backendSyncSummary =
      failedCount > 0
        ? `（后端属性同步成功 ${successCount}，失败 ${failedCount}）`
        : `（已同步后端属性 ${successCount} 条）`;
  }

  alert(
    `已应用组 ${groups.findIndex((g) => g.id === editingGroupId) + 1} 的自定义配置（修改了间距，已重绘）${backendSyncSummary}`,
  );
}
