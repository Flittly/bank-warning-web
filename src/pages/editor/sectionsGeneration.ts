import { message } from 'antd';
import { authHeaders } from '../../utils/apiClient';
import * as turf from '@turf/turf';
import { generatePerpendicularLines } from '../../utils/geometry';
import { ensureTaskParamsId } from '../../services/basicParamsService';
import { appendBanksToTask } from '../../services/taskBanksService';
import type { SectionParams } from '../../types/sections';
import { fetchSectionParams } from './sectionApi';
import { getCurrentTaskId, setCurrentTaskId } from './taskState';
import { newTaskId } from '../../utils/taskId';
import {
  coordsToVerticalFootPoint,
  getVerticalFootCoordsFromAny,
  getVerticalFootPointFromAny,
} from '../../utils/verticalFootPoint';

function getShoreLineIdFromFeature(feature: any, index: number) {
  const p = feature?.properties || {};
  return String(p.bank_id || p.bankId || `line-${index}`);
}

function toLineStrings(geometry: any): Array<{ type: 'LineString'; coordinates: any[] }> {
  if (!geometry) return [];
  if (geometry.type === 'LineString' && Array.isArray(geometry.coordinates)) {
    return [{ type: 'LineString', coordinates: geometry.coordinates }];
  }
  if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) {
    return (geometry.coordinates as any[])
      .filter((coords) => Array.isArray(coords) && coords.length >= 2)
      .map((coords) => ({ type: 'LineString' as const, coordinates: coords }));
  }
  return [];
}

function isFromBackendFeature(feature: any) {
  const props = feature?.properties || {};
  return props.from_backend === true || props.fromBackend === true;
}

function extendCrossLineToFirstShorelineIntersection(params: {
  crossLine: GeoJSON.Feature<GeoJSON.LineString>;
  uploadedData: GeoJSON.FeatureCollection;
  maxRayLengthMeters?: number;
}) {
  const { crossLine, uploadedData } = params;
  // 约束：最多延长 10000m；若仍无交点则丢弃该断面（返回 null）
  const maxRayLengthMeters = Math.max(1, Number(params.maxRayLengthMeters ?? 10000));

  const coords = crossLine?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return crossLine;

  const start = coords[0];
  const end = coords[coords.length - 1];
  if (!Array.isArray(start) || !Array.isArray(end)) return crossLine;

  const props: any = crossLine.properties || {};
  const anchorCoord = getVerticalFootCoordsFromAny(props);
  const right = (props.rightPoint as number[] | undefined) ?? null;
  const rightCoord = Array.isArray(right) && right.length >= 2 ? right : (Array.isArray(end) ? (end as any) : null);
  if (!anchorCoord || !rightCoord) return crossLine;

  const anchorPt = turf.point(anchorCoord as any);
  const dirPt = turf.point(rightCoord as any);
  const bearing = turf.bearing(anchorPt, dirPt);

  // 从垂足点向右端方向发射射线，跳过极近的交点
  const minAfterMeters = 1;
  const farEnd = turf.destination(anchorPt, maxRayLengthMeters, bearing, { units: 'meters' });
  const ray = turf.lineString([anchorCoord as any, farEnd.geometry.coordinates as any]);

  let bestLocation: number | null = null;
  let bestCoord: number[] | null = null;

  const features = (uploadedData?.features || []) as any[];
  for (let i = 0; i < features.length; i++) {
    const f = features[i];

    const parts = toLineStrings(f?.geometry);
    for (const part of parts) {
      const shore = turf.lineString(part.coordinates as any);
      const hits = turf.lineIntersect(ray, shore);
      const hitPts = (hits?.features || []) as any[];
      for (const hp of hitPts) {
        const snapped = turf.nearestPointOnLine(ray, hp, { units: 'meters' }) as any;
        const loc = Number(snapped?.properties?.location);
        if (!Number.isFinite(loc)) continue;
        if (loc < minAfterMeters) continue;

        if (bestLocation === null || loc < bestLocation) {
          bestLocation = loc;
          bestCoord = hp?.geometry?.coordinates as any;
        }
      }
    }
  }

  if (!bestCoord || bestLocation === null) {
    return null;
  }

  // 只保留：垂足点(vertical_foot_point) 与 延申后的交点
  crossLine.geometry.coordinates = [anchorCoord as any, bestCoord as any];
  if (!crossLine.properties) crossLine.properties = {};
  const vfp = coordsToVerticalFootPoint(anchorCoord);
  if (vfp) (crossLine.properties as any).vertical_foot_point = vfp;
  (crossLine.properties as any).leftPoint = anchorCoord;
  (crossLine.properties as any).rightPoint = bestCoord;
  (crossLine.properties as any).extended_to_shoreline = true;
  (crossLine.properties as any).extended_length_m = bestLocation;

  return crossLine;
}

