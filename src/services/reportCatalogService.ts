/**
 * 报告中心的数据源。
 *
 * <p>与结果页里「报告查看」面板调的是同一组后端接口（`/v0/bank/ai/reports`），
 * 但这里是**独立页面自己的取数**：不读结果页的 state、不依赖当前选中任务，
 * 因此从首页进报告中心不会顺带把编辑器/结果页的上下文拉起来。
 */

export interface ReportEntry {
  /** 磁盘文件名，形如 `report_<taskId>_<yyyyMMdd>_<HHmmss>.md` 或 `viz_<taskId>_...md` */
  filename: string;
  /** 由文件名反解出的任务号（后端没给时用文件名兜底） */
  taskId: string;
  kind: 'report' | 'viz';
  time: string;
}

/** 文件名里 `report_` / `viz_` 是唯一能区分「AI 报告」与「AI 出图」的标记。 */
export function reportKindOf(filename: string): 'report' | 'viz' {
  return filename.startsWith('viz_') ? 'viz' : 'report';
}

/** `report_task-abc_20260101_120000.md` → `task-abc`。反解失败时回退整串文件名。 */
export function taskIdFromFilename(filename: string): string {
  const stripped = filename.replace(/^(report|viz)_/, '').replace(/_\d{8}_\d{6}\.md$/, '');
  return stripped || filename;
}

/**
 * 后端返回体归一化。
 *
 * <p>⚠ 一定不能直接 `data.reports.map(...)`：接口异常或返回占位模板时 `reports` 不是数组，
 * 一次 `.map` 就会把整页打成白屏（结果页的 ChatPanel 就踩过这个坑）。
 */
export function normalizeReports(payload: unknown): ReportEntry[] {
  const list = (payload as { reports?: unknown } | null)?.reports;
  if (!Array.isArray(list)) return [];
  return list
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof (item as { filename?: unknown }).filename === 'string' && Boolean((item as { filename: string }).filename))
    .map((item) => {
      const filename = String(item.filename);
      const rawKind = typeof item.kind === 'string' ? item.kind : '';
      return {
        filename,
        taskId: typeof item.taskId === 'string' && item.taskId ? item.taskId : taskIdFromFilename(filename),
        kind: rawKind === 'viz' ? 'viz' : reportKindOf(filename),
        time: typeof item.time === 'string' ? item.time : '',
      };
    });
}

/**
 * 报告正文里的相对图片路径换成可视化输出的静态地址，否则 markdown 里的图全部 404。
 * 与结果页 `openReport` 用的是同一条规则。
 */
export function normalizeReportContent(content: string): string {
  return content.replace(/\.\/([^\s)]+\.png)/g, '/v0/bank/ai/viz-output/$1');
}

export async function fetchReportCatalog(signal?: AbortSignal): Promise<ReportEntry[]> {
  const res = await fetch('/v0/bank/ai/reports', { signal });
  if (!res.ok) throw new Error(`报告列表加载失败（HTTP ${res.status}）`);
  const data = await res.json();
  if (!data || data.success === false) throw new Error(data?.error || '报告列表加载失败');
  return normalizeReports(data);
}

export async function fetchReportContent(filename: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`/v0/bank/ai/reports/${encodeURIComponent(filename)}`, { signal });
  if (!res.ok) throw new Error(`报告内容加载失败（HTTP ${res.status}）`);
  const data = await res.json();
  if (!data?.success || typeof data.content !== 'string') throw new Error(data?.error || '报告内容为空');
  return normalizeReportContent(data.content);
}

export async function deleteReport(filename: string): Promise<void> {
  const res = await fetch(`/v0/bank/ai/reports/${encodeURIComponent(filename)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`删除失败（HTTP ${res.status}）`);
}
