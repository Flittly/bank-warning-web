/**
 * 编辑器内的「任务运行进度」：把模块级运行状态（`runProgressStore`）接到 React 上。
 *
 * <p>状态本身**不放在组件里**：`/run` 是一次几十秒到几分钟的同步请求，而用户会在
 * 编辑器 / 任务列表之间来回走。放在组件里，一换页就跟丢（进度卡消失、地图停止上色），
 * 看起来就像任务被终止了。现在运行与轮询都活在模块里，页面只订阅它看到的那一份。
 *
 * <p>这里只做三件小事：订阅、把「收尾」这件事通知一次给调用方、把 API 原样转发。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  dismissRunProgress,
  getRunSnapshot,
  markRunFailed,
  markRunReturned,
  startRunProgress,
  subscribeRunProgress,
} from '../pages/editor/runProgressStore';
import type { TaskRunSnapshot } from '../pages/editor/taskRunProgress';

export interface UseTaskRunProgress {
  snapshot: TaskRunSnapshot | null;
  /** 提交一次运行后调用：立刻开始轮询，与真正的 `/run` 请求并行。 */
  start: (taskId: string, taskName?: string) => Promise<void>;
  /** `/run` 已返回（无论成功/失败/被终止）：解除起跑闸门，让终态立刻生效。 */
  markReturned: (status?: string) => void;
  /** 请求就没发出去（校验失败 / 409 冲突）：别再空转轮询。 */
  markFailed: (message: string) => void;
  dismiss: () => void;
}

export function useTaskRunProgress(onFinished?: () => void): UseTaskRunProgress {
  const [snapshot, setSnapshot] = useState<TaskRunSnapshot | null>(() => getRunSnapshot());
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;
  /** 已经通知过收尾的 `taskId@updatedAt`，避免同一终态重复刷新资源树 */
  const notifiedRef = useRef<string>('');

  useEffect(() => subscribeRunProgress(setSnapshot), []);

  // 换页回来时状态可能已经收尾：挂载那一刻也要对齐一次，别等下一次 start。
  useEffect(() => setSnapshot(getRunSnapshot()), []);

  useEffect(() => {
    if (!snapshot) return;
    if (snapshot.phase === 'running') return;
    const key = `${snapshot.taskId}@${snapshot.updatedAt}`;
    if (notifiedRef.current === key) return;
    notifiedRef.current = key;
    finishedRef.current?.();
  }, [snapshot]);

  const start = useCallback(async (taskId: string, taskName?: string) => {
    await startRunProgress(taskId, taskName);
  }, []);

  return { snapshot, start, markReturned: markRunReturned, markFailed: markRunFailed, dismiss: dismissRunProgress };
}
