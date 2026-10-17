import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Edit3, Database } from 'lucide-react';
import { authHeaders } from '../../utils/apiClient';
import { buildResourceTree } from '../../tree/treeModel';
import type { TreeNode } from '../../tree/types';
import { useResourceTreeStore } from '../../store/useResourceTreeStore';
import { useEditorStore } from '../../store/useEditorStore';
import ResourceTree from './ResourceTree';
import LoadedOnMapPanel from './LoadedOnMapPanel';
import BatchActionBar from './BatchActionBar';
import type { LoadedOnMapActions } from './LoadedOnMapPanel';
import { buildLoadedGroups, pickRunningTasks } from './loadedOnMap';
import VerticalResizeHandle from '../VerticalResizeHandle';
import styles from './ResourceSidebar.module.css';

/**
 * 侧栏下半区（「已加载到屏幕」）的行级/组级操作。
 *
 * <p>全部可选：拿不到回调时面板只展示、不渲染对应图标，不会出现"点了没反应"的按钮。
 * 与 {@link ResourceSidebarHandlers} 合并成同一个对象传入，避免第二套 props 通道。
 */
export interface ResourceSidebarHandlers extends LoadedOnMapActions {
  onAction: (node: TreeNode, actionKey: string) => void;
  onNodeSelect: (node: TreeNode) => void;
  onNodeDoubleClick: (node: TreeNode) => void;
  onRun: () => void;
  /** 批量操作：kind 为选中节点的统一类型，nodes 为参与批量操作的节点 */
  onBatchAction?: (kind: string, nodes: TreeNode[], actionKey: string) => void;
}

interface Props {
  handlers: ResourceSidebarHandlers;
  /** 当前画在地图上的 DEM 范围 tiff_key 列表（没显示范围时传空数组） */
  demKeys?: string[];
  /** 地图上当前选中的断面 id，用于在下半区高亮对应行 */
  activeSectionId?: string | null;
}

