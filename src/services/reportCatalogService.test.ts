import { describe, expect, it } from 'vitest';
import {
  normalizeReportContent,
  normalizeReports,
  reportKindOf,
  taskIdFromFilename,
} from './reportCatalogService';

describe('reportCatalogService', () => {
  it('从文件名反解任务号与类型', () => {
    expect(taskIdFromFilename('report_task-abc_20261028_173500.md')).toBe('task-abc');
    expect(taskIdFromFilename('viz_task-abc_20261029_092000.md')).toBe('task-abc');
    expect(reportKindOf('viz_task-abc_20261029_092000.md')).toBe('viz');
    expect(reportKindOf('report_task-abc_20261028_173500.md')).toBe('report');
  });

  it('reports 不是数组时返回空表而不是抛错（避免整页白屏）', () => {
    expect(normalizeReports(null)).toEqual([]);
    expect(normalizeReports({ success: true })).toEqual([]);
    expect(normalizeReports({ reports: 'oops' })).toEqual([]);
  });

  it('缺失字段时用文件名兜底，kind 只在显式 viz 时为出图', () => {
    const list = normalizeReports({
      success: true,
      reports: [
        { filename: 'report_task-1_20260101_120000.md' },
        { filename: 'viz_task-2_20260102_120000.md', taskId: 'task-2', kind: 'viz', time: '2026-01-02 12:00' },
        { filename: '' },
        null,
      ],
    });
    expect(list).toEqual([
      { filename: 'report_task-1_20260101_120000.md', taskId: 'task-1', kind: 'report', time: '' },
      { filename: 'viz_task-2_20260102_120000.md', taskId: 'task-2', kind: 'viz', time: '2026-01-02 12:00' },
    ]);
  });

  it('正文里的相对图片路径换成静态输出地址', () => {
    expect(normalizeReportContent('![图层](./tile_0_0.png)')).toBe('![图层](/v0/bank/ai/viz-output/tile_0_0.png)');
    expect(normalizeReportContent('![](https://cdn/x.png)')).toBe('![](https://cdn/x.png)');
  });
});
