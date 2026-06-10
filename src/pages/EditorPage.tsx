import { useEffect, useRef, useState } from 'react';
import * as turf from '@turf/turf';
import '../App.css';
import type { SectionParams } from '../types/sections';
import SectionPropertiesModal from '../components/SectionPropertiesModal';
import EditorSidebar from '../components/EditorSidebar';
import EditorMap from '../components/EditorMap';
import { setCurrentBasicParamId } from '../services/basicParamsService';
import type { SelectionGroup } from '../types/selection';
import { stripZFromGeoJSON } from '../utils/geojson';
import {
  configureSelectedCrossLinePropertiesAction,
  createCrossLineAtPointAction,
  createCrossLineByEndpointsAction,
  deleteCrossLinesInGroupAction,
  deleteSelectedCrossLinesAction,
  deleteSelectedCrossLineAction,
  persistCrossLineGeometryAction,
  rotateCrossLineGeometry,
  reverseCrossLinesInGroupAction,
  scaleCrossLineGeometry,
  translateSelectedCrossLineAction,
} from './editor/crossLineActions';
import { applyCustomSegmentsAction } from './editor/customSegments';
import {
  exportSectionsSampleAction,
  uploadMainGeoJsonAction,
  uploadSectionsGeoJsonAndCreateTaskAction,
} from './editor/fileActions';
import {
  generateComputeSectionsAndCreateTask,
  generateSectionsAndCreateTask,
  runCurrentTask,
} from './editor/sectionsGeneration';
import {
  fetchBasicParamDetailAsSectionParams,
  fetchBasicParamsList,
  updateBasicParamAsSectionParams,
} from './editor/basicParamsApi';
import { getCurrentTaskId } from './editor/taskState';

interface EditorPageProps {
  setPage?: (page: 'home' | 'editor' | 'result', taskId?: string) => void;
}