async function fetchJSON(path: string) {
  const res = await fetch(path, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

// —— 下半区高度：用户拖到多少就记住多少（换页面/刷新后仍然保持一致的手感）——
const LOADED_H_KEY = 'tree-loaded-panel-height';
/**
 * 下半区缺省高度。面板已去掉搜索框与类型标签，常驻的只剩头部 ≈ 30px
 * 和任务在跑时的「正在运行」横幅 ≈ 58px；取 240 能保证横幅出现时仍看得见 4~5 行。
 */
const DEFAULT_LOADED_H = 240;
const MIN_LOADED_H = 90;
/** 上半区（资源树）保底高度：拖到底也不能把树压没 */
const MIN_TREE_H = 170;
/** 头部 + 分隔条 + 底部按钮条的固定占用 */
const CHROME_H = 96;

function readStoredHeight(): number {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_LOADED_H;
    const n = Number(localStorage.getItem(LOADED_H_KEY));
    return Number.isFinite(n) && n >= MIN_LOADED_H ? n : DEFAULT_LOADED_H;
  } catch {
    return DEFAULT_LOADED_H;
  }
}

export default function ResourceSidebar({ handlers, demKeys, activeSectionId }: Props) {
  const setData = useResourceTreeStore((s) => s.setData);
  const dataVersion = useResourceTreeStore((s) => s.dataVersion);
  const banks = useResourceTreeStore((s) => s.banks);
  const params = useResourceTreeStore((s) => s.params);
  const tiffs = useResourceTreeStore((s) => s.tiffs);
  const tasks = useResourceTreeStore((s) => s.tasks);
  const sectionsByTask = useResourceTreeStore((s) => s.sectionsByTask);
  const setSectionsForTask = useResourceTreeStore((s) => s.setSectionsForTask);
  const currentTaskId = useResourceTreeStore((s) => s.currentTaskId);
  const expanded = useResourceTreeStore((s) => s.expanded);

  // 下半区读的是"地图上实际画着什么"，来源是编辑器 store，而不是后端清单
  const uploadedData = useEditorStore((s) => s.uploadedData);
  const perpendicularData = useEditorStore((s) => s.perpendicularData);
  const showCrossLines = useEditorStore((s) => s.showCrossLines);

  const [loaded, setLoaded] = useState(false);
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const [sidebarH, setSidebarH] = useState(0);
  const [loadedH, setLoadedH] = useState<number>(readStoredHeight);
  const [collapsed, setCollapsed] = useState(false);

  // 多选：ResourceTree 通过 onSelectionChange 把当前选中节点清单抛上来，
  // 这里只负责渲染批量操作条 + 把批量动作转发给上层（EditorPage）。
  const [selectedNodes, setSelectedNodes] = useState<TreeNode[]>([]);
  const handleSelectionChange = useCallback((nodes: TreeNode[]) => setSelectedNodes(nodes), []);
  const handleClearSelection = useCallback(() => {
    setSelectedNodes([]);
    useResourceTreeStore.getState().clearSelection();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [b, p, t, k] = await Promise.all([
          fetchJSON('/v0/bank/banks'),
          fetchJSON('/v0/bank/basic-params'),
          fetchJSON('/v0/bank/tiffs'),
          fetchJSON('/v0/bank/tasks'),
        ]);
        setData({
          banks: b?.banks ?? b?.data ?? [],
          params: p?.params ?? [],
          tiffs: t?.tiffs ?? t?.items ?? (Array.isArray(t) ? t : []),
          tasks: k?.tasks ?? k?.data ?? [],
        });
      } catch (e) {
        console.error('资源树数据加载失败:', e);
      } finally {
        setLoaded(true);
      }
    })();
  }, [setData, dataVersion]);

  useEffect(() => {
    const ids = new Set<string>();
    if (currentTaskId) ids.add(currentTaskId);
    for (const [k, v] of Object.entries(expanded)) {
      if (v && k.startsWith('task:')) ids.add(k.slice(5));
    }
    const missing = [...ids].filter((id) => !sectionsByTask[id]);
    if (missing.length === 0) return;
    (async () => {
      for (const id of missing) {
        try {
          const res = await fetchJSON(`/v0/bank/sections?task_id=${encodeURIComponent(id)}`);
          setSectionsForTask(id, res?.sections ?? res?.data ?? []);
        } catch (e) {
          console.error('断面加载失败:', e);
        }
      }
    })();
  }, [currentTaskId, expanded, sectionsByTask, setSectionsForTask, dataVersion]);

  // 侧栏高度 → 决定下半区最大能拖多高（保证上半区至少还剩 MIN_TREE_H）
  useEffect(() => {
    const el = sidebarRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSidebarH(el.clientHeight));
    ro.observe(el);
    setSidebarH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const currentSections = useMemo(() => sectionsByTask[currentTaskId || ''] || [], [sectionsByTask, currentTaskId]);
  const tree = useMemo(
    () => buildResourceTree({ banks, params, tiffs, tasks, sections: currentSections, sectionsByTask }),
    [banks, params, tiffs, tasks, currentSections, sectionsByTask],
  );

  const currentTaskName = useMemo(
    () => tasks.find((t: any) => String(t.task_id ?? t.id) === currentTaskId)?.task_name || currentTaskId || '',
    [tasks, currentTaskId],
  );

  // —— 下半区数据 ——
  const demItems = useMemo(() => {
    const labelOf = (key: string) => {
      const t: any = (tiffs || []).find(
        (x: any) => String(x?.tiff_key ?? x?.key ?? x?.file_name) === key,
      );
      return String(t?.file_name || key.split('/').pop() || key);
    };
    return (demKeys || []).map((k) => ({ key: String(k), label: labelOf(String(k)) }));
  }, [demKeys, tiffs]);

  // 树上「这条 DEM 的范围正开着」的高亮依据（与下半区 demo 列表同一份数据）。
  const activeDemKeySet = useMemo(() => new Set((demKeys || []).map((k) => String(k))), [demKeys]);

  const loadedGroups = useMemo(
    () =>
      buildLoadedGroups({
        uploadedData,
        perpendicularData,
        showCrossLines,
        demItems,
        currentTaskId,
        sectionsByTask,
      }),
    [uploadedData, perpendicularData, showCrossLines, demItems, currentTaskId, sectionsByTask],
  );

  // 运行中的任务：状态来自后端 tasks.status，前端只负责显示
  const running = useMemo(() => pickRunningTasks(tasks), [tasks]);
  const hasRunning = running.length > 0;

  // 有任务在跑时才轮询任务清单：跑完自动停（避免空闲时白刷接口）
  useEffect(() => {
    if (!hasRunning) return;
    let alive = true;
    const timer = window.setInterval(async () => {
      try {
        const k = await fetchJSON('/v0/bank/tasks');
        if (!alive) return;
        setData({ tasks: k?.tasks ?? k?.data ?? [] });
      } catch {
        /* 单次失败静默：下一轮再试，不打断界面 */
      }
    }, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [hasRunning, setData]);

  const maxLoadedH = Math.max(
    MIN_LOADED_H,
    (sidebarH || 640) - MIN_TREE_H - CHROME_H,
  );
  const effectiveLoadedH = Math.min(Math.max(loadedH, MIN_LOADED_H), maxLoadedH);

  const persistHeight = useCallback(() => {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(LOADED_H_KEY, String(loadedH));
    } catch {
      /* 隐私模式下写不了 localStorage，不影响使用 */
    }
  }, [loadedH]);

  const libraryEmpty = loaded && banks.length === 0 && params.length === 0 && tiffs.length === 0 && tasks.length === 0;

  return (
    <div className={styles.sidebar} ref={sidebarRef}>
      <div className="sidebar-header" data-tour="tree-header" style={{ padding: '12px 14px 8px', margin: 0, flexShrink: 0 }}>
        <Edit3 size={14} />
        <h4>断面编辑器</h4>
      </div>

      {/* 上半区：数据资源 + 计算任务（独立滚动） */}
      <div className={styles.treeZone} data-tour="tree-root">
        <BatchActionBar
          nodes={selectedNodes}
          onBatchAction={(kind, list, actionKey) => handlers.onBatchAction?.(kind, list, actionKey)}
          onClear={handleClearSelection}
        />
        {libraryEmpty && (
          <div className={styles.upperHint}>
            <Database size={12} />
            <span>资源库为空：先上传岸段，或在「计算任务」里新建任务。</span>
          </div>
        )}
        {loaded && (
          <ResourceTree
            root={tree}
            activeDemKeys={activeDemKeySet}
            onNodeSelect={handlers.onNodeSelect}
            onNodeDoubleClick={handlers.onNodeDoubleClick}
            onNodeAction={handlers.onAction}
            onSelectionChange={handleSelectionChange}
          />
        )}
      </div>

      {/* 分隔条：上下比例可拖，收起时一并隐藏 */}
      {!collapsed && (
        <VerticalResizeHandle
          onResize={(delta) =>
            setLoadedH((h) => Math.min(Math.max(h + delta, MIN_LOADED_H), maxLoadedH))
          }
          onDragEnd={persistHeight}
        />
      )}

      {/* 下半区：已加载到屏幕（独立滚动） */}
      <div
        className={styles.loadedZone}
        style={{ height: collapsed ? undefined : effectiveLoadedH }}
      >
        <LoadedOnMapPanel
          groups={loadedGroups}
          running={running}
          activeSectionId={activeSectionId}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((v) => !v)}
          actions={handlers}
        />
      </div>

      <div className={styles.footer} data-tour="tree-footer">
        <button type="button" className={styles.run} onClick={handlers.onRun} title="执行风险分析">
          <Play size={15} /> 执行风险分析
        </button>
        <span className={styles.footerHint}>{currentTaskName ? `当前任务: ${currentTaskName}` : '未选择任务'}</span>
      </div>
    </div>
  );
}
