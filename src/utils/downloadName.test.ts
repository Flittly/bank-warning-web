import { describe, expect, it } from 'vitest';
import {
  resolveExportName,
  sectionCsvCount,
  partitionCsvInfoFromReport,
} from './downloadName';

/**
 * 报告导出的下载命名契约。
 *
 * 分幅报告导出的是「报告.docx + N 个分区断面详情 CSV」的压缩包，
 * 不分幅仍是 docx —— 二者由服务端 Content-Disposition 区分，
 * 前端不能写死扩展名，否则分幅导出会得到一个后缀是 .docx 的 zip。
 */
describe('resolveExportName', () => {
  it('优先取 RFC 5987 的 UTF-8 文件名（压缩包名带中文）', () => {
    const header =
      "attachment; filename=\"report_t1_20261015_143000___ .zip\"; " +
      "filename*=UTF-8''report_t1_20261015_143000_%E5%AF%BC%E5%87%BA%E5%8C%85.zip";
    expect(resolveExportName(header, 'report_t1_20261015_143000.md'))
      .toBe('report_t1_20261015_143000_导出包.zip');
  });

  it('没有 UTF-8 名时退回 ASCII 回退名', () => {
    const header = 'attachment; filename="report_t1_20261015_143000.docx"';
    expect(resolveExportName(header, 'report_t1_20261015_143000.md'))
      .toBe('report_t1_20261015_143000.docx');
  });

  it('编码损坏时不抛异常，退回 ASCII 名', () => {
    const header = "attachment; filename=\"fallback.docx\"; filename*=UTF-8''%E4%B8%";
    expect(resolveExportName(header, 'report_t1_20261015_143000.md')).toBe('fallback.docx');
  });

  it('拿不到响应头时退回本地拼接的 docx 名（历史行为）', () => {
    expect(resolveExportName(null, 'report_t1_20261015_143000.md'))
      .toBe('report_t1_20261015_143000.docx');
    expect(resolveExportName('', 'report_t1_20261015_143000.md'))
      .toBe('report_t1_20261015_143000.docx');
  });
});

describe('sectionCsvCount', () => {
  it('解析分区 CSV 个数', () => {
    expect(sectionCsvCount('5')).toBe(5);
  });

  it('缺失 / 非法 / 非正数一律按 0 处理', () => {
    expect(sectionCsvCount(null)).toBe(0);
    expect(sectionCsvCount('')).toBe(0);
    expect(sectionCsvCount('abc')).toBe(0);
    expect(sectionCsvCount('0')).toBe(0);
    expect(sectionCsvCount('-3')).toBe(0);
  });
});

/**
 * 报告附录里的分区断面详情 CSV 清单。
 *
 * 这是「5 个分区 + 1 个未落入分区」的真实附录文本（取自
 * report_task-1792030029572_20261015_151604.md），两个口径必须分开：
 * 正文说「划分为 5 个分区」，而压缩包里其实有 6 个 CSV。
 */
describe('partitionCsvInfoFromReport', () => {
  const REAL_APPENDIX = [
    '## 附录：分区断面详情（CSV）',
    '',
    '本次报告按经纬度划分为 5 个分区，各分区的断面详情在导出报告时随报告一并输出为独立的 CSV 文件：',
    '',
    '| 分区 | 分区位置 | 断面数 | CSV 文件 |',
    '| --- | --- | --- | --- |',
    '| 分区 1 | 第 1 行第 1 列（经度 118.4782~119.1335，纬度 31.7000~32.3000） | 38 | `分区1_断面详情.csv` |',
    '| 分区 2 | 第 1 行第 2 列（经度 119.0416~119.7423，纬度 32.1000~32.4000） | 33 | `分区2_断面详情.csv` |',
    '| 分区 3 | 第 1 行第 3 列（经度 119.6283~120.3063，纬度 31.8000~32.4000） | 42 | `分区3_断面详情.csv` |',
    '| 分区 4 | 第 1 行第 4 列（经度 120.2393~121.0571，纬度 31.6000~32.2000） | 54 | `分区4_断面详情.csv` |',
    '| 分区 5 | 第 1 行第 5 列（经度 120.9370~121.9599，纬度 31.4000~32.0000） | 67 | `分区5_断面详情.csv` |',
    '| 未落入分区 | 坐标缺失或落在自定义边界之外 | 1 | `未落入分区_断面详情.csv` |',
    '',
    '> 分区边界与「风险分布图」的分幅边界完全相同（同一组经纬度范围）…',
  ].join('\n');

  it('真实附录：5 个分区、6 个 CSV（含未落入分区）', () => {
    expect(partitionCsvInfoFromReport(REAL_APPENDIX)).toEqual({ partitions: 5, files: 6 });
  });

  it('不分幅的报告（无附录）返回全 0，导出行为与历史一致', () => {
    expect(partitionCsvInfoFromReport('# 报告\n\n正文…')).toEqual({ partitions: 0, files: 0 });
    expect(partitionCsvInfoFromReport('')).toEqual({ partitions: 0, files: 0 });
    expect(partitionCsvInfoFromReport(null)).toEqual({ partitions: 0, files: 0 });
    expect(partitionCsvInfoFromReport(undefined)).toEqual({ partitions: 0, files: 0 });
  });

  it('正文里顺带提到的文件名不算数，只认表格行', () => {
    const text = '这里随便提一句 分区9_断面详情.csv 不该被计数。\n\n' +
      '| 分区 1 | 位置 | 1 | `分区1_断面详情.csv` |\n';
    expect(partitionCsvInfoFromReport(text)).toEqual({ partitions: 1, files: 1 });
  });

  it('表格里的其他文件名（非断面详情）不计数', () => {
    const text = '| 分区 1 | 位置 | 1 | `分区1_断面详情.csv` |\n' +
      '| 汇总 | 全部 | 99 | `全断面汇总.xlsx` |\n';
    expect(partitionCsvInfoFromReport(text)).toEqual({ partitions: 1, files: 1 });
  });
});
