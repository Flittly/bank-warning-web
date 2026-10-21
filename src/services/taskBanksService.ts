import { authHeaders } from '../utils/apiClient';
import { useResourceTreeStore } from '../store/useResourceTreeStore';
import { isSyntheticBankId, resolveTaskBankIds } from '../tree/taskBankIds';

/**
 * 「给已有任务补充岸段」相关的接口封装。
 *
 * <p>为什么单独一个文件：这条链路的三个动作（读任务已有岸段、并入关联、只算未算断面）
 * 语义上是一组，散在 EditorPage 里会和「新建任务」那条链路混在一起 ——
 * 两者的关键差别只有一句：**不新建任务、不清空已有断面与结果**。
 */

export interface TaskBankScope {
  /** 任务当前关联的岸段（tasks.bank_ids ∪ 断面里出现过的 bank_id） */
  existingBankIds: Set<string>;
  /** 该任务下已有断面按 bank_id 分组后的数量 */
  sectionCountByBank: Record<string, number>;
  /** 已有断面的总数 */
  sectionCount: number;
  /** 下一个可用的 segment_index（续在已有最大值之后，避免与老断面抢号） */
  nextSegmentIndex: number;
}

interface RawSection {
  section_id?: string;
  bank_id?: string;
  segment_index?: number | string | null;
}

/** 取任务的全部断面（编辑器侧只需要 id/bank/序号这几个字段）。 */
export async function fetchTaskSections(taskId: string): Promise<RawSection[]> {
  const res = await fetch(`/v0/bank/sections?task_id=${encodeURIComponent(taskId)}`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`读取任务断面失败：${res.status} ${res.statusText}`);
  const data = await res.json();
  const list = data?.sections ?? data?.data ?? [];
  return Array.isArray(list) ? list : [];
}

/**
 * 汇总「这个任务已经有什么」，用于算候选岸段与断面序号起点。
 *
 * <p>已有岸段取 bank_ids 与断面 bank_id 的并集：历史任务的 bank_ids 可能为空或
 * 与实际断面不一致（见 treeModel 里同样的兜底），只信其中一个会漏。
 */
export async function resolveTaskBankScope(
  taskId: string,
  taskBankIds?: unknown,
): Promise<TaskBankScope> {
  const sections = await fetchTaskSections(taskId);

  const sectionCountByBank: Record<string, number> = {};
  let maxSegmentIndex = -1;
  for (const s of sections) {
    const bid = String(s?.bank_id ?? '').trim();
    if (bid) sectionCountByBank[bid] = (sectionCountByBank[bid] || 0) + 1;
    const idx = Number(s?.segment_index);
    if (Number.isFinite(idx) && idx > maxSegmentIndex) maxSegmentIndex = idx;
  }

  const existing = new Set<string>();
  if (Array.isArray(taskBankIds)) {
    for (const b of taskBankIds) {
      const v = String(b ?? '').trim();
      if (v) existing.add(v);
    }
  }
  // `line-N` 是自由断面的占位 id，岸段库里没有对应条目 ⇒ 不进"已有岸段"集合，
  // 否则它会被当成已占用而挡住某些逻辑（虽然库里的岸段本来也不会有这个 id）。
  for (const bid of Object.keys(sectionCountByBank)) {
    if (!isSyntheticBankId(bid)) existing.add(bid);
  }

  return {
    existingBankIds: existing,
    sectionCountByBank,
    sectionCount: sections.length,
    // 全库没有断面时从 0 开始；否则续在最大值之后。
    // 不复用 max+1 的"空洞"（比如删过断面）：segment_index 只用于排序与展示序号，
    // 单调递增比"填洞"更容易解释，也不会和并发补录的另一批撞号。
    nextSegmentIndex: maxSegmentIndex + 1,
  };
}

/** 从全库岸段里筛出该任务还没有的那些。保持传入顺序（库里的顺序就是树里的顺序）。 */
export function pickCandidateBanks<T extends { bank_id?: unknown }>(allBanks: T[], existingBankIds: Set<string>): T[] {
  return (allBanks || []).filter((b) => {
    const bid = String(b?.bank_id ?? '').trim();
    return Boolean(bid) && !existingBankIds.has(bid);
  });
}

