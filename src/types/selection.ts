import type { SectionParams } from './sections';

export interface SelectionGroup {
  id: string;
  line: GeoJSON.Feature<GeoJSON.LineString>;
  lineIndex: number | undefined; // 线在上传数据中的索引，用于判断是否同一条线
  start: number;
  end: number | null;
  interval: number;
  // 上一次实际应用到垂线上的间距，用于判断用户是否修改了间距
  lastAppliedInterval: number;
  length: number;
  crossData: { distance: number; left: number[]; right: number[] }[];
  // 该组的属性配置（如果未设置则使用全局配置）
  properties?: SectionParams;
}
