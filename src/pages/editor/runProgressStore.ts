/**
 * 「当前这次任务运行」的**进程级**状态。
 *
 * <p>为什么不是 hook 里的局部 state：`/run` 是同步请求，一次跑几十秒到几分钟，
 * 而页面会换（编辑器 → 任务列表 → 回编辑器）。状态放在组件里，一换页就跟丢了 ——
 * 回来后进度卡是空的、地图也不再上色，看起来就像「任务被终止了」。
 * 放到模块级单例后：轮询与运行本身都不再依赖哪个页面还挂着，回到编辑器能接着看。
 *
 * <p>轮询用 `setTimeout` 串行续排而不是 `setInterval`：任务跑到一半后端偶尔会慢到
 * 超过一个周期，`setInterval` 会把请求堆起来，越跑越拥；串行模式永远是「上一轮回来
 * 才开始算下一轮」。
 *
 * <p><b>起跑闸门</b>：重跑一个"上次已完成"的任务时，后端要过几百毫秒才会把状态改成
 * running、并清掉旧结果。若第一轮轮询落在这之前，读到的就是「completed + 上次的 5 条
 * 结果」—— 卡片会当场显示"计算完成 5/5"并**停止跟进**，真正的那次运行就再也看不见了。
 * 所以终态必须等两个条件之一成立才认：<b>见过一次运行中</b>，或 <b>`/run` 已经返回</b>。
 */
import { authHeaders } from '../../utils/apiClient';
import {
  summarizeRun,
  type SectionBrief,
  type TaskRunSnapshot,
} from '../editor/taskRunProgress';

const POLL_MS = 1500;

type Listener = (snapshot: TaskRunSnapshot | null) => void;

let snapshot: TaskRunSnapshot | null = null;
const listeners = new Set<Listener>();
/** 当前轮次的定时器；null = 没有在跟 */
let timer: number | null = null;
/** 每次 start / dismiss 自增：旧轮次的回调发现序号变了就自行退出 */
let seq = 0;
/** 是否已经见过一次「运行中」：终态闸门的一半条件 */
let sawRunning = false;
/** `/run` 是否已经返回：终态闸门的另一半条件 */
let returned = false;
let tickFn: (() => Promise<void>) | null = null;

function emit(): void {
  listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch {
      /* 订阅者自己的异常不该打断轮询 */
    }
  });
}

export function getRunSnapshot(): TaskRunSnapshot | null {
  return snapshot;
}

