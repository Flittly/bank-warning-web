import { create } from 'zustand';

interface ResourceTreeState {
  expanded: Record<string, boolean>;
  selectedId: string | null;
  currentTaskId: string | null;
  loadingIds: Record<string, boolean>;
  banks: any[];
  params: any[];
  tiffs: any[];
  tasks: any[];
  sectionsByTask: Record<string, any[]>;
  toggleExpanded: (id: string) => void;
  selectNode: (id: string | null) => void;
  setCurrentTask: (id: string | null) => void;
  setData: (partial: Partial<Pick<ResourceTreeState, 'banks' | 'params' | 'tiffs' | 'tasks'>>) => void;
  setSectionsForTask: (taskId: string, sections: any[]) => void;
}

export const useResourceTreeStore = create<ResourceTreeState>((set) => ({
  expanded: { 'group:resources': true, 'group:tasks': true, 'folder:banks': false, 'folder:sections': false, 'folder:params': false, 'folder:dems': false },
  selectedId: null,
  currentTaskId: null,
  loadingIds: {},
  banks: [],
  params: [],
  tiffs: [],
  tasks: [],
  sectionsByTask: {},
  toggleExpanded: (id) => set((s) => ({ expanded: { ...s.expanded, [id]: !s.expanded[id] } })),
  selectNode: (id) => set({ selectedId: id }),
  setCurrentTask: (id) => set({ currentTaskId: id }),
  setData: (partial) => set(partial),
  setSectionsForTask: (taskId, sections) => set((s) => ({ sectionsByTask: { ...s.sectionsByTask, [taskId]: sections } })),
}));
