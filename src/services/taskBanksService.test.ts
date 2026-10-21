import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pickCandidateBanks, resolveBankIdsForTaskLoading, resolveTaskBankScope } from './taskBanksService';

/**
 * 「补充岸段」候选口径。
 *
 * 这里要守住的是三件事，任意一件错了都会让用户"补了但补重了/补不上"：
 *   1. 已有岸段取 bank_ids ∪ 断面 bank_id —— 历史任务的 bank_ids 可能为空或与实际断面不一致；
 *   2. segment_index 续在已有最大值之后，不能从 0 重来（会与老断面抢号）；
 *   3. 候选里不能出现任务已经有的岸段，也不能出现 bank_id 为空的脏行。
 */

const jsonResponse = (body: unknown) =>
  ({ ok: true, status: 200, statusText: 'OK', json: async () => body }) as any;

// authHeaders() 会读 localStorage 取 token；这个测试只关心候选口径，
// 所以在 node 环境里给一个空实现，免得整条 import 链因为 "localStorage is not defined" 挂掉。
beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveTaskBankScope', () => {
  it('已有岸段 = bank_ids ∪ 断面 bank_id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          sections: [
            { section_id: 's1', bank_id: 'b1', segment_index: 0 },
            { section_id: 's2', bank_id: 'b2', segment_index: 1 },
          ],
        }),
      ),
    );

    const scope = await resolveTaskBankScope('t1', ['b1', 'b9']);
    expect([...scope.existingBankIds].sort()).toEqual(['b1', 'b2', 'b9']);
    expect(scope.sectionCount).toBe(2);
    expect(scope.sectionCountByBank).toEqual({ b1: 1, b2: 1 });
  });

  it('segment_index 续在最大值之后（不从 0 重来）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          sections: [
            { section_id: 's1', bank_id: 'b1', segment_index: 7 },
            { section_id: 's2', bank_id: 'b1', segment_index: '12' },
          ],
        }),
      ),
    );

    const scope = await resolveTaskBankScope('t1', []);
    expect(scope.nextSegmentIndex).toBe(13);
  });

  it('全库无断面时从 0 开始', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ sections: [] })));
    const scope = await resolveTaskBankScope('t1', null);
    expect(scope.existingBankIds.size).toBe(0);
    expect(scope.nextSegmentIndex).toBe(0);
  });
});

describe('pickCandidateBanks', () => {
  it('排除已有岸段，并保持库里的原始顺序', () => {
    const all = [
      { bank_id: 'b1', bank_name: '一' },
      { bank_id: 'b2', bank_name: '二' },
      { bank_id: 'b3', bank_name: '三' },
    ];
    const out = pickCandidateBanks(all, new Set(['b2']));
    expect(out.map((b) => b.bank_id)).toEqual(['b1', 'b3']);
  });

  it('丢掉 bank_id 为空/空白的脏行，避免提交后被后端判成 missing', () => {
    const all = [{ bank_id: '' }, { bank_id: '   ' }, { bank_id: 'b1' }, {}];
    const out = pickCandidateBanks(all, new Set());
    expect(out.map((b) => b.bank_id)).toEqual(['b1']);
  });

  it('全部已在任务里时返回空数组（弹窗据此给出"没有可补充"的结论）', () => {
    const all = [{ bank_id: 'b1' }, { bank_id: 'b2' }];
    expect(pickCandidateBanks(all, new Set(['b1', 'b2']))).toEqual([]);
  });
});

/**
 * 「双击任务加载到地图」的岸段口径。
 *
 * 曾经的实现只按断面反推岸段 ⇒ 任务关联了 16 条、断面只覆盖 12 条时，
 * 地图上就只有 12 条，用户看到的是"加载不全"。这里要钉死两件事：
 *   1. 任务关联的岸段一条都不能少（哪怕它没有断面）；
 *   2. 只出现在断面里的岸段也要补上（历史脏数据的兜底方向）。
 */
describe('resolveBankIdsForTaskLoading', () => {
  it('任务关联了但没断面的岸段也要加载（这就是"少几条"的根因）', () => {
    const out = resolveBankIdsForTaskLoading(
      ['b1', 'b2', 'b3', 'b4'],
      ['b1', 'b2'],
    );
    expect(out.bankIds).toEqual(['b1', 'b2', 'b3', 'b4']);
    expect(out.withoutSection).toEqual(['b3', 'b4']);
  });

  it('只出现在断面里的岸段也补进来，追加在任务顺序之后', () => {
    const out = resolveBankIdsForTaskLoading(['b1'], ['b2', 'b1']);
    expect(out.bankIds).toEqual(['b1', 'b2']);
    expect(out.withoutSection).toEqual([]);
  });

  it('重复与空白 id 被去掉（同一岸段不能在地图上画两遍）', () => {
    const out = resolveBankIdsForTaskLoading([' b1 ', 'b1', ''], ['b1', 'b2', '  ']);
    expect(out.bankIds).toEqual(['b1', 'b2']);
    expect(out.withoutSection).toEqual([]);
  });

  it('任务没登记岸段时完全按断面反推（老行为，不能比原来更差）', () => {
    const out = resolveBankIdsForTaskLoading([], ['b1', 'b2']);
    expect(out.bankIds).toEqual(['b1', 'b2']);
    expect(out.withoutSection).toEqual([]);
  });

  // 回归：自由断面（手工画线）的 bank_id 是 `line-N` 占位符，banks 表里没有记录。
  // 旧实现把它们算进加载清单 ⇒ 这一条必然 404，但也会让"地图上有几条岸段"
  // 与资源树（只认真实岸段）对不上。
  it('line-N 占位 id 不进加载清单（加载必然 404，只会让数字虚高）', () => {
    const out = resolveBankIdsForTaskLoading(
      ['bankwgs84_4', 'bankwgs84_5'],
      ['bankwgs84_4', 'bankwgs84_5', 'line-9', 'line-38'],
    );
    expect(out.bankIds).toEqual(['bankwgs84_4', 'bankwgs84_5']);
  });

  it('断面里有、关联里没有的真实岸段要报成 unregistered（供前端回写修复）', () => {
    const out = resolveBankIdsForTaskLoading(
      ['bankwgs84_4'],
      ['bankwgs84_4', 'bankwgs84_11', 'bankwgs84_12', 'line-9'],
    );
    expect(out.unregistered).toEqual(['bankwgs84_11', 'bankwgs84_12']);
  });
});
