import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TreeNode } from '../../tree/types';
import { flattenTree } from '../../tree/treeModel';
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
  onNodeSelect: (node: TreeNode) => void;
  onNodeDoubleClick: (node: TreeNode) => void;
  onNodeAction: (node: TreeNode, actionKey: string) => void;
}

export default function ResourceTree({ root, onNodeSelect, onNodeDoubleClick, onNodeAction }: Props) {
  const expanded = useResourceTreeStore((s) => s.expanded);
  const selectedId = useResourceTreeStore((s) => s.selectedId);
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
  const handleSelect = useCallback(
    (node: TreeNode) => {
      selectNode(node.id);
      onNodeSelect(node);
    },
    [selectNode, onNodeSelect],
  );
  const handleContextMenu = useCallback((node: TreeNode, x: number, y: number) => {
    if (getActions(node.actions || []).length === 0) return;
    setCtx({ node, x, y });
  }, []);

  return (
    <div className={styles.treeWrap}>
      <div
        className={styles.tree}
        ref={containerRef}
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
                selected={selectedId === r.node.id}
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
