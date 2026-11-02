import { describe, it, expect } from 'vitest';
import { groupSelectedByKind, hasBatchActions } from './batchActions';
import type { TreeNode } from './types';

function node(kind: TreeNode['kind'], id: string): TreeNode {
  return { id, kind, label: id, selectable: true };
}

describe('batchActions', () => {
  it('只选参数模板时不产生批量动作', () => {
    const nodes = [node('param', 'p1')];
    expect(hasBatchActions(nodes)).toBe(false);
    expect(groupSelectedByKind(nodes).size).toBe(0);
  });

  it('参数模板与岸段混选时只保留岸段分组', () => {
    const groups = groupSelectedByKind([node('param', 'p1'), node('bank', 'b1')]);
    expect([...groups.keys()]).toEqual(['bank']);
    expect(groups.get('bank')?.map((n) => n.id)).toEqual(['b1']);
  });
});