export function subscribeRunProgress(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function clearTimer(): void {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
}

/** 任务 + 断面清单只在一个轮次开始时取一次：运行期间断面集合不会变。 */
async function fetchSections(taskId: string): Promise<SectionBrief[]> {
  try {
    const res = await fetch(`/v0/bank/sections?task_id=${encodeURIComponent(taskId)}`, {
      headers: { ...authHeaders() },
    });
    if (!res.ok) return [];
    const json = await res.json().catch(() => null);
    const list = json?.sections ?? json?.data?.sections ?? json?.data ?? [];
    return Array.isArray(list)
      ? list
          .map((s: any) => ({
            section_id: String(s?.section_id ?? s?.sectionId ?? ''),
            section_name: s?.section_name ?? s?.sectionName,
          }))
          .filter((s: SectionBrief) => Boolean(s.section_id))
      : [];
  } catch {
    // 拿不到清单不该让进度卡死：总数退化成 0，卡片显示「已处理 N」而不是百分比。
    return [];
  }
}

async function fetchTaskInfo(taskId: string): Promise<{ status?: string; runCompletedAt?: string }> {
  const pick = (raw: any) => {
    const t = raw?.task ?? raw?.data?.task ?? raw?.data ?? raw;
    return {
      status: t?.status ?? t?.state,
      runCompletedAt: t?.run_completed_at ?? t?.runCompletedAt,
    };
  };
  try {
    const res = await fetch(`/v0/bank/tasks/${encodeURIComponent(taskId)}`, { headers: { ...authHeaders() } });
    if (res.ok) {
      const info = pick(await res.json().catch(() => null));
      if (info.status || info.runCompletedAt) return info;
    }
  } catch {
    /* 落到 /full 再试一次 */
  }
  try {
    // 老版本只在 /full 里带 status（结果页也有同样的兜底）。
    const res = await fetch(`/v0/bank/tasks/${encodeURIComponent(taskId)}/full`, { headers: { ...authHeaders() } });
    if (res.ok) return pick(await res.json().catch(() => null));
  } catch {
    /* 两个都失败：这一轮当作状态未知，继续下一轮 */
  }
  return {};
}

async function fetchResults(taskId: string): Promise<any[]> {
  try {
    const res = await fetch(`/v0/bank/results?task_id=${encodeURIComponent(taskId)}`, {
      headers: { ...authHeaders() },
    });
    if (!res.ok) return [];
    const json = await res.json().catch(() => null);
    const list = json?.results ?? json?.data?.results ?? json?.data ?? [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * 提交一次运行后调用：立刻开始轮询，与真正的 `/run` 请求并行。
 *
 * <p>返回值是个 Promise（等价于"至少跑完第一轮"），调用方一般 `void` 掉即可。
 */
export async function startRunProgress(taskId: string, taskName?: string): Promise<void> {
  const id = String(taskId || '').trim();
  if (!id) return;

  seq += 1;
  const mySeq = seq;
  clearTimer();
  sawRunning = false;
  returned = false;

  const startedAt = Date.now();
  // 先给一个 0/N 的骨架：让用户点完按钮立刻看到「正在计算」，
  // 而不是等两三个请求往返之后才出现卡片。
  snapshot = {
    taskId: id,
    taskName,
    phase: 'running',
    total: 0,
    done: 0,
    success: 0,
    errorCount: 0,
    errors: [],
    levels: {},
    startedAt,
    updatedAt: startedAt,
  };
  emit();

  const sections = await fetchSections(id);
  if (mySeq !== seq) return;

  const tick = async (): Promise<void> => {
    if (mySeq !== seq) return;
    const [info, results] = await Promise.all([fetchTaskInfo(id), fetchResults(id)]);
    if (mySeq !== seq) return;

    const raw = summarizeRun({
      taskId: id,
      taskName,
      sections,
      results,
      taskStatus: info.status,
      runCompletedAt: info.runCompletedAt,
      startedAt,
    });

    // 闸门：没跑起来过、也没收到 `/run` 返回 ⇒ 这个终态是**上一次**运行的残留。
    if (raw.phase === 'running') sawRunning = true;
    const gated = !sawRunning && !returned;
    snapshot = gated ? { ...raw, phase: 'running' as const } : raw;
    emit();

    if (snapshot.phase === 'running') {
      timer = window.setTimeout(() => {
        void tick();
      }, POLL_MS);
    } else {
      timer = null;
      tickFn = null;
    }
  };

  tickFn = tick;
  await tick();
}

/** `/run` 已返回（无论成功/失败/被终止）：解除起跑闸门，让终态立刻生效。 */
export function markRunReturned(status?: string): void {
  returned = true;
  // 后端明确说了不是 running，就直接算见过运行中，下一轮立刻能收尾
  if (status && String(status).toLowerCase() !== 'running') sawRunning = true;
  void tickFn?.();
}

/** 请求就没发出去（校验失败 / 409 冲突）：别再空转轮询。 */
export function markRunFailed(message: string): void {
  seq += 1;
  tickFn = null;
  clearTimer();
  const base = snapshot ?? {
    taskId: '',
    total: 0,
    done: 0,
    success: 0,
    errorCount: 0,
    errors: [],
    levels: {},
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
  snapshot = {
    ...base,
    phase: 'failed',
    errors: [{ sectionId: '', message }],
    errorCount: 1,
    updatedAt: Date.now(),
  };
  emit();
}

/** 关掉进度卡：连同地图上的风险着色一起收回（断面回到校验色）。 */
export function dismissRunProgress(): void {
  seq += 1;
  tickFn = null;
  clearTimer();
  snapshot = null;
  emit();
}
