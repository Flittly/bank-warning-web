/**
 * 「任务运行进度」的判定内核（纯函数，不碰网络/DOM）。
 *
 * <p>为什么不复用结果页那套 `updateProgressAndMap`：那边每一轮都要顺带重绘地图
 * （断面着色 + 岸段插值），和 `mapRef` / 结果缓存深度耦合。编辑器这边只需要
 * "算到第几条了"，把它抄过来会把地图渲染链一起搬进侧栏。这里只保留判定部分，
 * 请求由 `hooks/useTaskRunProgress` 负责。
 *
 * <p>口径与结果页保持一致，否则同一次运行在两处会显示不同的完成度：
 * <ul>
 *   <li><b>成功</b> = 该断面最新一条结果的 `risk_level` 落在 1..4（换算后 0..3）；</li>
 *   <li><b>失败</b> = 有 error message 或 status 不是 SUCCESS/COMPLETED/200，且没有有效风险等级；</li>
 *   <li><b>完成</b> = 后端状态已是终态（completed / partial_failed / cancelled …）；
 *       没拿到状态字段时才用 `run_completed_at` 兜底。</li>
 * </ul>
 */
import { toDisplayLevel } from '../../utils/riskScoring';

export type RunPhase = 'running' | 'completed' | 'cancelled' | 'failed';

export interface RunErrorRow {
  sectionId: string;
  sectionName?: string;
  message: string;
}

export interface SectionBrief {
  section_id: string;
  section_name?: string;
}

export interface TaskRunSnapshot {
  taskId: string;
  taskName?: string;
  phase: RunPhase;
  /** 后端原始状态字符串，展示用（`running` / `cancelled` …） */
  status?: string;
  total: number;
  done: number;
  success: number;
  errorCount: number;
  errors: RunErrorRow[];
  /**
   * 已经算出结果的断面 → 显示等级 0..3（绿/蓝/橙/红）。
   *
   * 编辑器地图靠它「一段一段上色」：轮询每拿到一条结果就往这里加一条，
   * 页面把整份映射塞给地图，算到哪儿就红到哪儿。键是 `section_id`。
   */
  levels: Record<string, number>;
  /** 本轮开始时间戳（本地时钟，只用于算「用时」） */
  startedAt: number;
  updatedAt: number;
}

const OK_STATUS = new Set(['SUCCESS', 'COMPLETED', 'DONE', 'OK', '200']);

/**
 * 结果行 → 显示等级 0..3。
 *
 * 库里的 `risk_level` 是 **1..4**（`/v0/bank/results?task_id=` 原样透传），而地图配色、
 * `RISK_COLORS`、图例用的都是 **0..3**。早期这里按 0..3 判「有结果」，于是 `risk_level=4`
 * （高风险）的断面会被当成「没算出等级」——进度卡把它算进失败、地图也不上色。
 * 换算只认 `toDisplayLevel`（唯一口径），空值/非法值一律 null。
 */
export function riskDisplayLevel(value: unknown): 0 | 1 | 2 | 3 | null {
  return toDisplayLevel(value);
}

/** 这条结果是否给出了有效风险等级（1..4 都算）。 */
export function isValidRiskLevel(value: unknown): boolean {
  return riskDisplayLevel(value) !== null;
}

/** 后端任务状态 → 界面阶段。空值当 `running`：刚提交时字段常还没写。 */
export function normalizeRunPhase(raw: unknown): RunPhase {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return 'running';
  if (s === 'cancelled' || s === 'canceled' || s === 'terminated' || s === 'stopped') return 'cancelled';
  if (s === 'failed' || s === 'error' || s === 'failure') return 'failed';
  if (s === 'completed' || s === 'success' || s === 'done' || s === 'finished') return 'completed';
  return 'running';
}

/**
 * 同一断面可能有多条历史结果（重算会追加/软删），只认**最后一条**。
 * 与结果页 `latestBySection` 一致：按数组顺序取后出现的。
 */
