/**
 * 技能中心的数据源。
 *
 * <p>后端 `/v0/bank/ai/skill/list` 同时返回本地、已同步与 Nacos 上的技能，
 * 用 `source` 区分；`approval` 只对走审批流的本地技能有意义。
 * 与结果页的 Skills 面板同源，但取数独立，页面之间不共享状态。
 */

export type SkillSource = 'local' | 'synced' | 'nacos';

export interface SkillEntry {
  name: string;
  source: SkillSource;
  version: string;
  description: string;
  approval: string;
}

export const SKILL_SOURCE_META: Record<SkillSource, { label: string; tone: 'info' | 'success' | 'warning' }> = {
  local: { label: '本地', tone: 'info' },
  synced: { label: '已同步', tone: 'success' },
  nacos: { label: 'Nacos', tone: 'warning' },
};

const APPROVAL_LABELS: Record<string, string> = {
  APPROVED: '已批准',
  PENDING: '待审批',
  REJECTED: '已驳回',
  NONE: '无需审批',
};

export function approvalLabelOf(approval: string): string | null {
  return APPROVAL_LABELS[approval] || null;
}

function sourceOf(value: unknown): SkillSource {
  return value === 'local' || value === 'synced' || value === 'nacos' ? value : 'nacos';
}

/** 与报告列表同样做形状兜底：`skills` 不是数组时返回空表，绝不让页面白屏。 */
export function normalizeSkills(payload: unknown): SkillEntry[] {
  const list = (payload as { skills?: unknown } | null)?.skills;
  if (!Array.isArray(list)) return [];
  return list
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof (item as { name?: unknown }).name === 'string' && Boolean((item as { name: string }).name))
    .map((item) => ({
      name: String(item.name),
      source: sourceOf(item.source),
      version: typeof item.version === 'string' ? item.version : '',
      description: typeof item.description === 'string' ? item.description : '',
      approval: typeof item.approval === 'string' ? item.approval : '',
    }));
}

export async function fetchSkillCatalog(signal?: AbortSignal): Promise<SkillEntry[]> {
  const res = await fetch('/v0/bank/ai/skill/list', { signal });
  if (!res.ok) throw new Error(`技能列表加载失败（HTTP ${res.status}）`);
  const data = await res.json();
  if (!data || data.success === false) throw new Error(data?.error || '技能列表加载失败');
  return normalizeSkills(data);
}

/** 本地技能上传到共享仓库（提交审批后生效）。 */
export async function uploadSkill(name: string): Promise<void> {
  const res = await fetch(`/v0/bank/ai/skill/upload/${encodeURIComponent(name)}`, { method: 'POST' });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) throw new Error(data?.error || '上传失败');
}

/** 把 Nacos 上的技能拉到本地。 */
export async function downloadSkill(name: string): Promise<void> {
  const res = await fetch(`/v0/bank/ai/skill/download/${encodeURIComponent(name)}`, { method: 'POST' });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) throw new Error(data?.error || '下载失败');
}
