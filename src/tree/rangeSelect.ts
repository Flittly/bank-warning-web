import type { TreeNode } from './types';
import { flattenTree } from './treeModel';

/**
 * 资源树「连续范围选择」的纯逻辑。
 *
 * 交互契约（与 Windows 资源管理器 / VSCode 一致）：
 * - 普通点击：锚点设为这一行，选中集合只留它一个。
 * - Shift + 点击：从「锚点」到「这一行」之间的所有**可选中**行，按当前可见顺序
 *   一并选中（锚点不变，所以反复 Shift 点不同行可以来回扩展/收缩范围）。
 * - Ctrl/Cmd + 点击：在这一行上做「取反」——已选则取消、未选则加入，并把锚点
 *   移到这一行（供后续 Shift 连续扩展）。
 * - Ctrl/Cmd + Shift + 点击：在保留既有选区的基础上，把「锚点→这一行」这段
 *   追加进选区（Windows 文件管理器的语义）。
 *
 * 把这段逻辑单独抽出来，是因为「哪些行可选中、可见顺序、锚点如何推进」这些规则
 * 必须可单测，不能埋在 React 事件里拍脑袋。
 */

export interface SelectableRow {
  node: TreeNode;
  index: number;
}

export interface RangeSelectState {
  /** 当前选中的节点 id 集合（只含 selectable 的叶子/容器节点） */
  selectedIds: Set<string>;
  /** 锚点行在可见序列里的下标；没有锚点（从未点过）时为 null */
  anchorIndex: number | null;
}

export type SelectModifier = { shift: boolean; ctrlOrMeta: boolean };

/**
 * 把树按 expanded 摊平，只留下 `selectable` 的节点作为「可选行」，
 * 并记住每个可选行在完整可见序列中的位置（index 用于范围计算）。
 */
export function collectSelectableRows(
  root: TreeNode,
  expanded: Record<string, boolean>,
): SelectableRow[] {
  const flat = flattenTree(root, expanded);
  const rows: SelectableRow[] = [];
  flat.forEach((r, i) => {
    if (r.node.selectable) rows.push({ node: r.node, index: i });
  });
  return rows;
}

/**
 * 计算点击某一行后的新选区。
 * @param rows        当前可见的可选行序列
 * @param clickedId   被点击节点的 id
 * @param prev        上一次的选区状态
 * @param mod         修饰键
 */
export function applyRangeSelect(
  rows: SelectableRow[],
  clickedId: string,
  prev: RangeSelectState,
  mod: SelectModifier,
): RangeSelectState {
  const clickedIdx = rows.findIndex((r) => r.node.id === clickedId);
  if (clickedIdx < 0) return prev;

  // ① 无修饰：单选这一行，锚点推进到它
  if (!mod.shift && !mod.ctrlOrMeta) {
    return { selectedIds: new Set([clickedId]), anchorIndex: clickedIdx };
  }

  // ② Ctrl/Cmd（无 Shift）：在这一行上取反
  if (mod.ctrlOrMeta && !mod.shift) {
    const next = new Set(prev.selectedIds);
    if (next.has(clickedId)) next.delete(clickedId);
    else next.add(clickedId);
    return { selectedIds: next, anchorIndex: clickedIdx };
  }

  // ③ Shift（含 Ctrl/Cmd + Shift）：把 [anchor, clicked] 这段加进来
  const rawAnchor = prev.anchorIndex;
  const anchor = rawAnchor !== null && rawAnchor >= 0 ? rawAnchor : clickedIdx;
  const lo = Math.min(anchor, clickedIdx);
  const hi = Math.max(anchor, clickedIdx);
  const base = mod.ctrlOrMeta ? new Set(prev.selectedIds) : new Set<string>();
  for (let i = lo; i <= hi; i++) base.add(rows[i].node.id);
  // 纯 Shift（不带 Ctrl）时，范围外的旧选区应被清掉（Windows 语义：Shift 是"重选这段"）
  return { selectedIds: base, anchorIndex: anchor };
}

/** 清空选区（锚点一并清除） */
export function emptySelection(): RangeSelectState {
  return { selectedIds: new Set<string>(), anchorIndex: null };
}
