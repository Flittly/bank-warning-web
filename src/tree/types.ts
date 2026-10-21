import type { RuleId, RuleLayer } from '../rules/types';

export type NodeKind =
  | 'root'
  | 'group'
  | 'folder'
  | 'bank'
  | 'section'
  | 'param'
  | 'dem'
  | 'task'
  | 'task-ref'
  /** 校验规则叶子（行尾是开关，不是图标动作） */
  | 'rule';

export type RefEntity = 'bank' | 'section' | 'param' | 'dem' | 'task';

export interface TreeRef {
  entity: RefEntity;
  key: string;
}

export type ActionKey = string;

/**
 * 规则节点自身携带的展示状态。
 *
 * <p>放在节点上而不是让 `ResourceTreeNode` 去读 store：树是纯数据渲染，
 * 一个节点长什么样应当由构建它的 `buildRulesGroup` 决定（同一棵树的快照可复现），
 * 组件里再订阅 store 会让"树内容"和"组件内部状态"两处都能改开关的样子。
 */
export interface RuleNodeMeta {
  id: RuleId;
  enabled: boolean;
  locked: boolean;
  /** 关联图层（river / tiff）；无图层则行尾只有开关 */
  layer?: RuleLayer;
  /** 该图层当前是否显示在地图上 */
  layerOn?: boolean;
}

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
  /** 整行 hover 提示；缺省用 label。规则行用它承载"判定依据"，避免组件反查 catalog */
  title?: string;
  /** 仅 kind='rule' 时有值 */
  rule?: RuleNodeMeta;
}
