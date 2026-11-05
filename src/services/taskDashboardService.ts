export interface DashboardTask {
  id: number;
  task_id: string;
  task_name: string;
  bank_ids: string[];
  description: string;
  created_at: string;
  status?: string;
  run_started_at?: string | null;
  run_completed_at?: string | null;
  error_message?: string | null;
}

export type DashboardStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export function dashboardStatusOf(status?: string): DashboardStatus {
  const value = String(status || 'pending').trim().toLowerCase();
  if (['running', 'processing', 'calculating'].includes(value)) return 'running';
  if (['completed', 'complete', 'success', 'finished'].includes(value)) return 'completed';
  if (['failed', 'error'].includes(value)) return 'failed';
  if (['cancelled', 'canceled', 'stale'].includes(value)) return 'cancelled';
  return 'pending';
}

export const DASHBOARD_STATUS_META: Record<DashboardStatus, { label: string; tone: string }> = {
  pending: { label: '待计算', tone: 'neutral' },
  running: { label: '计算中', tone: 'warning' },
  completed: { label: '已完成', tone: 'success' },
  failed: { label: '计算失败', tone: 'danger' },
  cancelled: { label: '已取消', tone: 'neutral' },
};

export function sortDashboardTasks(tasks: DashboardTask[]): DashboardTask[] {
  return [...tasks].sort((a, b) => {
    const aTime = Date.parse(a.run_started_at || a.created_at || '') || 0;
    const bTime = Date.parse(b.run_started_at || b.created_at || '') || 0;
    return bTime - aTime;
  });
}

export async function fetchDashboardTasks(signal?: AbortSignal): Promise<DashboardTask[]> {
  const response = await fetch('/v0/bank/tasks', { signal });
  if (!response.ok) throw new Error(`任务列表加载失败（${response.status}）`);
  const data = await response.json();
  if (!data?.success || !Array.isArray(data.tasks)) throw new Error('任务列表返回格式不正确');
  return sortDashboardTasks(data.tasks);
}
