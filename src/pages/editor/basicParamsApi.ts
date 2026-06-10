import type { SectionParams } from '../../types/sections';

export interface BasicParamListItem {
  id?: number;
  param_id?: string;
  param_name?: string;
  [key: string]: any;
}

export async function fetchBasicParamsList(): Promise<BasicParamListItem[]> {
  const res = await fetch('/v0/bank/basic-params');
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
  const res = await fetch(`/v0/bank/basic-params/${encodeURIComponent(paramId)}`);
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sectionParams),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`更新模板失败: ${res.status} ${res.statusText}${errorText ? ` - ${errorText}` : ''}`);
  }
}
