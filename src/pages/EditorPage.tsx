import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as turf from '@turf/turf';
import { Dropdown, message } from 'antd';
import '../App.css';
import { useEditorStore } from '../store/useEditorStore';
import SectionPropertiesModal from '../components/SectionPropertiesModal';
import TaskNameModal from '../components/TaskNameModal';
import CreateTaskModal, { type CreateTaskForm } from '../components/CreateTaskModal';
import AddBanksToTaskModal, { type AddBanksForm } from '../components/AddBanksToTaskModal';
import CreateParamTemplateModal, {
  type CreateParamTemplateForm,
  type ParamTemplateOption,
} from '../components/CreateParamTemplateModal';
import InfoModal, { type InfoGroup } from '../components/tree/InfoModal';
import ConfirmModal from '../components/ConfirmModal';
import modalStyles from '../components/Modal.module.css';
import EditorSidebar from '../components/EditorSidebar';
import CrossLineFineTuneBar from '../components/CrossLineFineTuneBar';
import ResourceSidebar from '../components/tree/ResourceSidebar';
import EditorMap from '../components/EditorMap';
import TiffResourcePicker from '../components/TiffResourcePicker';
import type { TreeNode } from '../tree/types';
import { useResourceTreeStore } from '../store/useResourceTreeStore';
import { useRuleStore } from '../store/useRuleStore';
import { RULE_CATALOG, disabledRuleIds, isMutedFailCode, isRuleOn, ruleById, rulesetKeyOf } from '../rules/catalog';
import type { RuleId } from '../rules/types';
import { authHeaders } from '../utils/apiClient';
import { getVerticalFootPointFromAny } from '../utils/verticalFootPoint';
import ChatPanel from '../components/ChatPanel';
import ResizeHandle from '../components/ResizeHandle';
import { MessageCircle, Globe, Upload, Ruler, Plus, MousePointer2, Eraser, ChevronDown, CheckCircle2 } from 'lucide-react';
import { invalidateTaskParamsCache, setCurrentBasicParamId } from '../services/basicParamsService';
import { fetchTiffBounds } from '../services/tiffService';
import { fetchRiverSurface, invalidateRiverSurfaceCache } from '../services/riverSurfaceApi';
import { resolveVisibleTiffBounds, toggleDemBounds } from '../map/tiffBoundsView';
import { cancelTask } from '../services/taskRunControl';
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
  generateSectionsForBanksIntoTask,
  runCurrentTask,
} from './editor/sectionsGeneration';
import {
  mergeBankIdsIntoTasksStore,
  pickCandidateBanks,
  refreshTaskSectionsIntoStore,
  resolveBankIdsForTaskLoading,
  resolveTaskBankScope,
  runTaskPendingSections,
  syncTaskBanksFromSections,
  type TaskBankScope,
} from '../services/taskBanksService';
import {
  fetchBasicParamDetailAsSectionParams,
  fetchBasicParamsList,
  fetchTaskParamsAsSectionParams,
  importTaskParamsFromTemplate,
  updateBasicParamAsSectionParams,
  updateTaskParams,
} from './editor/basicParamsApi';
import { getCurrentTaskId, setCurrentTaskId } from './editor/taskState';
import { updateSectionParams } from './editor/sectionApi';
import {
  DEFAULT_REQUEST_CONCURRENCY,
  isNetworkLevelError,
  mapWithConcurrency,
} from '../utils/concurrency';

interface EditorPageProps {
  setPage?: (page: 'editor' | 'result', taskId?: string) => void;
}

