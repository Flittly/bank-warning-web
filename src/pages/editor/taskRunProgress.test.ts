import { describe, expect, it } from 'vitest';
import {
  formatElapsed,
  isValidRiskLevel,
  normalizeRunPhase,
  percentOf,
  riskDisplayLevel,
  summarizeRun,
} from './taskRunProgress';

const sections = [
  { section_id: 's1', section_name: '断面1' },
  { section_id: 's2', section_name: '断面2' },
  { section_id: 's3', section_name: '断面3' },
];

describe('isValidRiskLevel / riskDisplayLevel', () => {
  it('库里的 risk_level 是 1..4，四个档都算「有结果」', () => {
    [1, 2, 3, 4].forEach((v) => expect(isValidRiskLevel(v)).toBe(true));
    expect(isValidRiskLevel('4')).toBe(true);
  });

  it('0 / 负数 / 空值都不算（0 不是等级，空值更不是低风险）', () => {
    expect(isValidRiskLevel(0)).toBe(false);
    expect(isValidRiskLevel(-1)).toBe(false);
    expect(isValidRiskLevel(null)).toBe(false);
    expect(isValidRiskLevel('')).toBe(false);
    expect(isValidRiskLevel(undefined)).toBe(false);
  });

  it('1..4 换算成地图色阶 0..3（高风险 4 → 红 3）', () => {
    expect(riskDisplayLevel(1)).toBe(0);
    expect(riskDisplayLevel(2)).toBe(1);
    expect(riskDisplayLevel(3)).toBe(2);
    expect(riskDisplayLevel(4)).toBe(3);
    expect(riskDisplayLevel(0)).toBeNull();
  });
});

describe('normalizeRunPhase', () => {
  it('空状态当 running（刚提交时字段还没写）', () => {
    expect(normalizeRunPhase(undefined)).toBe('running');
    expect(normalizeRunPhase('RUNNING')).toBe('running');
  });

  it('终止/失败/完成三个终态都要认出来，且不区分大小写', () => {
    expect(normalizeRunPhase('cancelled')).toBe('cancelled');
    expect(normalizeRunPhase('Canceled')).toBe('cancelled');
    expect(normalizeRunPhase('failed')).toBe('failed');
    expect(normalizeRunPhase('COMPLETED')).toBe('completed');
    expect(normalizeRunPhase('success')).toBe('completed');
  });
});

