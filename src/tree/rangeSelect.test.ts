import { describe, it, expect } from 'vitest';
import { applyRangeSelect, collectSelectableRows, emptySelection } from './rangeSelect';
import type { RangeSelectState } from './rangeSelect';
import { buildResourceTree } from './treeModel';

// 构造一棵可预测的树：数据资源组下 4 条岸段 + 计算任务组下 3 个任务，
// 用来验证「范围选择按可见顺序、只选 selectable 节点」。
function makeRows() {
  const root = buildResourceTree({
    banks: [
      { bank_id: 'b1', bank_name: '岸段1' },
      { bank_id: 'b2', bank_name: '岸段2' },
      { bank_id: 'b3', bank_name: '岸段3' },
      { bank_id: 'b4', bank_name: '岸段4' },
    ],
    params: [],
    tiffs: [],
    tasks: [
      { task_id: 't1', task_name: '任务1' },
      { task_id: 't2', task_name: '任务2' },
      { task_id: 't3', task_name: '任务3' },
    ],
    sections: [],
    sectionsByTask: {},
  });
  // 展开两个顶层组 + 岸段文件夹，让岸段和任务都可见
  const expanded = { 'group:resources': true, 'group:tasks': true, 'folder:banks': true };
  return { root, expanded, rows: collectSelectableRows(root, expanded) };
}

const ids = (rows: { node: { id: string } }[]) => rows.map((r) => r.node.id);

describe('applyRangeSelect', () => {
  it('普通点击：单选该行，锚点推进', () => {
    const { rows } = makeRows();
    const prev: RangeSelectState = emptySelection();
    const next = applyRangeSelect(rows, rows[2].node.id, prev, { shift: false, ctrlOrMeta: false });
    expect([...next.selectedIds]).toEqual([rows[2].node.id]);
    expect(next.anchorIndex).toBe(2);
  });

  it('Shift+点击：从锚点到点击行之间全部选中（含不可选行之间的可选行）', () => {
    const { rows } = makeRows();
    // 先点第 0 行建立锚点
    const s1 = applyRangeSelect(rows, rows[0].node.id, emptySelection(), { shift: false, ctrlOrMeta: false });
    // Shift 点第 3 行 → 选中 0..3
    const s2 = applyRangeSelect(rows, rows[3].node.id, s1, { shift: true, ctrlOrMeta: false });
    expect([...s2.selectedIds].sort()).toEqual(ids(rows.slice(0, 4)).sort());
    // 锚点保持 0
    expect(s2.anchorIndex).toBe(0);
  });

  it('Shift+点击（向下再向上）按锚点重选范围，而非累加', () => {
    const { rows } = makeRows();
    const s1 = applyRangeSelect(rows, rows[1].node.id, emptySelection(), { shift: false, ctrlOrMeta: false });
    // 锚点在 1，Shift 点 4 → 选 1..4
    const s2 = applyRangeSelect(rows, rows[4].node.id, s1, { shift: true, ctrlOrMeta: false });
    expect([...s2.selectedIds]).toHaveLength(4);
    // 再 Shift 点 2（往上）→ 重选 1..2，不是 1..4 累加
    const s3 = applyRangeSelect(rows, rows[2].node.id, s2, { shift: true, ctrlOrMeta: false });
    expect([...s3.selectedIds].sort()).toEqual(ids(rows.slice(1, 3)).sort());
  });

  it('Ctrl/Cmd+点击：在已有选区上取反（加入/取消），锚点移到该行', () => {
    const { rows } = makeRows();
    const s1 = applyRangeSelect(rows, rows[0].node.id, emptySelection(), { shift: false, ctrlOrMeta: false });
    // Ctrl 点第 2 行 → 加入
    const s2 = applyRangeSelect(rows, rows[2].node.id, s1, { shift: false, ctrlOrMeta: true });
    expect(s2.selectedIds.has(rows[2].node.id)).toBe(true);
    expect(s2.selectedIds.has(rows[0].node.id)).toBe(true);
    // 再 Ctrl 点第 0 行 → 取消它
    const s3 = applyRangeSelect(rows, rows[0].node.id, s2, { shift: false, ctrlOrMeta: true });
    expect(s3.selectedIds.has(rows[0].node.id)).toBe(false);
    expect(s3.selectedIds.has(rows[2].node.id)).toBe(true);
    expect(s3.anchorIndex).toBe(0);
  });

  it('Ctrl/Cmd+Shift+点击：把范围追加进既有选区，不丢旧选择', () => {
    const { rows } = makeRows();
    const s1 = applyRangeSelect(rows, rows[0].node.id, emptySelection(), { shift: false, ctrlOrMeta: false });
    // Ctrl+Shift 点第 5 行 → 0..5 追加（原本只有 0，实际就是 0..5）
    const s2 = applyRangeSelect(rows, rows[5].node.id, s1, { shift: true, ctrlOrMeta: true });
    expect([...s2.selectedIds]).toHaveLength(6);
  });

  it('点击不存在的 id 返回原状态（不变）', () => {
    const { rows } = makeRows();
    const prev = applyRangeSelect(rows, rows[0].node.id, emptySelection(), { shift: false, ctrlOrMeta: false });
    const next = applyRangeSelect(rows, 'nonexistent', prev, { shift: true, ctrlOrMeta: false });
    expect(next).toBe(prev);
  });
});

describe('collectSelectableRows', () => {
  it('只收集 selectable 节点，且顺序与 flattenTree 一致', () => {
    const { rows } = makeRows();
    // 岸段 b1..b4 + 任务 t1..t3 都是 selectable，共 7 个
    expect(rows).toHaveLength(7);
    expect(ids(rows)).toContain('bank:b1');
    expect(ids(rows)).toContain('task:t1');
    // 顶层 group / folder 不在其中
    expect(ids(rows)).not.toContain('group:resources');
    expect(ids(rows)).not.toContain('folder:banks');
  });

  it('未展开的文件夹，其子节点不进入可选行', () => {
    const { root, expanded } = makeRows();
    // 收起「岸段」文件夹：只剩任务组里的 3 个任务可选
    const collapsed = { ...expanded, 'folder:banks': false };
    const rows = collectSelectableRows(root, collapsed);
    expect(ids(rows).filter((id) => id.startsWith('bank:'))).toHaveLength(0);
    expect(rows).toHaveLength(3);
  });
});