async function generateSectionsAndCreateTaskCore(params: {
  uploadedData: GeoJSON.FeatureCollection;
  selectedLines: Set<string>;
  globalInterval: number;
  globalLength: number;
  globalProperties: SectionParams | null;
  setPerpendicularData: (v: GeoJSON.FeatureCollection | null) => void;
  setShowCrossLines: (v: boolean) => void;
  setGlobalProperties: (v: SectionParams | null) => void;
  // 弹窗获取任务名称（返回 null 表示用户取消）
  requestTaskName: () => Promise<string | null>;
  // 若为 true，则在生成断面前不将本地岸段同步上传到后端
  skipUploadBanks?: boolean;
  // 任务优先：若提供已有 task_id，则复用该任务，跳过命名与建任务步骤
  existingTaskId?: string | null;
  // 新建任务时用户选定的模板库模板：后端会把它拷成该任务自己的参数集
  templateParamId?: string | null;
  // 若为 true，则对每条断面沿起点->终点方向延长，直到与遇到的第一个岸线相交
  extendToFirstShorelineIntersection?: boolean;
}) {
  const {
    uploadedData,
    selectedLines,
    globalInterval,
    globalLength,
    globalProperties,
    setPerpendicularData,
    setShowCrossLines,
    setGlobalProperties,
  } = params;

  if (selectedLines.size === 0) {
    message.warning('请先选择用于分析的岸段');
    return;
  }

  const ensureBanksUploaded = async (banksToSend: any[]) => {
    if (banksToSend.length === 0) return;

    const results: Array<{ bank_id: string; ok: boolean; status?: number; message?: string }> = [];
    for (const bank of banksToSend) {
      const payload = { banks: [bank], overwrite: false };
      const res = await fetch('/v0/bank/banks', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        results.push({ bank_id: String(bank.bank_id), ok: true, status: res.status });
        continue;
      }

      // 若后端提示已存在（例如重复提交），视为成功并继续。
      if (res.status === 409) {
        results.push({ bank_id: String(bank.bank_id), ok: true, status: res.status });
        continue;
      }

      const t = await res.text();

      if (res.status === 400 && typeof t === 'string' && /exist|already|duplicate|conflict/i.test(t)) {
        results.push({ bank_id: String(bank.bank_id), ok: true, status: res.status });
        continue;
      }

      results.push({
        bank_id: String(bank.bank_id),
        ok: false,
        status: res.status,
        message: `${res.status} ${res.statusText} ${t}`,
      });
    }

    const fail = results.filter((r) => !r.ok);
    if (fail.length > 0) {
      const first = fail[0];
      console.error('生成前上传岸段失败明细:', fail);
      throw new Error(`生成前上传岸段失败：首个失败 bank_id=${first.bank_id}：${first.message}`);
    }
  };

  try {
    const existingTaskId = params.existingTaskId?.trim() || null;
    let taskName: string | undefined;
    let taskId: string;
    if (existingTaskId) {
      // 任务优先：复用用户选中的任务，不再命名/新建
      taskId = existingTaskId;
      setCurrentTaskId(taskId);
    } else {
      taskName = (await params.requestTaskName())?.trim() || undefined;
      if (!taskName) {
        // 用户取消创建任务
        return;
      }
      taskId = newTaskId();
      setCurrentTaskId(taskId);
    }

    const taskBankIdSet = new Set<string>();
    const localBanksToSend: any[] = [];

    const selectedEntries = uploadedData.features
      .map((feature: any, originalIndex: number) => {
        const selectionId = getShoreLineIdFromFeature(feature, originalIndex);
        return { feature, originalIndex, selectionId };
      })
      .filter((x) => selectedLines.has(x.selectionId));

    const selectionIdToBankBaseId = new Map<string, { fromBackend: boolean; base: string }>();

    selectedEntries.forEach(({ feature, selectionId }, selectedIndex) => {
      const props = feature?.properties || {};
      const fromBackend = isFromBackendFeature(feature);

      const baseIdInTask = getShoreLineIdFromFeature(feature, selectedIndex);
      const baseBackendBankId = fromBackend
        ? String(props.bank_id || props.bankId || baseIdInTask)
        : `${taskId}-${baseIdInTask}`;
      selectionIdToBankBaseId.set(selectionId, { fromBackend, base: baseBackendBankId });

      const baseName = String(props.bank_name || props.bankName || props.name || selectionId);
      const regionCode = String(props.region_code || props.regionCode || 'Mzs');
      const reversed = !!(props && (props.reversed === true || props.reversed === 'true'));
      const description = String(props.description || '');

      if (fromBackend) {
        taskBankIdSet.add(baseBackendBankId);
        return;
      }

      const parts = toLineStrings(feature?.geometry);
      parts.forEach((geom, partIndex) => {
        const suffix = parts.length > 1 ? `_part${partIndex + 1}` : '';
        const bankId = `${baseBackendBankId}${suffix}`;
        const bankName = parts.length > 1 ? `${baseName}_${partIndex + 1}` : baseName;
        taskBankIdSet.add(bankId);
        localBanksToSend.push({
          bank_id: String(bankId),
          bank_name: bankName,
          region_code: regionCode,
          geometry: geom,
          bank_geometry: geom,
          reversed,
          description,
        });
      });
    });

    if (taskBankIdSet.size === 0) {
      message.error('所选岸段中没有可用的 LineString / MultiLineString，无法创建任务');
      return;
    }

    if (!params.skipUploadBanks) {
      await ensureBanksUploaded(localBanksToSend);
    } else {
      console.info('跳过上传岸段（skipUploadBanks=true）');
    }

    const selectedBankIds: string[] = Array.from(taskBankIdSet);

    if (!existingTaskId) {
      const taskPayload = {
        tasks: [
          {
            task_id: taskId,
            task_name: taskName,
            bank_ids: selectedBankIds,
            description: `通过前端创建的任务: ${taskName}`,
          },
        ],
        overwrite: false,
      };

      console.log('创建任务:', taskPayload);
      const taskResponse = await fetch('/v0/bank/tasks', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(taskPayload),
      });

      if (!taskResponse.ok) {
        throw new Error(`创建任务失败: ${taskResponse.statusText}`);
      }
    } else {
      console.info('任务优先：复用已有任务，跳过创建任务:', taskId);
    }

    // 断面必须挂「本任务」的参数集（不是模板库的引用）：任务已经存在，才谈得上任务参数。
    // 指定了模板时后端会把该模板的内容拷进本任务，之后两者再无关联。
    const basicParamId = await ensureTaskParamsId(taskId, params.templateParamId ?? null);
    if (!basicParamId) {
      message.error('初始化任务参数失败，请检查后端连接或先创建参数模板');
      return;
    }

    const allPerpendicularLines: GeoJSON.Feature<GeoJSON.LineString>[] = [];
    const sectionsToCreate: any[] = [];

    // 防止同一岸段线在 uploadedData.features 中出现多次（重复特征）
    const processedShoreLineIds = new Set<string>();

    uploadedData.features.forEach((feature: any, index: number) => {
      const shoreLineId = getShoreLineIdFromFeature(feature, index);
      if (!selectedLines.has(shoreLineId)) return;
      if (processedShoreLineIds.has(shoreLineId)) return;
      processedShoreLineIds.add(shoreLineId);

      const mapped = selectionIdToBankBaseId.get(shoreLineId);
      const fromBackend = mapped?.fromBackend ?? isFromBackendFeature(feature);
      const baseBackendBankId =
        mapped?.base ??
        (fromBackend
          ? String(feature?.properties?.bank_id || feature?.properties?.bankId || shoreLineId)
          : `${taskId}-${shoreLineId}`);
      const reverseFlag = !!(
        feature.properties &&
        ((feature.properties as any).reversed === true || (feature.properties as any).reversed === 'true')
      );

      const applyReverseFlag = (featureCollection: any) => {
        if (!reverseFlag) return;
        featureCollection.features.forEach((f: any) => {
          if (f.geometry && Array.isArray(f.geometry.coordinates)) {
            f.geometry.coordinates = (f.geometry.coordinates as any[]).slice().reverse();
          }
          if (f.properties) {
            const lp = f.properties.leftPoint;
            const rp = f.properties.rightPoint;
            f.properties.leftPoint = rp;
            f.properties.rightPoint = lp;
          }
        });
      };

      const applyCommonProps = (featureCollection: any, bankIdToUse: string) => {
        featureCollection.features.forEach((f: any) => {
          if (!f.properties) f.properties = {};
          (f.properties as any).shoreLineIndex = index;
          (f.properties as any).shoreLineId = shoreLineId;
          (f.properties as any).bank_id = bankIdToUse;
        });
      };

      const maybeExtend = (f: GeoJSON.Feature<GeoJSON.LineString>) => {
        if (!params.extendToFirstShorelineIntersection) return f;
        return extendCrossLineToFirstShorelineIntersection({
          crossLine: f,
          uploadedData,
          maxRayLengthMeters: 10000,
        });
      };

      if (feature.geometry.type === 'LineString') {
        const line = feature as GeoJSON.Feature<GeoJSON.LineString>;
        const lineLengthMeters = turf.length(line, { units: 'meters' });

        const { featureCollection } = generatePerpendicularLines(line, 0, lineLengthMeters, globalInterval, globalLength);

        const bankIdToUse = baseBackendBankId;
        applyReverseFlag(featureCollection);
        applyCommonProps(featureCollection, bankIdToUse);

        const extendedFeatures = (featureCollection.features as any[])
          .map((ff) => maybeExtend(ff))
          .filter(Boolean) as GeoJSON.Feature<GeoJSON.LineString>[];

        allPerpendicularLines.push(...extendedFeatures);
      } else if (feature.geometry.type === 'MultiLineString') {
        const multiLine = feature.geometry as GeoJSON.MultiLineString;
        multiLine.coordinates.forEach((coords, partIndex) => {
          if (!Array.isArray(coords) || coords.length < 2) return;
          const line = turf.lineString(coords) as GeoJSON.Feature<GeoJSON.LineString>;
          const lineLengthMeters = turf.length(line, { units: 'meters' });

          const { featureCollection } = generatePerpendicularLines(line, 0, lineLengthMeters, globalInterval, globalLength);

          const bankIdToUse = fromBackend ? baseBackendBankId : `${baseBackendBankId}_part${partIndex + 1}`;
          applyReverseFlag(featureCollection);
          applyCommonProps(featureCollection, bankIdToUse);

          const extendedFeatures = (featureCollection.features as any[])
            .map((ff) => maybeExtend(ff))
            .filter(Boolean) as GeoJSON.Feature<GeoJSON.LineString>[];

          allPerpendicularLines.push(...extendedFeatures);
        });
      }
    });

    allPerpendicularLines.forEach((line, index) => {
      const props: any = line.properties || {};
      const sectionId = `sec-${taskId}-${index}`;

      const verticalFootPoint = getVerticalFootPointFromAny(props);

      sectionsToCreate.push({
        section_id: sectionId,
        section_name: `断面${index + 1}`,
        distance: props.distance,
        bank_id: props.bank_id || props.shoreLineId || 'line-0',
        region_code: 'Mzs',
        segment_index: index,
        geometry: line.geometry,
        section_geometry: line.geometry,
        ...(verticalFootPoint ? { vertical_foot_point: verticalFootPoint } : {}),
        basic_param_id: basicParamId,
      });

      line.properties = {
        sectionId,
        crossLineId: index,
        distance: props.distance,
        shoreLineIndex: props.shoreLineIndex,
        shoreLineId: props.shoreLineId,
        bank_id: props.bank_id,
        ...(verticalFootPoint ? { vertical_foot_point: verticalFootPoint } : {}),
        leftPoint: props.leftPoint,
        rightPoint: props.rightPoint,
        extended_to_shoreline: props.extended_to_shoreline,
        extended_length_m: props.extended_length_m,
      };
    });

    if (existingTaskId) {
      // 任务优先：重算前先清空该任务既有断面与结果，避免 section_id 唯一约束冲突
      const clearRes = await fetch(`/v0/bank/tasks/${encodeURIComponent(existingTaskId)}/clear`, {
        method: 'DELETE',
        headers: { ...authHeaders() },
      });
      if (!clearRes.ok) {
        console.warn('清空任务既有断面失败:', clearRes.status, clearRes.statusText);
      }
    }

    const sectionsPayload = {
      task_id: taskId,
      sections: sectionsToCreate,
      inherit_from_basic_param: true,
      overwrite: false,
    };

    console.log(`创建 ${sectionsToCreate.length} 个断面...`);
    console.log('发送到后端的数据:', JSON.stringify(sectionsPayload, null, 2));
    const sectionsResponse = await fetch('/v0/bank/sections', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(sectionsPayload),
    });

    if (!sectionsResponse.ok) {
      const errorText = await sectionsResponse.text();
      console.error('后端错误响应:', errorText);
      throw new Error(`创建断面失败: ${sectionsResponse.statusText} - ${errorText}`);
    }

    const sectionsResult = await sectionsResponse.json();
    console.log('断面创建成功:', sectionsResult);

    if (sectionsResult.success && sectionsResult.sections && sectionsResult.sections.length > 0) {
      const firstSection = sectionsResult.sections[0];
      const fetched = await fetchSectionParams(firstSection.section_id);
      if (fetched) {
        console.log('获取到断面参数:', fetched);
        setGlobalProperties(fetched);
      }
    } else if (!globalProperties) {
      // no-op
    }

    // 去重：相同岸段线+相同位置只保留一条
    const seen = new Set<string>();
    const dedupedLines: GeoJSON.Feature<GeoJSON.LineString>[] = [];
    allPerpendicularLines.forEach((f: any) => {
      const props = f.properties || {};
      const key = `${props.shoreLineId || props.bank_id || '_'}@${Number(props.distance || 0).toFixed(2)}`;
      if (!seen.has(key)) {
        seen.add(key);
        dedupedLines.push(f);
      }
    });
    const dedupedCount = allPerpendicularLines.length - dedupedLines.length;
    if (dedupedCount > 0) {
      console.warn(`已自动移除 ${dedupedCount} 条重复断面`);
    }

    setPerpendicularData(turf.featureCollection(dedupedLines));
    setShowCrossLines(true);

    const modeLabel = params.extendToFirstShorelineIntersection ? '计算断面' : '精细断面';
    message.success(`任务创建成功！已为 ${selectedLines.size} 个岸段生成 ${allPerpendicularLines.length} 条${modeLabel}`);
  } catch (err: any) {
    console.error('生成断面失败:', err);
    message.error(`生成断面失败: ${err.message}`);
  }
}

