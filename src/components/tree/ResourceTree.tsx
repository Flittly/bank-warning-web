import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TreeNode } from '../../tree/types';
import { flattenTree } from '../../tree/treeModel';
import { useResourceTreeStore } from '../../store/useResourceTreeStore';
import ResourceTreeNode from './ResourceTreeNode';
import TreeContextMenu from './TreeContextMenu';
import styles from './ResourceSidebar.module.css';

const ROW_HEIGHT = 28;
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
  const total = rows.length * ROW_HEIGHT;
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewportH) / ROW_HEIGHT) + OVERSCAN);
  const visible = rows.slice(start, end);

  const handleToggle = useCallback((node: TreeNode) => toggleExpanded(node.id), [toggleExpanded]);
  const handleSelect = useCallback(
    (node: TreeNode) => {
      selectNode(node.id);
      onNodeSelect(node);
    },
    [selectNode, onNodeSelect],
  );
  const handleContextMenu = useCallback((node: TreeNode, x: number, y: number) => setCtx({ node, x, y }), []);

  return (
    <div className={styles.treeWrap}>
      <div className={styles.legend}>数据资源 · 计算任务</div>
      <div
        className={styles.tree}
        ref={containerRef}
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
      >
        <div style={{ height: total, position: 'relative' }}>
          <div style={{ position: 'absolute', top: start * ROW_HEIGHT, left: 0, right: 0 }}>
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
      {ctx && (
        <TreeContextMenu
          node={ctx.node}
          x={ctx.x}
          y={ctx.y}
          onAction={onNodeAction}
          onClose={() => setCtx(null)}
        />
      )}
    </div>
  );
}
