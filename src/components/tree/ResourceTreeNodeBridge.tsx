import { useResourceTreeStore } from '../../store/useResourceTreeStore';
import ResourceTreeNode from './ResourceTreeNode';
import type { TreeNode } from '../../tree/types';

interface Props {
  node: TreeNode;
  depth: number;
  onToggle: (node: TreeNode) => void;
  onSelect: (node: TreeNode) => void;
  onDoubleClick: (node: TreeNode) => void;
  onAction: (node: TreeNode, actionKey: string) => void;
  onContextMenu: (node: TreeNode, x: number, y: number) => void;
}

export default function ResourceTreeNodeBridge(props: Props) {
  const expanded = useResourceTreeStore((s) => Boolean(s.expanded[props.node.id]));
  const selected = useResourceTreeStore((s) => s.selectedId === props.node.id);
  return <ResourceTreeNode {...props} expanded={expanded} selected={selected} />;
}
