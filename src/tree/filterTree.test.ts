import { describe, expect, it } from 'vitest';
import type { TreeNode } from './types';
import { countKeptNodes, expandedAll, makeHitPredicate, pruneTree, refKeyOf } from './filterTree';

function leaf(id: string, label: string, ref?: TreeNode['ref']): TreeNode {
  return { id, kind: 'section', label, selectable: true, ref };
}

function buildTree(): TreeNode {
  return {
    id: 'root',
    kind: 'root',
    label: '工作区',
    selectable: false,
    children: [
      {
        id: 'group:resources',
        kind: 'group',
        label: '数据资源',
        selectable: false,
        children: [
          {
            id: 'folder:sections',
            kind: 'folder',
            label: '断面',
            selectable: false,
            children: [
              {
                id: 'sections-task:t1',
                kind: 'folder',
                label: '岸线分析任务56',
                selectable: false,
                children: [
                  leaf('section:t1:s6', '断面6', { entity: 'section', key: 'sec-6' }),
                  leaf('section:t1:s7', '断面7', { entity: 'section', key: 'sec-7' }),
                ],
              },
            ],
          },
        ],
      },
      {
        id: 'group:tasks',
        kind: 'group',
        label: '计算任务',
        selectable: false,
        children: [
          {
            id: 'task:t1',
            kind: 'task',
            label: '岸线分析任务56',
            selectable: true,
            ref: { entity: 'task', key: 't1' },
            children: [leaf('task-section:t1:s6', '断面6', { entity: 'section', key: 'sec-6' })],
          },
        ],
      },
    ],
  };
}

describe('makeHitPredicate', () => {
  it('label 命中即可', () => {
    const hit = makeHitPredicate(['断面6'], new Set());
    expect(hit(leaf('a', '断面6'))).toBe(true);
    expect(hit(leaf('b', '断面7'))).toBe(false);
  });

  it('ref 命中时即使标题不含关键词也算命中（覆盖「词只在描述里」的情况）', () => {
    const hit = makeHitPredicate(['张'], new Set(['section:sec-6']));
    expect(hit(leaf('a', '断面6', { entity: 'section', key: 'sec-6' }))).toBe(true);
  });

  it('meta 也参与匹配', () => {
    const hit = makeHitPredicate(['bankwgs84_5'], new Set());
    expect(hit({ id: 'x', kind: 'section', label: '断面6', meta: 'bankwgs84_5', selectable: true })).toBe(true);
  });

  it('空词表且无 ref 命中时恒 false', () => {
    const hit = makeHitPredicate([], new Set());
    expect(hit(leaf('a', '断面6'))).toBe(false);
  });

  it('refOnly 模式下只认后端命中，忽略标题字面匹配', () => {
    const hit = makeHitPredicate(['断面6'], new Set(['section:sec-7']), true);
    expect(hit(leaf('a', '断面6', { entity: 'section', key: 'sec-6' }))).toBe(false);
    expect(hit(leaf('b', '断面7', { entity: 'section', key: 'sec-7' }))).toBe(true);
  });
});

describe('pruneTree', () => {
  it('保留命中节点及其完整祖先路径', () => {
    const hit = makeHitPredicate(['断面6'], new Set());
    const pruned = pruneTree(buildTree(), hit);
    expect(pruned).not.toBeNull();
    const group = pruned!.children!.map((c) => c.id);
    expect(group).toEqual(['group:resources', 'group:tasks']);

    const folder = pruned!.children![0].children![0];
    expect(folder.id).toBe('folder:sections');
    expect(folder.children![0].id).toBe('sections-task:t1');
    expect(folder.children![0].children!.map((n) => n.id)).toEqual(['section:t1:s6']);
  });

  it('未命中的兄弟节点被隐藏', () => {
    const hit = makeHitPredicate(['断面7'], new Set(['section:sec-7']));
    const pruned = pruneTree(buildTree(), hit);
    const sections = pruned!.children![0].children![0].children![0].children!;
    expect(sections.map((n) => n.label)).toEqual(['断面7']);
  });

  it('命中父节点但不命中任何子节点时，子节点被清空（不整棵子树放出）', () => {
    const hit = makeHitPredicate(['岸线分析任务56'], new Set());
    const pruned = pruneTree(buildTree(), hit);
    const task = pruned!.children![1].children![0];
    expect(task.id).toBe('task:t1');
    expect(task.children).toBeUndefined();
  });

  it('完全无命中返回 null', () => {
    expect(pruneTree(buildTree(), makeHitPredicate(['张家港'], new Set()))).toBeNull();
  });

  it('剪枝不修改原树', () => {
    const tree = buildTree();
    const before = JSON.stringify(tree);
    pruneTree(tree, makeHitPredicate(['断面6'], new Set()));
    expect(JSON.stringify(tree)).toBe(before);
  });
});

describe('expandedAll / countKeptNodes', () => {
  it('所有带子节点的 id 都置为展开', () => {
    const pruned = pruneTree(buildTree(), makeHitPredicate(['断面6'], new Set()));
    const expanded = expandedAll(pruned);
    expect(expanded['group:resources']).toBe(true);
    expect(expanded['section:t1:s6']).toBeUndefined();
  });

  it('只统计带 ref 的业务节点', () => {
    const pruned = pruneTree(buildTree(), makeHitPredicate(['断面6'], new Set()));
    // 两个「断面6」（数据资源侧 + 计算任务侧）+ 任务节点 1 个
    expect(countKeptNodes(pruned)).toBe(3);
  });

  it('refKeyOf 拼接实体与键', () => {
    expect(refKeyOf(leaf('a', 'x', { entity: 'bank', key: 'bankwgs84_5' }))).toBe('bank:bankwgs84_5');
    expect(refKeyOf(leaf('b', 'x'))).toBeNull();
  });
});
