import type { SectionParams } from '../../types/sections';
import { getAccessToken } from '../../auth/tokenManager';

export interface BasicParamListItem {
  id?: number;
  param_id?: string;
  param_name?: string;
  [key: string]: any;
}

function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchBasicParamsList(): Promise<BasicParamListItem[]> {
  const res = await fetch('/v0/bank/basic-params', {
    headers: { ...authHeaders() },
  });
  if (!res.ok) {
    throw new Error(`获取基础参数模板列表失败: ${res.statusText}`);
  }
  const data = await res.json();
  return (data?.params || []) as BasicParamListItem[];
}

export function mapBasicParamToSectionParams(param: any): SectionParams {
  return {
    param_name: param.param_name,
    segment: param.segment,
    current_timepoint: param.current_timepoint,
    set_name: param.set_name,
    water_qs: param.water_qs,
    tidal_level: param.tidal_level,
    bench_id: param.bench_id,
    ref_id: param.ref_id,
    hs: param.hs,
    hc: param.hc,
    protection_level: param.protection_level,
    control_level: param.control_level,
    comparison_timepoint: param.comparison_timepoint,
    risk_thresholds: param.risk_thresholds,
    weights: param.weights,
    other_params: param.other_params,
  };
}

export async function fetchBasicParamDetailAsSectionParams(paramId: string): Promise<{
  numericId: number | null;
  sectionParams: SectionParams;
}> {
  const res = await fetch(`/v0/bank/basic-params/${encodeURIComponent(paramId)}`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) {
    throw new Error(`获取模板详情失败: ${res.status}`);
  }
  const data = await res.json();
  if (!data?.param) {
    throw new Error('模板详情数据格式错误');
  }

  return {
    numericId: (data.param.id ?? null) as number | null,
    sectionParams: mapBasicParamToSectionParams(data.param),
  };
}

export async function updateBasicParamAsSectionParams(
  paramId: string,
  sectionParams: SectionParams,
): Promise<void> {
  const res = await fetch(`/v0/bank/basic-params/${encodeURIComponent(paramId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(sectionParams),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`更新模板失败: ${res.status} ${res.statusText}${errorText ? ` - ${errorText}` : ''}`);
  }
}

/**
 * 取「某个任务自己的参数集」。
 *
 * 任务参数是 basic_params 里的独立行（task_id 非空），不是对模板库的引用：
 * 改模板库不影响它，改它也不影响任何别的任务。后端在没有时会按
 * 模板（可选）→ 本任务断面快照 → 默认模板 的顺序物化一份。
 */
export async function fetchTaskParamsAsSectionParams(
  taskId: string,
  templateParamId?: string | null,
): Promise<{
  numericId: number | null;
  paramId: string | null;
  sectionParams: SectionParams;
  source?: string;
}> {
  const qs = templateParamId ? `?template_param_id=${encodeURIComponent(templateParamId)}` : '';
  const res = await fetch(`/v0/bank/tasks/${encodeURIComponent(taskId)}/params${qs}`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) {
    throw new Error(`获取任务参数失败: ${res.status}`);
  }
  const data = await res.json();
  if (!data?.param) {
    throw new Error('任务参数数据格式错误');
  }
  return {
    numericId: (data.param.id ?? null) as number | null,
    paramId: (data.param.param_id ?? null) as string | null,
    sectionParams: mapBasicParamToSectionParams(data.param),
    source: data.source as string | undefined,
  };
}

/**
 * 保存「本任务」的参数集。
 *
 * 只影响这一个任务：后端写本任务的参数行 + 同步本任务的断面快照，
 * 不提供任何按模板 / 按岸段跨任务下发的入口。
 */
export async function updateTaskParams(
  taskId: string,
  sectionParams: SectionParams,
): Promise<{ updated_sections: number; total_sections: number }> {
  const res = await fetch(`/v0/bank/tasks/${encodeURIComponent(taskId)}/params`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(sectionParams),
  });
  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`保存任务参数失败: ${res.status} ${res.statusText}${errorText ? ` - ${errorText}` : ''}`);
  }
  const data = await res.json();
  return {
    updated_sections: Number(data?.updated_sections ?? 0),
    total_sections: Number(data?.total_sections ?? 0),
  };
}

/** 显式从模板库拷一份进本任务（复制后无关联）。 */
export async function importTaskParamsFromTemplate(
  taskId: string,
  templateParamId: string,
): Promise<{ updated_sections: number; total_sections: number }> {
  const res = await fetch(
    `/v0/bank/tasks/${encodeURIComponent(taskId)}/params/from-template?template_param_id=${encodeURIComponent(templateParamId)}`,
    { method: 'POST', headers: { ...authHeaders() } },
  );
  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`导入模板失败: ${res.status} ${res.statusText}${errorText ? ` - ${errorText}` : ''}`);
  }
  const data = await res.json();
  return {
    updated_sections: Number(data?.updated_sections ?? 0),
    total_sections: Number(data?.total_sections ?? 0),
  };
}

