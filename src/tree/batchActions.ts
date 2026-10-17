import type { TreeNode } from './types';

/**
 * 批量操作条：按「资源类型」聚合选中节点，决定暴露哪些批量动作。
 *
 * 设计原则：
 * - 批量动作必须是「对该类型的所有节点都安全、语义一致」的（例如岸段可批量删除，
 *   但「截取」「平滑」这类依赖地图当前状态的单条动作不进批量）。
 * - 混合类型选择时，按类型分别分组展示，各自只列自己支持的批量动作；
 *   跨类型的「通用动作」（删除）可单独列出，但要明确目标类型，避免误伤。
 */

export interface BatchActionMeta {
  key: string;
  label: string;
  icon: string;
  danger?: boolean;
}

/** 每种节点 kind 支持的批量动作（key 与 EditorPage 的 handleBatchAction 对齐） */
export const BATCH_ACTIONS: Record<string, BatchActionMeta[]> = {
  bank: [
    { key: 'bank.loadMap', label: '批量加载到地图', icon: 'eye' },
    { key: 'bank.removeMap', label: '批量移出地图', icon: 'eyeOff' },
    { key: 'bank.delete', label: '批量删除', icon: 'trash', danger: true },
  ],
  section: [
    { key: 'section.loadMap', label: '批量加载到地图', icon: 'eye' },
    { key: 'section.removeMap', label: '批量移出地图', icon: 'eyeOff' },
    { key: 'section.delete', label: '批量删除', icon: 'trash', danger: true },
  ],
  dem: [
    { key: 'dem.delete', label: '批量删除', icon: 'trash', danger: true },
  ],
  task: [
    { key: 'task.delete', label: '批量删除', icon: 'trash', danger: true },
  ],
  param: [
    // 参数模板目前没有批量动作（没有删除/批量设置的落点），
    // 选中 param 时不展示批量条，避免出现"点了没反应"的按钮。
  ],
};

/** 按 kind 聚合选中节点（保持出现顺序稳定） */
export function groupSelectedByKind(nodes: TreeNode[]): Map<string, TreeNode[]> {
  const map = new Map<string, TreeNode[]>();
  for (const n of nodes) {
    if (!BATCH_ACTIONS[n.kind] || BATCH_ACTIONS[n.kind].length === 0) continue;
    const arr = map.get(n.kind) || [];
    arr.push(n);
    map.set(n.kind, arr);
  }
  return map;
}

/** 判断一组选中节点是否有可执行的批量动作 */
export function hasBatchActions(nodes: TreeNode[]): boolean {
  return groupSelectedByKind(nodes).size > 0;
}