/**
 * 主动把某个任务的最新断面清单写回资源树缓存，并返回条数。
 *
 * <p>为什么不能只调 `invalidateSections` 了事：那只是把缓存删掉，真正重拉发生在
 * ResourceSidebar 的 effect 里，而它只认「当前任务」和「已展开的任务节点」。
 * 用户从右键菜单补充岸段时，任务节点多半是折叠的 ⇒ 缓存删了却永远不重拉，
 * 树上就退化成「展开以加载…」，看起来和"没补充成功"一模一样。
 * 这里直接拉、直接写回，与是否展开无关。
 */
export async function refreshTaskSectionsIntoStore(taskId: string): Promise<number> {
  const tid = String(taskId || '').trim();
  if (!tid) return 0;
  const list = await fetchTaskSections(tid);
  useResourceTreeStore.getState().setSectionsForTask(tid, list);
  return list.length;
}

/**
 * 把若干 bank_id 并入 store 里那条任务的 `bank_ids`（乐观更新）。
 *
 * <p>补充岸段成功之后，如果只等 `bumpData` 触发的接口回包，树上会先有一小段空窗；
 * 更糟的是那个接口一旦失败，树就停在旧快照上。先本地并一次，接口回包再覆盖成真值。
 */
export function mergeBankIdsIntoTasksStore(taskId: string, bankIds: string[]): void {
  const tid = String(taskId || '').trim();
  const incoming = (bankIds || []).map((b) => String(b ?? '').trim()).filter(Boolean);
  if (!tid || incoming.length === 0) return;

  const store = useResourceTreeStore.getState();
  const tasks = store.tasks || [];
  let changed = false;
  // store.tasks 是 any[]，这里显式声明形状，既能安全读 bank_ids，也不触发 no-explicit-any
  type TaskRow = { task_id?: unknown; id?: unknown; bank_ids?: unknown; [k: string]: unknown };
  const next = tasks.map((row) => {
    const t = row as TaskRow;
    if (String(t?.task_id ?? t?.id ?? '') !== tid) return row;
    const current: string[] = Array.isArray(t?.bank_ids)
      ? (t.bank_ids as unknown[]).map((b) => String(b ?? '').trim()).filter(Boolean)
      : [];
    const merged = [...current];
    for (const id of incoming) if (!merged.includes(id)) merged.push(id);
    if (merged.length === current.length) return row;
    changed = true;
    return { ...t, bank_ids: merged };
  });
  if (changed) store.setData({ tasks: next });
}

/**
 * 双击任务 / 「加载岸段与断面到地图」时，到底该铺哪些岸段。
 *
 * <p>规则与资源树**同源**（`tree/taskBankIds.ts` 的 `resolveTaskBankIds`）：
 * 任务登记 ∪ 断面引用，并剔除 `line-N` 占位 id。自由断面（手工画线）的 bank_id
 * 在 `banks` 表里没有对应记录，既加载不上地图，也不该算进"地图上有几条岸段"。
 * 两边各算一套的直接后果就是"树里 17 条、地图上 19 条"，用户没法判断谁对。
 */
export function resolveBankIdsForTaskLoading(
  taskBankIds: string[],
  sectionBankIds: string[],
): { bankIds: string[]; withoutSection: string[]; unregistered: string[] } {
  return resolveTaskBankIds(taskBankIds, sectionBankIds);
}

export interface AppendBanksResult {
  ok: boolean;
  /** 本次真正新增的 bank_id（已存在的不重复计） */
  added: string[];
  removed?: string[];
  bankIds: string[];
  total?: number;
  missing?: string[];
  message?: string;
}

/**
 * 把岸段并入任务（`POST /v0/bank/tasks/{taskId}/banks`）。
 *
 * <p>只改 tasks.bank_ids，不动断面与结果；mode 缺省 merge（取并集，只增不减）。
 */