export async function generateSectionsAndCreateTask(params: {
  uploadedData: GeoJSON.FeatureCollection;
  selectedLines: Set<string>;
  globalInterval: number;
  globalLength: number;
  globalProperties: SectionParams | null;
  setPerpendicularData: (v: GeoJSON.FeatureCollection | null) => void;
  setShowCrossLines: (v: boolean) => void;
  setGlobalProperties: (v: SectionParams | null) => void;
  // 弹窗获取任务名称（返回 null 表示用户取消）
  requestTaskName: () => Promise<string | null>;
  // 若为 true，则在生成断面前不将本地岸段同步上传到后端
  skipUploadBanks?: boolean;
  // 任务优先：若提供已有 task_id，则复用该任务
  existingTaskId?: string | null;
  // 新建任务时用户选定的模板库模板：后端会把它拷成该任务自己的参数集
  templateParamId?: string | null;
}) {
  await generateSectionsAndCreateTaskCore({
    ...params,
    extendToFirstShorelineIntersection: false,
  });
}

export async function generateComputeSectionsAndCreateTask(params: {
  uploadedData: GeoJSON.FeatureCollection;
  selectedLines: Set<string>;
  globalInterval: number;
  globalLength: number;
  globalProperties: SectionParams | null;
  setPerpendicularData: (v: GeoJSON.FeatureCollection | null) => void;
  setShowCrossLines: (v: boolean) => void;
  setGlobalProperties: (v: SectionParams | null) => void;
  // 弹窗获取任务名称（返回 null 表示用户取消）
  requestTaskName: () => Promise<string | null>;
  skipUploadBanks?: boolean;
  // 任务优先：若提供已有 task_id，则复用该任务
  existingTaskId?: string | null;
  // 新建任务时用户选定的模板库模板：后端会把它拷成该任务自己的参数集
  templateParamId?: string | null;
}) {
  await generateSectionsAndCreateTaskCore({
    ...params,
    extendToFirstShorelineIntersection: true,
  });
}

