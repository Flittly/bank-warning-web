import { useEffect, useMemo, useState } from 'react';
import { Play, Edit3 } from 'lucide-react';
import { authHeaders } from '../../utils/apiClient';
import { buildResourceTree } from '../../tree/treeModel';
import type { TreeNode } from '../../tree/types';
import { useResourceTreeStore } from '../../store/useResourceTreeStore';
import ResourceTree from './ResourceTree';
import styles from './ResourceSidebar.module.css';

export interface ResourceSidebarHandlers {
  onAction: (node: TreeNode, actionKey: string) => void;
  onNodeSelect: (node: TreeNode) => void;
  onNodeDoubleClick: (node: TreeNode) => void;
  onRun: () => void;
}

interface Props {
  handlers: ResourceSidebarHandlers;
}

async function fetchJSON(path: string) {
  const res = await fetch(path, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

export default function ResourceSidebar({ handlers }: Props) {
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
  const [loaded, setLoaded] = useState(false);

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

  const currentSections = useMemo(() => sectionsByTask[currentTaskId || ''] || [], [sectionsByTask, currentTaskId]);
  const tree = useMemo(
    () => buildResourceTree({ banks, params, tiffs, tasks, sections: currentSections, sectionsByTask }),
    [banks, params, tiffs, tasks, currentSections, sectionsByTask],
  );

  const currentTaskName = useMemo(
    () => tasks.find((t: any) => String(t.task_id ?? t.id) === currentTaskId)?.task_name || currentTaskId || '',
    [tasks, currentTaskId],
  );

  return (
    <div className={styles.sidebar}>
      <div className="sidebar-header" style={{ padding: '12px 14px 8px', margin: 0, flexShrink: 0 }}>
        <Edit3 size={14} />
        <h4>断面编辑器</h4>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column' }}>
        {loaded && (
          <ResourceTree
            root={tree}
            onNodeSelect={handlers.onNodeSelect}
            onNodeDoubleClick={handlers.onNodeDoubleClick}
            onNodeAction={handlers.onAction}
          />
        )}
      </div>
      <div className={styles.footer}>
        <button type="button" className={styles.run} onClick={handlers.onRun} title="执行风险分析">
          <Play size={15} /> 执行风险分析
        </button>
        <span className={styles.footerHint}>{currentTaskName ? `当前任务: ${currentTaskName}` : '未选择任务'}</span>
      </div>
    </div>
  );
}
