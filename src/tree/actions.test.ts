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
  it('registers 43 keys with matching key fields', () => {
    const entries = Object.entries(ACTION_META);
    expect(entries.length).toBe(43);
    for (const [k, v] of entries) expect(v.key).toBe(k);
  });
  it('getActions drops unknown keys', () => {
    expect(getActions(['does.not.exist' as any])).toEqual([]);
  });
});