// ============================================================
// 「给已有任务补充岸段」
// ============================================================
//
// 与上面的 generateSectionsAndCreateTaskCore 是两条**互不重叠**的路：
//   · 那条是"整任务重来"：existingTaskId 非空时先 DELETE /tasks/{id}/clear，
//     把该任务的全部断面与结果清掉，再按当前选中岸段重建。
//   · 这条是"增量补充"：只为**新选的岸段**生成断面并追加，已有断面与其结果一条都不动。
//
// 所以这里刻意不调用 /clear，也不复用 `sec-${taskId}-${index}` 这套 id ——
// 那套 id 与老断面同构，追加批次一旦从 0 重新编号就会撞上已存在的 section_id。

export interface AppendBanksIntoTaskParams {
  taskId: string;
  /** 待补充的岸段（含 bank_geometry / reversed / region_code） */
  banks: any[];
  interval: number;
  length: number;
  sectionType: 'display' | 'compute';
  /** 新断面的 segment_index 起点，一般取任务已有最大值 + 1（见 taskBanksService.resolveTaskBankScope） */
  segmentIndexStart?: number;
  /** 延长到对岸时用来求交的岸线集合（不传则用本次补充的岸段自身） */
  shorelineScope?: GeoJSON.FeatureCollection | null;
  onProgress?: (message: string) => void;
}

