import type { SectionParams } from '../../types/sections';

export async function fetchSectionParams(sectionId: string): Promise<SectionParams | null> {
  try {
    const response = await fetch(`/v0/bank/sections/${encodeURIComponent(sectionId)}`);
    if (!response.ok) {
      console.error(`获取断面参数失败: ${response.statusText}`);
      return null;
    }
    const data = await response.json();
    if (!data.success || !data.section) {
      console.error('断面数据格式错误');
      return null;
    }

    const params: SectionParams = {
      param_name: data.section.param_name,
      segment: data.section.segment,
      current_timepoint: data.section.current_timepoint,
      set_name: data.section.set_name,
      water_qs: data.section.water_qs,
      tidal_level: data.section.tidal_level,
      bench_id: data.section.bench_id,
      ref_id: data.section.ref_id,
      hs: data.section.hs,
      hc: data.section.hc,
      protection_level: data.section.protection_level,
      control_level: data.section.control_level,
      comparison_timepoint: data.section.comparison_timepoint,
      risk_thresholds: data.section.risk_thresholds,
      weights: data.section.weights,
      other_params: data.section.other_params,
    };

    return params;
  } catch (err) {
    console.error('获取断面参数出错:', err);
    return null;
  }
}

export async function updateSectionParams(
  sectionId: string,
  sectionParams: SectionParams,
): Promise<void> {
  const response = await fetch(`/v0/bank/sections/${encodeURIComponent(sectionId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sectionParams),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(
      `更新断面参数失败: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`,
    );
  }
}