function latestBySection(results: any[]): Map<string, any> {
  const map = new Map<string, any>();
  (Array.isArray(results) ? results : []).forEach((r) => {
    const id = r?.section_id ?? r?.sectionId ?? r?.sectionID;
    if (!id) return;
    map.set(String(id), r);
  });
  return map;
}

export function summarizeRun(params: {
  taskId: string;
  taskName?: string;
  sections: SectionBrief[];
  results: any[];
  taskStatus?: unknown;
  runCompletedAt?: unknown;
  startedAt: number;
  now?: number;
}): TaskRunSnapshot {
  const {
    taskId,
    taskName,
    sections,
    results,
    taskStatus,
    runCompletedAt,
    startedAt,
    now = Date.now(),
  } = params;

  const total = Array.isArray(sections) ? sections.length : 0;
  const bySection = latestBySection(results);

  let success = 0;
  const levels: Record<string, number> = {};
  const errors: RunErrorRow[] = [];
  const nameOf = new Map<string, string | undefined>();
  (sections || []).forEach((s) => nameOf.set(String(s.section_id), s.section_name));

  bySection.forEach((row, sectionId) => {
    const level = riskDisplayLevel(row?.risk_level ?? row?.riskLevel);
    if (level !== null) {
      success += 1;
      levels[sectionId] = level;
      return;
    }
    const message = String(row?.error_message ?? row?.errorMessage ?? row?.message ?? '').trim();
    const status = String(row?.status ?? row?.state ?? '').trim().toUpperCase();
    const looksFailed = message.length > 0 || (status.length > 0 && !OK_STATUS.has(status));
    // 没结果的行也占一个位置：不算失败，等任务收尾时按「未运行」补进 errors。
    if (looksFailed) {
      errors.push({ sectionId, sectionName: nameOf.get(sectionId), message: message || status });
    }
  });

  // `run_completed_at` 只当**没有状态字段**时的兜底：重跑一个已完成任务时，后端在
  // `clearTaskResults → markTaskRunning` 之间有一个极短的窗口，「status 还是上次的
  // completed、run_completed_at 还挂着」—— 拿它当终态会让界面在开跑的那一秒就宣布算完。
  const rawStatus = String(taskStatus ?? '').trim().toLowerCase();
  let phase = normalizeRunPhase(taskStatus);
  if (phase === 'running' && !rawStatus && runCompletedAt) phase = 'completed';

  // 收尾时把「压根没回来结果」的断面补成失败/未运行：
  // 否则界面会出现「已完成 18/20」却没有一条报错，用户不知道差的 2 条去哪了。
  if (phase !== 'running' && total > 0) {
    (sections || []).forEach((s) => {
      const id = String(s.section_id);
      if (errors.some((e) => e.sectionId === id)) return;
      const row = bySection.get(id);
      if (row && isValidRiskLevel(row?.risk_level ?? row?.riskLevel)) return;
      if (row) return; // 行在但既非成功也非失败（例如 status=not_computed）：不重复报
      errors.push({
        sectionId: id,
        sectionName: s.section_name,
        message: phase === 'cancelled' ? '任务已终止，该断面未运行' : '未返回结果（可能计算失败）',
      });
    });
  }

  const done = total > 0 ? Math.min(total, success + errors.length) : success + errors.length;
  // 这里**故意不**用「已处理数 == 断面总数」直接判完成：数量到顶只说明"结果都回来了"，
  // 后端的终态（completed / partial_failed / cancelled）可能还差一会儿才写。
  // 提前收尾会让卡片停在"计算完成"、轮询也跟着停，看起来就像任务被掐断在最后一秒。
  return {
    taskId,
    taskName,
    phase,
    status: taskStatus == null ? undefined : String(taskStatus),
    total,
    done,
    success,
    errorCount: errors.length,
    errors,
    levels,
    startedAt,
    updatedAt: now,
  };
}

/** 用时：`02:14` / `1:03:20`。负数与非法值一律给 `00:00`，不显示 NaN。 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** 0..100；总数为 0 时给 `null`（进度条走不确定态，而不是假装 0%）。 */
export function percentOf(done: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  const pct = Math.round((Math.max(0, done) / total) * 100);
  return Math.min(100, Math.max(0, pct));
}
