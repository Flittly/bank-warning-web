import * as turf from '@turf/turf';
import type { ChangeEvent } from 'react';
import { ensureDefaultBasicParams } from '../../services/basicParamsService';
import { setCurrentTaskId } from './taskState';
import { stripZFromGeoJSON } from '../../utils/geojson';
import { coordsToVerticalFootPoint, getVerticalFootPointFromAny } from '../../utils/verticalFootPoint';

export function uploadMainGeoJsonAction(params: {
  e: ChangeEvent<HTMLInputElement>;
  setUploadedData: (v: GeoJSON.FeatureCollection | null) => void;
  setSelectedLines: (v: Set<string>) => void;
  setIsSelectingShoreLines: (v: boolean) => void;
  setIsSelectingStartEnd: (v: boolean) => void;
  setLoadedBanks?: (fn: (prev: any[]) => any[]) => void;
}) {
  const {
    e,
    setUploadedData,
    setSelectedLines,
    setIsSelectingShoreLines,
    setIsSelectingStartEnd,
    setLoadedBanks,
  } = params;

  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const json = JSON.parse(event.target?.result as string);
      const geojsonRaw = json.type === 'FeatureCollection' ? json : turf.featureCollection([json]);
      const geojson = stripZFromGeoJSON(geojsonRaw as any);

      const fileName = file.name.split('.')[0]; // 不含扩展名的文件名

      const lineStringFeatures: any[] = [];
      const newBanks: any[] = [];

      geojson.features.forEach((feature: any, index: number) => {
        if (!feature.properties) {
          feature.properties = {};
        }
        feature.properties.index = index;

        // 仅处理 LineString 要素，将其转换为可管理的岸段
        if (feature.geometry?.type === 'LineString') {
          const bankId = `${fileName}_${index}`;
          const bankName = feature.properties.name || feature.properties.bank_name || `${fileName} 线段${index + 1}`;

          // 创建岸段对象
          const bank = {
            bank_id: bankId,
            bank_name: bankName,
            region_code: feature.properties.region_code || 'uploaded',
            description: feature.properties.description || `从 ${fileName} 导入的岸线`,
            geometry: feature.geometry,
            reversed: !!(feature.properties.reversed === true || feature.properties.reversed === 'true'),
            from_backend: false, // 标记为前端上传
          };

          newBanks.push(bank);
          lineStringFeatures.push({
            ...feature,
            properties: {
              ...feature.properties,
              bank_id: bankId,
              bank_name: bankName,
              from_backend: false,
            },
          });
        } else {
          // 非 LineString 的要素保持原样
          lineStringFeatures.push(feature);
        }
      });

      setUploadedData(turf.featureCollection(lineStringFeatures) as any);
      setSelectedLines(new Set());
      setIsSelectingShoreLines(false);
      setIsSelectingStartEnd(false);

      // 将新创建的岸段添加到 loadedBanks，避免重复
      if (setLoadedBanks && newBanks.length > 0) {
        setLoadedBanks((prev) => {
          const existingBankIds = new Set(prev.map((b) => String(b.bank_id)));
          const banksToAdd = newBanks.filter((b) => !existingBankIds.has(String(b.bank_id)));
          return banksToAdd.length > 0 ? [...prev, ...banksToAdd] : prev;
        });
      }
    } catch {
      alert('解析 GeoJSON 失败，请检查文件格式');
    }
  };
  reader.readAsText(file);
}

