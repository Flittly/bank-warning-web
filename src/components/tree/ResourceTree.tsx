import { useMemo, useState } from 'react';
import type { TreeNode } from '../../tree/types';
import { useResourceTreeStore } from '../../store/useResourceTreeStore';
import ResourceTreeNodeBridge from './ResourceTreeNodeBridge';
import TreeContextMenu from './TreeContextMenu';
import styles from './ResourceSidebar.module.css';

interface Props {
  root: TreeNode;
  onNodeSelect: (node: TreeNode) => void;
  onNodeDoubleClick: (node: TreeNode) => void;
  onNodeAction: (node: TreeNode, actionKey: string) => void;
}

export default function ResourceTree({ root, onNodeSelect, onNodeDoubleClick, onNodeAction }: Props) {
  const toggleExpanded = useResourceTreeStore((s) => s.toggleExpanded);
  const selectNode = useResourceTreeStore((s) => s.selectNode);
  const [ctx, setCtx] = useState<{ node: TreeNode; x: number; y: number } | null>(null);

  const handleToggle = (node: TreeNode) => toggleExpanded(node.id);
  const handleSelect = (node: TreeNode) => { selectNode(node.id); onNodeSelect(node); };
  const handleContextMenu = (node: TreeNode, x: number, y: number) => setCtx({ node, x, y });

  const children = useMemo(() => root.children || [], [root]);

  return (
    <div className={styles.tree}>
      <div className={styles.legend}>数据资源 · 计算任务</div>
      {children.map((node) => (
        <ResourceTreeNodeBridge
          key={node.id}
          node={node}
          depth={0}
          onToggle={handleToggle}
          onSelect={handleSelect}
          onDoubleClick={onNodeDoubleClick}
          onAction={onNodeAction}
          onContextMenu={handleContextMenu}
        />
      ))}
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