function EditorPage(props: EditorPageProps) {
  const { setPage } = props;
  // 上传的 GeoJSON 数据 (主线)
  const [uploadedData, setUploadedData] = useState<GeoJSON.FeatureCollection | null>(null);
  // 生成的垂线数据
  const [perpendicularData, setPerpendicularData] = useState<GeoJSON.FeatureCollection | null>(null);

  // 参数模板列表与选择（从后端获取并允许用户选择）
  const [basicParamsList, setBasicParamsList] = useState<any[]>([]);
  const [selectedBasicParamIdState, setSelectedBasicParamIdState] = useState<string | number | null>(null);

  // 所有选择组
  const [groups, setGroups] = useState<SelectionGroup[]>([]);

  // 全局垂线配置（用于首次绘制整个 GeoJSON）
  const [globalInterval, setGlobalInterval] = useState<number>(1000);
  const [globalLength, setGlobalLength] = useState<number>(1000);

  // 当前正在编辑的组ID
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

  const [showCrossLines, setShowCrossLines] = useState<boolean>(true);

  // 全局属性配置
  const [globalProperties, setGlobalProperties] = useState<SectionParams | null>(null);
  // 属性配置弹窗状态
  const [showGlobalPropertiesModal, setShowGlobalPropertiesModal] = useState<boolean>(false);
  const [editingPropertiesGroupId, setEditingPropertiesGroupId] = useState<string | null>(null);

  // 新增状态：控制岸段选择模式
  const [isSelectingShoreLines, setIsSelectingShoreLines] = useState<boolean>(false);

  // 新增状态：控制起止点选择模式
  const [isSelectingStartEnd, setIsSelectingStartEnd] = useState<boolean>(false);

  // 新增状态：选中的用于生成垂线的线段（存储线的唯一标识）
  const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set());

  // 岸段组（后端 banks 按 region_code 分组）
  const [bankGroups, setBankGroups] = useState<Array<{ region_code: string; count: number }>>([]);
  // “获取岸段”下拉框支持多选（用于批量加载 bank_id）
  const [selectedBankGroup, setSelectedBankGroup] = useState<string[]>([]);
  // 当前可选的岸段列表（按 bank_id）
  const [bankList, setBankList] = useState<any[]>([]);
  // 已加载到地图上的岸段列表
  const [loadedBanks, setLoadedBanks] = useState<any[]>([]);
  // 已加载岸段的多选状态
  const [selectedLoadedBanks, setSelectedLoadedBanks] = useState<Set<string>>(new Set());

  const prevSelectedBankGroupRef = useRef<string[]>([]);

  // 新增状态：控制断面选择模式
  const [isSelectingCrossLines, setIsSelectingCrossLines] = useState<boolean>(false);

  // 岸段方向修正：对已选岸段逐条点击，批量反转该岸段上的断面，并标记岸段 properties.reversed=true
  const [isFixingShoreLineReversed, setIsFixingShoreLineReversed] = useState<boolean>(false);

  // 新增状态：断面编辑控制模式（岸段线/自由）
  const [crossLineControlMode, setCrossLineControlMode] = useState<'shoreline' | 'free'>('shoreline');

  // 新增状态：断面编辑模式
  // - 'none': 不进行选择/添加（用于“释放选择”）
  // - 'select': 选择现有断面
  // - 'add': 新建断面
  const [crossLineEditMode, setCrossLineEditMode] = useState<'none' | 'select' | 'add'>('none');

  // 新增状态：选中的断面索引
  const [selectedCrossLineIndex, setSelectedCrossLineIndex] = useState<number | null>(null);

  // 自由模式多选：按住 Ctrl 可选择多个断面
  // 约定：selectedCrossLineIndex 作为“主选中”（用于侧边栏显示），selectedCrossLineIndices 作为多选集合
  const [selectedCrossLineIndices, setSelectedCrossLineIndices] = useState<Set<number>>(new Set());

  const clearSelectedCrossLines = () => {
    setSelectedCrossLineIndex(null);
    setSelectedCrossLineIndices(new Set());
  };

  const loadBasicParamAsGlobalProperties = async (paramIdStr: string) => {
    const { numericId, sectionParams } = await fetchBasicParamDetailAsSectionParams(paramIdStr);
    setGlobalProperties(sectionParams);
    setSelectedBasicParamIdState(paramIdStr);
    setCurrentBasicParamId(numericId);
    return sectionParams;
  };

  const getSelectedCrossLineIndices = (): number[] => {
    if (selectedCrossLineIndices.size > 0) return Array.from(selectedCrossLineIndices);
    return selectedCrossLineIndex === null ? [] : [selectedCrossLineIndex];
  };

  // 当断面数据变化时，修剪无效的选中索引，避免越界
  useEffect(() => {
    const max = perpendicularData?.features?.length ?? 0;

    setSelectedCrossLineIndices((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(Array.from(prev).filter((i) => Number.isFinite(i) && i >= 0 && i < max));
      return next.size === prev.size ? prev : next;
    });

    setSelectedCrossLineIndex((prev) => {
      if (prev === null) return prev;
      if (!Number.isFinite(prev) || prev < 0 || prev >= max) return null;
      return prev;
    });
  }, [perpendicularData]);

  // 断面验证：避免重复触发校验
  const validationTriggeredRef = useRef<Set<string>>(new Set());

  const getShoreLineId = (feature: any, index: number) => {
    const p = feature?.properties || {};
    return String(p.bank_id || p.bankId || `line-${index}`);
  };

  const patchSectionValidationProps = (sectionId: string, patch: Record<string, any>) => {
    setPerpendicularData((prev) => {
      if (!prev) return prev;
      const features = [...prev.features] as any[];
      let changed = false;

      for (let i = 0; i < features.length; i++) {
        const f = features[i];
        const sid = f?.properties?.sectionId;
        if (!sid || sid !== sectionId) continue;

        features[i] = {
          ...f,
          properties: {
            ...(f.properties || {}),
            ...patch,
          },
        };
        changed = true;
      }

      return changed ? turf.featureCollection(features as any) : prev;
    });
  };

  const validateSectionAsync = async (sectionId: string): Promise<'valid' | 'invalid' | 'pending'> => {
    try {
      const res = await fetch(`/v0/bank/sections/${sectionId}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
      }

      let data: any = null;
      try {
        data = await res.json();
      } catch {
        // 后端若没有返回 JSON，则保持 pending（黄色）
        data = null;
      }

      const rawIsValid = data?.is_valid ?? data?.isValid;
      const rawStatus = data?.validation_status ?? data?.validationStatus;
      const validationMessage = data?.validation_message ?? data?.validationMessage;

      const isValid: boolean | undefined =
        rawIsValid === true ? true : rawIsValid === false ? false : undefined;

      const normalizedStatus: string | undefined =
        typeof rawStatus === 'string' ? String(rawStatus).toLowerCase() : undefined;

      // 只有真正通过/不通过才变色：其它任何状态（含未知字符串）都视为 pending
      let mappedStatus: 'valid' | 'invalid' | 'pending' = 'pending';
      if (isValid === true) mappedStatus = 'valid';
      else if (isValid === false) mappedStatus = 'invalid';
      else if (normalizedStatus === 'valid') mappedStatus = 'valid';
      else if (normalizedStatus === 'invalid' || (normalizedStatus && normalizedStatus.startsWith('invalid'))) {
        mappedStatus = 'invalid';
      }

      patchSectionValidationProps(sectionId, {
        is_valid: isValid,
        validation_status: mappedStatus,
        validation_status_raw: normalizedStatus,
        validation_message: validationMessage,
        validation_error: undefined,
        validated_at: Date.now(),
      });

      return mappedStatus;
    } catch (err: any) {
      console.warn(`断面验证请求失败: ${sectionId}`, err);
      // 请求失败不变红，保持黄色 pending；下次可手动刷新或重试
      patchSectionValidationProps(sectionId, {
        validation_status: 'pending',
        is_valid: undefined,
        validation_status_raw: undefined,
        validation_error: err?.message || String(err),
      });

      return 'pending';
    }
  };

  // 手动触发断面校验：强制重跑一遍（即使已校验过），避免编辑移动后状态滞后
  const validateAllPendingSections = async () => {
    if (!perpendicularData || perpendicularData.features.length === 0) {
      alert('当前没有可检查的断面');
      return;
    }

    const sectionIds = new Set<string>();
    let hasMissingSectionId = false;
    (perpendicularData.features as any[]).forEach((f) => {
      const sid = f?.properties?.sectionId as string | undefined;
      if (!sid) {
        hasMissingSectionId = true;
        return;
      }
      sectionIds.add(sid);
    });

    if (sectionIds.size === 0) {
      alert('当前没有可校验的断面（缺少 sectionId）');
      return;
    }

    sectionIds.forEach((sid) => {
      patchSectionValidationProps(sid, {
        validation_status: 'pending',
        is_valid: undefined,
        validation_status_raw: undefined,
        validation_message: undefined,
        validation_error: undefined,
        validated_at: Date.now(),
      });
    });

    // 强制重跑：不受 validationTriggeredRef 的影响
    await Promise.allSettled(Array.from(sectionIds).map((sid) => validateSectionAsync(sid)));

    if (hasMissingSectionId) {
      console.warn('存在缺少 sectionId 的断面，无法参与后端校验');
    }
  };

  const validateAllSectionsBeforeAnalysis = async (): Promise<{ ok: boolean; reason?: string }> => {
    if (!perpendicularData || perpendicularData.features.length === 0) {
      return { ok: false, reason: '请先绘制断面' };
    }

    const sectionIds = new Set<string>();
    let missingSectionIdCount = 0;

    (perpendicularData.features as any[]).forEach((f) => {
      const sid = f?.properties?.sectionId as string | undefined;
      if (!sid) {
        missingSectionIdCount++;
        return;
      }
      sectionIds.add(sid);
    });

    if (missingSectionIdCount > 0) {
      return { ok: false, reason: `存在 ${missingSectionIdCount} 个断面缺少 sectionId，无法校验` };
    }
    if (sectionIds.size === 0) {
      return { ok: false, reason: '没有可校验的断面' };
    }

    // 分析前强制校验一遍，避免断面被编辑移动后状态滞后
    sectionIds.forEach((sid) => {
      patchSectionValidationProps(sid, {
        validation_status: 'pending',
        is_valid: undefined,
        validation_status_raw: undefined,
        validation_message: undefined,
        validation_error: undefined,
        validated_at: Date.now(),
      });
    });

    const results = await Promise.allSettled(Array.from(sectionIds).map((sid) => validateSectionAsync(sid)));
    const mapped = results.map((r) => (r.status === 'fulfilled' ? r.value : 'pending'));
    const allValid = mapped.every((st) => st === 'valid');
    if (!allValid) {
      return { ok: false, reason: '存在未通过或未完成校验的断面，请先修正后再分析' };
    }

    return { ok: true };
  };

  // 一键删除错误断面：删除所有未通过检查的断面，仅保留未验证(pending/undefined)与已通过(valid)
  // 同时与后端联动：对有 sectionId 的断面调用 DELETE /v0/bank/sections/{sectionId}
  const deleteAllInvalidSections = async () => {
    if (!perpendicularData || perpendicularData.features.length === 0) {
      alert('当前没有断面可删除');
      return;
    }

    const isInvalid = (props: any): boolean => {
      if (!props) return false;
      const st = props.validation_status ?? props.validationStatus;
      const stRaw = props.validation_status_raw ?? props.validationStatusRaw;
      const isValid = props.is_valid ?? props.isValid;

      if (isValid === false) return true;
      if (typeof st === 'string' && String(st).toLowerCase() === 'invalid') return true;
      if (typeof stRaw === 'string' && String(stRaw).toLowerCase().startsWith('invalid')) return true;
      return false;
    };

    const features = (perpendicularData.features as any[]) || [];
    const invalidFeatures = features.filter((f) => isInvalid(f?.properties));
    const removedCount = invalidFeatures.length;
    if (removedCount <= 0) {
      alert('没有未通过检查的断面');
      return;
    }

    const sectionIds = invalidFeatures
      .map((f) => {
        const p = f?.properties || {};
        return (p.sectionId ?? p.section_id ?? p.id) as string | undefined;
      })
      .filter(Boolean)
      .map((s) => String(s));
    const uniqueSectionIds = Array.from(new Set(sectionIds));
    const localOnlyCount = removedCount - uniqueSectionIds.length;

    const kept = features.filter((f) => !isInvalid(f?.properties));
    const ok = window.confirm(
      `确认删除所有未通过检查的断面？\n\n` +
      `将删除 ${removedCount} 条，保留 ${kept.length} 条。\n` +
      `其中可同步后端删除 ${uniqueSectionIds.length} 条${localOnlyCount > 0 ? `，仅本地删除 ${localOnlyCount} 条（缺少 sectionId）` : ''}。`,
    );
    if (!ok) return;

    // 先更新前端（删除后索引会重排）
    const remaining = kept.map((f: any, idx: number) => {
      if (f?.properties) (f.properties as any).crossLineId = idx;
      return f;
    });
    setPerpendicularData(turf.featureCollection(remaining as any));
    clearSelectedCrossLines();
    setCrossLineEditMode('none');

    // 再同步后端（仅删除有 sectionId 的）
    if (uniqueSectionIds.length === 0) {
      alert(`已删除 ${removedCount} 条断面（未同步到后端）`);
      return;
    }

    const results = await Promise.allSettled(
      uniqueSectionIds.map((sectionId) =>
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
      console.error(
        '一键删除错误断面：后端删除失败明细:',
        results
          .map((r, idx) => ({
            sectionId: uniqueSectionIds[idx],
            ok: r.status === 'fulfilled',
            reason: r.status === 'rejected' ? (r.reason as any)?.message || String(r.reason) : undefined,
          }))
          .filter((x) => !x.ok),
      );
      alert(
        `已删除 ${removedCount} 条断面；后端同步成功 ${uniqueSectionIds.length - failCount}，失败 ${failCount}`,
      );
    } else {
      alert(`已删除 ${removedCount} 条断面（已同步到后端）`);
    }
  };

  // 当断面集合变化时，自动异步触发后端验证
  useEffect(() => {
    if (!perpendicularData || perpendicularData.features.length === 0) return;

    const sectionIdsToValidate: string[] = [];
    (perpendicularData.features as any[]).forEach((f) => {
      const sectionId = f?.properties?.sectionId as string | undefined;
      if (!sectionId) return;

      if (validationTriggeredRef.current.has(sectionId)) return;
      validationTriggeredRef.current.add(sectionId);
      sectionIdsToValidate.push(sectionId);

      // 初始标记为 pending（黄色）
      if (!f?.properties?.validation_status) {
        patchSectionValidationProps(sectionId, { validation_status: 'pending' });
      }
    });

    if (sectionIdsToValidate.length === 0) return;
    sectionIdsToValidate.forEach((sid) => {
      validateSectionAsync(sid);
    });
  }, [perpendicularData]);

  // 挂载时拉取可用的基础参数模板列表
  useEffect(() => {
    const fetchBasicParams = async () => {
      try {
        const list = await fetchBasicParamsList();
        setBasicParamsList(list);
        console.log('拉取到的基础参数模板列表:', list);

        if (list.length > 0) {
          const first: any = list[0];
          const paramId = first.param_id ?? first.id ?? null;
          if (paramId !== null) {
            setCurrentBasicParamId(first.id ?? null);
            try {
              await loadBasicParamAsGlobalProperties(String(paramId));
            } catch (innerErr) {
              console.warn('加载默认基础参数模板详情失败:', innerErr);
              setSelectedBasicParamIdState(String(paramId));
            }
          }
        }
      } catch (err) {
        console.warn('加载基础参数模板列表出错:', err);
      }
    };

    fetchBasicParams();
  }, []);

  const fetchBankGroups = async () => {
    try {
      // 目前岸段仅使用：GET /v0/bank/banks?region_code=...
      const res = await fetch('/v0/bank/banks?region_code=Mzs');
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      const banks = (data?.banks || data?.data || data) as any[];
      const list = Array.isArray(banks) ? banks : [];

      setBankGroups([{ region_code: 'Mzs', count: list.length }]);
      setBankList(list);
    } catch (err) {
      console.error('获取岸段组失败:', err);
      setBankGroups([]);
    }
  };

  const loadBankById = async (bankId: string) => {
    if (!bankId) return;
    try {
      // 尝试按 REST 资源路径获取单条
      let res = await fetch(`/v0/bank/banks/${encodeURIComponent(bankId)}`);
      if (!res.ok) {
        // 退回到查询参数形式
        res = await fetch(`/v0/bank/banks?bank_id=${encodeURIComponent(bankId)}`);
      }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      const bank = (data?.bank || data?.banks?.[0] || data?.data || data) as any;
      const b = Array.isArray(bank) ? bank[0] : bank;
      if (!b || !b.geometry) {
        alert('未找到指定的岸段或该岸段无几何数据');
        return;
      }

      const newFeature = {
        type: 'Feature' as const,
        geometry: b.geometry,
        properties: {
          index: uploadedData ? uploadedData.features.length : 0,
          bank_id: b.bank_id,
          bank_name: b.bank_name,
          region_code: b.region_code,
          reversed: !!(b?.reversed === true || b?.reversed === 'true'),
          description: b.description,
          from_backend: true,
        },
      } as any;

      // 如果已存在相同 bank_id，避免重复加载
      const exists = uploadedData?.features.some((f: any) => {
        const p = f?.properties || {};
        return String(p.bank_id || p.bankId || '') === String(b.bank_id);
      });
      if (exists) {
        // alert(`岸段 ${b.bank_id} 已在编辑器中，已跳过重复加载`);
        return;
      }

      setUploadedData((prev) => {
        if (!prev) return { type: 'FeatureCollection', features: [newFeature] } as any;
        const next = { ...prev, features: [...prev.features, newFeature] } as any;
        return next;
      });

      // 添加到已加载岸段列表
      setLoadedBanks((prev) => {
        const exists = prev.some((bank) => String(bank.bank_id) === String(b.bank_id));
        if (exists) return prev;
        return [...prev, b];
      });

      // 不清空现有选择，允许多条岸段共存。仅将编辑模式调整为默认关闭，避免干扰当前操作。
      setIsSelectingShoreLines(false);
      setIsSelectingStartEnd(false);
      setIsSelectingCrossLines(false);
      setIsFixingShoreLineReversed(false);
      setCrossLineEditMode('none');
    } catch (err: any) {
      console.error('加载岸段失败:', err);
      alert(`加载岸段失败: ${err?.message || String(err)}`);
    }
  };

  const deleteBankById = async (bankId: string) => {
    if (!bankId) return;
    const ok = window.confirm(`确认删除岸段 bank_id=${bankId} ?`);
    if (!ok) return;

    try {
      const res = await fetch(`/v0/bank/banks/${encodeURIComponent(bankId)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      alert('已删除岸段');
      prevSelectedBankGroupRef.current = [];
      setSelectedBankGroup([]);

      // 删除后同步移除该 bank 的“选中用于生成断面”的标记
      setSelectedLines((prev) => {
        if (!prev || prev.size === 0) return prev;
        if (!prev.has(bankId)) return prev;
        const next = new Set(prev);
        next.delete(bankId);
        return next;
      });

      // 同步从前端已加载的要素中移除该 bank
      setUploadedData((prev) => {
        if (!prev) return prev;
        const features = (prev.features || []).filter((f: any) => {
          const p = f?.properties || {};
          return String(p.bank_id || p.bankId || '') !== String(bankId);
        });
        return { ...prev, features } as any;
      });
      await fetchBankGroups();
    } catch (err: any) {
      console.error('删除岸段失败:', err);
      alert(`删除岸段失败: ${err?.message || String(err)}`);
    }
  };

  const deleteBanksByIds = async (bankIds: string[]) => {
    const ids = Array.from(new Set((bankIds || []).map(String))).filter(Boolean);
    if (ids.length === 0) return;

    const ok = window.confirm(`确认批量删除已选 ${ids.length} 条岸段？`);
    if (!ok) return;

    const results = await Promise.allSettled(
      ids.map((bankId) =>
        fetch(`/v0/bank/banks/${encodeURIComponent(bankId)}`, { method: 'DELETE' }).then((res) => {
          if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
          return true;
        }),
      ),
    );

    const successIds: string[] = [];
    const failed: Array<{ bankId: string; reason: string }> = [];
    results.forEach((r, idx) => {
      const bankId = ids[idx];
      if (r.status === 'fulfilled') successIds.push(bankId);
      else failed.push({ bankId, reason: (r.reason as any)?.message || String(r.reason) });
    });

    if (successIds.length > 0) {
      const successSet = new Set(successIds);

      prevSelectedBankGroupRef.current = [];
      setSelectedBankGroup([]);

      setSelectedLines((prev) => {
        if (!prev || prev.size === 0) return prev;
        const next = new Set(prev);
        successIds.forEach((id) => next.delete(id));
        return next.size === prev.size ? prev : next;
      });

      setUploadedData((prev) => {
        if (!prev) return prev;
        const features = (prev.features || []).filter((f: any) => {
          const p = f?.properties || {};
          const id = String(p.bank_id || p.bankId || '');
          return !successSet.has(id);
        });
        return { ...prev, features } as any;
      });
    }

    await fetchBankGroups();

    if (failed.length > 0) {
      console.error('批量删除岸段失败明细:', failed);
      alert(`批量删除完成：成功 ${successIds.length}，失败 ${failed.length}。首个失败 bank_id=${failed[0].bankId}：${failed[0].reason}`);
    } else {
      alert(`已批量删除 ${successIds.length} 条岸段`);
    }
  };

  // 清除已加载的岸段：仅从地图与本地列表移除，不删除后端数据
  const deleteLoadedBanks = () => {
    const selected = Array.from(selectedLoadedBanks);
    if (selected.length === 0) {
      alert('请先选择要清除的岸段');
      return;
    }

    const ok = window.confirm(`确认从地图上清除已选的 ${selected.length} 条岸段？`);
    if (!ok) return;

    setLoadedBanks((prev) => prev.filter((bank) => !selected.includes(String(bank.bank_id))));

    setUploadedData((prev) => {
      if (!prev) return prev;
      const features = (prev.features || []).filter((f: any) => {
        const p = f?.properties || {};
        const id = String(p.bank_id || p.bankId || '');
        return !selected.includes(id);
      });
      return { ...prev, features } as any;
    });

    setSelectedLines((prev) => {
      if (!prev || prev.size === 0) return prev;
      const next = new Set(prev);
      selected.forEach((id) => next.delete(id));
      return next.size === prev.size ? prev : next;
    });

    setSelectedLoadedBanks(new Set());
  };

  type SmoothParams = {
    passes: number;
    lookAhead: number;
    minSpan: number;
    maxSpan: number;
    nearFactor: number;
  };

  const smoothLineCoordinates = (coords: number[][], params: SmoothParams): number[][] => {
    const cleaned = (coords || [])
      .map((c) => [Number(c?.[0]), Number(c?.[1])])
      .filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1])) as number[][];

    if (cleaned.length < 3) return cleaned;

    const dist = (a: number[], b: number[]) => {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      return Math.sqrt(dx * dx + dy * dy);
    };

    const pointSegDist = (p: number[], a: number[], b: number[]) => {
      const abx = b[0] - a[0];
      const aby = b[1] - a[1];
      const apx = p[0] - a[0];
      const apy = p[1] - a[1];
      const ab2 = abx * abx + aby * aby;
      if (ab2 <= 0) return dist(p, a);
      const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));
      const qx = a[0] + abx * t;
      const qy = a[1] + aby * t;
      const dx = p[0] - qx;
      const dy = p[1] - qy;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const isClosed = cleaned.length >= 4 && dist(cleaned[0], cleaned[cleaned.length - 1]) <= 1e-12;
    let base = isClosed ? cleaned.slice(0, -1) : cleaned.slice();
    if (base.length < 3) return cleaned;

    let total = 0;
    for (let i = 0; i < base.length - 1; i++) total += dist(base[i], base[i + 1]);
    if (isClosed && base.length > 2) total += dist(base[base.length - 1], base[0]);
    const edgeCount = isClosed ? base.length : Math.max(1, base.length - 1);
    const avgStep = Math.max(total / Math.max(1, edgeCount), 1e-9);

    // 使用传入的平滑参数（首次平滑时保存并在后续迭代中复用），避免随迭代次数提高约束
    const passes = params.passes;
    const lookAhead = params.lookAhead;
    const minSpan = params.minSpan;
    const maxSpan = params.maxSpan;
    const nearFactor = params.nearFactor;

    for (let pass = 0; pass < passes; pass++) {
      if (base.length < (isClosed ? 6 : 4)) break;

      const next: number[][] = [];
      let i = 0;
      const lastIdx = base.length - 1;
      const endIdx = isClosed ? base.length : lastIdx;

      while (i < endIdx) {
        const curr = base[i];
        next.push(curr);

        // 开放线保护首尾，避免端点拓扑漂移
        if (!isClosed && (i === 0 || i >= lastIdx - minSpan)) {
          i += 1;
          continue;
        }

        let bestJ = -1;
        let bestNear = Number.POSITIVE_INFINITY;
        const maxJ = Math.min(lastIdx, i + lookAhead);

        for (let j = i + minSpan; j <= maxJ; j++) {
          const near = dist(curr, base[j]);
          if (near < bestNear) {
            bestNear = near;
            bestJ = j;
          }
        }

        if (bestJ <= i + minSpan) {
          i += 1;
          continue;
        }

        // 保护岛屿：如果跨越距离太大（折点少），直接跳过不删除
        const span = bestJ - i;
        if (span > maxSpan) {
          i += 1;
          continue;
        }

        const nearLimit = avgStep * nearFactor;
        // 增加最小阈值检查：如果最近距离小于avgStep的0.35，说明是折点少的区域，保护它
        if (bestNear > nearLimit || bestNear < avgStep * 0.35) {
          i += 1;
          continue;
        }

        let arcLen = 0;
        let maxDev = 0;
        for (let k = i; k < bestJ; k++) {
          arcLen += dist(base[k], base[k + 1]);
        }
        for (let k = i + 1; k < bestJ; k++) {
          maxDev = Math.max(maxDev, pointSegDist(base[k], base[i], base[bestJ]));
        }

        const chord = Math.max(dist(base[i], base[bestJ]), 1e-12);
        const detourRatio = arcLen / chord;

        // 仅删除“走了明显弯路且偏离主线”的局部突起，保留原有大尺度弯曲。
        const shouldClip =
          detourRatio > 1.15 &&
          maxDev > avgStep * 0.7 &&
          arcLen > bestNear * 1.2;

        if (shouldClip) {
          i = bestJ;
          continue;
        }

        i += 1;
      }

      if (!isClosed) {
        const tail = base[lastIdx];
        const prev = next[next.length - 1];
        if (!prev || prev[0] !== tail[0] || prev[1] !== tail[1]) {
          next.push(tail);
        }
      }

      // 闭合线保形：保证最少点数并闭合，不做均值平滑，避免整圈缩小。
      if (isClosed && next.length >= 3) {
        base = next;
      } else if (!isClosed && next.length >= 2) {
        base = next;
      } else {
        break;
      }
    }

    if (isClosed) {
      if (base.length < 3) return cleaned;
      const first = base[0];
      const last = base[base.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        return [...base, [first[0], first[1]]];
      }
      return base;
    }

    return base;
  };

  const smoothSelectedShoreLines = () => {
    if (!uploadedData || uploadedData.features.length === 0) {
      alert('请先加载岸段数据');
      return;
    }

    if (selectedLines.size === 0) {
      alert('请先点击拾取需要平滑的岸段');
      return;
    }

    let changedCount = 0;
    const nextFeatures = (uploadedData.features as any[]).map((f, index) => {
      const shoreLineId = getShoreLineId(f, index);
      if (!selectedLines.has(shoreLineId)) return f;

      const props = f?.properties || {};
      const prevLevelRaw = props.smooth_level ?? props.smoothLevel;
      const prevLevel = Number.isFinite(Number(prevLevelRaw)) ? Number(prevLevelRaw) : 0;
      const nextLevel = prevLevel + 1;

      // const computeParamsFromLevel = (lvl: number) => {
      //   const passes = Math.min(3, Math.max(1, lvl));
      //   const lookAhead = Math.min(20, 10 + lvl * 1.5);
      //   const minSpan = 3;
      //   const maxSpan = 12;
      //   const nearFactor = Math.min(1.8, 1.5 + lvl * 0.08);
      //   return { passes, lookAhead, minSpan, maxSpan, nearFactor } as any;
      // };

      const computeParamsFromLevel = () => {
        const passes = 10;        // 每轮执行3次平滑，力度拉满
        const lookAhead = 20;   // 往前看更远，能识别更大范围的凸起
        const minSpan = 2;      // 放宽最小跨点，小折点也能处理
        const maxSpan = 30;     // 允许跨更多点，删掉较大突出部位
        const nearFactor = 20.2; // 大幅放宽距离阈值，更容易判定为可拉直
        return { passes, lookAhead, minSpan, maxSpan, nearFactor } as any;
      };

      // 首次平滑时计算并保存参数；后续复用该参数，避免随迭代次数提高约束
      const existingParams = props.smooth_params as SmoothParams | undefined;
      const paramsToUse: SmoothParams = existingParams ?? computeParamsFromLevel();

      if (f?.geometry?.type === 'LineString') {
        const coords = (f.geometry.coordinates as number[][]) || [];
        const smoothedCoords = smoothLineCoordinates(coords, paramsToUse);
        if (smoothedCoords.length < 2) return f;
        changedCount++;
        return {
          ...f,
          geometry: {
            type: 'LineString',
            coordinates: smoothedCoords,
          },
          properties: {
            ...props,
            smooth_level: nextLevel,
            smooth_params: paramsToUse,
            smoothed_at: Date.now(),
          },
        };
      }

      if (f?.geometry?.type === 'MultiLineString') {
        const parts = (f.geometry.coordinates as number[][][]) || [];
        const smoothedParts = parts
          .map((part) => smoothLineCoordinates(part || [], paramsToUse))
          .filter((part) => part.length >= 2);

        if (smoothedParts.length === 0) return f;
        changedCount++;
        return {
          ...f,
          geometry: {
            type: 'MultiLineString',
            coordinates: smoothedParts,
          },
          properties: {
            ...props,
            smooth_level: nextLevel,
            smooth_params: paramsToUse,
            smoothed_at: Date.now(),
          },
        };
      }

      return f;
    });

    if (changedCount <= 0) {
      alert('未找到可平滑的线要素（仅支持 LineString / MultiLineString）');
      return;
    }

    setUploadedData({
      ...uploadedData,
      features: nextFeatures,
    } as any);

  };

  const loadBankGroup = async (regionCode: string) => {
    if (!regionCode) return;
    try {
      const res = await fetch(`/v0/bank/banks?region_code=${encodeURIComponent(regionCode)}`);
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      const banks = (data?.banks || data?.data || data) as any[];
      const list = Array.isArray(banks) ? banks : [];

      const features = list
        .filter((b) => b?.geometry)
        .map((b, index) => ({
          type: 'Feature' as const,
          geometry: b.geometry,
          properties: {
            index,
            bank_id: b.bank_id,
            bank_name: b.bank_name,
            region_code: b.region_code,
            reversed: !!(b?.reversed === true || b?.reversed === 'true'),
            description: b.description,
            from_backend: true,
          },
        }));

      setUploadedData({ type: 'FeatureCollection', features } as any);
      setSelectedLines(new Set());
      setIsSelectingShoreLines(false);
      setIsSelectingStartEnd(false);
      setIsSelectingCrossLines(false);
      setIsFixingShoreLineReversed(false);
      setCrossLineEditMode('none');
      clearSelectedCrossLines();
    } catch (err: any) {
      console.error('加载岸段组失败:', err);
      alert(`加载岸段组失败: ${err?.message || String(err)}`);
    }
  };

  const deleteBankGroup = async () => {
    if (!selectedBankGroup || selectedBankGroup.length === 0) {
      alert('请先选择要删除的岸段组');
      return;
    }

    // 多选时避免误删：仍然只允许删除单个 region_code
    if (selectedBankGroup.length !== 1) {
      alert('删除岸段组仅支持单选一个 region_code，请先只选择一个再删除');
      return;
    }

    const regionCode = selectedBankGroup[0];
    const ok = window.confirm(`确认删除岸段组 region_code=${regionCode} 下的全部岸段？`);
    if (!ok) return;

    try {
      const res = await fetch(`/v0/bank/banks?region_code=${encodeURIComponent(regionCode)}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      const banks = (data?.banks || data?.data || data) as any[];
      const list = Array.isArray(banks) ? banks : [];
      const ids = list.map((b) => b?.bank_id).filter(Boolean) as string[];
      if (ids.length === 0) {
        alert('该组下没有可删除的岸段');
        return;
      }

      const results = await Promise.allSettled(
        ids.map((id) => fetch(`/v0/bank/banks/${encodeURIComponent(id)}`, { method: 'DELETE' })),
      );
      const okCount = results.filter((r) => r.status === 'fulfilled' && (r.value as any).ok).length;
      const failCount = results.length - okCount;
      if (failCount > 0) {
        alert(`删除完成：成功 ${okCount}，失败 ${failCount}`);
      } else {
        alert(`已删除 ${okCount} 条岸段`);
      }

      setSelectedBankGroup([]);
      await fetchBankGroups();
    } catch (err: any) {
      console.error('删除岸段组失败:', err);
      alert(`删除岸段组失败: ${err?.message || String(err)}`);
    }
  };

  const handleSelectBanksFromDropdown = async (nextSelected: string[]) => {
    // 计算增量，只加载“新选中的”条目
    const prev = prevSelectedBankGroupRef.current;
    prevSelectedBankGroupRef.current = nextSelected;
    setSelectedBankGroup(nextSelected);

    const added = nextSelected.filter((v) => !prev.includes(v));
    if (added.length === 0) return;

    // 如果选中了 region_code（兜底分支），按原行为加载整组；为了避免多选语义混乱，强制单选该 region
    const regionAdded = added.find((v) => bankGroups.some((g) => g.region_code === v));
    if (regionAdded) {
      await loadBankGroup(regionAdded);
      prevSelectedBankGroupRef.current = [regionAdded];
      setSelectedBankGroup([regionAdded]);
      return;
    }

    for (const bankId of added) {
      await loadBankById(bankId);
    }
  };

  // 挂载时拉取岸段组列表（用于下拉框）
  useEffect(() => {
    fetchBankGroups();
  }, []);

  // 当用户选择模板时，拉取模板详情并设置为全局属性
  const handleSelectBasicParam = async (paramIdStr: string | null) => {
    if (!paramIdStr) {
      setSelectedBasicParamIdState(null);
      setCurrentBasicParamId(null);
      setGlobalProperties(null);
      return;
    }

    try {
      await loadBasicParamAsGlobalProperties(paramIdStr);
    } catch (err) {
      console.warn('加载模板详情失败:', err);
    }
  };

  const openGlobalPropertiesModal = async () => {
    const paramIdStr = selectedBasicParamIdState === null ? '' : String(selectedBasicParamIdState);
    if (!paramIdStr) {
      alert('请先选择一个参数模板');
      return;
    }

    if (!globalProperties) {
      try {
        await loadBasicParamAsGlobalProperties(paramIdStr);
      } catch (err) {
        console.warn('打开属性配置时加载模板详情失败:', err);
        alert('当前模板详情加载失败，请重试');
        return;
      }
    }

    setShowGlobalPropertiesModal(true);
  };

  // 反转选中的断面（交换端点并同步到后端如果存在）
  const reverseSelectedCrossLine = async () => {
    if (!perpendicularData || perpendicularData.features.length === 0) {
      alert('当前没有断面可反切');
      return;
    }

    const indices = getSelectedCrossLineIndices();
    if (indices.length === 0) {
      alert('请先选择要反切的断面');
      return;
    }

    const unique = Array.from(new Set(indices)).filter(
      (i) => Number.isFinite(i) && i >= 0 && i < perpendicularData.features.length,
    );
    if (unique.length === 0) {
      alert('请选择有效的断面');
      return;
    }

    // 先本地批量反切
    const updatedFeatures = [...(perpendicularData.features as any[])];
    const sectionIdsToSync: string[] = [];

    unique.forEach((idx) => {
      const f: any = updatedFeatures[idx];
      if (!f || f.geometry?.type !== 'LineString') return;
      const coords = (f.geometry.coordinates as number[][]) || [];
      if (coords.length < 2) return;

      const nextProps: any = { ...(f.properties || {}) };
      if (nextProps.leftPoint && nextProps.rightPoint) {
        const oldLeft = nextProps.leftPoint;
        nextProps.leftPoint = nextProps.rightPoint;
        nextProps.rightPoint = oldLeft;
      }

      updatedFeatures[idx] = {
        ...f,
        geometry: {
          type: 'LineString',
          coordinates: [...coords].reverse(),
        },
        properties: nextProps,
      };

      const sid = nextProps.sectionId ?? nextProps.section_id ?? nextProps.id;
      if (sid) sectionIdsToSync.push(String(sid));
    });

    setPerpendicularData(turf.featureCollection(updatedFeatures as any));

    // 再同步到后端（存在 sectionId 的才同步）
    if (sectionIdsToSync.length > 0) {
      const results = await Promise.allSettled(
        sectionIdsToSync.map((sectionId) =>
          fetch(`/v0/bank/sections/${encodeURIComponent(sectionId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reverse: true }),
          }).then((res) => {
            if (!res.ok) throw new Error(res.statusText);
            return true;
          }),
        ),
      );

      const failedCount = results.filter((r) => r.status === 'rejected').length;
      if (failedCount > 0) {
        alert(`反切同步后端失败 ${failedCount} 条（其余已完成）`);
      }
    }
  };

  // 切换岸段选择模式
  const toggleShoreLineSelection = () => {
    setIsSelectingShoreLines(!isSelectingShoreLines);
    if (isSelectingStartEnd) {
      setIsSelectingStartEnd(false); // 关闭起止点选择模式
    }
    if (isSelectingCrossLines) {
      setIsSelectingCrossLines(false); // 关闭断面选择模式
    }
  };

  // 全选或取消全选所有岸段
  const toggleSelectAllShoreLines = () => {
    if (!uploadedData) {
      alert('请先上传 GeoJSON 数据');
      return;
    }

    // 如果当前已经全选了（选中数量等于可选线要素数量），则清空
    const selectableIds: string[] = [];
    uploadedData.features.forEach((f: any, index: number) => {
      if (f?.geometry?.type === 'LineString' || f?.geometry?.type === 'MultiLineString') {
        selectableIds.push(getShoreLineId(f, index));
      }
    });

    if (selectedLines.size === selectableIds.length && selectableIds.length > 0) {
      setSelectedLines(new Set());
    } else {
      setSelectedLines(new Set(selectableIds));
    }
  };

  // 切换起止点选择模式
  const toggleStartEndSelection = () => {
    setIsSelectingStartEnd(!isSelectingStartEnd);
    if (isSelectingShoreLines) {
      setIsSelectingShoreLines(false); // 关闭岸段选择模式
    }
    if (isSelectingCrossLines) {
      setIsSelectingCrossLines(false); // 关闭断面选择模式
    }
  };

  // 切换断面选择模式
  const toggleCrossLineSelection = () => {
    const next = !isSelectingCrossLines;
    setIsSelectingCrossLines(next);

    if (next) {
      if (isSelectingShoreLines) setIsSelectingShoreLines(false);
      if (isSelectingStartEnd) setIsSelectingStartEnd(false);
      // 进入精调时默认不选中任何工具，避免误触
      setCrossLineEditMode('none');
      clearSelectedCrossLines();
    } else {
      // 退出精调时取消所有选择并释放断面
      clearSelectedCrossLines();
      setCrossLineEditMode('none');
      setCrossLineControlMode('shoreline');
    }
  };

  const clearSelectedCrossLineSelection = () => {
    clearSelectedCrossLines();
  };

  const toggleFixShoreLineReversed = () => {
    setIsFixingShoreLineReversed((prev) => {
      const next = !prev;
      if (next) {
        // 开启修正时，退出其它编辑/选择模式，避免点击冲突
        setIsSelectingShoreLines(false);
        setIsSelectingStartEnd(false);
        setIsSelectingCrossLines(false);
        setCrossLineEditMode('none');
        clearSelectedCrossLines();
      }
      return next;
    });
  };

  const fixSelectedShoreLineReversed = async (params: { shoreLineIndex: number; shoreLineId: string }) => {
    const { shoreLineIndex, shoreLineId } = params;

    if (!uploadedData) {
      alert('未加载岸段数据');
      return;
    }

    if (!perpendicularData || perpendicularData.features.length === 0) {
      alert('请先生成断面后再修正');
      return;
    }

    if (!selectedLines.has(shoreLineId)) {
      alert('修正仅对已选岸段生效');
      return;
    }

    const targetFeature: any = uploadedData.features?.[shoreLineIndex];
    const rawReversed = targetFeature?.properties?.reversed;
    const currentReversed = rawReversed === true || rawReversed === 'true' ? true : false;
    const nextReversed = !currentReversed;

    const updatedFeatures = [...(perpendicularData.features as any[])];
    const reversedIndices: number[] = [];

    updatedFeatures.forEach((f, idx) => {
      const props = f?.properties || {};
      if (props.shoreLineId !== shoreLineId) return;
      if (f?.geometry?.type !== 'LineString') return;
      const coords = (f.geometry.coordinates as any[]) || [];
      if (coords.length < 2) return;

      const nextProps: any = { ...props };
      if (nextProps.leftPoint && nextProps.rightPoint) {
        const oldLeft = nextProps.leftPoint;
        nextProps.leftPoint = nextProps.rightPoint;
        nextProps.rightPoint = oldLeft;
      }

      updatedFeatures[idx] = {
        ...f,
        geometry: {
          type: 'LineString',
          coordinates: [...coords].reverse(),
        },
        properties: nextProps,
      };

      reversedIndices.push(idx);
    });

    if (reversedIndices.length === 0) {
      alert('该岸段下未找到可反转的断面');
      return;
    }

    setPerpendicularData(turf.featureCollection(updatedFeatures as any));

    // 切换岸段 reversed 标记（用于后续重新生成断面时保持方向一致）
    setUploadedData((prev) => {
      if (!prev) return prev;
      const next = { ...prev, features: [...prev.features] } as any;
      const feat: any = next.features?.[shoreLineIndex];
      if (!feat) return next;
      feat.properties = { ...(feat.properties || {}), reversed: nextReversed };
      return next;
    });

    const sectionsToSync = reversedIndices
      .map((idx) => {
        const f: any = updatedFeatures[idx];
        return f?.properties?.sectionId as string | undefined;
      })
      .filter(Boolean) as string[];

    const actionLabel = nextReversed ? '反转' : '反转回'

    if (sectionsToSync.length === 0) {
      alert(`已修正岸段 ${shoreLineId}（reversed=${String(nextReversed)}）：${actionLabel} ${reversedIndices.length} 条断面（未同步到后端）`);
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
      alert(
        `已修正岸段 ${shoreLineId}（reversed=${String(nextReversed)}）：${actionLabel} ${reversedIndices.length} 条断面；后端同步成功 ${successCount}，失败 ${failedCount}`,
      );
    } else {
      alert(`已修正岸段 ${shoreLineId}（reversed=${String(nextReversed)}）：${actionLabel} ${reversedIndices.length} 条断面（已同步到后端）`);
    }
  };

  const sendSelectedShoreLinesGeoJson = async () => {
    if (!uploadedData) {
      alert('未加载岸段数据');
      return;
    }
    if (selectedLines.size === 0) {
      alert('请先选择用于生成断面的岸段');
      return;
    }

    const selectedFeatures = uploadedData.features
      .map((f: any, index: number) => ({ f, index }))
      .filter(({ f, index }) => selectedLines.has(getShoreLineId(f, index)))
      .map(({ f }) => f);

    const toLineStrings = (geometry: any): Array<{ type: 'LineString'; coordinates: any[] }> => {
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
    };

    const banksToSend: any[] = [];
    const currentTaskId = getCurrentTaskId();
    const taskPrefix = currentTaskId ? `${currentTaskId}-` : '';
    selectedFeatures.forEach((f: any, index: number) => {
      const props = f?.properties || {};
      const baseId = getShoreLineId(f, index);
      const baseName = String(props.bank_name || props.bankName || props.name || baseId);
      const regionCode = String(props.region_code || props.regionCode || 'Mzs');
      const reversed = !!(props && (props.reversed === true || props.reversed === 'true'));
      const description = String(props.description || '');

      const parts = toLineStrings(f?.geometry);
      parts.forEach((geom, partIndex) => {
        const geom2d = stripZFromGeoJSON(geom as any) as any;
        const suffix = parts.length > 1 ? `_part${partIndex + 1}` : '';
        const bankId = `${taskPrefix}${baseId}${suffix}`;
        const bankName = parts.length > 1 ? `${baseName}_${partIndex + 1}` : baseName;
        banksToSend.push({
          bank_id: String(bankId),
          bank_name: bankName,
          region_code: regionCode,
          geometry: geom2d,
          bank_geometry: geom2d,
          reversed,
          description,
        });
      });
    });

    if (banksToSend.length === 0) {
      alert('没有可发送的岸段（仅支持 LineString / MultiLineString）');
      return;
    }

    try {
      const results: Array<{ bank_id: string; ok: boolean; status?: number; message?: string }> = [];

      for (const bank of banksToSend) {
        const payload = { banks: [bank], overwrite: false };
        try {
          console.log('POST /v0/bank/banks payload for', bank.bank_id, JSON.stringify(payload, null, 2));
        } catch (e) {
          console.log('POST /v0/bank/banks payload for', bank.bank_id, payload);
        }
        const res = await fetch('/v0/bank/banks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const t = await res.text();
          results.push({
            bank_id: String(bank.bank_id),
            ok: false,
            status: res.status,
            message: `${res.status} ${res.statusText} ${t}`,
          });
        } else {
          results.push({ bank_id: String(bank.bank_id), ok: true, status: res.status });
        }
      }

      const okCount = results.filter((r) => r.ok).length;
      const fail = results.filter((r) => !r.ok);

      if (fail.length > 0) {
        const first = fail[0];
        console.error('发送岸段失败明细:', fail);
        alert(`发送完成：成功 ${okCount}，失败 ${fail.length}。首个失败 bank_id=${first.bank_id}：${first.message}`);
      } else {
        alert(`已成功发送 ${okCount} 条岸段到后端`);
      }

      await fetchBankGroups();
    } catch (err: any) {
      console.error('发送岸段到 /v0/bank/banks 失败:', err);
      alert(`发送岸段失败: ${err?.message || String(err)}`);
    }
  };

  // 在指定位置新建断面
  const createCrossLineAtPoint = async (line: GeoJSON.Feature<GeoJSON.LineString>, distanceOnLine: number) => {
    await createCrossLineAtPointAction({
      line,
      distanceOnLine,
      globalLength,
      perpendicularData,
      globalProperties,
      setGlobalProperties,
      setPerpendicularData,
    });
  };

  // 删除选中的断面
  const deleteSelectedCrossLine = async () => {
    const indices = getSelectedCrossLineIndices();
    if (indices.length > 1) {
      await deleteSelectedCrossLinesAction({
        selectedCrossLineIndices: indices,
        perpendicularData,
        setPerpendicularData,
        setSelectedCrossLineIndex: (v) => {
          setSelectedCrossLineIndex(v);
          if (v === null) setSelectedCrossLineIndices(new Set());
        },
      });
      // 删除后索引会重排，直接清空多选以避免错位
      setSelectedCrossLineIndices(new Set());
      return;
    }

    await deleteSelectedCrossLineAction({
      selectedCrossLineIndex,
      perpendicularData,
      setPerpendicularData,
      setSelectedCrossLineIndex: (v) => {
        setSelectedCrossLineIndex(v);
        if (v === null) setSelectedCrossLineIndices(new Set());
      },
    });

    // 单删也清空多选，避免索引错位
    setSelectedCrossLineIndices(new Set());
  };

  // 平移选中的断面
  const translateSelectedCrossLine = async (offsetMeters: number) => {
    await translateSelectedCrossLineAction({
      offsetMeters,
      selectedCrossLineIndex,
      perpendicularData,
      uploadedData,
      setPerpendicularData,
    });
  };

  // 仅更新前端断面几何（用于自由模式拖动/旋转/缩放的即时反馈）
  const updateCrossLineGeometryLocal = (crossLineIndex: number, geometry: GeoJSON.LineString) => {
    setPerpendicularData((prev) => {
      if (!prev) return prev;
      const features = [...prev.features] as GeoJSON.Feature<GeoJSON.Geometry>[];
      const current: any = features[crossLineIndex];
      if (!current || current.geometry?.type !== 'LineString') return prev;

      const coords = geometry.coordinates as number[][];
      if (!coords || coords.length < 2) return prev;

      const leftPoint = coords[0];
      const rightPoint = coords[coords.length - 1];

      features[crossLineIndex] = {
        ...current,
        geometry,
        properties: {
          ...(current.properties || {}),
          crossLineId: (current.properties as any)?.crossLineId ?? crossLineIndex,
          leftPoint,
          rightPoint,
        },
      };

      return turf.featureCollection(features as any);
    });
  };

  // 批量更新前端断面几何（用于自由模式多选拖动结束时一次性落盘，避免 N 次 setState）
  const applyCrossLineGeometriesLocal = (
    updates: Array<{ crossLineIndex: number; geometry: GeoJSON.LineString }>,
  ) => {
    if (!updates || updates.length === 0) return;

    setPerpendicularData((prev) => {
      if (!prev) return prev;
      const features = [...prev.features] as GeoJSON.Feature<GeoJSON.Geometry>[];
      let changed = false;

      updates.forEach(({ crossLineIndex, geometry }) => {
        if (!Number.isFinite(crossLineIndex) || crossLineIndex < 0 || crossLineIndex >= features.length) return;
        const current: any = features[crossLineIndex];
        if (!current || current.geometry?.type !== 'LineString') return;

        const coords = geometry.coordinates as number[][];
        if (!coords || coords.length < 2) return;

        const leftPoint = coords[0];
        const rightPoint = coords[coords.length - 1];

        features[crossLineIndex] = {
          ...current,
          geometry,
          properties: {
            ...(current.properties || {}),
            crossLineId: (current.properties as any)?.crossLineId ?? crossLineIndex,
            leftPoint,
            rightPoint,
          },
        };
        changed = true;
      });

      return changed ? turf.featureCollection(features as any) : prev;
    });
  };

  // 将断面几何同步到后端（自由模式拖动结束时调用）
  const persistCrossLineGeometry = async (crossLineIndex: number, geometry: GeoJSON.LineString) => {
    const feature: any = perpendicularData?.features?.[crossLineIndex];
    const sectionId = feature?.properties?.sectionId as string | undefined;
    await persistCrossLineGeometryAction({ sectionId, geometry, silent: true });
  };

  // 自由模式：旋转选中断面
  const rotateSelectedCrossLine = async (angleDegrees: number) => {
    if (!perpendicularData || perpendicularData.features.length === 0) {
      alert('当前没有断面可旋转');
      return;
    }

    const indices = getSelectedCrossLineIndices();
    if (indices.length === 0) {
      alert('请先选择要旋转的断面');
      return;
    }

    const unique = Array.from(new Set(indices)).filter(
      (i) => Number.isFinite(i) && i >= 0 && i < perpendicularData.features.length,
    );
    const tasks: Array<Promise<any>> = [];

    unique.forEach((idx) => {
      const feature: any = perpendicularData.features[idx];
      if (!feature || feature.geometry?.type !== 'LineString') return;

      const nextGeometry = rotateCrossLineGeometry({
        geometry: feature.geometry as GeoJSON.LineString,
        angleDegrees,
      });

      updateCrossLineGeometryLocal(idx, nextGeometry);
      tasks.push(persistCrossLineGeometry(idx, nextGeometry));
    });

    await Promise.allSettled(tasks);
  };

  // 自由模式：拉长/缩短选中断面
  const scaleSelectedCrossLine = async (deltaMeters: number) => {
    if (!perpendicularData || perpendicularData.features.length === 0) {
      alert('当前没有断面可缩放');
      return;
    }

    const indices = getSelectedCrossLineIndices();
    if (indices.length === 0) {
      alert('请先选择要缩放的断面');
      return;
    }

    const unique = Array.from(new Set(indices)).filter(
      (i) => Number.isFinite(i) && i >= 0 && i < perpendicularData.features.length,
    );
    const tasks: Array<Promise<any>> = [];

    unique.forEach((idx) => {
      const feature: any = perpendicularData.features[idx];
      if (!feature || feature.geometry?.type !== 'LineString') return;

      const nextGeometry = scaleCrossLineGeometry({
        geometry: feature.geometry as GeoJSON.LineString,
        deltaMeters,
      });

      updateCrossLineGeometryLocal(idx, nextGeometry);
      tasks.push(persistCrossLineGeometry(idx, nextGeometry));
    });

    await Promise.allSettled(tasks);
  };

  // 自由模式：点选起止点创建断面
  const createCrossLineByEndpoints = async (start: number[], end: number[]) => {
    await createCrossLineByEndpointsAction({
      start,
      end,
      uploadedData,
      perpendicularData,
      setPerpendicularData,
    });
  };

  // 为选中的断面配置属性
  const configureSelectedCrossLineProperties = async () => {
    await configureSelectedCrossLinePropertiesAction({
      selectedCrossLineIndex,
      perpendicularData,
      setEditingPropertiesGroupId,
    });
  };

  // 核心逻辑：基于上传的 GeoJSON 和全局配置生成所有垂线
  const handleGenerateSections = async () => {
    if (!uploadedData) {
      alert('请先上传 GeoJSON 数据');
      return;
    }
    try {
      await generateSectionsAndCreateTask({
        uploadedData,
        selectedLines,
        globalInterval,
        globalLength,
        globalProperties,
        setPerpendicularData,
        setShowCrossLines,
        setGlobalProperties,
        // 生成精细断面时不要同步上传岸段
        skipUploadBanks: true,
      });
    } finally {
      // 上传断面（生成）完成后刷新“获取岸段”下拉框数据
      fetchBankGroups();
    }
  };

  // “生成计算断面”：在精细断面基础上，沿断面起点->终点方向延长，直到与遇到的第一个岸线相交
  const handleGenerateComputeSections = async () => {
    if (!uploadedData) {
      alert('请先上传 GeoJSON 数据');
      return;
    }
    try {
      await generateComputeSectionsAndCreateTask({
        uploadedData,
        selectedLines,
        globalInterval,
        globalLength,
        globalProperties,
        setPerpendicularData,
        setShowCrossLines,
        setGlobalProperties,
        // 与精细断面保持一致：不强制同步上传岸段
        skipUploadBanks: true,
      });
    } finally {
      fetchBankGroups();
    }
  };

  // 开始分析：运行任务中的所有断面
  const handleStartAnalysis = async () => {
    if (!perpendicularData) {
      alert('请先绘制断面');
      return;
    }

    const check = await validateAllSectionsBeforeAnalysis();
    if (!check.ok) {
      alert(check.reason || '断面校验未通过，已拒绝执行分析');
      return;
    }

    await runCurrentTask({ perpendicularData, setPage });
  };

  // 应用自定义线段配置：更新当前编辑组的垂线
  const handleApplyCustomSegments = () => {
    void applyCustomSegmentsAction({
      editingGroupId,
      groups,
      perpendicularData,
      globalLength,
      globalProperties,
      setGroups,
      setPerpendicularData,
    });
  };

  // 处理文件上传
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    uploadMainGeoJsonAction({
      e,
      setUploadedData,
      setSelectedLines,
      setIsSelectingShoreLines,
      setIsSelectingStartEnd,
      setLoadedBanks,
    });
  };

  // 上传已有断面几何并直接创建任务与断面
  const handleSectionsFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      await uploadSectionsGeoJsonAndCreateTaskAction({
        e,
        setPerpendicularData,
        setShowCrossLines,
      });
    } finally {
      // 上传断面（导入）完成后刷新“获取岸段”下拉框数据
      fetchBankGroups();
    }
  };

  // 导出当前断面的几何信息（用于上传断面功能的样例）
  const handleExportSections = () => {
    exportSectionsSampleAction({ perpendicularData });
  };

  // 地图相关逻辑已移动到 EditorMap 组件中

  // 清除所有组
  const onClear = () => {
    setGroups([]);
    setPerpendicularData(null);
    setEditingGroupId(null);
    alert('已清除所有选择');
  };

  // 删除单个组
  const deleteGroup = (id: string) => {
    setGroups(prev => prev.filter(g => g.id !== id));
    if (editingGroupId === id) {
      setEditingGroupId(null);
    }
  };

  // 反切某段落范围内的所有断面
  const reverseCrossLinesInGroup = async (groupId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) {
      alert('未找到要反切的段落');
      return;
    }

    await reverseCrossLinesInGroupAction({
      group,
      perpendicularData,
      globalLength,
      setPerpendicularData,
    });
  };

  // 删除某段落范围内的所有断面
  const deleteCrossLinesInGroup = async (groupId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) {
      alert('未找到要删除断面的段落');
      return;
    }

    await deleteCrossLinesInGroupAction({
      group,
      perpendicularData,
      globalLength,
      setPerpendicularData,
      setSelectedCrossLineIndex,
    });
  };

  // 切换编辑组状态
  const handleEditGroup = (id: string) => {
    if (editingGroupId === id) {
      setEditingGroupId(null); // 关闭编辑
    } else {
      setEditingGroupId(id); // 打开编辑
    }
  };

  // 更新组的配置
  const updateGroupConfig = (id: string, field: 'interval' | 'length', value: number) => {
    setGroups(prev => {
      const updated = [...prev];
      const idx = updated.findIndex(g => g.id === id);
      if (idx !== -1) {
        updated[idx] = { ...updated[idx], [field]: value };
      }
      return updated;
    });
  };



  const totalCrossLinesCount = perpendicularData?.features.length || 0;
  const totalSelectedSegments = groups.filter(g => g.end !== null).length;

  return (
    <div className="map-wrapper">
      <EditorMap
        perpendicularData={perpendicularData}
        uploadedData={uploadedData}
        groups={groups}
        showCrossLines={showCrossLines}
        isFixingShoreLineReversed={isFixingShoreLineReversed}
        onFixSelectedShoreLineReversed={fixSelectedShoreLineReversed}
        isSelectingShoreLines={isSelectingShoreLines}
        isSelectingStartEnd={isSelectingStartEnd}
        isSelectingCrossLines={isSelectingCrossLines}
        crossLineControlMode={crossLineControlMode}
        crossLineEditMode={crossLineEditMode}
        selectedLines={selectedLines}
        setSelectedLines={setSelectedLines}
        setGroups={setGroups}
        selectedCrossLineIndex={selectedCrossLineIndex}
        setSelectedCrossLineIndex={setSelectedCrossLineIndex}
        selectedCrossLineIndices={selectedCrossLineIndices}
        setSelectedCrossLineIndices={setSelectedCrossLineIndices}
        globalInterval={globalInterval}
        globalLength={globalLength}
        createCrossLineAtPoint={createCrossLineAtPoint}
        updateCrossLineGeometryLocal={updateCrossLineGeometryLocal}
        applyCrossLineGeometriesLocal={applyCrossLineGeometriesLocal}
        persistCrossLineGeometry={persistCrossLineGeometry}
        createCrossLineByEndpoints={createCrossLineByEndpoints}
      />
      <EditorSidebar
        uploadedData={uploadedData}
        bankGroups={bankGroups}
        bankList={bankList}
        deleteBankById={deleteBankById}
        deleteBanksByIds={deleteBanksByIds}
        smoothSelectedShoreLines={smoothSelectedShoreLines}
        selectedBankGroup={selectedBankGroup}
        setSelectedBankGroup={handleSelectBanksFromDropdown}
        deleteBankGroup={deleteBankGroup}
        loadedBanks={loadedBanks}
        selectedLoadedBanks={selectedLoadedBanks}
        setSelectedLoadedBanks={setSelectedLoadedBanks}
        deleteLoadedBanks={deleteLoadedBanks}
        basicParamsList={basicParamsList}
        selectedBasicParamIdState={selectedBasicParamIdState}
        totalSelectedSegments={totalSelectedSegments}
        totalCrossLinesCount={totalCrossLinesCount}
        globalInterval={globalInterval}
        setGlobalInterval={setGlobalInterval}
        globalLength={globalLength}
        setGlobalLength={setGlobalLength}
        isSelectingShoreLines={isSelectingShoreLines}
        toggleShoreLineSelection={toggleShoreLineSelection}
        toggleSelectAllShoreLines={toggleSelectAllShoreLines}
        selectedLinesSize={selectedLines.size}
        handleGenerateSections={handleGenerateSections}
        handleGenerateComputeSections={handleGenerateComputeSections}
        isFixingShoreLineReversed={isFixingShoreLineReversed}
        toggleFixShoreLineReversed={toggleFixShoreLineReversed}
        sendSelectedShoreLinesGeoJson={sendSelectedShoreLinesGeoJson}
        perpendicularData={perpendicularData}
        openGlobalPropertiesModal={openGlobalPropertiesModal}
        isSelectingStartEnd={isSelectingStartEnd}
        toggleStartEndSelection={toggleStartEndSelection}
        groups={groups}
        editingGroupId={editingGroupId}
        handleEditGroup={handleEditGroup}
        deleteGroup={deleteGroup}
        updateGroupConfig={updateGroupConfig}
        reverseCrossLinesInGroup={reverseCrossLinesInGroup}
        deleteCrossLinesInGroup={deleteCrossLinesInGroup}
        setEditingPropertiesGroupId={setEditingPropertiesGroupId}
        handleApplyCustomSegments={handleApplyCustomSegments}
        isSelectingCrossLines={isSelectingCrossLines}
        toggleCrossLineSelection={toggleCrossLineSelection}
        validateAllPendingSections={validateAllPendingSections}
        deleteAllInvalidSections={deleteAllInvalidSections}
        crossLineControlMode={crossLineControlMode}
        setCrossLineControlMode={setCrossLineControlMode}
        crossLineEditMode={crossLineEditMode}
        setCrossLineEditMode={setCrossLineEditMode}
        clearSelectedCrossLineSelection={clearSelectedCrossLineSelection}
        selectedCrossLineIndex={selectedCrossLineIndex}
        translateSelectedCrossLine={translateSelectedCrossLine}
        rotateSelectedCrossLine={rotateSelectedCrossLine}
        scaleSelectedCrossLine={scaleSelectedCrossLine}
        configureSelectedCrossLineProperties={configureSelectedCrossLineProperties}
        deleteSelectedCrossLine={deleteSelectedCrossLine}
        reverseSelectedCrossLine={reverseSelectedCrossLine}
        showCrossLines={showCrossLines}
        setShowCrossLines={setShowCrossLines}
        handleStartAnalysis={handleStartAnalysis}
        onClear={onClear}
        handleFileUpload={handleFileUpload}
        handleSectionsFileUpload={handleSectionsFileUpload}
        onExportSections={handleExportSections}
        handleSelectBasicParam={handleSelectBasicParam}
      />

      {/* 全局属性配置弹窗 */}
      {showGlobalPropertiesModal && globalProperties && (
        <SectionPropertiesModal
          config={globalProperties}
          title="全局属性配置"
          onSave={async (newConfig) => {
            const paramIdStr = selectedBasicParamIdState === null ? '' : String(selectedBasicParamIdState);
            if (!paramIdStr) {
              throw new Error('未选择可保存的参数模板');
            }

            await updateBasicParamAsSectionParams(paramIdStr, newConfig);
            setGlobalProperties(newConfig);
            setBasicParamsList((prev) =>
              prev.map((item) => {
                const itemId = String(item.param_id ?? item.id ?? '');
                if (itemId !== paramIdStr) return item;
                return {
                  ...item,
                  ...newConfig,
                };
              }),
            );
            alert('参数模板已保存到后端');
          }}
          onClose={() => setShowGlobalPropertiesModal(false)}
        />
      )}

      {/* 组属性配置弹窗 */}
      {editingPropertiesGroupId && (() => {
        // 检查是否是单个断面的属性配置
        if (editingPropertiesGroupId.startsWith('cross-line-')) {
          const index = parseInt(editingPropertiesGroupId.replace('cross-line-', ''));
          if (!perpendicularData || !perpendicularData.features[index]) return null;

          const currentLine = perpendicularData.features[index];
          const lineProps: any = currentLine.properties || {};
          const currentConfig =
            lineProps.analysisConfig ||
            lineProps.properties ||
            lineProps.backendParams ||
            globalProperties;
          const sectionId =
            lineProps.sectionId ||
            lineProps.section_id ||
            lineProps.id;

          if (!currentConfig) {
            alert('断面参数未加载，请稍后再试');
            setEditingPropertiesGroupId(null);
            return null;
          }

          return (
            <SectionPropertiesModal
              config={currentConfig}
              title={`断面 #${index + 1} 属性配置`}
              sectionId={sectionId}
              onSave={(newConfig) => {
                // 更新前端状态
                const updatedFeatures = [...perpendicularData.features];
                updatedFeatures[index] = {
                  ...currentLine,
                  properties: {
                    ...currentLine.properties,
                    analysisConfig: newConfig,
                    properties: newConfig,
                  }
                };
                setPerpendicularData(turf.featureCollection(updatedFeatures as GeoJSON.Feature<GeoJSON.LineString>[]));
                alert(`断面 #${index + 1} 的属性配置已保存`);
              }}
              onClose={() => setEditingPropertiesGroupId(null)}
            />
          );
        }

        // 组属性配置
        const group = groups.find(g => g.id === editingPropertiesGroupId);
        if (!group) return null;

        const groupConfig = group.properties || globalProperties;
        if (!groupConfig) {
          alert('参数未加载，请先创建断面');
          setEditingPropertiesGroupId(null);
          return null;
        }

        return (
          <SectionPropertiesModal
            config={groupConfig}
            title={`组 ${groups.findIndex(g => g.id === editingPropertiesGroupId) + 1} 属性配置`}
            onSave={(newConfig) => {
              setGroups(prev => {
                const updated = [...prev];
                const idx = updated.findIndex(g => g.id === editingPropertiesGroupId);
                if (idx !== -1) {
                  updated[idx] = { ...updated[idx], properties: newConfig };
                }
                return updated;
              });
              alert(`组 ${groups.findIndex(g => g.id === editingPropertiesGroupId) + 1} 的属性配置已保存\n\n注意：需要点击"应用配置"才能将属性更新到垂线上`);
            }}
            onClose={() => setEditingPropertiesGroupId(null)}
          />
        );
      })()}
    </div>
  );
}

export default EditorPage;
