import { describe, it, expect } from 'vitest';
import { ACTION_META, getActions } from './actions';

describe('actions', () => {
  it('has labels for all used keys', () => {
    expect(ACTION_META['task.run'].label).toContain('执行');
    expect(ACTION_META['bank.delete'].label).toContain('删除');
  });
  it('getActions returns metadata for a node', () => {
    const list = getActions(['bank.smooth', 'bank.delete']);
    expect(list.map((a) => a.key)).toEqual(['bank.smooth', 'bank.delete']);
  });
  // 57 = 56 + task.loadMap（双击任务节点 / 右键「加载岸段与断面到地图」，2026-10-17 新增）
  // 56 = 55 + task.stop（终止运行中的任务，2026-10-15 新增）
  // 55 曾 = 53 + bank.loadAll / bank.removeAll（「岸段」文件夹右键 → 全部加载/移出地图，
  // 与断面文件夹的 section.loadAll / section.removeAll 对称，2026-10-14 新增）
  it('registers 57 keys with matching key fields', () => {
    const entries = Object.entries(ACTION_META);
    expect(entries.length).toBe(57);
    for (const [k, v] of entries) expect(v.key).toBe(k);
  });
  it('exposes 终止运行 as a danger action next to 执行风险分析', () => {
    expect(ACTION_META['task.stop'].label).toBe('终止运行');
    expect(ACTION_META['task.stop'].danger).toBe(true);
  });
  it('exposes 新建参数模板 on the params folder', () => {
    expect(ACTION_META['param.create'].label).toBe('新建参数模板');
  });
  it('exposes the 岸段 folder batch pair', () => {
    expect(ACTION_META['bank.loadAll'].label).toBe('全部加载到地图');
    expect(ACTION_META['bank.removeAll'].label).toBe('全部移出地图');
  });
  it('getActions drops unknown keys', () => {
    expect(getActions(['does.not.exist' as any])).toEqual([]);
  });
});
