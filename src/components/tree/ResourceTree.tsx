import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TreeNode } from '../../tree/types';
import { flattenTree } from '../../tree/treeModel';
import { applyRangeSelect } from '../../tree/rangeSelect';
import { getActions } from '../../tree/actions';
import { useResourceTreeStore } from '../../store/useResourceTreeStore';
import ResourceTreeNode from './ResourceTreeNode';
import TreeContextMenu from './TreeContextMenu';
import styles from './ResourceSidebar.module.css';

const ROW_H = 28;
const ROW_TALL = 42;
const OVERSCAN = 8;

interface Props {
  root: TreeNode;
  /** 当前画在地图上的 DEM tiff_key 集合（用于把对应行的开关标成"已开"） */
  activeDemKeys?: Set<string>;
  onNodeSelect: (node: TreeNode) => void;
  onNodeDoubleClick: (node: TreeNode) => void;
  onNodeAction: (node: TreeNode, actionKey: string) => void;
  /** 多选变化回调：把「当前选中的节点」抛给上层，用于批量操作条 */
  onSelectionChange?: (nodes: TreeNode[]) => void;
}

export default function ResourceTree({ root, activeDemKeys, onNodeSelect, onNodeDoubleClick, onNodeAction, onSelectionChange }: Props) {
  const expanded = useResourceTreeStore((s) => s.expanded);
  const selectedId = useResourceTreeStore((s) => s.selectedId);
  const selectedIds = useResourceTreeStore((s) => s.selectedIds);
  const anchorIndex = useResourceTreeStore((s) => s.anchorIndex);
  const setSelection = useResourceTreeStore((s) => s.setSelection);
  const clearSelection = useResourceTreeStore((s) => s.clearSelection);
  const toggleExpanded = useResourceTreeStore((s) => s.toggleExpanded);
  const selectNode = useResourceTreeStore((s) => s.selectNode);
  const [ctx, setCtx] = useState<{ node: TreeNode; x: number; y: number } | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    setViewportH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const rows = useMemo(() => flattenTree(root, expanded), [root, expanded]);
  const { offsets, total } = useMemo(() => {
    const offsets = new Array<number>(rows.length);
    let acc = 0;
    for (let i = 0; i < rows.length; i++) {
      offsets[i] = acc;
      acc += rows[i].node.subtitle ? ROW_TALL : ROW_H;
    }
    return { offsets, total: acc };
  }, [rows]);

  let start = 0;
  let end = rows.length;
  for (let i = 0; i < rows.length; i++) {
    const h = rows[i].node.subtitle ? ROW_TALL : ROW_H;
    if (offsets[i] + h < scrollTop) start = i + 1;
  }
  for (let i = start; i < rows.length; i++) {
    if (offsets[i] > scrollTop + viewportH) { end = i; break; }
  }
  start = Math.max(0, start - OVERSCAN);
  end = Math.min(rows.length, end + OVERSCAN);
  const visible = rows.slice(start, end);

  const handleToggle = useCallback((node: TreeNode) => toggleExpanded(node.id), [toggleExpanded]);

  // 可见可选行序列：范围选择依赖「当前展开态下的可见顺序」，
  // 用 flattenTree 之后的 rows（含全部节点）再过滤 selectable，与渲染顺序严格一致。
  const selectableRows = useMemo(() => {
    const out: { node: TreeNode; index: number }[] = [];
    rows.forEach((r, i) => {
      if (r.node.selectable) out.push({ node: r.node, index: i });
    });
    return out;
  }, [rows]);

  const handleSelect = useCallback(
    (node: TreeNode, mod: { shift: boolean; ctrlOrMeta: boolean }) => {
      const next = applyRangeSelect(
        selectableRows,
        node.id,
        { selectedIds: new Set(selectedIds), anchorIndex },
        mod,
      );
      setSelection(next.selectedIds, next.anchorIndex ?? -1);
      // 单选入口仍推进 selectedId（供原有高亮/定位复用），但只在"真正单选"时同步，
      // 多选场景下 selectedId 保持最后点击的那一行，作为视觉焦点。
      selectNode(node.id);
      // 地图联动（loadBankById / 定位断面…）只属于「普通单选」的意图；
      // Shift / Ctrl 是"挑范围"，不应顺手把每一行都打开到地图上。
      if (!mod.shift && !mod.ctrlOrMeta) onNodeSelect(node);
      // 把当前选中节点清单抛给上层（批量操作条据此渲染）
      const byId = new Map(selectableRows.map((r) => [r.node.id, r.node]));
      const selectedNodes: TreeNode[] = [];
      next.selectedIds.forEach((id) => {
        const n = byId.get(id);
        if (n) selectedNodes.push(n);
      });
      onSelectionChange?.(selectedNodes);
    },
    [selectableRows, selectedIds, anchorIndex, setSelection, selectNode, onNodeSelect, onSelectionChange],
  );

  // 点击树空白处清空多选（不影响单选入口）
  const handleBlankClick = useCallback(() => {
    if (selectedIds.size > 0) {
      clearSelection();
      onSelectionChange?.([]);
    }
  }, [selectedIds.size, clearSelection, onSelectionChange]);

  const handleContextMenu = useCallback((node: TreeNode, x: number, y: number) => {
    if (getActions(node.actions || []).length === 0) return;
    setCtx({ node, x, y });
  }, []);

  return (
    <div className={styles.treeWrap}>
      <div
        className={styles.tree}
        ref={containerRef}
        onClick={handleBlankClick}
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
      >
        <div style={{ height: total, position: 'relative' }}>
          <div style={{ position: 'absolute', top: offsets[start], left: 0, right: 0 }}>
            {visible.map((r) => (
              <ResourceTreeNode
                key={r.node.id}
                node={r.node}
                depth={r.depth}
                expanded={Boolean(expanded[r.node.id])}
                selected={selectedIds.has(r.node.id) || selectedId === r.node.id}
                activeDemKeys={activeDemKeys}
                onToggle={handleToggle}
                onSelect={handleSelect}
                onDoubleClick={onNodeDoubleClick}
                onAction={onNodeAction}
                onContextMenu={handleContextMenu}
              />
            ))}
          </div>
        </div>
      </div>
      {ctx && createPortal(
        <TreeContextMenu
          node={ctx.node}
          x={ctx.x}
          y={ctx.y}
          onAction={onNodeAction}
          onClose={() => setCtx(null)}
        />,
        document.body,
      )}
    </div>
  );
}
