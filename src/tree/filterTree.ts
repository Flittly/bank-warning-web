import type { TreeNode } from './types';
import { matchesAnyTerm } from '../utils/highlight';

/**
 * 搜索态的树剪枝。
 *
 * 规则（对应用户要求「仅展示被命中的节点及其相关路径，隐藏未命中的节点」）：
 * - 节点自身命中 -> 保留
 * - 节点自身不命中，但有后代命中 -> 保留（作为路径），只带命中后代
 * - 整棵子树无命中 -> 整枝丢弃
 *
 * 刻意**不**保留命中节点的全部子节点：否则搜「断面」会把某个任务的 600 条断面全放出来，
 * 等于没剪枝。
 */

/** 命中判定：既认业务主键（后端给的 ref），也认节点自身文案（本地即时反馈） */
export type HitPredicate = (node: TreeNode) => boolean;

/** 树节点的业务引用键，形如 `section:sec-xxx` */
export function refKeyOf(node: TreeNode): string | null {
  if (!node.ref?.entity || !node.ref?.key) return null;
  return `${node.ref.entity}:${node.ref.key}`;
}

/**
 * 构造命中判定。
 *
 * `matchedRefs` 来自后端命中结果（能覆盖「关键词只出现在描述里、节点标题里没有」的情况），
 * `terms` 用于本地即时匹配（不等网络，敲第一个字树就开始收窄）。
 *
 * `refOnly` 是关键开关：后端结果回来后必须切到「只认 ref」。
 * 否则 `risk:3 断面` 这种带筛选的查询会把树里所有含「断面」的节点都放出来，
 * 与列表里的 3 条命中直接矛盾——树和列表必须说同一件事。
 */
export function makeHitPredicate(
  terms: readonly string[],
  matchedRefs: ReadonlySet<string>,
  refOnly = false,
): HitPredicate {
  const needles = (terms || []).filter((t) => String(t ?? '').trim().length > 0);
  return (node: TreeNode) => {
    const key = refKeyOf(node);
    if (key && matchedRefs.has(key)) return true;
    if (refOnly) return false;
    if (needles.length === 0) return false;
    if (matchesAnyTerm(node.label, needles)) return true;
    // meta 里放的是状态、bank_id、时间点等，用户也会照着它搜（如输 `bankwgs84_5`）
    return node.meta ? matchesAnyTerm(node.meta, needles) : false;
  };
}

/** 返回剪枝后的新树；完全无命中时返回 null（调用方据此显示空态） */
export function pruneTree(root: TreeNode, isHit: HitPredicate): TreeNode | null {
  return pruneNode(root, isHit);
}

function pruneNode(node: TreeNode, isHit: HitPredicate): TreeNode | null {
  const keptChildren: TreeNode[] = [];
  for (const child of node.children || []) {
    const kept = pruneNode(child, isHit);
    if (kept) keptChildren.push(kept);
  }

  const selfHit = isHit(node);
  if (!selfHit && keptChildren.length === 0) return null;

  return {
    ...node,
    children: keptChildren.length > 0 ? keptChildren : undefined,
  };
}

/**
 * 剪枝后的树必须全展开，否则命中的节点被折叠在看不见的地方。
 * 单独返回一份映射而不是写进 store：搜索结束后用户的展开态要原样回来。
 */
export function expandedAll(root: TreeNode | null): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!root) return out;
  const walk = (node: TreeNode) => {
    if (node.children && node.children.length > 0) {
      out[node.id] = true;
      node.children.forEach(walk);
    }
  };
  walk(root);
  return out;
}

/** 统计剪枝后仍被选中的业务对象数（结果条数，不含路径文件夹） */
export function countKeptNodes(root: TreeNode | null): number {
  if (!root) return 0;
  let n = 0;
  const walk = (node: TreeNode) => {
    if (node.ref) n += 1;
    node.children?.forEach(walk);
  };
  walk(root);
  return n;
}
