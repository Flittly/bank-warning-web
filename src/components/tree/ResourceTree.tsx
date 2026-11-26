import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { TreeNode } from '../../tree/types';
import { flattenTree } from '../../tree/treeModel';
import { expandedAll, makeHitPredicate, pruneTree } from '../../tree/filterTree';
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
  // 搜索态：树只保留命中节点及其祖先路径。判定来源有两份 ——
  // 本地词项（敲字立刻收窄）与后端 ref 集合（覆盖「词只在描述里」的命中）。
  const searchTerms = useResourceTreeStore((s) => s.searchTerms);
  const searchMatchedRefs = useResourceTreeStore((s) => s.searchMatchedRefs);
  const searchStrict = useResourceTreeStore((s) => s.searchStrict);
  const searching = searchTerms.length > 0;
  const [ctx, setCtx] = useState<{ node: TreeNode; x: number; y: number } | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);
  const containerRef = useRef<HTMLDivElement | null>(null);
  /**
   * roving tabindex 的焦点行（flattenTree 之后的行序号）。
   * 为什么不用 DOM 焦点当状态：行会被虚拟滚动卸载，离屏行的元素根本不存在，
   * 焦点只能记在 state 里，滚动到位、行重新渲染后再把 DOM 焦点补上（见下面的 effect）。
   */
  const [activeIndex, setActiveIndex] = useState(0);
  const pendingFocusRef = useRef<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    setViewportH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const hitPredicate = useMemo(
    () => makeHitPredicate(searchTerms, searchMatchedRefs, searchStrict),
    [searchTerms, searchMatchedRefs, searchStrict],
  );
  // 搜索态才剪枝；非搜索态直接用原树引用，不复制任何节点（避免每帧重建整棵树）
  const prunedRoot = useMemo(
    () => (searching ? pruneTree(root, hitPredicate) : root),
    [searching, root, hitPredicate],
  );
  // 剪枝后必须全展开，否则命中的节点被折叠在看不见的地方。
  // 用派生映射而不写进 store：搜索结束后用户原来的展开态要原样回来。
  const effectiveExpanded = useMemo(
    () => (searching ? expandedAll(prunedRoot) : expanded),
    [searching, prunedRoot, expanded],
  );
  const rows = useMemo(
    () => (prunedRoot ? flattenTree(prunedRoot, effectiveExpanded) : []),
    [prunedRoot, effectiveExpanded],
  );
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

  // ---- 键盘导航（WAI-ARIA tree pattern）----
  // 焦点行可能超出当前渲染窗口（虚拟滚动），所以先滚动、再在 render 之后补焦点。
  const safeActiveIndex = rows.length > 0 ? Math.min(Math.max(activeIndex, 0), rows.length - 1) : 0;

  const rowHeightAt = (i: number) => (rows[i]?.node.subtitle ? ROW_TALL : ROW_H);

  const scrollRowIntoView = (i: number) => {
    const el = containerRef.current;
    if (!el) return;
    const top = offsets[i] ?? 0;
    const h = rowHeightAt(i);
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + h > el.scrollTop + el.clientHeight) el.scrollTop = top + h - el.clientHeight;
  };

  const focusRow = (i: number) => {
    if (rows.length === 0) return;
    const next = Math.min(Math.max(i, 0), rows.length - 1);
    setActiveIndex(next);
    scrollRowIntoView(next);
    pendingFocusRef.current = next;
  };

  // 行渲染出来之后把 DOM 焦点补上；没有依赖数组是有意的 —— 每次 render 都试一次，
  // 直到目标行真的存在于 DOM（虚拟窗口可能要多滚一帧才包含它）。
  useEffect(() => {
    if (pendingFocusRef.current === null) return;
    const idx = pendingFocusRef.current;
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-row-index="${idx}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      pendingFocusRef.current = null;
    }
  });

  const openMenuForRow = (i: number) => {
    const node = rows[i]?.node;
    if (!node) return;
    if (getActions(node.actions || []).length === 0) return;
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-row-index="${i}"]`);
    const rect = el?.getBoundingClientRect();
    setCtx({
      node,
      x: Math.round(rect ? Math.min(rect.right - 8, window.innerWidth - 210) : window.innerWidth / 2),
      y: Math.round(rect ? Math.min(rect.bottom, window.innerHeight - 230) : window.innerHeight / 2),
    });
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (rows.length === 0) return;
    const i = safeActiveIndex;
    const row = rows[i];
    const node = row.node;
    const hasChildren = Boolean(node.children && node.children.length > 0);
    const isExpanded = Boolean(effectiveExpanded[node.id]);

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusRow(i + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusRow(i - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusRow(0);
        break;
      case 'End':
        e.preventDefault();
        focusRow(rows.length - 1);
        break;
      case 'ArrowRight':
        // 有子节点且折叠 → 展开；已展开 → 进到第一项（flatten 之后就是下一行）
        e.preventDefault();
        if (hasChildren && !isExpanded) toggleExpanded(node.id);
        else if (hasChildren) focusRow(i + 1);
        break;
      case 'ArrowLeft':
        // 已展开 → 折叠；否则回到父节点（往上找第一个 depth 更小的行）
        e.preventDefault();
        if (hasChildren && isExpanded) {
          toggleExpanded(node.id);
        } else {
          for (let j = i - 1; j >= 0; j -= 1) {
            if (rows[j].depth < row.depth) { focusRow(j); break; }
          }
        }
        break;
      case 'Enter':
      case ' ': {
        e.preventDefault();
        // 规则行点整行 = 看这条规则在拦什么，键盘必须一致（见 ResourceTreeNode 的 handleClick）
        if (node.kind === 'rule') { onNodeAction(node, 'rule.describe'); break; }
        if (node.selectable) {
          handleSelect(node, { shift: e.shiftKey, ctrlOrMeta: e.ctrlKey || e.metaKey });
        }
        if (hasChildren && !e.shiftKey && !e.ctrlKey && !e.metaKey) toggleExpanded(node.id);
        break;
      }
      case 'ContextMenu':
        e.preventDefault();
        openMenuForRow(i);
        break;
      case 'F10':
        // Shift+F10 是 Windows 上"打开上下文菜单"的标准键
        if (e.shiftKey) {
          e.preventDefault();
          openMenuForRow(i);
        }
        break;
      default:
        break;
    }
  };

  // 搜索态下无任何命中：直接给空态，不要让虚拟滚动容器渲染 0 行空白
  if (searching && !prunedRoot) {
    return (
      <div className={styles.treeWrap}>
        <div className={styles.searchEmpty}>没有匹配「{searchTerms.join(' ')}」的节点</div>
      </div>
    );
  }

  return (
    <div className={styles.treeWrap}>
      <div
        className={styles.tree}
        ref={containerRef}
        onClick={handleBlankClick}
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
        onKeyDown={handleKeyDown}
        role="tree"
        aria-label="资源树"
      >
        <div style={{ height: total, position: 'relative' }}>
          <div style={{ position: 'absolute', top: offsets[start], left: 0, right: 0 }}>
            {visible.map((r, k) => {
              const rowIndex = start + k;
              return (
                <ResourceTreeNode
                  key={r.node.id}
                  node={r.node}
                  depth={r.depth}
                  expanded={Boolean(effectiveExpanded[r.node.id])}
                  highlightTerms={searchTerms}
                  selected={selectedIds.has(r.node.id) || selectedId === r.node.id}
                  activeDemKeys={activeDemKeys}
                  rowIndex={rowIndex}
                  active={rowIndex === safeActiveIndex}
                  onFocusRow={setActiveIndex}
                  onToggle={handleToggle}
                  onSelect={handleSelect}
                  onDoubleClick={onNodeDoubleClick}
                  onAction={onNodeAction}
                  onContextMenu={handleContextMenu}
                />
              );
            })}
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