export async function appendBanksToTask(
  taskId: string,
  bankIds: string[],
  mode: 'merge' | 'replace' = 'merge',
): Promise<AppendBanksResult> {
  const res = await fetch(`/v0/bank/tasks/${encodeURIComponent(taskId)}/banks`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ bank_ids: bankIds, mode }),
  });

  let raw: unknown = null;
  try {
    raw = await res.json();
  } catch {
    raw = null;
  }
  const body = (raw ?? {}) as Record<string, unknown>;
  const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

  if (!res.ok) {
    const err = body.error as Record<string, unknown> | undefined;
    const msg = err?.message ?? body.message;
    throw new Error(typeof msg === 'string' && msg ? msg : `${res.status} ${res.statusText}`);
  }

  return {
    ok: body.success !== false,
    added: asStrings(body.added),
    removed: asStrings(body.removed),
    bankIds: asStrings(body.bank_ids),
    total: typeof body.total === 'number' ? body.total : undefined,
    missing: asStrings(body.missing),
    message: typeof body.message === 'string' ? body.message : undefined,
  };
}

/**
 * 用「断面里实际用到的真实岸段」补全任务的 `bank_ids`（`POST /tasks/{id}/banks/sync`）。
 *
 * <p>为什么需要它：`tasks.bank_ids` 与断面可能对不上 —— 早年「补充岸段」在写关联
 * 之前就失败过（接口还没发布 / 请求中断），断面已落库、关联没写。那份数据在库里
 * 客观存在，光靠前端求并集只能让"看起来一致"，一旦走整任务重建仍会丢岸段。
 * 所以发现差异就回写一次，让两个数据源真正收敛。
 *
 * <p>幂等、只增不减：不会删除任何已登记的岸段，也不会动断面与结果。
 */
export async function syncTaskBanksFromSections(taskId: string): Promise<{
  ok: boolean;
  added: string[];
  bankIds: string[];
}> {
  const tid = String(taskId || '').trim();
  if (!tid) return { ok: false, added: [], bankIds: [] };
  const res = await fetch(`/v0/bank/tasks/${encodeURIComponent(tid)}/banks/sync`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`修复任务岸段关联失败：${res.status} ${res.statusText}`);
  const body = await res.json().catch(() => ({} as Record<string, unknown>));
  const asStrings = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : [];
  return {
    ok: body?.success !== false,
    added: asStrings(body?.added),
    bankIds: asStrings(body?.bank_ids),
  };
}

/**
 * 只执行「还没有有效结果」的断面（`POST /tasks/{id}/run?only_pending=true`）。
 *
 * <p>给任务补了岸段之后用它：不先作废全部结果，也不重算已有结论的断面。
 * 返回 `status: 'nothing_pending'` 表示本来就没有待算断面（任务状态不会被改成 running）。
 *
 * <p>`sectionIds` 用来把范围再收窄到"本次新增的这一批"。**补岸段时一定要传**：
 * 不传就是"整个任务所有没结果的断面"，一个跑了 300 条只出 40 条结果的任务，
 * 补 13 条会连带重算 275 条老断面 —— 界面写着"只算新增"，实际跑半小时，
 * 用户中途取消后就变成"补了岸段却没有结果"。
 */
export async function runTaskPendingSections(
  taskId: string,
  sectionIds?: string[],
): Promise<{
  ok: boolean;
  status: string;
  computed: number;
  failed: number;
  skippedExisting: number;
  skippedOutOfScope: number;
}> {
  const scope = (sectionIds || []).map((s) => String(s ?? '').trim()).filter(Boolean);
  const res = await fetch(`/v0/bank/tasks/${encodeURIComponent(taskId)}/run?only_pending=true`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(scope.length > 0 ? { section_ids: scope } : {}),
  });
  if (!res.ok) {
    // 后端把「有断面在重算」「任务已在跑」这类冲突放在 error.message 里，
    // 只报状态码的话用户看到的是一句无从下手的 "执行任务失败：409"。
    let detail = '';
    try {
      const body = await res.json();
      const err = body?.error as Record<string, unknown> | undefined;
      detail = String(err?.message ?? body?.message ?? '');
    } catch {
      /* body 不是 JSON 就退回状态码 */
    }
    throw new Error(detail || `${res.status} ${res.statusText}`);
  }
  const body = await res.json();
  const summary = body?.summary ?? {};
  return {
    ok: body?.success !== false,
    status: String(body?.status ?? ''),
    computed: Number(summary?.success ?? 0),
    failed: Number(summary?.failed ?? 0),
    skippedExisting: Number(summary?.skipped_existing ?? 0),
    skippedOutOfScope: Number(summary?.skipped_out_of_scope ?? 0),
  };
}
