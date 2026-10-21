/**
 * 「某个任务到底有哪些岸段」的唯一口径。
 *
 * <p>为什么必须收敛到一个函数：这个问题的答案被四处消费 ——
 * 资源树的「岸段」文件夹、双击任务铺到地图的岸段清单、「补充岸段」的候选过滤、
 * 以及后端对 `tasks.bank_ids` 的修复。之前树只认 `tasks.bank_ids`、地图认
 * 「关联 ∪ 断面」，两边一旦不同源就会出现自相矛盾的界面：树里 17 条、
 * 地图上 19 条，用户完全无法判断哪个是真的。
 *
 * <p>取值规则（顺序即展示顺序）：
 * 1. `tasks.bank_ids` 里登记的，按登记顺序；
 * 2. 断面里出现过、但没登记的，追加在后面（历史任务确有这种数据：早年
 *    「补充岸段」在写关联前就失败了，断面已落库、`bank_ids` 没写进去）；
 * 3. 去掉 `line-N` 这类占位 id —— 它们是「自由断面」手工画线时临时生成的，
 *    `banks` 表里没有对应岸段，既加载不上地图，也不该在岸段树里冒充一条岸段。
 *
 * <p>纯函数、无依赖，`treeModel` / `services/taskBanksService` 共用。
 */

/** 自由断面（手工画线）的 bank_id 占位格式：`line-9`、`line-38` …… */
const SYNTHETIC_BANK_ID = /^line-\d+$/i;

/** 是否是「自由断面」的占位 id —— 不是真实岸段，不能当岸段加载/展示。 */
export function isSyntheticBankId(bankId: unknown): boolean {
  return SYNTHETIC_BANK_ID.test(String(bankId ?? '').trim());
}

export interface TaskBankIdResolution {
  /** 该任务的岸段清单（已去重、已剔除占位 id，顺序稳定） */
  bankIds: string[];
  /** 登记了岸段但该任务还没有断面 —— UI 要如实提示「这 N 条还没断面」 */
  withoutSection: string[];
  /** 有断面但没登记进 `tasks.bank_ids` —— 任务自身的数据不一致，需要回写修复 */
  unregistered: string[];
}

function normalize(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const id = String(raw ?? '').trim();
    if (!id || isSyntheticBankId(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * 合并两侧来源，得到该任务完整的岸段清单。
 *
 * @param taskBankIds `tasks.bank_ids`（任务登记的关联）
 * @param sectionBankIds 该任务断面里出现过的 `bank_id`
 */
export function resolveTaskBankIds(
  taskBankIds: unknown,
  sectionBankIds: unknown,
): TaskBankIdResolution {
  const fromTask = normalize(taskBankIds);
  const fromSections = normalize(sectionBankIds);
  const taskSet = new Set(fromTask);
  const sectionSet = new Set(fromSections);

  const bankIds = [...fromTask];
  for (const id of fromSections) if (!taskSet.has(id)) bankIds.push(id);

  return {
    bankIds,
    withoutSection: fromTask.filter((id) => !sectionSet.has(id)),
    unregistered: fromSections.filter((id) => !taskSet.has(id)),
  };
}