export async function uploadSectionsGeoJsonAndCreateTaskAction(params: {
  e: ChangeEvent<HTMLInputElement>;
  setPerpendicularData: (v: GeoJSON.FeatureCollection | null) => void;
  setShowCrossLines: (v: boolean) => void;
}) {
  const { e, setPerpendicularData, setShowCrossLines } = params;

  const file = e.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const json = JSON.parse(text);
    const geojsonRaw = json.type === 'FeatureCollection' ? json : turf.featureCollection([json]);
    const geojson = stripZFromGeoJSON(geojsonRaw as any);

    const lineFeatures = geojson.features.filter((f: any) => f.geometry && f.geometry.type === 'LineString') as GeoJSON.Feature<
      GeoJSON.LineString
    >[];

    if (lineFeatures.length === 0) {
      alert('GeoJSON 中未找到 LineString 类型的断面要素');
      return;
    }

    const basicParamId = await ensureDefaultBasicParams();
    if (!basicParamId) {
      alert('初始化默认参数失败，请检查后端连接');
      return;
    }

    const taskName = window.prompt('请输入任务名称：', '导入断面任务');
    if (!taskName) {
      alert('任务名称不能为空');
      return;
    }

    const taskId = `task-${Date.now()}`;
    setCurrentTaskId(taskId);

    const bankIdSet = new Set<string>();
    lineFeatures.forEach((f) => {
      const props: any = f.properties || {};
      const bankId = props.bank_id || props.shoreLineId || props.bankId || 'line-0';
      bankIdSet.add(bankId);
    });

    const selectedBankIds = Array.from(bankIdSet);
    if (selectedBankIds.length === 0) {
      selectedBankIds.push('line-0');
    }

    const taskPayload = {
      tasks: [
        {
          task_id: taskId,
          task_name: taskName,
          bank_ids: selectedBankIds,
          description: `通过前端导入断面任务: ${taskName}`,
        },
      ],
      overwrite: false,
    };

    console.log('创建导入断面任务:', taskPayload);
    const taskResponse = await fetch('/v0/bank/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(taskPayload),
    });

    if (!taskResponse.ok) {
      throw new Error(`创建任务失败: ${taskResponse.statusText}`);
    }

    const sectionsToCreate: any[] = [];

    lineFeatures.forEach((line, index) => {
      const props: any = line.properties || {};
      const sectionId = props.section_id || `sec-${taskId}-import-${index}`;
      const bankId = props.bank_id || props.shoreLineId || props.bankId || 'line-0';
      const distance = props.distance ?? 0;

      // 防御性：确保导入断面为 2D 坐标
      const line2d = stripZFromGeoJSON(line as any) as any;

      const coords = (line2d.geometry.coordinates as number[][]) || [];
      const left = coords[0];
      const right = coords[coords.length - 1];

      const fallbackMid =
        Array.isArray(left) && Array.isArray(right) ? ([(left[0] + right[0]) / 2, (left[1] + right[1]) / 2] as any) : null;

      const verticalFootPoint =
        getVerticalFootPointFromAny(props) ?? (fallbackMid ? coordsToVerticalFootPoint(fallbackMid) : null);

      sectionsToCreate.push({
        section_id: sectionId,
        section_name: props.section_name || props.name || `导入断面${index + 1}`,
        distance,
        bank_id: bankId,
        region_code: 'Mzs',
        segment_index: index,
        geometry: line2d.geometry,
        section_geometry: line2d.geometry,
        ...(verticalFootPoint ? { vertical_foot_point: verticalFootPoint } : {}),
        basic_param_id: basicParamId,
      });

      line.properties = {
        ...props,
        sectionId,
        crossLineId: index,
        distance,
        shoreLineId: bankId,
        bank_id: bankId,
        ...(verticalFootPoint ? { vertical_foot_point: verticalFootPoint } : {}),
        leftPoint: left,
        rightPoint: right,
      };

      // 同步更新本地 Feature 的 geometry，避免后续前端再发送时带 Z
      (line as any).geometry = line2d.geometry;
    });

    const sectionsPayload = {
      task_id: taskId,
      sections: sectionsToCreate,
      inherit_from_basic_param: true,
      overwrite: false,
    };

    console.log('导入断面创建 payload:', JSON.stringify(sectionsPayload, null, 2));
    const sectionsResponse = await fetch('/v0/bank/sections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sectionsPayload),
    });

    if (!sectionsResponse.ok) {
      const errorText = await sectionsResponse.text();
      console.error('导入断面后端错误响应:', errorText);
      throw new Error(`创建断面失败: ${sectionsResponse.statusText} - ${errorText}`);
    }

    const sectionsResult = await sectionsResponse.json();
    console.log('导入断面创建成功:', sectionsResult);

    setPerpendicularData(turf.featureCollection(lineFeatures));
    setShowCrossLines(true);

    alert(`导入断面任务创建成功！共导入 ${lineFeatures.length} 条断面。`);
  } catch (err: any) {
    console.error('导入断面失败:', err);
    alert(`导入断面失败: ${err.message}`);
  } finally {
    e.target.value = '';
  }
}

export function exportSectionsSampleAction(params: { perpendicularData: GeoJSON.FeatureCollection | null }) {
  const { perpendicularData } = params;

  if (!perpendicularData || perpendicularData.features.length === 0) {
    alert('当前没有可导出的断面，请先生成或导入断面');
    return;
  }

  const features = perpendicularData.features
    .filter((f) => f.geometry && f.geometry.type === 'LineString')
    .map((f: any) => {
      const props = f?.properties || {};
      const bankId = String(props.bank_id || props.shoreLineId || props.bankId || '');
      const verticalFootPoint = getVerticalFootPointFromAny(props) ?? undefined;
      return {
        type: 'Feature' as const,
        geometry: f.geometry,
        // 导出时必须带 bank_id，作为导入后按岸段分组依据
        properties: {
          ...(bankId ? { bank_id: bankId } : {}),
          ...(verticalFootPoint ? { vertical_foot_point: verticalFootPoint } : {}),
        },
      };
    });

  const exportData = {
    type: 'FeatureCollection' as const,
    features,
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sections-sample-${Date.now()}.geojson`;
  a.click();
  URL.revokeObjectURL(url);
}
