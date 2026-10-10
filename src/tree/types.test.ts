import { describe, it, expect } from 'vitest';
import type { TreeNode, NodeKind } from './types';

describe('types', () => {
  it('constructs a recursive node', () => {
    const kind: NodeKind = 'bank';
    const node: TreeNode = {
      id: 'bank:bankwgs84_30',
      kind,
      label: 'bankwgs84_30',
      selectable: true,
      children: [{ id: 'x', kind: 'section', label: 's', selectable: true }],
    };
    expect(node.children?.length).toBe(1);
    expect(node.kind).toBe('bank');
  });
});