export interface AppendBanksIntoTaskResult {
  sectionRecords: any[];
  /** 本次要铺到地图上的岸段（含"本来就关联、只是补了断面"的） */
  bankIds: string[];
  /** 其中真正新并入任务关联的岸段（`tasks.bank_ids` 原本没有的） */
  addedBankIds: string[];
  sectionCount: number;
}

export async function generateSectionsForBanksIntoTask(
  params: AppendBanksIntoTaskParams,
): Promise<AppendBanksIntoTaskResult> {
  const taskId = String(params.taskId || '').trim();
  if (!taskId) throw new Error('缺少 task_id，无法补充岸段');

  const banks = (params.banks || []).filter((b) => String(b?.bank_id ?? '').trim());
  if (banks.length === 0) throw new Error('没有选中任何岸段');

  const extend = params.sectionType === 'compute';

  // 任务参数集：任务已存在 ⇒ 取它自己那一份（后端会复用，不会新建）。
  // 不传 templateParamId：补岸段不该顺带把任务参数换成模板库里的某一份。
  const basicParamId = await ensureTaskParamsId(taskId);
  if (!basicParamId) {
    throw new Error('初始化任务参数失败，请检查后端连接或先创建参数模板');
  }

  // 批次号进 section_id：同一个任务可以被补充多次，批次间不能撞。
  const batch = Date.now().toString(36);
  let segmentIndex = Number.isFinite(params.segmentIndexStart as number)
    ? Number(params.segmentIndexStart)
    : 0;

  // 延长到对岸需要一张"所有岸线"的图；没给就退化成只用本批岸段（只能延到自己身上）。
  const scope: GeoJSON.FeatureCollection = params.shorelineScope ?? {
    type: 'FeatureCollection',
    features: banks.map((b) => ({
      type: 'Feature',
      geometry: (b.bank_geometry || b.geometry) as any,
      properties: { bank_id: b.bank_id },
    })) as any,
  };

  const sectionRecords: any[] = [];
  const createdBankIds: string[] = [];

  for (const bank of banks) {
    const bankId = String(bank.bank_id).trim();
    const bankName = String(bank.bank_name || bank.bankName || bankId);
    const regionCode = String(bank.region_code || 'Mzs');
    const reversed = !!(bank.reversed === true || bank.reversed === 'true');
    const geom = bank.bank_geometry || bank.geometry;
    const parts = toLineStrings(geom);
    if (parts.length === 0) {
      console.warn('[append-banks] 岸段无有效几何，已跳过:', bankId);
      continue;
    }

    params.onProgress?.(`正在为「${bankName}」生成断面…`);
    createdBankIds.push(bankId);

    parts.forEach((part, partIndex) => {
      const line = turf.lineString(part.coordinates as any) as GeoJSON.Feature<GeoJSON.LineString>;
      const lineLengthMeters = turf.length(line, { units: 'meters' });
      const { featureCollection } = generatePerpendicularLines(
        line,
        0,
        lineLengthMeters,
        params.interval,
        params.length,
      );

      // 反向岸段：与主流程保持一致，把断面左右端点对调，否则算出来的左右岸会反。
      if (reversed) {
        featureCollection.features.forEach((f: any) => {
          if (f.geometry?.coordinates) f.geometry.coordinates = [...f.geometry.coordinates].reverse();
          if (f.properties) {
            const lp = f.properties.leftPoint;
            f.properties.leftPoint = f.properties.rightPoint;
            f.properties.rightPoint = lp;
          }
        });
      }

      (featureCollection.features as any[]).forEach((f) => {
        let crossLine = f;
        if (extend) {
          crossLine = extendCrossLineToFirstShorelineIntersection({
            crossLine,
            uploadedData: scope,
            maxRayLengthMeters: 10000,
          });
          // 延不到对岸就不用它：留着会让后续计算拿到一条长度不足的断面
          if (!crossLine) return;
        }

        const props: any = crossLine.properties || {};
        const vfp = getVerticalFootPointFromAny(props);
        const bankIdOfPart = parts.length > 1 ? `${bankId}_part${partIndex + 1}` : bankId;

        sectionRecords.push({
          section_id: `sec-${taskId}-add${batch}-${sectionRecords.length}`,
          section_name: `断面${segmentIndex + 1}`,
          distance: Number(props.distance ?? 0),
          bank_id: bankIdOfPart,
          region_code: regionCode,
          segment_index: segmentIndex,
          geometry: crossLine.geometry,
          section_geometry: crossLine.geometry,
          ...(vfp ? { vertical_foot_point: vfp } : {}),
          basic_param_id: basicParamId,
        });
        segmentIndex += 1;
      });
    });
  }

  if (sectionRecords.length === 0) {
    throw new Error('所选岸段没有生成出任何可用断面（几何为空，或延长后仍未与岸线相交）');
  }

  params.onProgress?.(`正在保存 ${sectionRecords.length} 条断面…`);
  const sectionsResponse = await fetch('/v0/bank/sections', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      task_id: taskId,
      sections: sectionRecords,
      inherit_from_basic_param: true,
      overwrite: false,
    }),
  });

  if (!sectionsResponse.ok) {
    const errorText = await sectionsResponse.text();
    throw new Error(`保存断面失败：${sectionsResponse.status} ${sectionsResponse.statusText} ${errorText}`);
  }

  // 断面落库成功后再写任务关联：反过来（先关联后建断面）一旦断面失败，
  // 树上就会多出一个挂着 0 条断面的空岸段节点，比"断面存在但关联没写上"更难解释。
  const merged = await appendBanksToTask(taskId, createdBankIds, 'merge');
  if (!merged.ok) {
    throw new Error(merged.message || '断面已保存，但把岸段并入任务失败，请重试一次补充');
  }

  return {
    sectionRecords,
    bankIds: merged.added.length > 0 ? merged.added : createdBankIds,
    addedBankIds: merged.added,
    sectionCount: sectionRecords.length,
  };
}

