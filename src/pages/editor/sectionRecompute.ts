import { message } from 'antd';
import { authHeaders } from '../../utils/apiClient';

/**
 * 断面几何变更后的「单断面重算」调度。
 *
 * 背景：断面被拖动/旋转/平移/缩放后，后端在保存几何时就把这条断面的旧结论作废了
 * （见 BusinessStoreService#updateSection），所以必须立刻把它算回来，否则结果页会
 * 一直显示「该断面尚无计算结果」。
 *
 * 两条约束决定了这里必须做**单飞 + 合并**：
 * 1. 后端对同一断面并发重算是快速失败（409），不会排队 —— 重算一次包含剖面与
 *    风险等级两次模型调用，堆起来只是白烧。
 * 2. 更关键的是正确性：重算内部是「重新读库里的几何再算」。如果两次几何变更交错发出，
 *    先落地的那次可能把**旧位置**的结论写成最终结果。因此第二次变更不并发发出，
 *    而是记一笔「跑完再算一次」，用最新几何补算。
 */

export type RecomputeOutcome = {
  status: 'computed' | 'failed' | 'skipped';
  riskLevel?: number;
  errorCode?: string;
  errorMessage?: string;
};

/** sectionId -> 在途请求。 */
const inFlight = new Map<string, Promise<RecomputeOutcome>>();
/** 在途期间又发生了一次几何变更的断面。 */
const rerunRequested = new Set<string>();

async function requestRecompute(sectionId: string): Promise<RecomputeOutcome> {
  let response: Response;
  try {
    response = await fetch(`/v0/bank/sections/${encodeURIComponent(sectionId)}/recompute`, {
      method: 'POST',
      headers: { ...authHeaders() },
    });
  } catch (error: any) {
    return { status: 'failed', errorMessage: error?.message ?? '重算请求发送失败' };
  }

  // 409 = 此刻不能算（整任务在跑 / 同一断面已在算）。不是错误，让任务整体运行去覆盖即可。
  if (response.status === 409) {
    return { status: 'skipped', errorMessage: '该任务正在运行，结果稍后由任务整体运行刷新' };
  }
  if (!response.ok) {
    return { status: 'failed', errorMessage: `HTTP ${response.status}` };
  }

  const payload = await response.json().catch(() => null as any);
  if (payload?.status === 'computed') {
    return { status: 'computed', riskLevel: typeof payload.risk_level === 'number' ? payload.risk_level : undefined };
  }
  return {
    status: 'failed',
    errorCode: payload?.error_code,
    errorMessage: payload?.error_message ?? payload?.error_detail ?? '重算未返回结果',
  };
}

/**
 * 请求重算一条断面（不做任何 UI 提示）。
 *
 * 同一断面已有请求在途时不会重复发出，只登记一次「稍后补算」，并复用当前的 Promise。
 */
export function recomputeSectionAfterGeometryChange(sectionId: string): Promise<RecomputeOutcome> {
  const running = inFlight.get(sectionId);
  if (running) {
    rerunRequested.add(sectionId);
    return running;
  }

  const task = requestRecompute(sectionId).finally(() => {
    inFlight.delete(sectionId);
    if (rerunRequested.delete(sectionId)) {
      // 用最新几何补算一次。刻意不 await：它属于上一轮的收尾，不该拖住调用方。
      void recomputeSectionAfterGeometryChange(sectionId);
    }
  });
  inFlight.set(sectionId, task);
  return task;
}

/**
 * 几何保存成功后的入口：按需重算 + 轻提示。
 *
 * 只在 `had_result` 为真时调用 —— 该断面本来就没算过（新建断面）时不必在这里烧模型调用，
 * 等任务整体运行即可。
 */
export function scheduleSectionRecompute(sectionId: string | undefined, hadResult: boolean | undefined): void {
  if (!sectionId || !hadResult) return;

  const key = `section-recompute:${sectionId}`;
  message.loading({ content: '断面位置已更新，正在重算该断面…', key, duration: 0 });

  void recomputeSectionAfterGeometryChange(sectionId).then((outcome) => {
    if (outcome.status === 'computed') {
      const level = outcome.riskLevel === undefined ? '' : `，风险等级 ${outcome.riskLevel}`;
      message.success({ content: `该断面已按新位置重算完成${level}`, key, duration: 3 });
      return;
    }
    if (outcome.status === 'failed') {
      message.warning({
        content: `该断面重算失败：${outcome.errorMessage || outcome.errorCode || '未知原因'}`,
        key,
        duration: 6,
      });
      return;
    }
    // skipped：任务在跑，交给任务自身的运行结果
    message.info({ content: outcome.errorMessage ?? '该断面暂不重算', key, duration: 4 });
  });
}

/** 仅测试用：清空在途/待补算登记。 */
export function __resetSectionRecomputeState(): void {
  inFlight.clear();
  rerunRequested.clear();
}
