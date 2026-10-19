/**
 * 结果人工修改的接口封装。
 *
 * 与其它服务不同的是：这里**必须**把服务端的失败原因原样透出给用户。
 * 「风险值与等级不一致」「结果已被新一轮运行覆盖」这两种提示是产品语义的一部分，
 * 笼统的「保存失败」会让用户以为是自己填错了。
 */

export type RiskOverridePatch = {
  raw_values: Record<string, number | string | null>;
  matrices: Record<string, any>;
  result: number;
  risk_level: number;
};

export type SaveRiskOverrideParams = {
  sectionId: string;
  taskId: string | null;
  /** 客户端展示的那一行 id；服务端据此判断是否已被新一轮运行覆盖（409）。 */
  resultId?: number | null;
  note?: string;
  patch: RiskOverridePatch;
};

type ApiError = { code?: string; message?: string };

async function readError(res: Response): Promise<Error> {
  let message = `HTTP ${res.status}`;
  try {
    const body = await res.json();
    const err: ApiError = body?.error ?? body ?? {};
    if (err?.message) message = err.message;
  } catch {
    /* 非 JSON 响应，保留状态码 */
  }
  return new Error(message);
}

export async function saveSectionResultOverride(params: SaveRiskOverrideParams): Promise<any> {
  const res = await fetch(`/v0/bank/results/${encodeURIComponent(params.sectionId)}/override`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      task_id: params.taskId,
      result_id: params.resultId ?? undefined,
      note: params.note || undefined,
      patch: params.patch,
    }),
  });
  if (!res.ok) throw await readError(res);
  const body = await res.json();
  return body?.result ?? null;
}

export async function revertSectionResultOverride(sectionId: string, taskId: string | null): Promise<any> {
  const query = taskId ? `?task_id=${encodeURIComponent(taskId)}` : '';
  const res = await fetch(`/v0/bank/results/${encodeURIComponent(sectionId)}/override${query}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw await readError(res);
  const body = await res.json();
  return body?.result ?? null;
}
