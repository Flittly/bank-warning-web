/**
 * 「终止运行中的任务」的前端唯一入口。
 *
 * <p>为什么要专门一个模块：这个动作有两个**必须区分**的结果，界面文案不能混为一谈 ——
 * <ul>
 *   <li><b>cooperative</b>：本进程确实有线程在跑 ⇒ 只是"请求已受理"，任务**还没停**，
 *       要等它把当前断面算完。界面要给出"正在停止"的中间态，不能报"已终止"。</li>
 *   <li><b>stale</b>：跑它的进程已经不在了（后端重启 / 请求被中断，也就是面板上那种挂了几周的僵尸）
 *       ⇒ 服务端会当场改库收尾，**这一刻就已经终止完了**。</li>
 * </ul>
 *
 * <p>判定逻辑放在纯函数 {@link interpretCancelResponse} 里，不碰网络、不碰 DOM，
 * 便于在 node 环境的 vitest 里直测（本仓库没有 jsdom）。
 */
import { authHeaders } from '../utils/apiClient';

export type CancelOutcomeKind =
  /** 真在跑：已请求停止，待当前断面算完 */
  | 'stopping'
  /** 进程已死的僵尸：服务端已直接标记终止 */
  | 'stale-cleared'
  /** 本来就没在跑 */
  | 'not-running'
  /** 请求失败（网络 / 权限 / 服务端异常） */
  | 'error';

export interface CancelOutcome {
  /** 请求是否被服务端正确受理（`kind === 'error'` 时才是 false） */
  ok: boolean;
  kind: CancelOutcomeKind;
  /** 可直接交给 message.* 的文案 */
  message: string;
  /** 服务端回报的任务状态，便于调用方刷新后比对 */
  status?: string;
}

/**
 * 从错误响应体里抠出能给用户看的一句话。
 *
 * <p>本仓的响应体形状**不统一**：顺手写的是 `{message}`，走全局异常处理器的是
 * `{error:{code,message}}`。只认前一种的话，后者会被 `String(对象)` 变成
 * "终止失败：[object Object]" —— 一句废话。
 */
export function extractErrorMessage(body: any): string {
  if (!body) return '';
  const direct = String(body?.message ?? '').trim();
  if (direct) return direct;
  const nested = body?.error;
  if (typeof nested === 'string') return nested.trim();
  const nestedMessage = String(nested?.message ?? '').trim();
  return nestedMessage;
}

/**
 * 把终止接口的响应翻译成界面可用的结果。
 *
 * <p>不确定的响应一律当**失败**处理：宁可让用户看到"终止失败"，也不要给一个假绿灯 ——
 * 之前那条挂了 20 小时的僵尸任务，本质就是"界面显示的状态不是真的"。
 */
export function interpretCancelResponse(httpStatus: number, body: any): CancelOutcome {
  if (httpStatus === 401 || httpStatus === 403) {
    return { ok: false, kind: 'error', message: '没有终止任务的权限，登录可能已过期，请重新登录' };
  }
  if (httpStatus === 404) {
    return { ok: false, kind: 'error', message: '任务不存在或已被删除' };
  }
  if (!Number.isFinite(httpStatus) || httpStatus < 200 || httpStatus >= 300) {
    const detail = extractErrorMessage(body);
    return {
      ok: false,
      kind: 'error',
      message: detail ? `终止失败：${detail}` : `终止失败（HTTP ${httpStatus}）`,
    };
  }

  const mode = String(body?.mode ?? '').trim();
  const status = String(body?.status ?? '').trim() || undefined;
  const serverMessage = String(body?.message ?? '').trim();

  if (mode === 'cooperative') {
    return {
      ok: true,
      kind: 'stopping',
      status,
      message: serverMessage || '已请求终止：当前断面算完后停止，已完成的结果保留',
    };
  }
  if (mode === 'stale') {
    return {
      ok: true,
      kind: 'stale-cleared',
      status,
      message: serverMessage || '该任务的执行进程已不存在，已直接标记为「已终止」',
    };
  }
  if (mode === 'not-running') {
    return {
      ok: true,
      kind: 'not-running',
      status,
      message: serverMessage || '该任务当前并不在运行中',
    };
  }
  return {
    ok: false,
    kind: 'error',
    message: `终止请求返回了无法识别的结果（mode=${mode || '空'}）`,
  };
}

/** POST /v0/bank/tasks/{id}/cancel。网络层异常也包成 CancelOutcome，调用方只需看 ok/kind。 */
export async function cancelTask(taskId: string): Promise<CancelOutcome> {
  const id = String(taskId || '').trim();
  if (!id) {
    return { ok: false, kind: 'error', message: '缺少任务 ID，无法终止' };
  }
  try {
    const res = await fetch(`/v0/bank/tasks/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    });
    const text = await res.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return interpretCancelResponse(res.status, body);
  } catch (err: any) {
    return { ok: false, kind: 'error', message: `终止请求发送失败：${err?.message || String(err)}` };
  }
}
