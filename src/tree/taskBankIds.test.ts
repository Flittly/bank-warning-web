import { describe, expect, it } from 'vitest';
import { isSyntheticBankId, resolveTaskBankIds } from './taskBankIds';

/**
 * 「任务有哪些岸段」的口径测试。
 *
 * 这一组断言守的是**树与地图只有一个数字**：树、双击任务加载、补充岸段候选
 * 全部消费同一个函数，任何一处单独改口径都会让界面自相矛盾
 * （线上真实症状：树里 17 条、地图上 19 条）。
 */
describe('isSyntheticBankId', () => {
  it('自由断面的 line-N 占位 id 不算岸段', () => {
    expect(isSyntheticBankId('line-9')).toBe(true);
    expect(isSyntheticBankId('line-38')).toBe(true);
    expect(isSyntheticBankId(' LINE-12 ')).toBe(true);
  });

  it('真实 bank_id 不受影响（bank_49 / bankwgs84_13 都是库里真有几何的）', () => {
    expect(isSyntheticBankId('bank_49')).toBe(false);
    expect(isSyntheticBankId('bankwgs84_13')).toBe(false);
    expect(isSyntheticBankId('lineage_1')).toBe(false);
    expect(isSyntheticBankId('')).toBe(false);
  });
});

describe('resolveTaskBankIds', () => {
  it('任务登记 ∪ 断面引用，任务顺序在前', () => {
    const out = resolveTaskBankIds(['b1', 'b2'], ['b2', 'b3']);
    expect(out.bankIds).toEqual(['b1', 'b2', 'b3']);
    expect(out.withoutSection).toEqual(['b1']);
    expect(out.unregistered).toEqual(['b3']);
  });

  it('断面里有、关联里没有的岸段要进清单（否则树比地图少）', () => {
    // 线上真实数据：tasks.bank_ids 17 条，断面还额外覆盖 bankwgs84_11/_12
    const out = resolveTaskBankIds(
      ['bankwgs84_5', 'bankwgs84_4'],
      ['bankwgs84_5', 'bankwgs84_4', 'bankwgs84_11', 'bankwgs84_12'],
    );
    expect(out.bankIds).toEqual(['bankwgs84_5', 'bankwgs84_4', 'bankwgs84_11', 'bankwgs84_12']);
    expect(out.unregistered).toEqual(['bankwgs84_11', 'bankwgs84_12']);
  });

  it('line-N 占位 id 从两侧都被剔除（它既不是岸段，也加载不上地图）', () => {
    const out = resolveTaskBankIds(['b1', 'line-9'], ['b1', 'line-9', 'line-38', 'b2']);
    expect(out.bankIds).toEqual(['b1', 'b2']);
    // 占位 id 不属于「有断面但没登记」的岸段，不该触发修复写库
    expect(out.unregistered).toEqual(['b2']);
    expect(out.withoutSection).toEqual([]);
  });

  it('重复、空白、null 都被归一化（同一岸段不能在地图上画两遍）', () => {
    const out = resolveTaskBankIds([' b1 ', 'b1', '', null], ['b1', ' b2 ', '  ']);
    expect(out.bankIds).toEqual(['b1', 'b2']);
  });

  it('非数组入参按空处理（接口返回 null 时不能抛）', () => {
    expect(resolveTaskBankIds(null, undefined)).toEqual({
      bankIds: [],
      withoutSection: [],
      unregistered: [],
    });
  });

  it('任务没登记任何岸段时完全按断面反推', () => {
    const out = resolveTaskBankIds([], ['b1', 'b2']);
    expect(out.bankIds).toEqual(['b1', 'b2']);
    expect(out.withoutSection).toEqual([]);
  });
});
