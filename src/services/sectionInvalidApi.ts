/**
 * 断面「人工无效」标记的接口封装。
 *
 * 与 `resultOverrideApi` 刻意分开：那边是**改数值**（重算档位、写 `edit_state`、可能 409），
 * 这边只改**可见性**（`cross_sections.manual_invalid`，碰都不碰结果行）。
 * 混在一个模块里，早晚有人把「标记无效」当成「删结果」来调。
 *
 * 服务端语义（详见 `BusinessStoreService#setSectionsManualInvalid`）：
 *   · 不删结果、不作废结果 ⇒ 恢复有效立刻重新上色，不需要重算；
 *   · 只影响图面着色、框选统计、报告出图与导出；
 *   · `is_valid`（几何校验）不受影响。
 */

export type ManualInvalidResponse = {
  /** 请求里的断面条数 */
  requested: number;
  /** 实际更新行数；小于 requested 说明有 id 越权或已被删除 */
  updated: number;
  /** 本次操作后的状态（true = 无效） */
  invalid: boolean;
};

export type ManualInvalidParams = {
  sectionIds: string[];
  invalid: boolean;
  /** 标记原因（选填，≤200 字）；恢复有效时服务端会忽略并清空 */
  reason?: string | null;
};

async function readError(res: Response): Promise<Error> {
  let message = `HTTP ${res.status}`;
  try {
    const body = await res.json();
    const err = body?.error ?? body ?? {};
    if (err?.message) message = err.message;
  } catch {
    /* 非 JSON 响应，保留状态码 */
  }
  return new Error(message);
}

export async function setSectionManualInvalid(params: ManualInvalidParams): Promise<ManualInvalidResponse> {
  // 去空 + 去首尾空格 + **去重**：批量操作时 id 来自 DOM 文本，重复项会让后端返回的
  // affected rows 虚高（PostgreSQL 的 UPDATE ... IN 对重复值不重复计数），
  // 前端据此判断「部分失败」就会误报。
  const ids = Array.from(new Set(
    (params.sectionIds ?? []).map(id => String(id ?? '').trim()).filter(Boolean),
  ));
  if (ids.length === 0) throw new Error('没有选中任何断面');

  const res = await fetch('/v0/bank/sections/manual-invalid', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      section_ids: ids,
      invalid: params.invalid,
      reason: params.reason ? String(params.reason).slice(0, 200) : undefined,
    }),
  });
  if (!res.ok) throw await readError(res);

  const body = await res.json().catch(() => null);
  return {
    requested: Number(body?.requested ?? ids.length),
    updated: Number(body?.updated ?? 0),
    invalid: Boolean(body?.invalid ?? params.invalid),
  };
}