export async function runCurrentTask(params: {   perpendicularData: GeoJSON.FeatureCollection;
  setPage?: (page: 'editor' | 'result', taskId?: string) => void;
}) {
  const { perpendicularData, setPage } = params;

  if (!perpendicularData || perpendicularData.features.length === 0) {
    message.warning('请先绘制断面');
    return;
  }

  const taskId = getCurrentTaskId();
  if (!taskId) {
    message.warning('未找到任务ID，请先绘制断面');
    return;
  }

  try {
    console.log(`开始分析任务: ${taskId}`);

    if (setPage) {
      setPage('result', taskId);
    }

    const response = await fetch(`/v0/bank/tasks/${taskId}/run`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      // 409 现在是可预期的结果（P2 分布式锁）：任务已在跑、或该任务下有断面在单独重算。
      // 后端把可读原因放在 error.message 里，只报 statusText 的话用户看到的是 "Conflict"。
      let detail = '';
      try {
        const body = await response.json();
        const err = body?.error as Record<string, unknown> | undefined;
        detail = String(err?.message ?? body?.message ?? '');
      } catch {
        /* body 不是 JSON 就退回状态码 */
      }
      throw new Error(detail || `${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    console.log('任务运行结果:', result);

    // 被终止**不是失败**：后端会正常返回 200 + status=cancelled（success=false）。
    // 不单独拦一下，用户点了「终止」之后看到的会是"任务运行失败"，以为自己搞坏了什么。
    if (String(result?.status ?? '') === 'cancelled') {
      const summary: any = result?.summary ?? {};
      message.warning(
        `任务已终止：已处理 ${summary.success ?? 0} 个断面（失败 ${summary.failed ?? 0}），` +
        `${summary.skipped ?? 0} 个未处理，已完成的结果保留`,
        6,
      );
    } else if (result.success) {
      message.success(`任务运行成功！状态: ${result.status}，已处理 ${result.results?.length || 0} 个断面`);
    } else {
      message.error('任务运行失败，请检查控制台');
    }
  } catch (err: any) {
    console.error('运行任务失败:', err);
    message.error(`运行任务失败: ${err.message}`);
  }
}
