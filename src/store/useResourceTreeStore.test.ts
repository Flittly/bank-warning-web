import { describe, it, expect, beforeEach } from 'vitest';
import { useResourceTreeStore } from './useResourceTreeStore';

describe('useResourceTreeStore', () => {
  beforeEach(() => {
    useResourceTreeStore.setState({
      expanded: {}, selectedId: null, currentTaskId: null,
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
});
