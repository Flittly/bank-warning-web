export type NodeKind =
  | 'root'
  | 'group'
  | 'folder'
  | 'bank'
  | 'section'
  | 'param'
  | 'dem'
  | 'task'
  | 'task-ref';

export type RefEntity = 'bank' | 'section' | 'param' | 'dem' | 'task';

export interface TreeRef {
  entity: RefEntity;
  key: string;
}

export type ActionKey = string;

export interface TreeNode {
  id: string;
  kind: NodeKind;
  label: string;
  icon?: string;
  meta?: string;
  subtitle?: string;
  ref?: TreeRef;
  children?: TreeNode[];
  selectable: boolean;
  actions?: ActionKey[];
  invalid?: boolean;
}