function EditorPage(props: EditorPageProps) {
  const { setPage } = props;
  // === 持久化状态（使用 zustand store） ===
  const uploadedData = useEditorStore((s) => s.uploadedData);
  const setUploadedData = useEditorStore((s) => s.setUploadedData);
  const perpendicularData = useEditorStore((s) => s.perpendicularData);
  const setPerpendicularData = useEditorStore((s) => s.setPerpendicularData);
  const groups = useEditorStore((s) => s.groups);
  const setGroups = useEditorStore((s) => s.setGroups);
  const globalInterval = useEditorStore((s) => s.globalInterval);
  const setGlobalInterval = useEditorStore((s) => s.setGlobalInterval);
  const globalLength = useEditorStore((s) => s.globalLength);
  const setGlobalLength = useEditorStore((s) => s.setGlobalLength);
  const globalProperties = useEditorStore((s) => s.globalProperties);
  const setGlobalProperties = useEditorStore((s) => s.setGlobalProperties);
  const selectedLines = useEditorStore((s) => s.selectedLines);
  const setSelectedLines = useEditorStore((s) => s.setSelectedLines);
  const selectedBankGroup = useEditorStore((s) => s.selectedBankGroup);
  const setSelectedBankGroup = useEditorStore((s) => s.setSelectedBankGroup);
  const selectedLoadedBanks = useEditorStore((s) => s.selectedLoadedBanks);
  const setSelectedLoadedBanks = useEditorStore((s) => s.setSelectedLoadedBanks);
  const showCrossLines = useEditorStore((s) => s.showCrossLines);
  const setShowCrossLines = useEditorStore((s) => s.setShowCrossLines);
  const satellite = useEditorStore((s) => s.satellite);
  const setSatellite = useEditorStore((s) => s.setSatellite);
  const colorBanks = useEditorStore((s) => s.colorBanks);
  const setColorBanks = useEditorStore((s) => s.setColorBanks);
  const loadedBanks = useEditorStore((s) => s.loadedBanks);
  const setLoadedBanks = useEditorStore((s) => s.setLoadedBanks);
  const crossLineControlMode = useEditorStore((s) => s.crossLineControlMode);
  const setCrossLineControlMode = useEditorStore((s) => s.setCrossLineControlMode);
  const selectedBasicParamIdState = useEditorStore((s) => s.selectedBasicParamIdState);
  const setSelectedBasicParamIdState = useEditorStore((s) => s.setSelectedBasicParamIdState);

  const prevSelectedBankGroupRef = useRef<string[]>([]);

  // === 非持久化状态（UI 交互模式、瞬时状态） ===
  const [basicParamsList, setBasicParamsList] = useState<any[]>([]);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [chatCollapsed, setChatCollapsed] = useState<boolean>(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(350);
  const [rightPanelWidth, setRightPanelWidth] = useState(350);
  const [resizeTrigger, setResizeTrigger] = useState(0);
  const [showTiffBounds, setShowTiffBounds] = useState<boolean>(false);
  const [tiffBoundsData, setTiffBoundsData] = useState<GeoJSON.FeatureCollection | null>(null);

  // === 长江范围参考图层（规则：与长江河面相交）===
  // 开关状态放 store（两种侧栏模式共用 + 持久化），图层数据放这里（请求/缓存由服务层管）。
  const showRiverSurface = useEditorStore((s) => s.showRiverSurface);
  const setShowRiverSurface = useEditorStore((s) => s.setShowRiverSurface);
  const [riverSurfaceData, setRiverSurfaceData] = useState<GeoJSON.FeatureCollection | null>(null);
  // 只保留 status（不存 error 文案）：错误通过 toast 一次性告知，
  // status 用来决定"眼睛再点一次是重试还是关闭"（见 handleRuleAction）。
  const [riverSurfaceStatus, setRiverSurfaceStatus] =
    useState<'idle' | 'loading' | 'ready' | 'empty' | 'error'>('idle');
  // 请求去重：StrictMode 下 effect 会跑两遍，不能用 loading 状态当哨兵（见 useEditorStore 的坑记录）
  const riverSurfaceLoadingRef = useRef(false);
  // 「TIF 范围」当前聚焦的 DEM：null / 空数组 = 不限（显示全部，侧栏那个全局开关的语义）；
  // 非空数组 = 只显示这几条（点资源树里某条 DEM、或它的「显示范围」图标时置入）。
  const [focusedDemKeys, setFocusedDemKeys] = useState<string[] | null>(null);
  const [showGlobalPropertiesModal, setShowGlobalPropertiesModal] = useState<boolean>(false);
  const [editingPropertiesGroupId, setEditingPropertiesGroupId] = useState<string | null>(null);
  const [editingBankParams, setEditingBankParams] = useState<{bankId: string; bankName: string; config: any} | null>(null);
  const [taskNameDialog, setTaskNameDialog] = useState<{ defaultName: string } | null>(null);
  const taskNameResolveRef = useRef<((name: string | null) => void) | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    content: ReactNode;
    confirmText?: string;
    danger?: boolean;
  } | null>(null);
  const confirmDialogResolveRef = useRef<((ok: boolean) => void) | null>(null);
  const [isSelectingShoreLines, setIsSelectingShoreLines] = useState<boolean>(false);
  const [isSelectingStartEnd, setIsSelectingStartEnd] = useState<boolean>(false);
  const [bankGroups, setBankGroups] = useState<Array<{ region_code: string; count: number }>>([]);
  const [bankList, setBankList] = useState<any[]>([]);
  const [isSelectingCrossLines, setIsSelectingCrossLines] = useState<boolean>(false);
  const [isFixingShoreLineReversed, setIsFixingShoreLineReversed] = useState<boolean>(false);
  const [crossLineEditMode, setCrossLineEditMode] = useState<'none' | 'select' | 'add'>('none');
  const [selectedCrossLineIndex, setSelectedCrossLineIndex] = useState<number | null>(null);
  const [selectedCrossLineIndices, setSelectedCrossLineIndices] = useState<Set<number>>(new Set());
  const sidebarMode = useEditorStore((s) => s.sidebarMode);
  const [demPickerOpen, setDemPickerOpen] = useState(false);
  const [createTaskModalOpen, setCreateTaskModalOpen] = useState(false);
  // 「补充岸段到已有任务」弹窗。候选清单在打开时算好（全库岸段 − 该任务已有），
  // 弹窗本身只负责勾选与参数，不再请求后端。
  const [addBanksModal, setAddBanksModal] = useState<{
    taskId: string;
    taskName: string;
    candidates: any[];
    scope: TaskBankScope;
  } | null>(null);
  // 「参数模板」文件夹右键 → 新建参数模板
  const [createParamModalOpen, setCreateParamModalOpen] = useState(false);
  const [infoModal, setInfoModal] = useState<{ title: string; groups: InfoGroup[] } | null>(null);
  const bankUploadInputRef = useRef<HTMLInputElement | null>(null);
  const sectionsUploadInputRef = useRef<HTMLInputElement | null>(null);

  const clearSelectedCrossLines = () => {
    setSelectedCrossLineIndex(null);
    setSelectedCrossLineIndices(new Set());
  };

  // 创建任务：弹出居中弹窗获取任务名称（替代原生 window.prompt）
  const requestTaskName = (defaultName: string) =>
    new Promise<string | null>((resolve) => {
      taskNameResolveRef.current?.(null);
      taskNameResolveRef.current = resolve;
      setTaskNameDialog({ defaultName });
    });

  const closeTaskNameDialog = (name: string | null) => {
    setTaskNameDialog(null);
    const resolve = taskNameResolveRef.current;
    taskNameResolveRef.current = null;
    resolve?.(name);
  };

  // 通用确认弹窗（替代原生 window.confirm）
  const requestConfirm = (options: {
    title?: string;
    content: ReactNode;
    confirmText?: string;
    danger?: boolean;
  }) =>
    new Promise<boolean>((resolve) => {
      confirmDialogResolveRef.current?.(false);
      confirmDialogResolveRef.current = resolve;
      setConfirmDialog({
        title: options.title ?? '确认操作',
        content: options.content,
        confirmText: options.confirmText,
        danger: options.danger,
      });
    });

  const closeConfirmDialog = (ok: boolean) => {
    setConfirmDialog(null);
    const resolve = confirmDialogResolveRef.current;
    confirmDialogResolveRef.current = null;
    resolve?.(ok);
  };

  /**
   * 参数面板当前的作用域。
   *
   * 只有两种，互不交叉：
   *   · 'library' —— 模板库主数据，保存只写模板本身，**永远不影响任何任务**；
   *   · 'task'    —— 当前任务自己的一份参数，保存只写该任务并同步该任务的断面。
   *
   * 旧实现把两者混成一个「全局属性配置」，保存时还问要不要「下发到断面」，
   * 于是改一次模板就改掉了所有引用它的任务（模板 166 事发时波及 15 个任务的 13822 条断面）。
   */
  const [paramScope, setParamScope] = useState<'library' | 'task'>('library');
  // 从模板库导入会替换整份参数：用 key 强制重挂弹窗，避免内部 state 还留着旧值
  const [paramPanelRevision, setParamPanelRevision] = useState(0);

  const loadBasicParamAsGlobalProperties = async (paramIdStr: string) => {
    const { numericId, sectionParams } = await fetchBasicParamDetailAsSectionParams(paramIdStr);
    setGlobalProperties(sectionParams);
    setSelectedBasicParamIdState(paramIdStr);
    setCurrentBasicParamId(numericId);
    setParamScope('library');
    return sectionParams;
  };

  /** 载入「某个任务自己的参数集」，后续保存只写这个任务。 */
  const loadTaskParamsAsGlobalProperties = async (taskId: string, templateParamId?: string | null) => {
    const { numericId, paramId, sectionParams } = await fetchTaskParamsAsSectionParams(taskId, templateParamId);
    setGlobalProperties(sectionParams);
    setSelectedBasicParamIdState(paramId);
    setCurrentBasicParamId(numericId);
    setParamScope('task');
    return sectionParams;
  };

  const getSelectedCrossLineIndices = (): number[] => {
    if (selectedCrossLineIndices.size > 0) return Array.from(selectedCrossLineIndices);
    return selectedCrossLineIndex === null ? [] : [selectedCrossLineIndex];
  };

  // 去重：自动清除相同岸段线+相同位置（距离误差<0.5m）的重复断面
  useEffect(() => {
    if (!perpendicularData || perpendicularData.features.length === 0) return;
    const existing = perpendicularData.features as GeoJSON.Feature[];
    const seen = new Map<string, number>();
    const keep: number[] = [];

    existing.forEach((f: any, i: number) => {
      const props = f.properties || {};
      const lineId = props.shoreLineId || props.bank_id || '';
      const dist = Math.round(Number(props.distance || 0) * 2) / 2;
      const key = `${lineId}@${dist}`;
      if (!seen.has(key)) {
        seen.set(key, i);
        keep.push(i);
      }
    });

    if (keep.length < existing.length) {
      const deduped = keep.map((i) => existing[i]);
      setPerpendicularData(turf.featureCollection(deduped as any));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perpendicularData?.features?.length, perpendicularData]);

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
  const isGeneratingRef = useRef(false);

  const getShoreLineId = (feature: any, index: number) => {
    const p = feature?.properties || {};
    return String(p.bank_id || p.bankId || `line-${index}`);
  };

  // 校验补丁按帧合并：几十/上百个断面并发校验时，每个 fetch 回调各 set 一次会触发
  // React 19 useSyncExternalStore 的 forceStoreRerender 风暴（渲染被反复打断重排），
  // 单轮渲染内嵌套更新超过 50 次即抛 "Maximum update depth exceeded"，并被当时执行的
  // validateSectionAsync 的 catch 记为该断面的 validation_error。合并为每帧最多一次
  // set 后，渲染可以正常 commit（嵌套计数随 commit 归零），竞争消失。
  const pendingValidationPatchesRef = useRef<Map<string, Record<string, any>>>(new Map());
  const validationPatchScheduledRef = useRef(false);

  const patchSectionValidationProps = (sectionId: string, patch: Record<string, any>) => {
    const merged = pendingValidationPatchesRef.current;
    merged.set(sectionId, { ...(merged.get(sectionId) || {}), ...patch });
    if (validationPatchScheduledRef.current) return;
    validationPatchScheduledRef.current = true;

    const flush = () => {
      validationPatchScheduledRef.current = false;
      if (merged.size === 0) return;
      const pending = new Map(merged);
      merged.clear();

      setPerpendicularData((prev) => {
        if (!prev) return prev;
        let changed = false;
        const features = (prev.features as any[]).map((f) => {
          const sid = f?.properties?.sectionId;
          const p = sid ? pending.get(sid) : undefined;
          if (!p) return f;
          changed = true;
          return { ...f, properties: { ...(f.properties || {}), ...p } };
        });
        return changed ? turf.featureCollection(features as any) : prev;
      });
    };

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(flush);
    } else {
      setTimeout(flush, 16);
    }
  };

  useEffect(() => {
    if (!showTiffBounds || tiffBoundsData) return;
    fetchTiffBounds().then((data) => {
      if (data) setTiffBoundsData(data);
    });
  }, [showTiffBounds, tiffBoundsData]);

  /**
   * 拉长江河面图层。
   *
   * <p>`force` 只给「重试」用：正常路径靠 riverSurfaceApi 的模块级缓存，
   * 开关来回切一次不会重复走网络。
   */
  const loadRiverSurface = useCallback(async (force = false) => {
    if (riverSurfaceLoadingRef.current) return;
    if (!force && riverSurfaceData) return;
    if (force) invalidateRiverSurfaceCache();

    riverSurfaceLoadingRef.current = true;
    setRiverSurfaceStatus('loading');
    try {
      const layer = await fetchRiverSurface();
      setRiverSurfaceData(layer.collection);
      setRiverSurfaceStatus(layer.collection.features.length > 0 ? 'ready' : 'empty');
      if (layer.collection.features.length === 0) {
        message.warning('后端未返回长江河面几何（river_yangtze 为空？）');
      }
    } catch (e: any) {
      setRiverSurfaceStatus('error');
      // 规则行不再有独立的"重试"按钮：错误在这里说清楚，眼睛再点一次即重试（见 handleRuleAction）
      message.error({
        content: `长江范围图层加载失败：${e?.message ? String(e.message) : '未知错误'}（再点一次规则行眼睛重试）`,
        duration: 6,
      });
    } finally {
      riverSurfaceLoadingRef.current = false;
    }
  }, [riverSurfaceData]);

  // 开启即加载；关闭时保留已取到的数据，再打开直接复用（不闪白、不重复请求）
  useEffect(() => {
    if (showRiverSurface) void loadRiverSurface();
  }, [showRiverSurface, loadRiverSurface]);

  const filteredTiffBoundsData = useMemo(() => {
    // 用当前面板里的参数（任务参数 / 模板库参数都行）取 DEM key。
    // 不能再去 basicParamsList 里按 param_id 找：任务参数不在模板库列表里，会永远找不到。
    if (!tiffBoundsData || !globalProperties) return null;
    const demKeys = new Set([globalProperties.bench_id, globalProperties.ref_id].filter(Boolean));
    if (demKeys.size === 0) return null;
    const features = tiffBoundsData.features.filter((f: any) =>
      demKeys.has(f.properties?.tiff_key)
    );
    return { type: 'FeatureCollection', features } as GeoJSON.FeatureCollection;
  }, [tiffBoundsData, globalProperties]);

  // 真正喂给地图的 TIF 范围数据（推导 + 单测见 map/tiffBoundsView.ts）。
  //
  // 两条约束合起来才安全：
  //   ① 聚焦时只给聚焦的那几条 —— 否则地图的 source 拿着全库集合，点一条却画出全部；
  //   ② **关闭时给空集合** —— 这条是后补的。图层可见性原本只在 `showTiffBounds` 变化时
  //      靠 `isStyleLoaded()` 置位，那一步一旦被跳过，留在 source 里的旧数据就会照画不误
  //      （症状：第二次点同一条 DEM，变成全库的框都显示出来）。
  const visibleTiffBoundsData = useMemo(
    () => resolveVisibleTiffBounds({ showTiffBounds, tiffBoundsData, focusedDemKeys }),
    [showTiffBounds, tiffBoundsData, focusedDemKeys],
  );

  const clipSelectedBank = async () => {
    const groupsList = groups || [];
    const g = groupsList[groupsList.length - 1];
    if (!g || g.end === null || g.start === null) {
      alert('请先拾取起点和终点');
      return;
    }
    // 从 group 记录的线要素上读取 bank_id，而不是用全局 selectedLines/selectedBankGroup
    const clickBankId = (g as any).line?.properties?.bank_id;
    const bankId = clickBankId || (selectedLines.size === 1 ? [...selectedLines][0] : (selectedBankGroup[0] || ''));
    if (!bankId) { alert('请先选择一条岸段'); return; }
    const bank = bankList.find((b: any) => String(b.bank_id) === bankId);
    const geom = bank?.bank_geometry || bank?.geometry;
    if (!geom) { alert('岸段无几何数据'); return; }
    try {
      const bankLine = turf.lineString(geom.coordinates);
      // 用组里记录的距离作为大致位置，在线上找实际最近点
      const fakePt = turf.along(bankLine, g.start, { units: 'meters' });
      const snappedStart = turf.nearestPointOnLine(bankLine, fakePt, { units: 'meters' });
      const fakeEnd = turf.along(bankLine, g.end, { units: 'meters' });
      const snappedEnd = turf.nearestPointOnLine(bankLine, fakeEnd, { units: 'meters' });
      const startDist = Math.min(snappedStart.properties.location, snappedEnd.properties.location);
      const endDist = Math.max(snappedStart.properties.location, snappedEnd.properties.location);
      const actualStart = turf.along(bankLine, startDist, { units: 'meters' });
      const actualEnd = turf.along(bankLine, endDist, { units: 'meters' });
      const slice = turf.lineSlice(actualStart, actualEnd, bankLine);
      if (!slice || slice.geometry.coordinates.length < 2) {
        alert('截取结果无效，请确保起终点在岸段范围内');
        return;
      }
      const newBankName = (bank.bank_name || bankId) + '_截取段';
      const newBankId = bankId + '_clip_' + Date.now();
      const payload = {
        banks: [{ bank_id: newBankId, bank_name: newBankName, region_code: bank.region_code || 'Mzs', geometry: slice.geometry, bank_geometry: slice.geometry, description: `截取自 ${bankId}` }],
        overwrite: false,
      };
      await fetch('/v0/bank/banks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      alert(`已保存新岸段: ${newBankName}`);
      fetchBankGroups();

      // 构造新岸段 feature
      const newFeature = {
        type: 'Feature' as const,
        geometry: slice.geometry,
        properties: { bank_id: newBankId, bank_name: newBankName, region_code: bank.region_code || 'Mzs', from_backend: true },
      };

      // 清理地图上所有旧岸段，仅保留新截取的岸段
      setUploadedData({ type: 'FeatureCollection', features: [newFeature] } as any);
      setLoadedBanks([{ bank_id: newBankId, bank_name: newBankName, region_code: bank.region_code || 'Mzs', description: `截取自 ${bankId}` }]);

      setSelectedLines(new Set());
      setSelectedBankGroup([]);
      setGroups([]);
      setIsSelectingStartEnd(false);
    } catch (err: any) { alert('截取失败: ' + err.message); }
  };

  const applyTiffRangeSelection = async (bounds: any) => {
    let banks = bankList;
    if (!banks || banks.length === 0) {
      try {
        const res = await fetch('/v0/bank/banks', { headers: { ...authHeaders() } });
        const data = await res.json();
        const list = (data?.banks || data?.data || data) as any[];
        if (Array.isArray(list)) {
          banks = list;
          setBankList(list);
        }
      } catch {
        banks = [];
      }
    }
    const matched = (banks || []).filter((b: any) => {
      const geom = b.bank_geometry || b.geometry;
      if (!geom) return false;
      try {
        return turf.booleanIntersects(geom, bounds.geometry);
      } catch { return false; }
    });
    if (matched.length === 0) { message.info('没有岸段在所选 DEM 范围内'); return; }
    matched.forEach((b: any) => { void loadBankById(String(b.bank_id)); });
    message.success(`已加载 ${matched.length} 条岸段到地图`);
  };

  const selectBanksByTiffRange = async (demKey?: string) => {
    if (demKey && typeof demKey === 'string') {
      let bounds = tiffBoundsData?.features?.find(
        (f: any) => String(f.properties?.tiff_key) === String(demKey),
      );
      if (!bounds) {
        const data = await fetchTiffBounds();
        if (data) {
          setTiffBoundsData(data);
          bounds = data.features?.find((f: any) => String(f.properties?.tiff_key) === String(demKey));
        }
      }
      if (!bounds) { message.warning('未找到该 DEM 的范围数据'); return; }
      setShowTiffBounds(true);
      // 与「显示范围」口径一致：只把这一个 DEM 的框画出来
      setFocusedDemKeys([String(demKey)]);
      await applyTiffRangeSelection(bounds);
      return;
    }
    const bounds = filteredTiffBoundsData?.features?.[0] || tiffBoundsData?.features?.[0];
    if (!bounds) { message.warning('请先选择一个带 DEM 的参数模板'); return; }
    setShowTiffBounds(true);
    await applyTiffRangeSelection(bounds);
  };

  /**
   * 单次断面校验请求（不做重试/限流，由 validateSectionAsync 包一层）。
   * 成功返回映射后的状态；网络层失败或 HTTP 非 2xx 一律抛错，交给上层决定是否重试。
   */
  const validateSectionOnce = async (sectionId: string): Promise<'valid' | 'invalid' | 'pending'> => {
    // 规则开关随请求下发：被停用的规则由后端跳过判定（不传 = 全部启用 = 与改动前完全一致）。
    // 读 getState() 而不是闭包里的值：批量校验可能跨越一次规则切换，每条请求都该拿到当下的规则集。
    const disabledRules = disabledRuleIds(useRuleStore.getState().enabled);
    const res = await fetch(`/v0/bank/sections/${sectionId}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled_rules: disabledRules }),
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
  };

  /**
   * 断面校验（带网络层重试）。
   *
   * 重试存在的原因：批量校验时浏览器会并发下发成百上千个请求，一旦触及
   * Chromium 每渲染进程「挂起请求」上限（kMaxOutstandingRequestsPerProcess），
   * 超出部分会被直接以 net::ERR_INSUFFICIENT_RESOURCES 拒绝，JS 侧就是
   * TypeError: Failed to fetch，断面会永久停在「未验证」。
   * 配合下面的 mapWithConcurrency 限流后，这里再补一次短退避重试兜底瞬时抖动。
   */
  const validateSectionAsync = async (sectionId: string, retries = 1): Promise<'valid' | 'invalid' | 'pending'> => {
    let lastErr: any = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await validateSectionOnce(sectionId);
      } catch (err: any) {
        lastErr = err;
        if (!isNetworkLevelError(err) || attempt >= retries) break;
        await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
      }
    }

    console.warn(`断面验证请求失败: ${sectionId}`, lastErr);
    // 请求失败不变红，保持黄色 pending；下次可手动刷新或重试
    patchSectionValidationProps(sectionId, {
      validation_status: 'pending',
      is_valid: undefined,
      validation_status_raw: undefined,
      validation_error: lastErr?.message || String(lastErr),
    });

    return 'pending';
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

    // 强制重跑：不受 validationTriggeredRef 的影响。
    // 必须限流——断面动辄上千条，全量并发会被浏览器以 ERR_INSUFFICIENT_RESOURCES
    // 拒绝（表现为 Failed to fetch），断面会永久停在「未验证」。
    const idList = Array.from(sectionIds);
    const progressKey = 'section-validate-all';
    if (idList.length > 20) {
      message.open({ key: progressKey, type: 'loading', content: `正在校验断面 0/${idList.length} …`, duration: 0 });
    }
    await mapWithConcurrency(idList, DEFAULT_REQUEST_CONCURRENCY, (sid) => validateSectionAsync(sid), (done, total) => {
      if (total > 20) {
        message.open({ key: progressKey, type: 'loading', content: `正在校验断面 ${done}/${total} …`, duration: 0 });
      }
    });
    if (idList.length > 20) {
      message.destroy(progressKey);
    }

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

    // 同上：分析前的批量校验也必须限流，否则尾部断面会因浏览器并发上限而 Failed to fetch，
    // 被判定为「未完成校验」后分析会被一直挡住。
    const mapped = await mapWithConcurrency(
      Array.from(sectionIds),
      DEFAULT_REQUEST_CONCURRENCY,
      (sid) => validateSectionAsync(sid),
    );
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
      message.warning('当前没有断面可删除');
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
      message.warning('没有未通过检查的断面');
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
    const ok = await requestConfirm({
      title: '一键删除错误断面',
      confirmText: '删除',
      danger: true,
      content: (
        <>
          <div>确认删除所有未通过检查的断面？</div>
          <div className={modalStyles.statLine}>
            将删除{' '}
            <span className={`${modalStyles.statNumber} ${modalStyles.statDanger}`}>{removedCount}</span> 条，保留{' '}
            <span className={`${modalStyles.statNumber} ${modalStyles.statSuccess}`}>{kept.length}</span> 条。
          </div>
          <div className={modalStyles.statLine}>
            其中可同步后端删除{' '}
            <span className={`${modalStyles.statNumber} ${modalStyles.statInfo}`}>{uniqueSectionIds.length}</span> 条
            {localOnlyCount > 0 && (
              <span>
                ，仅本地删除{' '}
                <span className={`${modalStyles.statNumber} ${modalStyles.statWarning}`}>{localOnlyCount}</span>{' '}
                条（缺少 sectionId）
              </span>
            )}
            。
          </div>
        </>
      ),
    });
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
      message.success(`已删除 ${removedCount} 条断面（未同步到后端）`);
      return;
    }

    // 同样限流：错误断面一次可能上千条，全量并发 DELETE 会被浏览器直接拒绝
    // （Failed to fetch），断面对不上库、前端却以为删干净了。
    const deleteResults = await mapWithConcurrency(
      uniqueSectionIds,
      DEFAULT_REQUEST_CONCURRENCY,
      async (sectionId) => {
        try {
          const res = await fetch(`/v0/bank/sections/${encodeURIComponent(sectionId)}`, {
            method: 'DELETE',
          });
          if (!res.ok) throw new Error(res.statusText);
          return { sectionId, ok: true as const, reason: undefined as string | undefined };
        } catch (err: any) {
          return { sectionId, ok: false as const, reason: err?.message || String(err) };
        }
      },
    );

    const failures = deleteResults.filter((r) => !r.ok);
    const failCount = failures.length;
    if (failCount > 0) {
      console.error('一键删除错误断面：后端删除失败明细:', failures);
      message.warning(
        `已删除 ${removedCount} 条断面；后端同步成功 ${uniqueSectionIds.length - failCount}，失败 ${failCount}`,
      );
    } else {
      message.success(`已删除 ${removedCount} 条断面（已同步到后端）`);
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
    // 限流下发：放过岸段全选可能带来上千条断面，全量 forEach 并发会触发浏览器的
    // 挂起请求上限，尾部请求直接 Failed to fetch，DOM 上就表现为「未验证」。
    void mapWithConcurrency(sectionIdsToValidate, DEFAULT_REQUEST_CONCURRENCY, (sid) => validateSectionAsync(sid));
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
      const res = await fetch('/v0/bank/banks', { headers: { ...authHeaders() } });
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      const banks = (data?.banks || data?.data || data) as any[];
      const list = Array.isArray(banks) ? banks : [];

      // 按 region_code 分组
      const groupMap: Record<string, any[]> = {};
      list.forEach((b: any) => {
        const rc = b.region_code || 'Unknown';
        if (!groupMap[rc]) groupMap[rc] = [];
        groupMap[rc].push(b);
      });
      const groups = Object.entries(groupMap).map(([region_code, items]) => ({
        region_code,
        count: items.length,
      }));

      setBankGroups(groups);
      setBankList(list);
    } catch (err) {
      console.error('获取岸段组失败:', err);
      setBankGroups([]);
    }
  };

  // ============================================================
  //  断面「移出地图后可恢复」
  //
  //  问题：岸段「移出地图」会把该岸段的断面一并从 perpendicularData 摘掉
  //  （本意是避免岸段没了、断面还留在地图上飘着），但这个摘除是破坏性的；
  //  而 perpendicularData 又会被 persist 写进 localStorage，于是移出之后
  //  没有任何入口能把断面找回来 —— 树里的断面节点当时也没有"加载到地图"动作。
  //
  //  修法：移出时记下"哪些岸段的断面被摘走了"（纯前端标记，不落库），
  //  重新加载该岸段时按 bank_id 从后端拉回；同时给断面节点补上
  //  「加载到地图」动作，即便跨会话/刷新（标记丢失）也能手动恢复。
  // ============================================================

  // 被「移出地图」摘掉过断面的岸段 → 重新「加载到地图」时自动恢复
  const removedBankSectionsRef = useRef<Set<string>>(new Set());

  // 后端断面记录 → 地图 feature。
  // 注意 crossLineId 必须等于它在数组里的真实下标：EditorMap 用 features 下标关联选中态。
  const sectionRecordToFeature = (s: any, index: number): any | null => {
    const geom = s?.section_geometry ?? s?.sectionGeometry ?? s?.geometry;
    if (!geom || (geom.type !== 'LineString' && geom.type !== 'MultiLineString')) return null;
    const sid = String(s?.section_id ?? s?.sectionId ?? '');
    if (!sid) return null;
    const bankId = s?.bank_id ?? s?.bankId;
    const vf = getVerticalFootPointFromAny(s) ?? undefined;
    // 库里存的是"最后一次按**当时**规则集算出来的结论"，不带规则集指纹。
    // 用户停用某条规则后刷新页面，这里会把旧的 invalid_no_river 之类照样读出来 → 断面标红，
    // 看着像"规则没关掉"。凡是失败码属于当前已停用规则的，一律降级成 pending（待重算），
    // 原始失败码仍保留在 validation_status_raw 里供详情/排障查看。
    const rawStatus = s?.validation_status ?? s?.validationStatus;
    const muted = isMutedFailCode(rawStatus, useRuleStore.getState().enabled);
    return {
      type: 'Feature',
      geometry: geom,
      properties: {
        sectionId: sid,
        section_id: sid,
        section_name: s?.section_name,
        crossLineId: index,
        index,
        distance: s?.distance,
        bank_id: bankId,
        shoreLineId: bankId,
        validation_status: muted ? 'pending' : rawStatus,
        validation_status_raw: muted
          ? String(rawStatus).toLowerCase()
          : s?.validation_status_raw,
        is_valid: muted ? undefined : s?.is_valid,
        ...(vf ? { vertical_foot_point: vf } : {}),
      },
    };
  };

  // 追加到数组末尾（不能插队），按 sectionId 去重，返回真正新增的条数。
  // zustand 的 set 是同步执行的，所以函数返回时 added 已是最终值。
  const appendSectionsToMap = (records: any[]): number => {
    let added = 0;
    setPerpendicularData((prev) => {
      const existing = ((prev?.features || []) as any[]);
      const have = new Set(
        existing
          .map((f) => String(f?.properties?.sectionId ?? f?.properties?.section_id ?? ''))
          .filter(Boolean),
      );
      const base = existing.length;
      const fresh: any[] = [];
      for (const r of records) {
        const f = sectionRecordToFeature(r, base + fresh.length);
        if (!f) continue;
        const sid = String(f.properties.sectionId);
        if (have.has(sid)) continue;
        have.add(sid);
        fresh.push(f);
      }
      if (fresh.length === 0) return prev;
      added = fresh.length;
      return { ...(prev || { type: 'FeatureCollection', features: [] }), features: [...existing, ...fresh] } as any;
    });
    return added;
  };

  // 按岸段从后端把断面拉回来（「移出地图」→「加载到地图」的恢复路径）
  const restoreSectionsForBank = async (bankId: string): Promise<number> => {
    const bid = String(bankId);
    if (!bid) return 0;
    try {
      const res = await fetch(`/v0/bank/sections?bank_id=${encodeURIComponent(bid)}`, { headers: { ...authHeaders() } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      const list = data?.sections ?? data?.data ?? [];
      if (!Array.isArray(list) || list.length === 0) return 0;
      const n = appendSectionsToMap(list);
      if (n > 0) setShowCrossLines(true);
      return n;
    } catch (e) {
      console.error('恢复断面失败:', e);
      return 0;
    }
  };

  // 按单个断面恢复（树里单击断面节点 / 右键「加载到地图」）
  const restoreSectionById = async (sectionId: string): Promise<boolean> => {
    const sid = String(sectionId);
    if (!sid) return false;

    // 已经在地图上：直接选中定位。数据从 store 现取，避免闭包里的陈旧副本。
    const locate = () => {
      const list = ((useEditorStore.getState().perpendicularData?.features || []) as any[]);
      const i = list.findIndex(
        (f) => String(f?.properties?.sectionId ?? f?.properties?.section_id ?? '') === sid,
      );
      if (i < 0) return false;
      setSelectedCrossLineIndex(i);
      setShowCrossLines(true);
      return true;
    };

    if (locate()) return true;

    try {
      const res = await fetch(`/v0/bank/sections/${encodeURIComponent(sid)}`, { headers: { ...authHeaders() } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      const rec = data?.section ?? data?.data ?? data;
      const n = appendSectionsToMap(rec && (rec.section_id || rec.sectionId) ? [rec] : []);
      if (n > 0) {
        locate();
        return true;
      }
      message.warning(`断面 ${sid} 没有可加载的几何数据`);
      return false;
    } catch (e) {
      console.error('加载断面失败:', e);
      message.error(`断面 ${sid} 加载失败`);
      return false;
    }
  };

  // opts.silent：批量加载时（「全部加载到地图」可能上百条）不弹 alert / message，
  // 由调用方统一汇总成功/失败，避免逐条弹窗把页面刷屏。
  // 返回值：该岸段最终是否已在地图上（原本就存在也算成功，便于调用方统计条数）。
  const loadBankById = async (bankId: string, opts?: { silent?: boolean }): Promise<boolean> => {
    const silent = opts?.silent === true;
    console.log('[loadBankById] 加载岸段:', bankId);
    if (!bankId) return false;
    try {
      let res = await fetch(`/v0/bank/banks/${encodeURIComponent(bankId)}`, { headers: { ...authHeaders() } });
      if (!res.ok) {
        // 退回到查询参数形式
        res = await fetch(`/v0/bank/banks?bank_id=${encodeURIComponent(bankId)}`, { headers: { ...authHeaders() } });
      }
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          if (!silent) message.error('登录已过期或无权限，请重新登录后再加载岸段');
          return false;
        }
        throw new Error(`${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      const bank = (data?.bank || data?.banks?.[0] || data?.data || data) as any;
      const b = Array.isArray(bank) ? bank[0] : bank;
      const geom = b?.bank_geometry || b?.geometry;
      if (!b || !geom) {
        if (!silent) alert('未找到指定的岸段或该岸段无几何数据');
        return false;
      }

      // 这里必须从 store 现取，而不是用闭包里捕获的 uploadedData。
      // 批量场景（双击任务一键加载 / 文件夹「全部加载」）是「先清空、紧接着连续 loadBankById」，
      // 闭包里的集合还停在清空之前 ⇒ 会把本该重新画上的岸段误判成"已在地图上"直接跳过，
      // 症状就是"点了加载但地图上还是空的"。
      const currentBanks = ((useEditorStore.getState().uploadedData?.features || []) as any[]);

      const newFeature = {
        type: 'Feature' as const,
        geometry: geom,
        properties: {
          index: currentBanks.length,
          bank_id: b.bank_id,
          bank_name: b.bank_name,
          region_code: b.region_code,
          reversed: !!(b?.reversed === true || b?.reversed === 'true'),
          description: b.description,
          from_backend: true,
        },
      } as any;

      // 如果已存在相同 bank_id，避免重复加载
      const exists = currentBanks.some((f: any) => {
        const p = f?.properties || {};
        return String(p.bank_id || p.bankId || '') === String(b.bank_id);
      });
      if (exists) {
        // alert(`岸段 ${b.bank_id} 已在编辑器中，已跳过重复加载`);
        return true;   // 已在图上 → 对批量调用方等价于成功
      }

      setUploadedData((prev) => {
        // index 必须在 updater 里按"当前实际长度"分配：批量加载是 6 路并发，
        // 每条都在外面算 currentBanks.length 会拿到同一个数 ⇒ index 重复，
        // 点选岸段时 getShoreLineId 的兜底下标就会指到别的岸段上。
        const prevFeatures = ((prev?.features || []) as any[]);
        const feature = {
          ...newFeature,
          properties: { ...newFeature.properties, index: prevFeatures.length },
        };
        if (!prev) return { type: 'FeatureCollection', features: [feature] } as any;
        return { ...prev, features: [...prevFeatures, feature] } as any;
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

      // 岸段回到地图后，把它之前随「移出地图」被一并摘走的断面也拉回来
      if (removedBankSectionsRef.current.has(String(b.bank_id))) {
        removedBankSectionsRef.current.delete(String(b.bank_id));
        await restoreSectionsForBank(String(b.bank_id));
      }
      return true;
    } catch (err: any) {
      console.error('加载岸段失败:', err);
      if (!silent) alert(`加载岸段失败: ${err?.message || String(err)}`);
      return false;
    }
  };

  const removeBankFromMap = (bankId: string) => {
    const bid = String(bankId);
    setUploadedData((prev) => {
      if (!prev) return prev;
      const features = (prev.features || []).filter((f: any) => {
        const p = f?.properties || {};
        return String(p.bank_id || p.bankId || '') !== bid;
      });
      return { ...prev, features } as any;
    });
    setLoadedBanks((prev) => prev.filter((b) => String(b.bank_id) !== bid));

    // 同时清除关联断面。
    // 这一步只是"从地图上摘掉"，必须记下哪个岸段的断面被摘走了：
    // 否则重新「加载到地图」时无从得知要把它们找回来（原来的 bug 就出在这里）。
    const hadSections = ((perpendicularData?.features || []) as any[]).some((f: any) => {
      const p = f?.properties || {};
      return String(p.bank_id || '') === bid || String(p.shoreLineId || '') === bid;
    });
    if (hadSections) removedBankSectionsRef.current.add(bid);

    setPerpendicularData((prev) => {
      if (!prev) return prev;
      const features = (prev.features || []).filter((f: any) => {
        const p = f?.properties || {};
        return String(p.bank_id || '') !== bid && String(p.shoreLineId || '') !== bid;
      });
      if (features.length === (prev.features || []).length) return prev;
      return { ...prev, features } as any;
    });
  };

  // === 文件夹级批量动作：全部加载到地图 / 全部移出地图 ===

  // 收集某个文件夹节点下（含嵌套）所有断面的 section_id。
  // 断面节点是叶子，直接遍历 children 即可覆盖"断面 → 任务 → 岸段分组"各层级。
  const collectSectionIds = (node: TreeNode): string[] => {
    const out = new Set<string>();
    const walk = (n: TreeNode) => {
      if (n.ref?.entity === 'section' && n.ref.key) out.add(String(n.ref.key));
      for (const c of n.children || []) walk(c);
    };
    walk(node);
    // 计算任务树里的「断面」文件夹是懒加载的：子节点可能还没展开。
    // 此时退回 store 里该任务的断面清单，保证按钮不会因为"没展开"而失效。
    if (node.id.startsWith('task-sections:')) {
      const tid = node.id.slice('task-sections:'.length);
      for (const s of (useResourceTreeStore.getState().sectionsByTask[tid] || []) as any[]) {
        const sid = String(s?.section_id ?? s?.id ?? '');
        if (sid) out.add(sid);
      }
    }
    return [...out];
  };

  const sectionIdOfFeature = (f: any) =>
    String(f?.properties?.sectionId ?? f?.properties?.section_id ?? '');

  // 在资源树里点到「某一个断面节点」时，把"目标断面"锚定到这个节点上。
  // 为什么需要这一步：断面的各项操作（参数 / 删除 / 反切…）最终都要落到
  // perpendicularData.features 的**下标**上，而树下发展开前，这些断面
  // 往往根本不在图上（甚至整张图是空的）。旧写法直接读"地图上当前选中的断面"，
  // 于是出现两类错：
  //   ① 地图上什么都没选 → 误报「请先选择要配置的断面」；
  //   ② 之前在地图上选过别的断面 → 静默作用到**另一个断面**上（删除/反切尤其危险）。
  // 这里返回该断面在 features 里的下标（必要时先从后端把它拉回地图并选中）；失败返回 null。
  const focusSectionOfTreeNode = async (sectionId: string): Promise<number | null> => {
    const sid = String(sectionId || '');
    if (!sid) return null;
    // restoreSectionById 内部：已在图上 → 直接选中定位；不在 → 按 id 拉回图后再定位
    if (!(await restoreSectionById(sid))) return null;
    const list = ((useEditorStore.getState().perpendicularData?.features || []) as any[]);
    const index = list.findIndex((f) => sectionIdOfFeature(f) === sid);
    if (index < 0) return null;
    setSelectedCrossLineIndex(index);
    setSelectedCrossLineIndices(new Set());   // 收回单选，避免多选残留把批量动作带偏
    return index;
  };

  // 某个断面属于哪个任务（删掉之后要让资源树重新拉一次该任务的断面清单，否则节点会残留）
  const taskIdOfSection = (sectionId: string): string => {
    const byTask = useResourceTreeStore.getState().sectionsByTask || {};
    for (const [tid, list] of Object.entries(byTask)) {
      if ((list as any[]).some((s) => String(s?.section_id ?? s?.id ?? '') === sectionId)) return tid;
    }
    return '';
  };

  // 把文件夹下所有断面拉回地图。已在图上的跳过，只补缺的那些。
  const loadAllSectionsUnder = async (node: TreeNode) => {
    const ids = collectSectionIds(node);
    if (ids.length === 0) { message.warning('该文件夹下没有断面'); return; }

    const onMap = new Set(
      (((useEditorStore.getState().perpendicularData?.features || []) as any[]).map(sectionIdOfFeature)).filter(Boolean),
    );
    const todo = ids.filter((id) => !onMap.has(id));
    if (todo.length === 0) { message.info(`这 ${ids.length} 条断面已经全部在地图上了`); return; }

    const hide = message.loading(`正在加载 ${todo.length} 条断面…`, 0);
    let ok = 0;
    let fail = 0;
    let cursor = 0;
    // 并发 4：断面数量通常不大，限流只是为了避免一次性打满后端
    const worker = async () => {
      while (cursor < todo.length) {
        const id = todo[cursor++];
        try {
          const res = await fetch(`/v0/bank/sections/${encodeURIComponent(id)}`, { headers: { ...authHeaders() } });
          if (!res.ok) throw new Error(`${res.status}`);
          const data = await res.json();
          const rec = data?.section ?? data?.data ?? data;
          if (rec && (rec.section_id || rec.sectionId) && appendSectionsToMap([rec]) > 0) ok++;
          else fail++;
        } catch {
          fail++;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, todo.length) }, worker));
    hide();

    if (ok > 0) setShowCrossLines(true);
    if (fail > 0) message.warning(`已加载 ${ok} 条断面，${fail} 条未能加载（可能缺少几何数据）`);
    else message.success(`已加载 ${ok} 条断面`);
  };

  // 按 id 批量把断面从地图上摘掉。
  // 注意：这与岸段的「移出地图」不同 —— 它不写 removedBankSectionsRef，
  // 因为"再点一次全部加载"就能回来，不需要岸段落图来触发恢复。
  // 侧栏下半区「已加载到屏幕」的行级/组级移出也复用这里（单条就是长度为 1 的 ids）。
  const removeSectionsByIds = (ids: string[]) => {
    if (ids.length === 0) { message.info('这些断面本来就不在地图上'); return; }
    const want = new Set(ids);

    // 选中态是按 features 下标存的 → 删完必须按"断面身份"重新映射，
    // 否则下标会整体前移、选中态悄悄指向另一个断面。
    const before = ((useEditorStore.getState().perpendicularData?.features || []) as any[]);
    const keepId = selectedCrossLineIndex != null && before[selectedCrossLineIndex]
      ? sectionIdOfFeature(before[selectedCrossLineIndex])
      : '';
    const multiIds = [...selectedCrossLineIndices].map((i) => sectionIdOfFeature(before[i])).filter(Boolean);

    let removed = 0;
    setPerpendicularData((prev) => {
      if (!prev) return prev;
      const b = (prev.features || []) as any[];
      const features = b.filter((f) => !want.has(sectionIdOfFeature(f)));
      if (features.length === b.length) return prev;
      removed = b.length - features.length;
      return { ...prev, features } as any;
    });
    if (removed === 0) { message.info('这些断面本来就不在地图上'); return; }

    const after = ((useEditorStore.getState().perpendicularData?.features || []) as any[]);
    const idxOf = (sid: string) => (sid ? after.findIndex((f) => sectionIdOfFeature(f) === sid) : -1);
    const nextSingle = idxOf(keepId);
    setSelectedCrossLineIndex(nextSingle >= 0 ? nextSingle : null);
    if (multiIds.length > 0) {
      const next = new Set<number>();
      for (const sid of multiIds) { const j = idxOf(sid); if (j >= 0) next.add(j); }
      setSelectedCrossLineIndices(next);
    }
    message.success(`已从地图移出 ${removed} 条断面`);
  };

  const removeAllSectionsUnder = (node: TreeNode) => {
    const ids = collectSectionIds(node);
    if (ids.length === 0) { message.warning('该文件夹下没有断面'); return; }
    removeSectionsByIds(ids);
  };

  // —— 侧栏下半区「已加载到屏幕」的批量操作 ——
  // 只处理"当前确实在图上"的那些，逐条走既有单条路径（removeBankFromMap 会顺带写
  // removedBankSectionsRef，后续「加载到地图」时断面才找得回来）。

  // 地图上当前所有岸段（几何已在 uploadedData.features 里）
  const loadedBankIdsOnMap = (): string[] => [...bankIdsOnMap()];

  const removeLoadedBanksFromMap = () => {
    const ids = loadedBankIdsOnMap();
    if (ids.length === 0) { message.info('地图上没有岸段'); return; }
    if (!window.confirm(`将把地图上的 ${ids.length} 条岸段（及其断面）一起移出。确认继续？`)) return;
    ids.forEach((id) => removeBankFromMap(id));
    message.success(`已从地图移出 ${ids.length} 条岸段`);
  };

  const removeLoadedSectionsFromMap = () => {
    const ids = ((useEditorStore.getState().perpendicularData?.features || []) as any[])
      .map(sectionIdOfFeature)
      .filter(Boolean) as string[];
    if (ids.length === 0) { message.info('地图上没有断面'); return; }
    if (!window.confirm(`将把地图上的 ${ids.length} 条断面一起移出。确认继续？`)) return;
    removeSectionsByIds(ids);
  };

  // 下半区点「定位」：与资源树里点岸段节点完全同义（都是 loadBankById）。
  // 注意不要顺手改 selectedLines —— 那是"选中用于生成断面"的语义，
  // 在下半区点一下定位就悄悄改变生成范围属于越权。
  const focusBankOnMap = async (bankId: string) => {
    const id = String(bankId || '');
    if (!id) return;
    await loadBankById(id);
  };

  // —— 岸段的文件夹级批量动作（与断面那对完全对称）——
  //
  // 为什么需要：断面文件夹早有 section.loadAll / section.removeAll（见 actions.ts 里的注释：
  // "单个断面的动作只能一条条点，断面多时很烦"），但「岸段」文件夹只有上传 + 着色开关。
  // 面对库里上百条岸段（实际 113 条）要逐条点「加载到地图」，是同一类痛点漏了这一侧。

  // 收集某个文件夹节点下（含嵌套）所有岸段的 bank_id。
  // 岸段节点是叶子，遍历 children 即可；若该文件夹的子节点尚未构建，退回 store 里的岸段清单兜底。
  // 口径与 treeModel.buildBanksFolder 一致：排除 _clip_ 系列（那是「截取岸段」的产物，不在文件夹里）。
  const collectBankIds = (node: TreeNode): string[] => {
    const out = new Set<string>();
    const walk = (n: TreeNode) => {
      if (n.ref?.entity === 'bank' && n.ref.key) out.add(String(n.ref.key));
      for (const c of n.children || []) walk(c);
    };
    walk(node);
    if (out.size === 0) {
      for (const b of (bankList || []) as any[]) {
        const id = String(b?.bank_id || '');
        if (id && !id.includes('_clip_')) out.add(id);
      }
    }
    return [...out];
  };

  // 当前已在地图上的岸段 bank_id 集合
  const bankIdsOnMap = (): Set<string> =>
    new Set(
      (((useEditorStore.getState().uploadedData?.features || []) as any[])
        .map((f: any) => String(f?.properties?.bank_id || f?.properties?.bankId || ''))
        .filter(Boolean)),
    );

  // 把文件夹下所有岸段加载到地图。已在图上的跳过，只补缺的那些。
  const loadAllBanksUnder = async (node: TreeNode) => {
    const ids = collectBankIds(node);
    if (ids.length === 0) { message.warning('该文件夹下没有岸段'); return; }

    const onMap = bankIdsOnMap();
    const todo = ids.filter((id) => !onMap.has(id));
    if (todo.length === 0) { message.info(`这 ${ids.length} 条岸段已经全部在地图上了`); return; }

    // 条数多时先确认：一次把上百条岸段画到地图上，渲染会明显变慢。
    if (todo.length > 20) {
      const go = window.confirm(
        `将把 ${todo.length} 条岸段加载到地图（该文件夹共 ${ids.length} 条，已在图上 ${ids.length - todo.length} 条）。\n` +
        `条数较多时地图渲染会变慢，确认继续？`,
      );
      if (!go) return;
    }

    const hide = message.loading(`正在加载 ${todo.length} 条岸段…`, 0);
    let okCount = 0;
    let fail = 0;
    let cursor = 0;
    // 并发 4：与 loadAllSectionsUnder 同一口径，只为避免一次性打满后端
    const worker = async () => {
      while (cursor < todo.length) {
        const id = todo[cursor++];
        try {
          // silent：上百条逐条弹窗会刷屏，这里统一汇总
          const done = await loadBankById(id, { silent: true });
          if (done) okCount++; else fail++;
        } catch {
          fail++;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, todo.length) }, worker));
    hide();

    if (fail > 0) message.warning(`已加载 ${okCount} 条岸段，${fail} 条未能加载（可能缺少几何数据）`);
    else message.success(`已加载 ${okCount} 条岸段到地图`);
  };

  // 把文件夹下所有岸段从地图上摘掉（连同它们的断面）。
  // 逐条走 removeBankFromMap，而不是自己批量 setState —— 那样才会照常写
  // removedBankSectionsRef，将来再「加载到地图」时断面还能被找回来。
  const removeAllBanksUnder = (node: TreeNode) => {
    const ids = collectBankIds(node);
    if (ids.length === 0) { message.warning('该文件夹下没有岸段'); return; }

    const onMap = bankIdsOnMap();
    const hit = ids.filter((id) => onMap.has(id));
    if (hit.length === 0) { message.info('这些岸段本来就不在地图上'); return; }

    const go = window.confirm(`将把地图上的 ${hit.length} 条岸段（及其断面）一起移出。确认继续？`);
    if (!go) return;

    hit.forEach((id) => removeBankFromMap(id));
    message.success(`已从地图移出 ${hit.length} 条岸段`);
  };

  // —— 双击「计算任务」下的任务节点：一键把该任务的岸段 + 断面铺到地图 ——
  //
  // 为什么要有：一个任务下动辄上百条断面，此前要"先把旧的移出、再逐个文件夹点全部加载"，
  // 而且很容易把两个任务的断面混在一张图上（编号/颜色全对不上）。
  // 双击任务 = 明确的"切到这个任务"的意图，所以这里**先清空**再加载，不做合并。

  // 清空地图上现有的岸段与断面，并复位所有"按下标存"的选中态。
  const clearMapForTaskSwitch = () => {
    const beforeBanks = Number(useEditorStore.getState().uploadedData?.features?.length || 0);
    const beforeSections = Number(useEditorStore.getState().perpendicularData?.features?.length || 0);

    setUploadedData({ type: 'FeatureCollection', features: [] } as any);
    setLoadedBanks([]);
    setPerpendicularData({ type: 'FeatureCollection', features: [] } as any);

    // 选中态是按 features 下标存的 ⇒ 清空后必须复位，否则下一次点断面会指到另一条
    setSelectedCrossLineIndex(null);
    setSelectedCrossLineIndices(new Set());
    setSelectedLoadedBanks(new Set());

    // 「移出后可恢复」的记录只对"用户手动移出"有意义；
    // 这里是换任务，把上一个任务的断面恢复回来是错的。
    removedBankSectionsRef.current.clear();

    // 「选中岸段」是"用哪些岸段生成断面"的语义，跨任务复用会把上一任务的范围带过去
    if (useEditorStore.getState().selectedLines.size > 0) setSelectedLines(new Set());

    return { beforeBanks, beforeSections };
  };

  /**
   * 任务登记的岸段清单（`tasks.bank_ids`）。
   *
   * <p>为什么需要它：断面只覆盖"生成过断面的岸段"，任务可以关联岸段但还没有断面
   * （补岸段时断面生成失败、或历史数据本来就没断面）。只按断面反推岸段，
   * 就一定会少几条 —— 用户看到的现象是"双击任务加载的岸段比树里少"。
   * 接口失败不阻断加载：退回 store 里的任务快照，再不行就空数组（等价于老行为）。
   */
  const fetchTaskBankIds = async (taskId: string): Promise<string[]> => {
    const norm = (v: any): string[] =>
      Array.isArray(v) ? v.map((b: any) => String(b ?? '').trim()).filter(Boolean) : [];
    try {
      const res = await fetch(`/v0/bank/tasks/${encodeURIComponent(taskId)}`, { headers: { ...authHeaders() } });
      if (res.ok) {
        const body = await res.json();
        const t = body?.task ?? body?.data ?? body;
        // 接口成功就以接口为准（哪怕返回空数组）：库里确实没有关联时，
        // 不能拿本地快照顶上 —— 那会让"补充岸段"的候选漏掉本该能补的岸段。
        if (t && typeof t === 'object' && 'bank_ids' in t) return norm(t.bank_ids);
      }
    } catch (e) {
      console.warn('[task-load] 读取任务岸段关联失败，退回本地快照:', e);
    }
    const fromStore = ((useResourceTreeStore.getState().tasks || []) as any[]).find(
      (t: any) => String(t?.task_id ?? t?.id) === taskId,
    );
    return norm(fromStore?.bank_ids);
  };

  const loadTaskOntoMap = async (taskId: string, taskName?: string) => {
    const tid = String(taskId || '');
    if (!tid) return;
    const label = taskName || tid;
    // 同一个 key 复用一条提示：进度文案原地更新，不会叠一堆 toast
    // （实测库里最大的任务有 2088 条断面 / 100 条岸段，串行加载要好几秒）
    const toastKey = `task-load:${tid}`;
    const toast = (content: string) => message.loading({ content, key: toastKey, duration: 0 });
    toast(`正在读取任务「${label}」的断面清单…`);
    try {
      const { beforeBanks, beforeSections } = clearMapForTaskSwitch();

      // 1) 一次取全该任务的断面（响应里带 section_geometry / vertical_foot_point）。
      //    断面只回答"图上要画哪些线"，**不代表任务的全部岸段** —— 岸段清单另取
      //    tasks.bank_ids 求并集，见下面的 sectionBankIds / taskBankIds。
      const res = await fetch(
        `/v0/bank/sections?task_id=${encodeURIComponent(tid)}`,
        { headers: { ...authHeaders() } },
      );
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      const list: any[] = Array.isArray(data?.sections) ? data.sections : [];

      // 岸段清单 = 任务登记的 bank_ids ∪ 断面里出现过的真实 bank_id（剔除 line-N 占位 id）。
      // 两个数据源都要读：只按断面反推会漏掉「已关联、但还没有断面」的岸段；
      // 只按 bank_ids 又会漏掉「有断面、但当年没登记成功」的岸段（补充岸段写关联失败的历史数据），
      // 后者正是"树里 17 条、地图上 19 条"的来源。
      const sectionBankIds = [...new Set(list.map((s) => String(s?.bank_id || '')).filter(Boolean))];
      const taskBankIds = await fetchTaskBankIds(tid);
      const {
        bankIds,
        withoutSection: bankIdsWithoutSection,
        unregistered: bankIdsUnregistered,
      } = resolveBankIdsForTaskLoading(taskBankIds, sectionBankIds);

      // 树与地图必须报同一个数：先把并集写回本地任务快照。
      // 即便下面的 sync 接口不可用（后端没重启 / 老版本），树也不会继续显示 17 条。
      mergeBankIdsIntoTasksStore(tid, bankIds);

      // 断面里有、关联里没有 ⇒ 任务自身数据不一致。趁加载顺手回写一次（幂等、只增不减），
      // 否则以后任何以 bank_ids 为准的路径（整任务重建）都会把这几天岸段静默丢掉。
      // 失败不阻断加载：这次只是"少记了一笔账"，岸段照样画得出来。
      let healedNote = '';
      if (bankIdsUnregistered.length > 0) {
        try {
          const healed = await syncTaskBanksFromSections(tid);
          if (healed.added.length > 0) {
            mergeBankIdsIntoTasksStore(tid, healed.added);
            healedNote = `（已补登记 ${healed.added.length} 条漏记的岸段）`;
          }
        } catch (e) {
          console.warn('[task-load] 修复任务岸段关联失败（不影响本次加载）:', e);
        }
      }

      const clearedNote = beforeBanks + beforeSections > 0
        ? `（已先移出原有 ${beforeBanks} 条岸段、${beforeSections} 条断面）`
        : '';

      if (list.length === 0 && bankIds.length === 0) {
        message.warning({ content: `任务「${label}」下没有岸段与断面，地图已清空${clearedNote}`, key: toastKey, duration: 5 });
        return;
      }

      // 2) 先铺岸段：断面是挂在岸段上的，岸段不在图上时断面会显得悬空。
      //    走统一限流（6 并发）：岸段可能上百条，逐条串行在远程部署下会很慢。
      toast(
        list.length === 0
          ? `正在加载任务「${label}」：${bankIds.length} 条岸段（该任务还没有断面）…`
          : `正在加载任务「${label}」：${bankIds.length} 条岸段、${list.length} 条断面…`,
      );
      const bankResults = await mapWithConcurrency(
        bankIds,
        DEFAULT_REQUEST_CONCURRENCY,
        (bid) => loadBankById(bid, { silent: true }),
        (done, total) => {
          if (total > DEFAULT_REQUEST_CONCURRENCY * 2 && (done % DEFAULT_REQUEST_CONCURRENCY === 0 || done === total)) {
            toast(`正在加载任务「${label}」的岸段 ${done}/${total}…`);
          }
        },
      );
      const bankOk = bankResults.filter(Boolean).length;

      // 3) 再铺断面
      const added = appendSectionsToMap(list);
      if (added > 0) setShowCrossLines(true);

      const bankFail = bankIds.length - bankOk;
      message.success({
        content:
          `已加载任务「${label}」：${bankOk} 条岸段、${added} 条断面` +
          (bankIdsWithoutSection.length > 0
            ? `（其中 ${bankIdsWithoutSection.length} 条岸段该任务还没有断面）`
            : '') +
          (bankFail > 0 ? `（${bankFail} 条岸段缺几何未画上）` : '') +
          healedNote +
          clearedNote,
        key: toastKey,
        duration: 5,
      });
    } catch (e: any) {
      console.error('按任务加载岸段/断面失败:', e);
      message.error({ content: `加载任务「${label}」失败：${e?.message || String(e)}`, key: toastKey, duration: 6 });
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
      // 同时清除关联断面
      setPerpendicularData((prev) => {
        if (!prev) return prev;
        const features = (prev.features || []).filter((f: any) => {
          const p = f?.properties || {};
          return String(p.bank_id || '') !== String(bankId) && String(p.shoreLineId || '') !== String(bankId);
        });
        if (features.length === (prev.features || []).length) return prev;
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

      // 同时清除关联断面
      setPerpendicularData((prev) => {
        if (!prev) return prev;
        const features = (prev.features || []).filter((f: any) => {
          const p = f?.properties || {};
          const bid = String(p.bank_id || '');
          const sid = String(p.shoreLineId || '');
          return !successSet.has(bid) && !successSet.has(sid);
        });
        if (features.length === (prev.features || []).length) return prev;
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

    const selectedSet = new Set(selected.map(String));

    setLoadedBanks((prev) => prev.filter((bank) => !selected.includes(String(bank.bank_id))));
    setSelectedBankGroup((prev) => prev.filter((id) => !selected.includes(String(id))));

    setUploadedData((prev) => {
      if (!prev) return prev;
      const features = (prev.features || []).filter((f: any) => {
        const p = f?.properties || {};
        const id = String(p.bank_id || p.bankId || '');
        return !selected.includes(id);
      });
      return { ...prev, features } as any;
    });

    // 同时清除与该岸段关联的断面
    setPerpendicularData((prev) => {
      if (!prev) return prev;
      const features = (prev.features || []).filter((f: any) => {
        const p = f?.properties || {};
        const bid = String(p.bank_id || '');
        const sid = String(p.shoreLineId || '');
        return !selectedSet.has(bid) && !selectedSet.has(sid);
      });
      if (features.length === (prev.features || []).length) return prev;
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
    console.log('[dropdown] 选中岸段:', nextSelected);
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

  /**
   * 打开参数面板。作用域必须由入口显式指定，不再靠「当前选中的模板」猜：
   *   · 资源树「参数模板」文件夹（模板库）→ 只改模板本身；
   *   · 任务节点右键「参数配置」/ 任务参数节点 → 只改该任务。
   */
  const openGlobalPropertiesModal = async (
    target?: { scope: 'task'; taskId: string } | { scope: 'library'; paramId?: string | null },
  ) => {
    if (target?.scope === 'task') {
      try {
        await loadTaskParamsAsGlobalProperties(target.taskId);
        setShowGlobalPropertiesModal(true);
      } catch (err: any) {
        console.error('加载任务参数失败:', err);
        alert(`加载任务参数失败: ${err?.message || err}`);
      }
      return;
    }

    const paramIdStr = String(target?.paramId ?? selectedBasicParamIdState ?? '');
    if (!paramIdStr) {
      alert('请先选择一个参数模板');
      return;
    }

    try {
      await loadBasicParamAsGlobalProperties(paramIdStr);
    } catch (err) {
      console.warn('打开属性配置时加载模板详情失败:', err);
      alert('当前模板详情加载失败，请重试');
      return;
    }

    setShowGlobalPropertiesModal(true);
  };

  /**
   * 新建参数模板（「参数模板」文件夹右键菜单的入口）。
   *
   * 后端 `POST /v0/bank/basic-params` 是「按数组批量写入」的接口：
   *   · overwrite=false → 纯插入；
   *   · param_id **由前端生成**（后端不代生成），且库里是全库唯一约束 `basic_params_param_id_key`；
   *   · 成功回包结构 `{ success, inserted_count, params:[{ id, param_id, param_name }] }`。
   * 所以这里生成的 id 自带时间戳，唯一性不依赖本地列表是否新鲜。
   *
   * 创建成功后做三件事：刷新模板列表 → 在树里选中新节点 → 把它设为当前引用的模板，
   * 用户就不用再去「参数配置」下拉框里找一遍了。
   */
  const handleCreateParamTemplate = async (form: CreateParamTemplateForm, openAfter: boolean) => {
    const res = await fetch('/v0/bank/basic-params', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ params: [form], overwrite: false }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      const detail = data?.message || data?.error || `${res.status} ${res.statusText}`;
      throw new Error(detail);
    }

    const newParamId = String(data?.params?.[0]?.param_id ?? form.param_id);

    const list = await fetchBasicParamsList().catch(() => null);
    if (list) setBasicParamsList(list);

    const store = useResourceTreeStore.getState();
    store.selectNode(`param:${newParamId}`);
    useResourceTreeStore.setState({ expanded: { ...store.expanded, 'folder:params': true } });
    bumpTreeData();

    await loadBasicParamAsGlobalProperties(newParamId);

    message.success(`参数模板「${form.param_name}」已创建`);
    setCreateParamModalOpen(false);

    if (openAfter) setShowGlobalPropertiesModal(true);
  };

  // 反转选中的断面（交换端点并同步到后端如果存在）
  const reverseSelectedCrossLine = async (indicesOverride?: number[]) => {
    // 数据从 store 现取，而不是用闭包里的 perpendicularData：
    // 树里右键「反切」时，断面可能是刚刚才被拉回地图的，闭包副本里还没有它。
    const data = useEditorStore.getState().perpendicularData;
    if (!data || data.features.length === 0) {
      message.warning('当前没有断面可反切');
      return;
    }

    // 树节点是权威目标，直接传入它的下标；否则退回"当前选中的断面"。
    // 用 Array.isArray 而不是 ?? —— 这个函数也会被 <button onClick={...}> 直接调用，
    // 那样第一个实参是 MouseEvent，会把下标覆盖掉。
    const indices = Array.isArray(indicesOverride) ? indicesOverride : getSelectedCrossLineIndices();
    if (indices.length === 0) {
      message.warning('请先选择要反切的断面');
      return;
    }

    const unique = Array.from(new Set(indices)).filter(
      (i) => Number.isFinite(i) && i >= 0 && i < data.features.length,
    );
    if (unique.length === 0) {
      message.warning('请选择有效的断面');
      return;
    }

    // 先本地批量反切
    const updatedFeatures = [...(data.features as any[])];
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
          fetch(`/v0/bank/sections/${encodeURIComponent(sectionId)}/reverse`, {
            method: 'PUT',
          }).then((res) => {
            if (!res.ok) throw new Error(res.statusText);
            return true;
          }),
        ),
      );

      const failedCount = results.filter((r) => r.status === 'rejected').length;
      if (failedCount > 0) {
        message.warning(`反切同步后端失败 ${failedCount} 条（其余已完成）`, 5);
      }
    }
  };

  // 切换岸段选择模式
  const toggleShoreLineSelection = () => {
    setIsSelectingShoreLines(!isSelectingShoreLines);
    if (isSelectingCrossLines) {
      setIsSelectingCrossLines(false); // 关闭断面选择模式
    }
  };

  // === 岸段批量选择：口径 =「地图上已加载的全部岸段」===
  //
  // 候选集是 uploadedData 里已加载到地图的线要素，与「选中岸段」在地图上逐条点选的是同一批。
  // 刻意不做"只选当前视野内"：视野外但已加载的岸段会莫名漏掉，用户缩放一下又会"多出来"，
  // 反而更难理解；而没加载到地图的岸段，任何选择口径都选不到它。
  //
  // 抽成这几个函数的原因：默认（资源树）模式下 EditorSidebar 不渲染，侧栏那对
  // 「选中岸段 / 全选」根本不在页面上，地图底部工具栏的「选中岸段」是唯一入口，
  // 而它原来只会切换点选模式 —— 于是选几十条岸段只能一条条点。
  // 现在侧栏的「全选」与地图工具栏共用同一份实现。

  // 地图上可作为岸段选中的线要素 id（与 getShoreLineId 同源）
  const mapShoreLineIds = (): string[] => {
    const out: string[] = [];
    (uploadedData?.features || []).forEach((f: any, index: number) => {
      const t = f?.geometry?.type;
      if (t === 'LineString' || t === 'MultiLineString') out.push(getShoreLineId(f, index));
    });
    return out;
  };

  // 是否"已经全选"。用 every(has) 而不是"数量相等"：后者在 selectedLines 里混入了
  // 不属于 uploadedData 的 id 时会误判成"已全选"，从而把全选做成清空。
  const isAllMapShoreLinesSelected = (): boolean => {
    const ids = mapShoreLineIds();
    return ids.length > 0 && ids.every((id) => selectedLines.has(id));
  };

  const selectAllMapShoreLines = () => {
    const ids = mapShoreLineIds();
    if (ids.length === 0) { message.warning('地图上还没有岸段，请先从资源树加载'); return; }
    setSelectedLines(new Set(ids));
    message.success(`已选中地图上的 ${ids.length} 条岸段`);
  };

  const clearMapShoreLineSelection = () => {
    if (selectedLines.size === 0) { message.info('当前没有选中的岸段'); return; }
    setSelectedLines(new Set());
    message.success('已清空岸段选择');
  };

  // 全选或取消全选所有岸段（侧栏那颗按钮）
  const toggleSelectAllShoreLines = () => {
    if (!uploadedData) {
      alert('请先上传 GeoJSON 数据');
      return;
    }
    if (isAllMapShoreLinesSelected()) {
      setSelectedLines(new Set());
    } else {
      setSelectedLines(new Set(mapShoreLineIds()));
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
      message.warning('未加载岸段数据');
      return;
    }

    if (!perpendicularData || perpendicularData.features.length === 0) {
      message.warning('请先生成断面后再修正');
      return;
    }

    if (!selectedLines.has(shoreLineId)) {
      message.warning('修正仅对已选岸段生效');
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
      message.info('该岸段下未找到可反转的断面');
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
      message.warning(`已修正岸段 ${shoreLineId}（reversed=${String(nextReversed)}）：${actionLabel} ${reversedIndices.length} 条断面（未同步到后端）`);
      return;
    }

    const results = await Promise.allSettled(
      sectionsToSync.map((sectionId) =>
        fetch(`/v0/bank/sections/${encodeURIComponent(sectionId)}/reverse`, {
          method: 'PUT',
        }).then((res) => {
          if (!res.ok) throw new Error(res.statusText);
          return true;
        }),
      ),
    );

    const successCount = results.filter((r) => r.status === 'fulfilled').length;
    const failedCount = results.length - successCount;

    if (failedCount > 0) {
      message.warning(
        `已修正岸段 ${shoreLineId}（reversed=${String(nextReversed)}）：${actionLabel} ${reversedIndices.length} 条断面；后端同步成功 ${successCount}，失败 ${failedCount}`,
        5,
      );
    } else {
      message.success(`已修正岸段 ${shoreLineId}（reversed=${String(nextReversed)}）：${actionLabel} ${reversedIndices.length} 条断面（已同步到后端）`);
    }
  };

  const sendSelectedShoreLinesGeoJson = async () => {
    if (!uploadedData) {
      message.warning('未加载岸段数据');
      return;
    }
    if (selectedLines.size === 0) {
      message.warning('请先选择用于生成断面的岸段');
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
      message.warning('没有可发送的岸段（仅支持 LineString / MultiLineString）');
      return;
    }

    try {
      const results: Array<{ bank_id: string; ok: boolean; status?: number; message?: string }> = [];

      for (const bank of banksToSend) {
        // overwrite=true：bank_id 已存在时覆盖更新（重复上传视为最新数据）
        const payload = { banks: [bank], overwrite: true };
        try {
          console.log('POST /v0/bank/banks payload for', bank.bank_id, JSON.stringify(payload, null, 2));
        } catch {
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
        message.error(`发送完成：成功 ${okCount}，失败 ${fail.length}。首个失败 bank_id=${first.bank_id}：${first.message}`, 6);
      } else {
        message.success(`已成功发送 ${okCount} 条岸段到后端`);
      }

      await fetchBankGroups();
    } catch (err: any) {
      console.error('发送岸段到 /v0/bank/banks 失败:', err);
      message.error(`发送岸段失败: ${err?.message || String(err)}`);
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
    if (isGeneratingRef.current) return;
    if (!uploadedData) {
      alert('请先上传 GeoJSON 数据');
      return;
    }
    isGeneratingRef.current = true;
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
        requestTaskName: () => requestTaskName('岸线分析任务'),
        skipUploadBanks: true,
        existingTaskId: getCurrentTaskId(),
      });
    } finally {
      fetchBankGroups();
      const tid = getCurrentTaskId();
      if (tid) {
        useResourceTreeStore.getState().setCurrentTask(tid);
        useResourceTreeStore.getState().invalidateSections(tid);
      }
      useResourceTreeStore.getState().bumpData();
      isGeneratingRef.current = false;
    }
  };

  // “生成计算断面”：在精细断面基础上，沿断面起点->终点方向延长，直到与遇到的第一个岸线相交
  const handleGenerateComputeSections = async () => {
    if (isGeneratingRef.current) return;
    if (!uploadedData) {
      alert('请先上传 GeoJSON 数据');
      return;
    }
    isGeneratingRef.current = true;
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
        requestTaskName: () => requestTaskName('岸线分析任务'),
        // 与精细断面保持一致：不强制同步上传岸段
        skipUploadBanks: true,
        existingTaskId: getCurrentTaskId(),
      });
    } finally {
      fetchBankGroups();
      const tid = getCurrentTaskId();
      if (tid) {
        useResourceTreeStore.getState().setCurrentTask(tid);
        useResourceTreeStore.getState().invalidateSections(tid);
      }
      useResourceTreeStore.getState().bumpData();
      isGeneratingRef.current = false;
    }
  };

  // 开始分析：运行任务中的所有断面
  const handleStartAnalysis = async () => {
    if (!perpendicularData) {
      message.warning('请先绘制断面');
      return;
    }

    const check = await validateAllSectionsBeforeAnalysis();
    if (!check.ok) {
      message.warning(check.reason || '断面校验未通过，已拒绝执行分析', 5);
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
        requestTaskName: () => requestTaskName('导入断面任务'),
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
    message.success('已清除所有选择');
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



  // === 资源树侧栏：节点操作分发 ===
  const bumpTreeData = () => useResourceTreeStore.getState().bumpData();

  /**
   * 终止一个正在运行的任务（下半区运行横幅 / 资源树任务节点 / 结果页进度栏共用这一条）。
   *
   * <p>三段式：二次确认 → 调接口 → 按 outcome 给不同反馈并刷新界面。
   * 「确认框文案」和「成功文案」都刻意区分了两种情形（真在跑 / 进程已死的僵尸），
   * 因为它们的后果完全不同：前者结果保留、后者本来就没结果。含糊其辞会让人误判。
   *
   * @returns true 表示请求已受理（调用方据此把按钮锁成「终止中」）
   */
  const handleStopTask = async (taskId: string, taskName?: string): Promise<boolean> => {
    const name = taskName || taskId;
    const ok = await requestConfirm({
      title: '终止运行中的任务',
      content: (
        <div style={{ lineHeight: 1.7 }}>
          <div>确认终止任务「{name}」？</div>
          <ul style={{ margin: '8px 0 0 18px', padding: 0 }}>
            <li>当前正在计算的那条断面会算完，之后的断面不再计算；</li>
            <li>已经算完并入库的断面结果<b>全部保留</b>，可照常在结果页查看；</li>
            <li>任务状态将变为「已终止」，不会自动重跑。</li>
          </ul>
          <div style={{ marginTop: 8, color: '#b45309' }}>
            若跑它的进程已经不存在（例如后端重启过），系统会直接把它标记为「已终止」——
            那类任务本来就没有任何计算在跑，只是状态一直没被收掉。
          </div>
        </div>
      ),
      confirmText: '终止任务',
      danger: true,
    });
    if (!ok) return false;

    const outcome = await cancelTask(taskId);
    if (!outcome.ok) {
      message.error(outcome.message, 6);
      return false;
    }

    if (outcome.kind === 'stopping') {
      message.success(`已请求终止「${name}」：当前断面算完后停止，已完成的结果保留`, 5);
    } else if (outcome.kind === 'stale-cleared') {
      message.success(`「${name}」的执行进程早已不存在，已直接标记为「已终止」`, 6);
    } else {
      message.info(`「${name}」当前并不在运行中，已刷新状态`);
    }

    bumpTreeData();
    // 协作式取消要等执行循环察觉标志才落库（通常 <1s，但可能等一条模型调用）。
    // 这里补两次跟进刷新，免得界面非要等满 5s 的轮询周期才把「运行中」摘掉。
    [1200, 4000].forEach((ms) => window.setTimeout(bumpTreeData, ms));
    return true;
  };

  const handleTreeNodeSelect = (node: TreeNode) => {
    const key = node.ref?.key || '';
    if (node.kind === 'task' && key) {
      useResourceTreeStore.getState().setCurrentTask(key);
      setCurrentTaskId(key);
      return;
    }
    if (node.ref?.entity === 'bank' && key) {
      // 地图联动：把岸段加载到地图上（可见即高亮）
      void loadBankById(key);
      return;
    }
    if (node.ref?.entity === 'section' && key) {
      const features = perpendicularData?.features || [];
      const idx = features.findIndex((f: any) => {
        const p = f.properties || {};
        return String(p.sectionId ?? p.section_id ?? '') === key;
      });
      if (idx >= 0) {
        setSelectedCrossLineIndex(idx);
      } else {
        // 该断面当前不在图上（典型情形：随岸段「移出地图」被摘掉了）
        // → 从后端拉回来并选中，等于"单击即恢复"
        void restoreSectionById(key);
      }
      return;
    }
    if (node.ref?.entity === 'dem') {
      setShowTiffBounds(true);
      // 只聚焦被点中的这一条，避免把整库 DEM 的范围一起铺到地图上
      if (key) setFocusedDemKeys([String(key)]);
      return;
    }
  };

  const handleTreeNodeDoubleClick = (node: TreeNode) => {
    // 双击「计算任务」下的某个任务：把这个任务的岸段与断面整体铺到地图上
    // （先清掉地图上原有的岸段/断面，不合并 —— 免得上一个任务的东西留在图上串号）。
    // 注意判 kind 而不是 ref.entity：任务参数节点（task-ref）的 ref.entity 也是 'task'，
    // 双击它应当是"编辑参数"，不能顺手把整张图换掉。
    if (node.kind === 'task') {
      const tid = String(node.ref?.key || '');
      if (!tid) return;
      useResourceTreeStore.getState().setCurrentTask(tid);
      setCurrentTaskId(tid);
      void loadTaskOntoMap(tid, node.label);
      return;
    }
    if (node.ref?.entity === 'bank') {
      void loadBankById(node.ref.key);
    } else if (node.ref?.entity === 'dem') {
      setShowTiffBounds(true);
      if (node.ref.key) setFocusedDemKeys([String(node.ref.key)]);
    }
  };

  const handleOpenBankParams = (bankId: string) => {
    const features = perpendicularData?.features || [];
    const section = features.find((f: any) => f.properties?.bank_id === bankId);
    if (!section) {
      message.warning('该岸段暂无断面数据，请先生成断面');
      return;
    }
    const lineProps: any = section.properties || {};
    const bankName = lineProps.bank_name || lineProps.bankName || bankId;
    const currentConfig = {
      param_name: lineProps.paramName || lineProps.param_name || '',
      segment: lineProps.segment || '',
      current_timepoint: lineProps.currentTimepoint || lineProps.current_timepoint || '',
      set_name: lineProps.setName || lineProps.set_name || '',
      water_qs: lineProps.waterQs || lineProps.water_qs || '',
      tidal_level: lineProps.tidalLevel || lineProps.tidal_level || '',
      bench_id: lineProps.benchId || lineProps.bench_id || '',
      ref_id: lineProps.refId || lineProps.ref_id || '',
      hs: lineProps.hs,
      hc: lineProps.hc,
      protection_level: lineProps.protectionLevel || lineProps.protection_level || '',
      control_level: lineProps.controlLevel || lineProps.control_level || '',
      comparison_timepoint: lineProps.comparisonTimepoint || lineProps.comparison_timepoint || '',
      risk_thresholds: lineProps.riskThresholds || lineProps.risk_thresholds || {},
      weights: lineProps.weights || {},
      other_params: lineProps.otherParams || lineProps.other_params || {},
    } as any;
    setEditingBankParams({ bankId, bankName, config: currentConfig });
  };

  const handleNewTask = () => {
    if (!uploadedData || selectedLines.size === 0) {
      message.warning('请先在地图上选中岸段（底部「选中岸段」点选），再创建任务');
      return;
    }
    setCreateTaskModalOpen(true);
  };

  const handleCreateTaskConfirm = async (form: CreateTaskForm) => {
    setCreateTaskModalOpen(false);
    if (!uploadedData || selectedLines.size === 0) {
      message.warning('没有已选中的岸段，无法生成断面');
      return;
    }
    setGlobalInterval(form.interval);
    setGlobalLength(form.length);
    let sectionParams = globalProperties;
    if (form.templateId) {
      try {
        const { numericId, sectionParams: sp } = await fetchBasicParamDetailAsSectionParams(form.templateId);
        sectionParams = sp;
        setGlobalProperties(sp);
        setSelectedBasicParamIdState(form.templateId);
        setCurrentBasicParamId(numericId);
      } catch (err) {
        console.warn('加载参数模板失败:', err);
      }
    }
    const genFn = form.sectionType === 'display'
      ? generateSectionsAndCreateTask
      : generateComputeSectionsAndCreateTask;
    await genFn({
      uploadedData,
      selectedLines,
      globalInterval: form.interval,
      globalLength: form.length,
      globalProperties: sectionParams,
      setPerpendicularData,
      setShowCrossLines,
      setGlobalProperties,
      requestTaskName: () => Promise.resolve(form.name),
      skipUploadBanks: true,
      existingTaskId: null,
      templateParamId: form.templateId || null,
    });
    const tid = getCurrentTaskId();
    if (tid) {
      useResourceTreeStore.getState().setCurrentTask(tid);
      useResourceTreeStore.getState().invalidateSections(tid);
      // 任务建好后，参数面板切到「本任务参数」——它已经是模板的一份独立副本，
      // 之后再改模板库不会影响这个任务，面板上显示的也应该是这份副本。
      try {
        await loadTaskParamsAsGlobalProperties(tid);
      } catch (err) {
        console.warn('加载新任务参数失败:', err);
      }
    }
    bumpTreeData();
    fetchBankGroups();
  };

  // ——— 「补充岸段到已有任务」 ———
  //
  // 与「新建任务」的区别：不新建任务、不清空既有断面、不覆盖任何结果。
  // 候选 = 全库岸段 − 该任务已有关联（bank_ids ∪ 断面里出现过的 bank_id）。
  const collectAllBankFeatures = (): GeoJSON.FeatureCollection => {
    const features = (bankList || [])
      .map((b: any) => {
        const geom = b?.bank_geometry || b?.geometry;
        if (!geom) return null;
        return {
          type: 'Feature' as const,
          geometry: geom,
          properties: { bank_id: b.bank_id },
        } as any;
      })
      .filter(Boolean);
    return { type: 'FeatureCollection', features } as any;
  };

  const openAddBanksModal = async (taskId: string, taskName?: string) => {
    const tid = String(taskId || '').trim();
    if (!tid) return;
    // 入口有两个（任务节点 / 该任务下的「岸段」文件夹），文件夹的 label 是「岸段」而不是任务名，
    // 所以任务名一律以库里那份为准，传进来的 label 只做兜底。
    const fromStore = ((useResourceTreeStore.getState().tasks || []) as any[]).find(
      (t: any) => String(t?.task_id ?? t?.id) === tid,
    );
    const label = String(fromStore?.task_name || taskName || tid);
    const key = `add-banks:${tid}`;
    message.loading({ content: `正在读取任务「${label}」已有岸段与断面…`, key, duration: 0 });
    try {
      // 已有岸段取「库里的 tasks.bank_ids」而不是 store 里的任务快照：
      // 补完岸段后 store 可能还没被 bumpData 重拉刷新，用旧快照算候选，
      // 会把刚补上的岸段又列一遍（用户就会重复补同一批）。
      const scope = await resolveTaskBankScope(tid, await fetchTaskBankIds(tid));

      // 岸段库：优先用已经拉过的那份，没有就现拉 —— 否则弹窗里的候选会是空的，
      // 看起来像"库里没有岸段"，而实际只是这个页面还没请求过。
      let all: any[] = Array.isArray(bankList) ? bankList : [];
      if (all.length === 0) {
        const res = await fetch('/v0/bank/banks', { headers: { ...authHeaders() } });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = await res.json();
        all = (data?.banks || data?.data || []) as any[];
        setBankList(Array.isArray(all) ? all : []);
      }

      const candidates = pickCandidateBanks(all, scope.existingBankIds);
      message.destroy(key);
      setAddBanksModal({ taskId: tid, taskName: label, candidates, scope });
    } catch (e: any) {
      console.error('打开补充岸段弹窗失败:', e);
      message.error({ content: `读取任务「${label}」的岸段范围失败：${e?.message || String(e)}`, key, duration: 6 });
    }
  };

  const handleAddBanksConfirm = async (form: AddBanksForm) => {
    const ctx = addBanksModal;
    if (!ctx) return;
    setAddBanksModal(null);

    const chosen = ctx.candidates.filter((b: any) => form.bankIds.includes(String(b.bank_id)));
    if (chosen.length === 0) {
      message.warning('没有可用的岸段（选择的岸段已不在候选清单里，请重新打开）');
      return;
    }

    const key = `add-banks:${ctx.taskId}`;
    const progress = (content: string) =>
      message.loading({ content, key, duration: 0 });

    try {
      progress(`正在为 ${chosen.length} 条岸段生成断面…`);
      const result = await generateSectionsForBanksIntoTask({
        taskId: ctx.taskId,
        banks: chosen,
        interval: form.interval,
        length: form.length,
        sectionType: form.sectionType,
        segmentIndexStart: ctx.scope.nextSegmentIndex,
        shorelineScope: collectAllBankFeatures(),
        onProgress: progress,
      });

      // 地图上同步追加：新断面直接画出来，新岸段也铺上去（否则断面看着是悬空的）
      const addedSections = appendSectionsToMap(result.sectionRecords);
      if (addedSections > 0) setShowCrossLines(true);
      for (const bid of result.bankIds) {
        await loadBankById(bid, { silent: true });
      }

      // 补充成功后要让用户**当场看得见**，分三步：
      //  1) 本地先把新岸段并进 store 的任务快照 —— 树立刻能画出岸段节点，
      //     不必等 bumpData 触发的 /tasks 回包（那个请求失败时树会停在旧快照上）。
      //  2) 幂等展开该任务节点 —— 折叠着的话用户根本看不到新加的岸段。
      //  3) 主动重拉并写回断面缓存 —— 只 invalidate 不够：ResourceSidebar 只会给
      //     「当前任务 / 已展开任务」补拉，折叠状态下缓存删了就永远不回来。
      mergeBankIdsIntoTasksStore(ctx.taskId, result.bankIds);
      useResourceTreeStore.getState().expandNode(`task:${ctx.taskId}`);
      try {
        await refreshTaskSectionsIntoStore(ctx.taskId);
      } catch (e) {
        console.warn('刷新任务断面缓存失败，退回作废缓存:', e);
        useResourceTreeStore.getState().invalidateSections(ctx.taskId);
      }
      bumpTreeData();
      fetchBankGroups();

      message.success({
        content:
          `已为任务「${ctx.taskName}」生成 ${result.sectionCount} 条断面（原有断面与结果未改动）；` +
          (result.addedBankIds.length > 0
            ? `新增关联岸段 ${result.addedBankIds.length} 条`
            : `这 ${result.bankIds.length} 条岸段本来就关联在该任务上，本次只补了断面`) +
          '。已同步展开资源树中的该任务。',
        key,
        duration: 6,
      });

      // 到这里「岸段 + 断面」已经真正落库成功。后面的计算失败**不能**再报成
      // "补充岸段失败" —— 那会让用户以为没补上，于是重复去点补充（候选里当然没有，
      // 因为关联已经写进去了），最后只看到"补了却不出图"。所以计算单独 try。
      if (!form.runNow) {
        message.info({
          content:
            `已保存 ${result.sectionCount} 条断面，但它们还没有计算结果；` +
            '结果页对「没有风险值」的岸段按透明处理，所以暂时不会着色。' +
            '需要时右键该任务 →「只算未计算断面」。',
          key,
          duration: 10,
        });
        return;
      }

      try {
        // 只算本次新增的这一批：不传 section_ids 就是"整个任务所有没结果的断面"，
        // 在一个 300 条断面只出 40 条结果的任务上会连带重算 275 条老断面。
        const newSectionIds = result.sectionRecords
          .map((s: any) => String(s?.section_id ?? ''))
          .filter(Boolean);
        progress(`正在计算本次新增的 ${newSectionIds.length} 条断面…`);
        const run = await runTaskPendingSections(ctx.taskId, newSectionIds);
        if (run.status === 'nothing_pending') {
          message.info({ content: '这批断面已经都有结果了，无需再算', key, duration: 6 });
        } else if (run.ok) {
          message.success({
            content:
              `新增断面计算完成：成功 ${run.computed} 条、失败 ${run.failed} 条` +
              (run.skippedExisting > 0 ? `（已有结果跳过 ${run.skippedExisting} 条）` : ''),
            key,
            duration: 6,
          });
        } else {
          message.warning({
            content: `这 ${result.sectionCount} 条断面已保存，但计算未全部成功：成功 ${run.computed} 条、失败 ${run.failed} 条`,
            key,
            duration: 8,
          });
        }
      } catch (runErr: any) {
        console.error('新增断面计算失败（岸段与断面已保存）:', runErr);
        message.warning({
          content:
            `岸段与 ${result.sectionCount} 条断面已保存成功，但这批断面的计算没跑成：` +
            `${runErr?.message || String(runErr)}。可稍后右键该任务 →「只算未计算断面」重试。`,
          key,
          duration: 10,
        });
      }
      bumpTreeData();
    } catch (e: any) {
      console.error('补充岸段失败:', e);
      message.error({ content: `补充岸段失败：${e?.message || String(e)}`, key, duration: 8 });
    }
  };

  /** 只算「还没有结果」的断面：补完岸段后不想全量重跑时用。 */
  const runPendingForTask = async (taskId: string, label: string) => {
    const tid = String(taskId || '');
    if (!tid) return;
    const ok = await requestConfirm({
      title: '只算未计算断面',
      content:
        `将执行「${label}」中还没有结果的断面；已有结果的断面不会被重算，也不会被删除。\n` +
        '如果只想算刚补充的岸段，这就是对的入口。',
    });
    if (!ok) return;

    const key = `add-banks:${tid}`;
    message.loading({ content: `正在计算「${label}」中未计算的断面…`, key, duration: 0 });
    try {
      const run = await runTaskPendingSections(tid);
      if (run.status === 'nothing_pending') {
        message.info({ content: `「${label}」没有待计算的断面`, key, duration: 5 });
      } else if (run.ok) {
        message.success({
          content: `「${label}」计算完成：成功 ${run.computed} 条、失败 ${run.failed} 条（跳过已有 ${run.skippedExisting} 条）`,
          key,
          duration: 6,
        });
      } else {
        message.warning({
          content: `「${label}」未全部成功：成功 ${run.computed} 条、失败 ${run.failed} 条`,
          key,
          duration: 6,
        });
      }
      bumpTreeData();
    } catch (e: any) {
      message.error({ content: `执行失败：${e?.message || String(e)}`, key, duration: 8 });
    }
  };

  const handleTreeNodeAction = async (node: TreeNode, actionKey: string) => {
    const key = node.ref?.key || '';

    const fmtTime = (v: any) => {
      if (!v) return '-';
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('zh-CN', { hour12: false });
    };
    const openInfo = (title: string, rows: Array<[string, string]>, storage: string) =>
      setInfoModal({ title, groups: [{ heading: '基本信息', rows }, { heading: '存储位置', rows: [['存储', storage]] }] });
    const openResourceInfo = (kind: string, k: string, label: string) => {
      const store = useResourceTreeStore.getState();
      if (kind === 'bank') {
        const b: any = (store.banks || []).find((x: any) => String(x.bank_id) === k) || {};
        const pts = b?.bank_geometry?.coordinates?.length;
        openInfo(`岸段属性：${b.bank_name || label}`, [
          ['岸段 ID', String(b.bank_id || k)],
          ['岸段名称', b.bank_name || '-'],
          ['区域代码', b.region_code || '-'],
          ['是否反向', b.reversed != null ? String(b.reversed) : '-'],
          ['描述', b.description || '-'],
          ['几何点数', pts != null ? String(pts) : '-'],
          ['创建时间', fmtTime(b.created_at)],
          ['更新时间', fmtTime(b.updated_at)],
        ], 'PostgreSQL `bank_risk_db` · `banks` 表（几何字段 bank_geometry / geom）');
      } else if (kind === 'section') {
        const all = Object.values(store.sectionsByTask || {}).flat() as any[];
        const s: any = all.find((x: any) => String(x.section_id ?? x.id) === k) || {};
        openInfo(`断面属性：${s.section_name || k}`, [
          ['断面 ID', String(s.section_id || k)],
          ['断面名称', s.section_name || '-'],
          ['所属任务', s.task_id || '-'],
          ['所属岸段', s.bank_id || '-'],
          ['区域代码', s.region_code || '-'],
          ['校验状态', s.validation_status || '-'],
          ['距离', s.distance != null ? String(s.distance) : '-'],
          ['参数模板', s.param_name || (s.basic_param_id != null ? String(s.basic_param_id) : '-')],
          ['基准 DEM', s.bench_id || '-'],
          ['对照 DEM', s.ref_id || '-'],
          ['创建时间', fmtTime(s.created_at)],
          ['更新时间', fmtTime(s.updated_at)],
        ], 'PostgreSQL `bank_risk_db` · `cross_sections` 表（几何 section_geometry / geom）');
      } else if (kind === 'param') {
        const p: any = (store.params || []).find((x: any) => String(x.param_id ?? x.id) === k) || {};
        openInfo(`参数模板属性：${p.param_name || k}`, [
          ['param_id', String(p.param_id || k)],
          ['数据库 id', p.id != null ? String(p.id) : '-'],
          ['名称', p.param_name || '-'],
          ['河段', p.segment || '-'],
          ['流量 (water_qs)', p.water_qs || '-'],
          ['潮型 (tidal_level)', p.tidal_level || '-'],
          ['基准 DEM', p.bench_id || '-'],
          ['对照 DEM', p.ref_id || '-'],
          ['当前时间点', p.current_timepoint || '-'],
          ['对比时间点', p.comparison_timepoint || '-'],
          ['创建时间', fmtTime(p.created_at)],
          ['更新时间', fmtTime(p.updated_at)],
        ], 'PostgreSQL `bank_risk_db` · `basic_params` 表');
      } else if (kind === 'dem') {
        const d: any = (store.tiffs || []).find((x: any) => String(x.tiff_key ?? x.key ?? x.file_name) === k) || {};
        openInfo(`DEM 属性：${d.file_name || k}`, [
          ['TIFF Key (路径)', String(d.tiff_key || k)],
          ['河段', d.segment || d.region_code || '-'],
          ['年份', d.year || '-'],
          ['时间点', d.timepoint || '-'],
          ['文件名', d.file_name || '-'],
          ['X 范围', d.min_x != null ? `${d.min_x} ~ ${d.max_x}` : '-'],
          ['Y 范围', d.min_y != null ? `${d.min_y} ~ ${d.max_y}` : '-'],
          ['创建时间', fmtTime(d.created_at)],
          ['更新时间', fmtTime(d.updated_at)],
        ], '本体 .tif 文件在模型服务端文件系统 `resource/tiff/...`；元数据在 PostgreSQL `tiff_bounds` 表');
      }
    };

    // —— 校验规则（树里与「数据资源」「计算任务」并列的「规则」节点）——
    /**
     * 切换一条规则。
     *
     * <p>只有**规则集**真的变了才把断面打回 pending；单纯切换图层（眼睛）不改判定，
     * 不该让一整个任务的几千条断面重跑一遍校验（每条一次 HTTP）。
     *
     * <p>为什么必须打回：`cross_sections.validation_status` 只保存"最后一次按当时规则集算出来的结论"，
     * 规则集一变它就开始骗人 —— 而分析前的门禁读的正是它。
     */
    const applyRuleToggle = (id: RuleId) => {
      const before = rulesetKeyOf(useRuleStore.getState().enabled);
      useRuleStore.getState().toggle(id);
      const after = rulesetKeyOf(useRuleStore.getState().enabled);
      if (before === after) return; // 锁定规则被 toggle 忽略（store 里已兜底）

      const def = ruleById(id);
      const nowOn = isRuleOn(useRuleStore.getState().enabled, id);
      message.info({
        content: `${nowOn ? '已启用' : '已停用'}规则「${def?.label || id}」，历史校验结论已作废；执行分析前会自动重新校验全部断面。`,
        duration: 5,
      });

      const ids = (perpendicularData?.features || [])
        .map((f: any) => f?.properties?.sectionId as string | undefined)
        .filter(Boolean) as string[];
      ids.forEach((sid) => patchSectionValidationProps(sid, {
        validation_status: 'pending',
        is_valid: undefined,
        validation_status_raw: undefined,
        validation_message: undefined,
        validated_at: undefined,
      }));
    };

    /**
     * 规则行尾的「眼睛」：只控制判定范围的显示，与"规则是否执行"正交。
     * 长江范围已开但上次加载失败时，这次点击当作重试 —— 否则用户只能关一次再开一次。
     */
    const toggleRuleLayer = (rule: NonNullable<TreeNode['rule']>) => {
      if (rule.layer === 'river') {
        if (!showRiverSurface) { setShowRiverSurface(true); return; }
        if (riverSurfaceStatus === 'error') { void loadRiverSurface(true); return; }
        setShowRiverSurface(false);
        return;
      }
      if (rule.layer === 'tiff') setShowTiffBounds((v) => !v);
    };

    const openRuleInfo = (id: RuleId) => {
      const def = ruleById(id);
      if (!def) return;
      const on = isRuleOn(useRuleStore.getState().enabled, id);
      setInfoModal({
        title: `规则说明 · ${def.label}`,
        groups: [
          {
            heading: '判定',
            rows: [
              ['规则 ID', def.id],
              ['依据', def.desc],
              ['失败码', def.failCode || '—'],
            ],
          },
          {
            heading: '开关',
            rows: def.locked
              ? [
                  ['可关闭', '否（固定）'],
                  ['原因', '模型采样 / 参数合法性必需；关掉不会算出结果，只会产出不可用数据'],
                ]
              : [
                  ['当前状态', on ? '启用' : '已停用'],
                  ['停用后果', def.offWarning || '不再拦截该条件，交给后续校验或模型自行报错'],
                ],
          },
        ],
      });
    };

    const openRuleCreateInfo = () => {
      setInfoModal({
        title: '新增规则',
        groups: [
          {
            heading: '如何新增',
            rows: [
              ['①', '前端 src/rules/catalog.ts 的 RULE_CATALOG 登记 id / 分类 / 名称 / 是否可关 / 关联图层'],
              ['②', '后端 SectionValidationService 实现判定，并使用同名常量'],
              ['③', '重启后端；未登记或未实现的 id 会被忽略并打 warn，不会让整批校验失败'],
            ],
          },
          {
            heading: '当前已登记',
            rows: RULE_CATALOG.map((r) => [r.id, `${r.label}${r.locked ? '（固定）' : ''}`]),
          },
        ],
      });
    };

    switch (actionKey) {
      // 规则节点：开关 / 图层 / 说明（新增入口挂在「规则」组行上）
      case 'rule.toggle': if (node.rule) applyRuleToggle(node.rule.id); break;
      case 'rule.layer': if (node.rule) toggleRuleLayer(node.rule); break;
      case 'rule.describe': if (node.rule) openRuleInfo(node.rule.id); break;
      case 'rule.create': openRuleCreateInfo(); break;
      case 'bank.upload': bankUploadInputRef.current?.click(); break;
      case 'bank.colorToggle': setColorBanks(!colorBanks); break;
      case 'bank.loadMap':
      case 'bank.locate': await loadBankById(key); break;
      case 'bank.removeMap': removeBankFromMap(key); break;
      case 'bank.props': handleOpenBankParams(key); break;
      case 'bank.smooth': smoothSelectedShoreLines(); break;
      case 'bank.clip': toggleStartEndSelection(); break;
      case 'bank.confirmClip': await clipSelectedBank(); break;
      case 'bank.selectByTiff': selectBanksByTiffRange(); break;
      case 'bank.fixReversed': setIsFixingShoreLineReversed((v) => !v); break;
      case 'bank.uploadSelected': await sendSelectedShoreLinesGeoJson(); break;
      case 'bank.delete': await deleteBankById(key); bumpTreeData(); break;
      case 'bank.clearLoaded': deleteLoadedBanks(); break;
      // 文件夹级批量：与 section.loadAll / section.removeAll 对称
      case 'bank.loadAll': await loadAllBanksUnder(node); break;
      case 'bank.removeAll': removeAllBanksUnder(node); break;

      case 'section.upload': sectionsUploadInputRef.current?.click(); break;
      case 'section.toggleVisible': setShowCrossLines(!showCrossLines); break;
      case 'section.loadMap': await restoreSectionById(key); break;
      case 'section.loadAll': await loadAllSectionsUnder(node); break;
      case 'section.removeAll': removeAllSectionsUnder(node); break;
      case 'section.generateDisplay': await handleGenerateSections(); bumpTreeData(); break;
      case 'section.generateCompute': await handleGenerateComputeSections(); bumpTreeData(); break;
      case 'section.validate': await validateAllPendingSections(); break;
      case 'section.deleteInvalid': await deleteAllInvalidSections(); break;
      case 'section.export': handleExportSections(); break;
      case 'section.reverse': {
        // 断面节点上点「反切」：目标是这个断面本身（不在图上就先拉回来），
        // 不能拿"地图上碰巧选中的那个"去反切。文件夹上的「反切」仍按当前多选处理。
        if (node.ref?.entity === 'section') {
          const idx = await focusSectionOfTreeNode(key);
          if (idx == null) { message.warning(`未能定位断面 ${node.label}，请先把它「加载到地图」`); break; }
          await reverseSelectedCrossLine([idx]);
          break;
        }
        await reverseSelectedCrossLine();
        break;
      }
      case 'section.fineTune': toggleCrossLineSelection(); break;
      case 'section.batchParams': {
        const features = perpendicularData?.features || [];
        const ids = features
          .map((f: any) => f.properties?.sectionId ?? f.properties?.section_id)
          .filter(Boolean) as string[];
        if (ids.length === 0) { message.warning('当前无断面可批量设置'); break; }
        if (!globalProperties) { message.warning('请先选择参数模板'); break; }
        const ok = await requestConfirm({ title: '断面批量参数', content: `将当前参数模板应用到 ${ids.length} 个断面？` });
        if (ok) {
          await fetch('/v0/bank/sections/batch-params', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ section_ids: ids, params: globalProperties }),
          });
          message.success(`已应用参数到 ${ids.length} 个断面`);
        }
        break;
      }
      case 'section.props': {
        // 「断面参数」的目标 = 被点的那一行断面节点，而不是"地图上当前选中的断面"。
        // 旧实现在这里直接复用选中项，所以只要没先在地图上点过断面就会报错。
        if (node.ref?.entity === 'section') {
          const idx = await focusSectionOfTreeNode(key);
          if (idx == null) { message.warning(`未能定位断面 ${node.label}，请先把它「加载到地图」`); break; }
          await configureSelectedCrossLinePropertiesAction({
            selectedCrossLineIndex: idx,
            perpendicularData: useEditorStore.getState().perpendicularData as any,
            setEditingPropertiesGroupId,
          });
          break;
        }
        await configureSelectedCrossLineProperties();
        break;
      }
      case 'section.delete': {
        if (node.ref?.entity === 'section') {
          const idx = await focusSectionOfTreeNode(key);
          if (idx == null) { message.warning(`未能定位断面 ${node.label}，请先把它「加载到地图」`); break; }
          const ok = await requestConfirm({
            title: '删除断面',
            content: `确认删除断面 ${node.label}？后端记录会一并删除，且无法撤销。`,
          });
          if (!ok) break;
          await deleteSelectedCrossLineAction({
            selectedCrossLineIndex: idx,
            perpendicularData: useEditorStore.getState().perpendicularData as any,
            setPerpendicularData,
            setSelectedCrossLineIndex: (v) => {
              setSelectedCrossLineIndex(v);
              if (v === null) setSelectedCrossLineIndices(new Set());
            },
          });
          // 后端已删，但树里还缓存着这条断面 → 让该任务的断面清单失效，否则节点会残留在树上
          const tid = taskIdOfSection(String(key));
          if (tid) useResourceTreeStore.getState().invalidateSections(tid);
          bumpTreeData();
          break;
        }
        await deleteSelectedCrossLine();
        break;
      }

      case 'param.create': setCreateParamModalOpen(true); break;
      case 'param.select': await handleSelectBasicParam(key); break;
      case 'param.props': await openGlobalPropertiesModal({ scope: 'library', paramId: key }); break;
      case 'param.editSectionParams': await configureSelectedCrossLineProperties(); break;

      case 'dem.select':
      case 'dem.upload': setDemPickerOpen(true); break;
      case 'dem.toggleBounds': {
        // 资源树里点的是「某一条」DEM 的开关 ⇒ 只切这一条，不动别的：
        //   点第二下 = 关掉它自己（用户明确要的语义），不是"把全库画出来"。
        // 关到一条不剩时连总开关一起关（见 toggleDemBounds）。
        const next = toggleDemBounds({ showTiffBounds, focusedDemKeys }, key);
        setShowTiffBounds(next.showTiffBounds);
        setFocusedDemKeys(next.focusedDemKeys);
        break;
      }
      case 'dem.selectBanks': selectBanksByTiffRange(key); break;
      case 'dem.delete': {
        const svc = await import('../services/tiffService');
        await svc.deleteTiffResource(key);
        svc.invalidateTiffResourceCache();
        bumpTreeData();
        break;
      }

      case 'bank.info': openResourceInfo('bank', key, node.label); break;
      case 'section.info': openResourceInfo('section', key, node.label); break;
      case 'param.info': openResourceInfo('param', key, node.label); break;
      case 'dem.info': openResourceInfo('dem', key, node.label); break;
      case 'task.create': await handleNewTask(); break;
      case 'task.props': {
        const tasks = useResourceTreeStore.getState().tasks;
        const t: any = tasks.find((x: any) => String(x.task_id ?? x.id) === key) || { task_id: key, task_name: node.label };
        const bankCount = Array.isArray(t.bank_ids) ? t.bank_ids.length : 0;
        openInfo('任务属性', [
          ['任务名称', t.task_name || '-'],
          ['任务 ID', String(t.task_id || key)],
          ['状态', t.status || '-'],
          ['岸段数量', `${bankCount} 条`],
          ['描述', t.description || '-'],
          ['创建时间', fmtTime(t.created_at)],
          ['更新时间', fmtTime(t.updated_at)],
          ['开始运行', fmtTime(t.run_started_at)],
          ['完成运行', fmtTime(t.run_completed_at)],
        ], 'PostgreSQL `bank_risk_db` · `tasks` 表');
        break;
      }
      case 'task.run': useResourceTreeStore.getState().setCurrentTask(key); await handleStartAnalysis(); break;
      case 'task.stop': await handleStopTask(key, node.label); break;
      case 'task.generateCompute': useResourceTreeStore.getState().setCurrentTask(key); await handleGenerateComputeSections(); bumpTreeData(); break;
      case 'task.addBanks': await openAddBanksModal(key, node.label); break;
      case 'task.runPending': await runPendingForTask(key, node.label); break;
      case 'task.setParam': useResourceTreeStore.getState().setCurrentTask(key); await openGlobalPropertiesModal({ scope: 'task', taskId: key }); break;
      case 'task.loadMap': await loadTaskOntoMap(key, node.label); break;
      case 'task.viewResult': setPage?.('result', key); break;
      case 'task.delete': {
        const ok = await requestConfirm({ title: '删除任务', content: `确认删除任务「${node.label}」？`, danger: true });
        if (ok) {
          await fetch(`/v0/bank/tasks/${encodeURIComponent(key)}`, { method: 'DELETE', headers: { ...authHeaders() } });
          invalidateTaskParamsCache(key);
          useResourceTreeStore.getState().removeTask(key);
          bumpTreeData();
        }
        break;
      }

      case 'global.clear': onClear(); break;
      case 'global.satellite': setSatellite(!satellite); break;
      case 'global.uploadBank': bankUploadInputRef.current?.click(); break;
      case 'global.uploadSections': sectionsUploadInputRef.current?.click(); break;
      default: console.warn('未绑定资源树操作:', actionKey);
    }
  };

  /**
   * 多选批量操作分发：ResourceSidebar 的批量条把「类型 + 该类型的选中节点 + 动作」抛到这里。
   *
   * 每种类型只放「对所有选中节点语义一致、可安全并发」的动作；依赖地图当前态的单条动作
   * （平滑/截取/反切/定位）不进批量。具体每类支持哪些见 tree/batchActions.ts。
   */
  const handleBatchAction = async (kind: string, nodes: TreeNode[], actionKey: string) => {
    const ids = nodes.map((n) => String(n.ref?.key || '')).filter(Boolean);
    if (ids.length === 0) { message.warning('没有可操作的目标'); return; }

    const clearTreeSelection = () => useResourceTreeStore.getState().clearSelection();

    if (kind === 'bank') {
      if (actionKey === 'bank.delete') {
        await deleteBanksByIds(ids);
        bumpTreeData();
      } else if (actionKey === 'bank.loadMap') {
        const hide = message.loading(`正在加载 ${ids.length} 条岸段…`, 0);
        let ok = 0;
        for (const id of ids) { try { await loadBankById(id); ok++; } catch { /* 单条失败跳过 */ } }
        hide();
        message.success(`已加载 ${ok}/${ids.length} 条岸段`);
      } else if (actionKey === 'bank.removeMap') {
        const ok = await requestConfirm({ title: '批量移出地图', content: `将把 ${ids.length} 条岸段（及其断面）从地图移出，确认继续？` });
        if (!ok) return;
        ids.forEach((id) => removeBankFromMap(id));
        message.success(`已从地图移出 ${ids.length} 条岸段`);
      }
      clearTreeSelection();
      return;
    }

    if (kind === 'section') {
      if (actionKey === 'section.removeMap') {
        removeSectionsByIds(ids);
      } else if (actionKey === 'section.loadMap') {
        // 复用 loadAllSectionsUnder 的思路，但目标是一组明确的 section_id
        const hide = message.loading(`正在加载 ${ids.length} 条断面…`, 0);
        let ok = 0; let fail = 0; let cursor = 0;
        const worker = async () => {
          while (cursor < ids.length) {
            const id = ids[cursor++];
            try {
              const res = await fetch(`/v0/bank/sections/${encodeURIComponent(id)}`, { headers: { ...authHeaders() } });
              if (!res.ok) throw new Error(`${res.status}`);
              const data = await res.json();
              const rec = data?.section ?? data?.data ?? data;
              if (rec && (rec.section_id || rec.sectionId) && appendSectionsToMap([rec]) > 0) ok++;
              else fail++;
            } catch { fail++; }
          }
        };
        await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker));
        hide();
        if (ok > 0) setShowCrossLines(true);
        if (fail > 0) message.warning(`已加载 ${ok} 条断面，${fail} 条未能加载`);
        else message.success(`已加载 ${ok} 条断面`);
      } else if (actionKey === 'section.delete') {
        const ok = await requestConfirm({
          title: '批量删除断面',
          content: `将删除 ${ids.length} 条断面，后端记录会一并删除且无法撤销，确认继续？`,
          danger: true,
        });
        if (!ok) return;
        // 记下每条断面所属任务，删除后逐一失效其清单缓存，避免树上残留
        const affectedTasks = new Set<string>();
        ids.forEach((sid) => { const t = taskIdOfSection(sid); if (t) affectedTasks.add(t); });
        const results = await Promise.allSettled(
          ids.map((sid) => fetch(`/v0/bank/sections/${encodeURIComponent(sid)}`, { method: 'DELETE', headers: { ...authHeaders() } })
            .then((r) => { if (!r.ok) throw new Error(`${r.status}`); return true; })),
        );
        const okCount = results.filter((r) => r.status === 'fulfilled').length;
        const failCount = results.length - okCount;
        affectedTasks.forEach((tid) => useResourceTreeStore.getState().invalidateSections(tid));
        // 同步从地图摘掉已删断面
        removeSectionsByIds(ids);
        bumpTreeData();
        if (failCount > 0) message.warning(`已删除 ${okCount} 条断面，${failCount} 条失败`);
        else message.success(`已删除 ${okCount} 条断面`);
      }
      clearTreeSelection();
      return;
    }

    if (kind === 'dem') {
      if (actionKey === 'dem.delete') {
        const ok = await requestConfirm({ title: '批量删除 DEM', content: `将删除 ${ids.length} 个 DEM 资源，确认继续？`, danger: true });
        if (!ok) return;
        const svc = await import('../services/tiffService');
        let okCount = 0; let failCount = 0;
        for (const key of ids) {
          try { await svc.deleteTiffResource(key); okCount++; } catch { failCount++; }
        }
        svc.invalidateTiffResourceCache();
        bumpTreeData();
        if (failCount > 0) message.warning(`已删除 ${okCount} 个 DEM，${failCount} 个失败`);
        else message.success(`已删除 ${okCount} 个 DEM`);
      }
      clearTreeSelection();
      return;
    }

    if (kind === 'task') {
      if (actionKey === 'task.delete') {
        const ok = await requestConfirm({ title: '批量删除任务', content: `将删除 ${ids.length} 个任务及其结果，确认继续？`, danger: true });
        if (!ok) return;
        let okCount = 0; let failCount = 0;
        for (const tid of ids) {
          try {
            const res = await fetch(`/v0/bank/tasks/${encodeURIComponent(tid)}`, { method: 'DELETE', headers: { ...authHeaders() } });
            if (!res.ok) throw new Error(`${res.status}`);
            useResourceTreeStore.getState().removeTask(tid);
            okCount++;
          } catch { failCount++; }
        }
        bumpTreeData();
        if (failCount > 0) message.warning(`已删除 ${okCount} 个任务，${failCount} 个失败`);
        else message.success(`已删除 ${okCount} 个任务`);
      }
      clearTreeSelection();
      return;
    }
  };

  const totalCrossLinesCount = perpendicularData?.features.length || 0;
  const totalSelectedSegments = groups.filter(g => g.end !== null).length;
  const clippedBanks = (bankList || []).filter((b: any) => String(b.bank_id || '').includes('_clip_'));

  // —— 侧栏下半区「已加载到屏幕」需要两个"屏幕现状"字段 ——
  // ① DEM 范围：只统计**真正喂给地图**的那份（visibleTiffBoundsData），
  //    用全量会重复上次那个"点一条却列出全部"的坑（见 visibleTiffBoundsData 的注释）。
  const demKeysOnMap = useMemo(() => {
    if (!showTiffBounds || !visibleTiffBoundsData) return [] as string[];
    const keys = (visibleTiffBoundsData.features || [])
      .map((f: any) => String(f?.properties?.tiff_key ?? ''))
      .filter(Boolean);
    return [...new Set(keys)];
  }, [showTiffBounds, visibleTiffBoundsData]);

  // ② 当前在地图上选中的断面（面板据此高亮对应行）
  const activeSectionIdOnMap = useMemo(() => {
    const list = (perpendicularData?.features || []) as any[];
    if (selectedCrossLineIndex == null || !list[selectedCrossLineIndex]) return null;
    return sectionIdOfFeature(list[selectedCrossLineIndex]) || null;
  }, [perpendicularData, selectedCrossLineIndex]);

  return (
    <div className="editor-layout">
      <div className="editor-sidebar-panel" style={{ width: leftPanelWidth, minWidth: leftPanelWidth, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flex: 1, minHeight: 0, position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column' }}>
          <input ref={bankUploadInputRef} type="file" accept=".geojson,application/json" style={{ display: 'none' }} onChange={handleFileUpload} />
          <input ref={sectionsUploadInputRef} type="file" accept=".geojson,application/json" style={{ display: 'none' }} onChange={handleSectionsFileUpload} />
          {sidebarMode === 'tree' && (
            <ResourceSidebar
              demKeys={demKeysOnMap}
              activeSectionId={activeSectionIdOnMap}
              tiffBoundsVisible={showTiffBounds}
              handlers={{
                onAction: handleTreeNodeAction,
                onNodeSelect: handleTreeNodeSelect,
                onNodeDoubleClick: handleTreeNodeDoubleClick,
                onRun: handleStartAnalysis,
                onBatchAction: handleBatchAction,
                // —— 下半区「已加载到屏幕」的行级/组级操作 ——
                onFocusBank: (id) => { void focusBankOnMap(id); },
                onRemoveBank: removeBankFromMap,
                onRemoveAllBanks: removeLoadedBanksFromMap,
                onFocusSection: (id) => { void focusSectionOfTreeNode(id); },
                onRemoveSection: (id) => removeSectionsByIds([id]),
                onRemoveAllSections: removeLoadedSectionsFromMap,
          onFocusDem: (key) => { setShowTiffBounds(true); setFocusedDemKeys([String(key)]); },
          onHideDems: () => { setShowTiffBounds(false); setFocusedDemKeys(null); },
          // —— 下半区运行横幅的「终止」：与资源树 task.stop 走同一条实现 ——
          onStopTask: (id, name) => handleStopTask(id, name),
        }}
            />
          )}
          {sidebarMode === 'classic' && (
        <EditorSidebar
          uploadedData={uploadedData}
          bankGroups={bankGroups}
          bankList={bankList}
          deleteBankById={deleteBankById}
          deleteBanksByIds={deleteBanksByIds}
          smoothSelectedShoreLines={smoothSelectedShoreLines}
          selectedBankGroup={selectedBankGroup}
          setSelectedBankGroup={handleSelectBanksFromDropdown}
          loadBankById={loadBankById}
          removeBankFromMap={removeBankFromMap}
          onBankParamsView={(bankId) => {
            const features = perpendicularData?.features || [];
            const section = features.find((f: any) => f.properties?.bank_id === bankId);
            if (!section) {
              alert('该岸段暂无断面数据，请先生成断面');
              return;
            }
            const lineProps: any = section.properties || {};
            const bankName = lineProps.bank_name || lineProps.bankName || bankId;
            const currentConfig = {
              param_name: lineProps.paramName || lineProps.param_name || '',
              segment: lineProps.segment || '',
              current_timepoint: lineProps.currentTimepoint || lineProps.current_timepoint || '',
              set_name: lineProps.setName || lineProps.set_name || '',
              water_qs: lineProps.waterQs || lineProps.water_qs || '',
              tidal_level: lineProps.tidalLevel || lineProps.tidal_level || '',
              bench_id: lineProps.benchId || lineProps.bench_id || '',
              ref_id: lineProps.refId || lineProps.ref_id || '',
              hs: lineProps.hs,
              hc: lineProps.hc,
              protection_level: lineProps.protectionLevel || lineProps.protection_level || '',
              control_level: lineProps.controlLevel || lineProps.control_level || '',
              comparison_timepoint: lineProps.comparisonTimepoint || lineProps.comparison_timepoint || '',
              risk_thresholds: lineProps.riskThresholds || lineProps.risk_thresholds || {},
              weights: lineProps.weights || {},
              other_params: lineProps.otherParams || lineProps.other_params || {},
            } as any;
            setEditingBankParams({ bankId, bankName, config: currentConfig });
          }}
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
          showTiffBounds={showTiffBounds}
          // 侧栏这个是「全局」开关：打开时清掉聚焦，回到显示全部 DEM 范围
          setShowTiffBounds={(v: boolean) => {
            setShowTiffBounds(v);
            if (v) setFocusedDemKeys(null);
          }}
          showRiverSurface={showRiverSurface}
          setShowRiverSurface={setShowRiverSurface}
          satellite={satellite}
          setSatellite={setSatellite}
          handleStartAnalysis={handleStartAnalysis}
          onClear={onClear}
          onSelectBanksByTiff={selectBanksByTiffRange}
          onClipBank={clipSelectedBank}
          colorBanks={colorBanks}
          setColorBanks={setColorBanks}
          handleFileUpload={handleFileUpload}
          handleSectionsFileUpload={handleSectionsFileUpload}
          onExportSections={handleExportSections}
          handleSelectBasicParam={handleSelectBasicParam}
          clippedBanks={clippedBanks}
        />
          )}
        </div>
      </div>
      <ResizeHandle onResize={(delta) => setLeftPanelWidth(w => Math.max(200, Math.min(600, w + delta)))} onDragEnd={() => setResizeTrigger(t => t + 1)} />
      <div className="editor-map-panel">
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
          tiffBoundsData={visibleTiffBoundsData}
          showTiffBounds={showTiffBounds}
          riverSurfaceData={riverSurfaceData}
          showRiverSurface={showRiverSurface}
          resizeTrigger={resizeTrigger}
          satellite={satellite}
          colorBanks={colorBanks}
        />
        <button
          onClick={() => setSatellite(!satellite)}
          title={satellite ? '标准底图' : '卫星影像'}
          style={{
            position: 'absolute', top: 12, right: 12, zIndex: 10,
            background: 'rgba(255,255,255,0.7)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            border: '1px solid rgba(0,0,0,0.08)',
            borderRadius: 14, padding: '6px 12px', cursor: 'pointer',
            fontSize: '0.8rem', color: '#334155',
            display: 'flex', alignItems: 'center', gap: 4,
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          }}
        >
          <Globe size={14} /> {satellite ? '平面' : '卫星'}
        </button>
        <button
          onClick={() => { setChatCollapsed(!chatCollapsed); setTimeout(() => setResizeTrigger(t => t + 1), 350); }}
          style={{
            position: 'absolute', top: 50, right: 12, zIndex: 10,
            background: 'rgba(255,255,255,0.7)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            border: '1px solid rgba(0,0,0,0.08)',
            borderRadius: 14, padding: '6px 12px', cursor: 'pointer',
            fontSize: '0.8rem', color: '#334155',
            display: 'flex', alignItems: 'center', gap: 4,
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          }}
          title={chatCollapsed ? '展开聊天' : '收起聊天'}
        >
          <MessageCircle size={14} />
          {chatCollapsed ? 'AI' : '收起'}
        </button>

        {/* 地图底部居中操作条 */}
        <div className="editor-map-toolbar" data-tour="map-toolbar">
          <button type="button" className="emt-btn" onClick={() => bankUploadInputRef.current?.click()} title="上传岸段">
            <Upload size={15} /> 上传岸段
          </button>
          <button type="button" className="emt-btn" onClick={() => sectionsUploadInputRef.current?.click()} title="上传断面">
            <Ruler size={15} /> 上传断面
          </button>
          <button type="button" className="emt-create" onClick={handleNewTask} title="新建任务">
            <Plus size={26} strokeWidth={3} />
          </button>
          {/* 分裂按钮：主体 = 进入/退出地图点选（保持原来的一键行为，不增加常用路径的点击次数）；
              右侧小箭头 = 批量选择。
              为什么需要：默认（资源树）模式下 EditorSidebar 不渲染，侧栏那对
              「选中岸段 / 全选」根本不在页面上，地图上逐条点选是唯一办法 —— 选几十条岸段
              就只能一条条点。批量口径见上面的 mapShoreLineIds 注释。 */}
          <div className="emt-split" data-tour="map-select-bank">
            <button
              type="button"
              className={`emt-btn ${isSelectingShoreLines ? 'emt-active' : ''}`}
              onClick={toggleShoreLineSelection}
              title="在地图上点选岸段"
            >
              <MousePointer2 size={15} /> 选中岸段
            </button>
            <Dropdown
              trigger={['click']}
              placement="topRight"
              menu={{
                items: [
                  {
                    key: 'selectAll',
                    icon: <CheckCircle2 size={14} />,
                    label: isAllMapShoreLinesSelected()
                      ? '取消全选'
                      : `全选地图上的岸段（${mapShoreLineIds().length}）`,
                  },
                  {
                    key: 'clear',
                    icon: <Eraser size={14} />,
                    label: '清空选择',
                    disabled: selectedLines.size === 0,
                  },
                ],
                onClick: ({ key: k }) => {
                  if (k === 'selectAll') {
                    if (isAllMapShoreLinesSelected()) clearMapShoreLineSelection();
                    else selectAllMapShoreLines();
                  } else if (k === 'clear') {
                    clearMapShoreLineSelection();
                  }
                },
              }}
            >
              <button type="button" className="emt-btn emt-caret" title="批量选择岸段">
                <ChevronDown size={13} />
              </button>
            </Dropdown>
          </div>
          <button type="button" className="emt-btn" onClick={onClear} title="清除断面">
            <Eraser size={15} /> 清除断面
          </button>
        </div>

        {/* 断面精细调整浮栏（地图左下角）。
            资源树模式（默认）不渲染 EditorSidebar，那批精调操作原本无处可点；
            这里搬到地图上。经典模式下同名区块仍在侧栏里，故此处只在 tree 模式渲染，避免重复。 */}
        {sidebarMode === 'tree' && isSelectingCrossLines && (
          <CrossLineFineTuneBar
            crossLineControlMode={crossLineControlMode}
            setCrossLineControlMode={setCrossLineControlMode}
            crossLineEditMode={crossLineEditMode}
            setCrossLineEditMode={setCrossLineEditMode}
            selectedCrossLineIndex={selectedCrossLineIndex}
            onExit={toggleCrossLineSelection}
            translateSelectedCrossLine={translateSelectedCrossLine}
            rotateSelectedCrossLine={rotateSelectedCrossLine}
            scaleSelectedCrossLine={scaleSelectedCrossLine}
            configureSelectedCrossLineProperties={configureSelectedCrossLineProperties}
            deleteSelectedCrossLine={deleteSelectedCrossLine}
            reverseSelectedCrossLine={reverseSelectedCrossLine}
          />
        )}
      </div>
      {!chatCollapsed && <ResizeHandle onResize={(delta) => setRightPanelWidth(w => Math.max(200, Math.min(600, w - delta)))} onDragEnd={() => setResizeTrigger(t => t + 1)} />}
      <div data-tour="chat-panel" style={{ height: '100%', position: 'relative' }}>
        <ChatPanel collapsed={chatCollapsed} width={rightPanelWidth} />
      </div>

      {/* 创建任务弹窗 */}
      {taskNameDialog && (
        <TaskNameModal
          title="创建任务"
          defaultValue={taskNameDialog.defaultName}
          onConfirm={closeTaskNameDialog}
          onCancel={() => closeTaskNameDialog(null)}
        />
      )}

      {/* 创建任务（含断面属性/参数模板）弹窗 */}
      {createTaskModalOpen && (
        <CreateTaskModal
          defaultName="岸线分析任务"
          interval={globalInterval}
          length={globalLength}
          templates={basicParamsList.map((p: any) => ({
            id: p.param_id ?? p.id ?? '',
            label: p.param_name || p.paramName || String(p.param_id ?? p.id),
          }))}
          selectedTemplateId={selectedBasicParamIdState === null ? null : String(selectedBasicParamIdState)}
          bankCount={selectedLines.size}
          onConfirm={handleCreateTaskConfirm}
          onCancel={() => setCreateTaskModalOpen(false)}
        />
      )}

      {/* 补充岸段到已有任务（资源树任务节点右键 → 补充岸段…） */}
      {addBanksModal && (
        <AddBanksToTaskModal
          taskId={addBanksModal.taskId}
          taskName={addBanksModal.taskName}
          candidates={addBanksModal.candidates}
          existingBankCount={addBanksModal.scope.existingBankIds.size}
          existingSectionCount={addBanksModal.scope.sectionCount}
          defaultInterval={globalInterval}
          defaultLength={globalLength}
          onConfirm={handleAddBanksConfirm}
          onCancel={() => setAddBanksModal(null)}
        />
      )}

      {/* 新建参数模板弹窗（「参数模板」文件夹右键 → 新建参数模板） */}
      {createParamModalOpen && (
        <CreateParamTemplateModal
          templates={basicParamsList
            .map((p: any) => ({
              param_id: String(p.param_id ?? p.id ?? ''),
              param_name: String(p.param_name || p.paramName || p.param_id || p.id || ''),
            }))
            .filter((t: ParamTemplateOption) => Boolean(t.param_id))}
          defaultSegment="Yangtze"
          onSubmit={handleCreateParamTemplate}
          onCancel={() => setCreateParamModalOpen(false)}
        />
      )}

      {/* 属性弹窗（任务/岸段/断面/参数/DEM） */}
      {infoModal && (
        <InfoModal title={infoModal.title} groups={infoModal.groups} onClose={() => setInfoModal(null)} />
      )}

      {/* 通用确认弹窗 */}
      {confirmDialog && (
        <ConfirmModal
          title={confirmDialog.title}
          content={confirmDialog.content}
          confirmText={confirmDialog.confirmText}
          danger={confirmDialog.danger}
          onConfirm={() => closeConfirmDialog(true)}
          onCancel={() => closeConfirmDialog(false)}
        />
      )}

      {/* DEM 选择 / 上传弹窗 */}
      {demPickerOpen && (
        <div className={modalStyles.overlay} onClick={() => setDemPickerOpen(false)}>
          <div
            className={`${modalStyles.container} ${modalStyles.containerCompact}`}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className={modalStyles.title}>选择 / 上传 DEM</h3>
            <TiffResourcePicker
              label="DEM 资源"
              value=""
              onConfirm={(key) => {
                // 与资源树里「显示范围」口径一致：只把这个 DEM 的框画出来。
                // 这里从前把 key 丢掉了 ⇒ 只有 setShowTiffBounds(true) 而 focusedDemKeys 仍是 null，
                // 地图会把全库 DEM 的框一起铺出来，跟点单条的表现不一致。
                if (key) {
                  setShowTiffBounds(true);
                  setFocusedDemKeys([String(key)]);
                }
                setDemPickerOpen(false);
              }}
            />
            <div className={modalStyles.actions}>
              <button type="button" className={modalStyles.cancelButton} onClick={() => setDemPickerOpen(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 参数配置弹窗：作用域只有两种，见 paramScope 的注释 */}
      {showGlobalPropertiesModal && globalProperties && (
        <SectionPropertiesModal
          key={`${paramScope}-${paramPanelRevision}`}
          config={globalProperties}
          title={paramScope === 'task' ? '任务参数（仅本任务）' : '模板库参数（仅模板本身）'}
          templateOptions={
            paramScope === 'task'
              ? basicParamsList
                  .map((p: any) => ({
                    param_id: String(p.param_id ?? p.id ?? ''),
                    param_name: String(p.param_name ?? p.paramName ?? ''),
                  }))
                  .filter((t) => t.param_id)
              : undefined
          }
          onImportTemplate={
            paramScope === 'task'
              ? async (templateId: string) => {
                  const taskId = getCurrentTaskId();
                  if (!taskId) throw new Error('未找到当前任务');
                  const r = await importTaskParamsFromTemplate(taskId, templateId);
                  await loadTaskParamsAsGlobalProperties(taskId);
                  setParamPanelRevision((v) => v + 1);
                  alert(
                    `已从模板库复制到本任务，并同步 ${r.updated_sections}/${r.total_sections} 条断面。\n\n` +
                      '复制之后两者无关联：之后改模板库不会再影响这个任务。',
                  );
                }
              : undefined
          }
          onSave={async (newConfig) => {
            if (paramScope === 'task') {
              const taskId = getCurrentTaskId();
              if (!taskId) throw new Error('未找到当前任务，无法保存任务参数');

              const result = await updateTaskParams(taskId, newConfig);
              setGlobalProperties(newConfig);
              alert(
                '已保存到本任务的参数集。\n\n' +
                  `本任务断面：${result.updated_sections}/${result.total_sections} 条已同步。\n` +
                  '参数已变化，需要重跑本任务，风险结果才会更新；其它任务完全不受影响。',
              );
              return;
            }

            const paramIdStr = selectedBasicParamIdState === null ? '' : String(selectedBasicParamIdState);
            if (!paramIdStr) throw new Error('未选择可保存的参数模板');

            await updateBasicParamAsSectionParams(paramIdStr, newConfig);
            setGlobalProperties(newConfig);
            setBasicParamsList((prev) =>
              prev.map((item) => {
                const itemId = String(item.param_id ?? item.id ?? '');
                return itemId !== paramIdStr ? item : { ...item, ...newConfig };
              }),
            );

            // 模板库是主数据，这里只写模板本身：
            // 已有任务各自持有一份从模板复制出来的参数集（basic_params.task_id 非空），
            // 与模板再无关联，所以不存在「改模板把历史任务一起改了」这件事。
            alert(
              '模板已保存（仅模板本身）。\n\n' +
                '已有任务使用的是各自独立的参数集，不会被这次修改影响；' +
                '之后新建的任务从该模板复制时才会用到新值。',
            );
          }}
          onClose={() => setShowGlobalPropertiesModal(false)}
        />
      )}

      {/* 岸段参数配置弹窗 */}
      {editingBankParams && (
        <SectionPropertiesModal
          config={editingBankParams.config}
          title={`岸段 ${editingBankParams.bankName} 参数配置`}
          onSave={async (newConfig) => {
            const features = perpendicularData?.features || [];
            const sections = features.filter((f: any) => f.properties?.bank_id === editingBankParams.bankId);
            const sectionIds = sections
              .map((f: any) => f.properties?.sectionId || f.properties?.section_id)
              .filter(Boolean);
            if (sectionIds.length > 0) {
              await fetch('/v0/bank/sections/batch-params', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ section_ids: sectionIds, params: newConfig }),
              });
              // 更新本地
              sections.forEach((f: any) => {
                for (const [key, val] of Object.entries(newConfig as Record<string, any>)) {
                  if (f.properties) f.properties[key] = val;
                }
              });
            }
            setEditingBankParams(null);
            alert(`${sectionIds.length} 个断面已更新`);
          }}
          onClose={() => setEditingBankParams(null)}
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
              onSave={async (newConfig) => {
                // 单断面弹窗只写这一条断面：这是唯一允许「只影响一条」的作用域。
                if (sectionId) {
                  await updateSectionParams(String(sectionId), newConfig);
                }
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
                alert(
                  `断面 #${index + 1} 的参数已保存。\n\n` +
                    '只改了这一条断面的参数快照；该断面所在任务需要重跑才会更新结果。',
                );
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