describe('summarizeRun', () => {
  it('运行中：按有效风险等级计数，未返回的断面不算失败', () => {
    const snap = summarizeRun({
      taskId: 't1',
      sections,
      results: [{ section_id: 's1', risk_level: 2 }, { section_id: 's2', risk_level: 4 }],
      taskStatus: 'running',
      startedAt: 1000,
      now: 4000,
    });
    expect(snap.phase).toBe('running');
    expect(snap.total).toBe(3);
    expect(snap.success).toBe(2);
    expect(snap.errorCount).toBe(0);
    expect(snap.done).toBe(2);
  });

  it('把等级换算成地图色阶，供「算一条红一条」上色用', () => {
    const snap = summarizeRun({
      taskId: 't1',
      sections,
      results: [
        { section_id: 's1', risk_level: 1 },
        { section_id: 's2', risk_level: 4 },
      ],
      taskStatus: 'running',
      startedAt: 0,
    });
    // 1 → 0（绿）、4 → 3（红）；没有结果的断面**不出现在映射里**，
    // 地图据此保留校验色，而不是被涂成最低等级
    expect(snap.levels).toEqual({ s1: 0, s2: 3 });
    expect('s3' in snap.levels).toBe(false);
  });

  it('同一断面多条结果只认最后一条', () => {
    const snap = summarizeRun({
      taskId: 't1',
      sections: [sections[0]],
      results: [
        { section_id: 's1', risk_level: null, error_message: '模型超时', status: 'ERROR' },
        { section_id: 's1', risk_level: 1, status: 'SUCCESS' },
      ],
      taskStatus: 'running',
      startedAt: 0,
    });
    expect(snap.success).toBe(1);
    expect(snap.errorCount).toBe(0);
  });

  it('有错误信息且没有有效风险等级 ⇒ 记一条失败', () => {
    const snap = summarizeRun({
      taskId: 't1',
      sections,
      results: [
        { section_id: 's1', risk_level: 3 },
        { section_id: 's2', risk_level: null, error_message: 'DEM 不覆盖该断面' },
      ],
      taskStatus: 'running',
      startedAt: 0,
    });
    expect(snap.success).toBe(1);
    expect(snap.errorCount).toBe(1);
    expect(snap.errors[0]).toMatchObject({ sectionId: 's2', sectionName: '断面2' });
  });

  it('完成时把"没回来结果"的断面补成失败，避免出现 18/20 却零报错', () => {
    const snap = summarizeRun({
      taskId: 't1',
      sections,
      results: [{ section_id: 's1', risk_level: 1 }],
      taskStatus: 'completed',
      startedAt: 0,
    });
    expect(snap.phase).toBe('completed');
    expect(snap.errorCount).toBe(2);
    expect(snap.errors.map((e) => e.sectionId).sort()).toEqual(['s2', 's3']);
    expect(snap.errors[0].message).toContain('未返回结果');
  });

  it('被终止时补的那两条文案是"未运行"而不是"计算失败"', () => {
    const snap = summarizeRun({
      taskId: 't1',
      sections,
      results: [{ section_id: 's1', risk_level: 2 }],
      taskStatus: 'cancelled',
      startedAt: 0,
    });
    expect(snap.phase).toBe('cancelled');
    expect(snap.errors.every((e) => e.message.includes('未运行'))).toBe(true);
  });

  it('状态还是 running 时，残留的 run_completed_at 不得宣布完成', () => {
    const snap = summarizeRun({
      taskId: 't1',
      sections: [sections[0]],
      results: [{ section_id: 's1', risk_level: 1 }],
      taskStatus: 'running',
      runCompletedAt: '2026-11-27T12:00:00Z',
      startedAt: 0,
    });
    expect(snap.phase).toBe('running');
  });

  it('完全没有状态字段时才用 run_completed_at 兜底收尾', () => {
    const snap = summarizeRun({
      taskId: 't1',
      sections: [sections[0]],
      results: [{ section_id: 's1', risk_level: 1 }],
      runCompletedAt: '2026-11-27T12:00:00Z',
      startedAt: 0,
    });
    expect(snap.phase).toBe('completed');
  });

  it('结果全回来了但状态还是 running ⇒ 不收尾（等后端写终态）', () => {
    const snap = summarizeRun({
      taskId: 't1',
      sections,
      results: [
        { section_id: 's1', risk_level: 1 },
        { section_id: 's2', risk_level: 2 },
        { section_id: 's3', risk_level: 3 },
      ],
      taskStatus: 'running',
      startedAt: 0,
    });
    expect(snap.done).toBe(3);
    expect(snap.phase).toBe('running');
  });

  it('断面清单没取到（total=0）不崩，done 跟着结果走', () => {
    const snap = summarizeRun({
      taskId: 't1',
      sections: [],
      results: [{ section_id: 'x1', risk_level: 1 }, { section_id: 'x2', risk_level: 2 }],
      taskStatus: 'running',
      startedAt: 0,
    });
    expect(snap.total).toBe(0);
    expect(snap.done).toBe(2);
    expect(snap.phase).toBe('running');
  });
});

describe('percentOf / formatElapsed', () => {
  it('总数为 0 时给 null（走不确定态，不假装 0%）', () => {
    expect(percentOf(0, 0)).toBeNull();
    expect(percentOf(1, 4)).toBe(25);
    expect(percentOf(9, 4)).toBe(100);
  });

  it('用时按 分:秒 / 时:分:秒', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(134_000)).toBe('02:14');
    expect(formatElapsed(3_800_000)).toBe('1:03:20');
    expect(formatElapsed(-5)).toBe('00:00');
    expect(formatElapsed(Number.NaN)).toBe('00:00');
  });
});
