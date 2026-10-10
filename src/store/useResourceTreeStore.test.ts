import { describe, it, expect, beforeEach } from 'vitest';
import { useResourceTreeStore } from './useResourceTreeStore';

describe('useResourceTreeStore', () => {
  beforeEach(() => {
    useResourceTreeStore.setState({
      expanded: {}, selectedId: null, currentTaskId: null, dataVersion: 0, loadingIds: {},
      banks: [], params: [], tiffs: [], tasks: [], sectionsByTask: {},
    });
  });
  it('toggles expansion', () => {
    useResourceTreeStore.getState().toggleExpanded('group:resources');
    expect(useResourceTreeStore.getState().expanded['group:resources']).toBe(true);
    useResourceTreeStore.getState().toggleExpanded('group:resources');
    expect(useResourceTreeStore.getState().expanded['group:resources']).toBe(false);
  });
  it('selects a node and sets current task', () => {
    useResourceTreeStore.getState().selectNode('task:t1');
    useResourceTreeStore.getState().setCurrentTask('t1');
    expect(useResourceTreeStore.getState().selectedId).toBe('task:t1');
    expect(useResourceTreeStore.getState().currentTaskId).toBe('t1');
  });
  it('caches data and sections, and invalidates', () => {
    const s = useResourceTreeStore.getState();
    s.setData({ banks: [{ bank_id: 'b1' }] });
    s.setSectionsForTask('t1', [{ section_id: 's1' }]);
    expect(useResourceTreeStore.getState().banks).toHaveLength(1);
    expect(useResourceTreeStore.getState().sectionsByTask['t1']).toHaveLength(1);
    s.invalidateSections('t1');
    expect(useResourceTreeStore.getState().sectionsByTask['t1']).toBeUndefined();
  });
  it('toggleExpanded is immutable (new object)', () => {
    const before = useResourceTreeStore.getState().expanded;
    useResourceTreeStore.getState().toggleExpanded('x');
    expect(useResourceTreeStore.getState().expanded).not.toBe(before);
  });
  it('removeTask filters by id and bumpData increments', () => {
    useResourceTreeStore.getState().setData({ tasks: [{ task_id: 't1' }, { task_id: 't2' }] });
    useResourceTreeStore.getState().removeTask('t1');
    expect(useResourceTreeStore.getState().tasks.map((t: any) => t.task_id)).toEqual(['t2']);
    const v = useResourceTreeStore.getState().dataVersion;
    useResourceTreeStore.getState().bumpData();
    expect(useResourceTreeStore.getState().dataVersion).toBe(v + 1);
  });
});
