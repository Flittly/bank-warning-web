import { describe, expect, it } from 'vitest';
import { dashboardStatusOf, sortDashboardTasks, type DashboardTask } from './taskDashboardService';

const task = (taskId: string, createdAt: string, status?: string): DashboardTask => ({
  id: 1,
  task_id: taskId,
  task_name: taskId,
  bank_ids: [],
  description: '',
  created_at: createdAt,
  status,
});

describe('taskDashboardService', () => {
  it('统一后端任务状态，未知值安全回退为待计算', () => {
    expect(dashboardStatusOf('RUNNING')).toBe('running');
    expect(dashboardStatusOf('success')).toBe('completed');
    expect(dashboardStatusOf('error')).toBe('failed');
    expect(dashboardStatusOf('canceled')).toBe('cancelled');
    expect(dashboardStatusOf('unexpected')).toBe('pending');
    expect(dashboardStatusOf(undefined)).toBe('pending');
  });

  it('最近开始计算的任务优先，其次按创建时间倒序', () => {
    const sorted = sortDashboardTasks([
      task('old', '2026-01-01T00:00:00Z'),
      { ...task('running', '2026-01-02T00:00:00Z'), run_started_at: '2026-01-03T00:00:00Z' },
      task('new', '2026-01-02T12:00:00Z'),
    ]);
    expect(sorted.map((item) => item.task_id)).toEqual(['running', 'new', 'old']);
  });
});
