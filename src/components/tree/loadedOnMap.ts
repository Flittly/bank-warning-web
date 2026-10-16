/**
 * 「已加载到屏幕」面板的数据口径 —— 全部是纯函数，便于单测。
 *
 * <p>这个面板回答的是**地图上现在画着什么**，与资源树的「库里有什么」是两件不同的事：
 * <ul>
 *   <li>资源树读后端清单（banks / sections / tiffs / tasks），是"资产台账"；</li>
 *   <li>本面板读地图当前真实绘制的三样东西（岸段线、断面线、DEM 范围框），是"屏幕现状"。</li>
 * </ul>
 *
 * ⚠ 口径必须与 EditorMap 的图层一致，否则面板会与地图自相矛盾：
 * 地图的岸段层过滤 `$type == LineString`（`uploaded-lines` / `uploaded-lines-hit-target`），
 * 上传时也只把 LineString 转成岸段 —— 所以这里同样只认 LineString。
 */

export interface LoadedRow {
  id: string;
  label: string;
  /** 次要信息（岸段 ID / 所属岸段等），为空则不渲染 */
  meta?: string;
  /** 属于当前选中的任务（任务切换后重新打标） */
  currentTask?: boolean;
  /** 所在图层当前被隐藏（例如断面总开关关掉了）：资源仍在图上，只是没画出来 */
  dimmed?: boolean;
}

export interface LoadedGroup {
  key: 'banks' | 'sections' | 'dems';
  title: string;
  /** 该组为空时的提示文案（告诉用户怎么把它填上） */
  hint: string;
  rows: LoadedRow[];
}

export interface RunningTaskRow {
  taskId: string;
  taskName: string;
  /** 原始开始时间字段；解析失败为 null */
  startedAt: string | null;
}

/** 后端 `tasks.status` 里表示"正在跑"的字面量（见 TaskMapper.xml 的 markRunning）。 */
const STATUS_RUNNING = 'running';

export function isRunningStatus(status: unknown): boolean {
  return String(status ?? '').trim().toLowerCase() === STATUS_RUNNING;
}

/**
 * 从任务清单里挑出正在运行的任务。
 *
 * <p>任务状态由后端写库（开始跑就是 running、跑完变 completed / partial_failed / error），
 * 前端不自己维护"运行中"布尔量，避免页面刷新后状态对不上。
 */
export function pickRunningTasks(tasks: any[] | null | undefined): RunningTaskRow[] {
  const out: RunningTaskRow[] = [];
  for (const t of tasks || []) {
    if (!isRunningStatus(t?.status)) continue;
    const taskId = String(t?.task_id ?? t?.id ?? '');
    if (!taskId) continue;
    out.push({
      taskId,
      taskName: String(t?.task_name ?? t?.taskName ?? '') || taskId,
      startedAt: (t?.run_started_at ?? t?.runStartedAt ?? null) as string | null,
    });
  }
  return out;
}

/**
 * 解析后端返回的时间。
 *
 * <p>后端同一字段可能是 ISO 串、`2026-10-15 17:01:40` 这种无时区串、或秒/毫秒时间戳。
 * 无时区串交给 `Date.parse` 在各浏览器上行为不一致，所以先补成 `T` 分隔的 ISO 形式。
 */
export function parseServerTime(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    // 10 位当秒、13 位当毫秒（1e12 是 2001 年，业务时间不可能更小）
    return value > 1e12 ? value : value * 1000;
  }
  const s = String(value).trim();
  if (!s) return null;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s) ? s.replace(' ', 'T') : s;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** 把"已运行时长"变成人话。拿不到起点（null）或时长为负时返回空串，由调用方决定不渲染。 */
export function formatElapsed(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '';
  const sec = Math.floor(ms / 1000);
  if (sec < 5) return '刚刚开始';
  if (sec < 60) return `已运行 ${sec} 秒`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `已运行 ${min} 分 ${sec % 60} 秒`;
  const hour = Math.floor(min / 60);
  return `已运行 ${hour} 小时 ${min % 60} 分`;
}

export interface BuildLoadedGroupsInput {
  /** 地图上的岸段线（useEditorStore.uploadedData） */
  uploadedData?: GeoJSON.FeatureCollection | null;
  /** 地图上的断面线（useEditorStore.perpendicularData） */
  perpendicularData?: GeoJSON.FeatureCollection | null;
  /** 断面图层总开关：关闭时断面仍在图上但不绘制 */
  showCrossLines?: boolean;
  /** 当前实际画在地图上的 DEM 范围（已解析出显示名） */
  demItems?: Array<{ key: string; label: string }> | null;
  currentTaskId?: string | null;
  /** 已加载的任务断面清单（懒加载，只有当前任务一定会被拉取） */
  sectionsByTask?: Record<string, any[]> | null;
}

function sectionIdOf(f: any): string {
  return String(f?.properties?.sectionId ?? f?.properties?.section_id ?? '');
}

