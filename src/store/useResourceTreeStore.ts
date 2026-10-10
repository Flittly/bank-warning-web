import { create } from 'zustand';

export interface ResourceTreeState {
  expanded: Record<string, boolean>;
  selectedId: string | null;
  currentTaskId: string | null;
  dataVersion: number;
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
  bumpData: () => void;
  setLoading: (id: string, loading: boolean) => void;
  invalidateSections: (taskId: string) => void;
  removeTask: (taskId: string) => void;
}

export const useResourceTreeStore = create<ResourceTreeState>((set) => ({
  expanded: { 'group:resources': true, 'group:tasks': true, 'folder:banks': false, 'folder:sections': false, 'folder:params': false, 'folder:dems': false },
  selectedId: null,
  currentTaskId: null,
  dataVersion: 0,
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
  bumpData: () => set((s) => ({ dataVersion: s.dataVersion + 1 })),
  setLoading: (id, loading) => set((s) => ({ loadingIds: { ...s.loadingIds, [id]: loading } })),
  invalidateSections: (taskId) => set((s) => {
    const next = { ...s.sectionsByTask };
    delete next[taskId];
    return { sectionsByTask: next };
  }),
  removeTask: (taskId) => set((s) => ({ tasks: s.tasks.filter((t: any) => String(t?.task_id ?? t?.id) !== taskId) })),
}));