export function buildLoadedGroups(input: BuildLoadedGroupsInput): LoadedGroup[] {
  // —— 岸段：只认 LineString，与地图图层过滤条件保持一致 ——
  const bankRows: LoadedRow[] = [];
  const seenBanks = new Set<string>();
  for (const [i, f] of (input.uploadedData?.features || []).entries()) {
    if ((f as any)?.geometry?.type !== 'LineString') continue;
    const p: any = (f as any)?.properties || {};
    const name = String(p.bank_name ?? p.bankName ?? '').trim();
    const rawId = String(p.bank_id ?? p.bankId ?? '').trim();
    // 未入库的岸线只有 `line-N` 这种占位 id，拿它当标签没有意义
    const key = rawId || `line-${i}`;
    if (seenBanks.has(key)) continue;
    seenBanks.add(key);
    bankRows.push({
      id: key,
      label: name || rawId || `岸线 ${i + 1}`,
      // 有名字才值得把 bank_id 作为次要信息；没名字时标签本身就是 id，改用区域代码
      meta: name ? key : (p.region_code ? String(p.region_code) : undefined),
    });
  }

  // —— 断面：与地图的断面图层一致；关闭总开关时仍然列出，但标记为"未绘制" ——
  const runningTaskIds = new Set(
    ((input.sectionsByTask?.[String(input.currentTaskId ?? '')] || []) as any[])
      .map((s) => String(s?.section_id ?? s?.id ?? ''))
      .filter(Boolean),
  );
  const sectionRows: LoadedRow[] = [];
  const seenSections = new Set<string>();
  const hidden = input.showCrossLines === false;
  for (const [i, f] of (input.perpendicularData?.features || []).entries()) {
    const id = sectionIdOf(f);
    if (!id || seenSections.has(id)) continue;
    seenSections.add(id);
    const p: any = (f as any)?.properties || {};
    const seq = p.crossLineId ?? p.index ?? i;
    const label = String(p.section_name ?? '') || (Number.isFinite(Number(seq)) ? `断面 ${Number(seq) + 1}` : `#${id}`);
    sectionRows.push({
      id,
      label,
      meta: p.bank_id ? String(p.bank_id) : undefined,
      currentTask: runningTaskIds.has(id),
      dimmed: hidden,
    });
  }

  const demRows: LoadedRow[] = (input.demItems || []).map((d) => ({
    id: d.key,
    label: d.label,
    meta: '范围框',
  }));

  return [
    {
      key: 'banks',
      title: '岸段',
      hint: '地图上没有岸段：在资源树里双击岸段，或右键选「加载到地图」。',
      rows: bankRows,
    },
    {
      key: 'sections',
      title: '断面',
      hint: '地图上没有断面：在「断面」文件夹右键选「全部加载到地图」。',
      rows: sectionRows,
    },
    {
      key: 'dems',
      title: 'DEM 范围',
      hint: '地图上未显示 DEM 范围：在资源树里点 DEM 的「显示范围」或它的范围图标。',
      rows: demRows,
    },
  ];
}

// ——————————————————————————————————————————————————————————————
// 分组视图：折叠 / 每组渲染上限
// ——————————————————————————————————————————————————————————————

/**
 * 每组默认最多渲染多少行。
 * 岸段动辄上百条，一次性铺满 DOM 会让这个只有三四百像素宽的面板滚动发涩；
 * 超出部分由用户点「显示全部」显式展开。
 */
export const DEFAULT_ROW_LIMIT = 60;

export interface LoadedViewOptions {
  /** 被用户折叠的组 */
  collapsed?: string[] | Set<string>;
  /** 每组渲染上限；<=0 表示不限制 */
  limit?: number;
  /** 这些组不受 `limit` 限制（用户对该组点了「显示全部」） */
  expandKeys?: string[] | Set<string>;
}

export interface DisplayGroup {
  key: LoadedGroup['key'];
  title: string;
  hint: string;
  /** 该组的条数 */
  total: number;
  /** 本次要渲染的行（已按 limit 截断） */
  rows: LoadedRow[];
  /** 被 limit 截掉、尚未渲染的条数 */
  hiddenByLimit: number;
  /** 是否按折叠态渲染（组标题仍照常显示计数） */
  collapsed: boolean;
  /**
   * 空态：`no-data` = 地图上确实没有这类资源 → 展示 `hint` 指路；`null` = 有内容要渲染。
   */
  emptyKind: 'no-data' | null;
}

export interface LoadedView {
  /** 需要渲染的组，顺序与传入一致（岸段 / 断面 / DEM 范围） */
  groups: DisplayGroup[];
  /** 三组条数之和 */
  total: number;
}

/** 把 `buildLoadedGroups` 的原始结果加工成"可直接渲染"的视图。 */
export function buildLoadedView(groups: LoadedGroup[], options: LoadedViewOptions = {}): LoadedView {
  const limit = options.limit ?? DEFAULT_ROW_LIMIT;
  const collapsedSet =
    options.collapsed instanceof Set ? options.collapsed : new Set(options.collapsed || []);
  const expandSet =
    options.expandKeys instanceof Set ? options.expandKeys : new Set(options.expandKeys || []);

  let total = 0;
  const display: DisplayGroup[] = [];
  for (const g of groups) {
    const n = g.rows.length;
    total += n;

    const cap = expandSet.has(g.key) ? 0 : limit;
    const rows = cap > 0 ? g.rows.slice(0, cap) : g.rows;

    display.push({
      key: g.key,
      title: g.title,
      hint: g.hint,
      total: n,
      rows,
      hiddenByLimit: n - rows.length,
      collapsed: collapsedSet.has(g.key),
      emptyKind: n === 0 ? 'no-data' : null,
    });
  }

  return { groups: display, total };
}

