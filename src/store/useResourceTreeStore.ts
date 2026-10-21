import { create } from 'zustand';

export interface ResourceTreeState {
  expanded: Record<string, boolean>;
  selectedId: string | null;
  /** 多选：当前选中的节点 id 集合（范围选择用，selectedId 仍保留作为单选/高亮入口） */
  selectedIds: Set<string>;
  /** 范围选择的锚点行下标（-1 表示未建立锚点） */
  anchorIndex: number;
  currentTaskId: string | null;
  dataVersion: number;
  loadingIds: Record<string, boolean>;
  banks: any[];
  params: any[];
  tiffs: any[];
  tasks: any[];
  sectionsByTask: Record<string, any[]>;
  toggleExpanded: (id: string) => void;
  /** 幂等展开某个节点（补充岸段后要让用户"看得见"，不能靠 toggle 碰运气） */
  expandNode: (id: string) => void;
  selectNode: (id: string | null) => void;
  /** 直接写入整个多选集合 + 锚点（范围选择逻辑在 tree/rangeSelect 里算好后调用） */
  setSelection: (ids: Set<string>, anchorIndex: number) => void;
  clearSelection: () => void;
  setCurrentTask: (id: string | null) => void;
  setData: (partial: Partial<Pick<ResourceTreeState, 'banks' | 'params' | 'tiffs' | 'tasks'>>) => void;
  setSectionsForTask: (taskId: string, sections: any[]) => void;
  bumpData: () => void;
  setLoading: (id: string, loading: boolean) => void;
  invalidateSections: (taskId: string) => void;
  removeTask: (taskId: string) => void;

  // ===== 全局搜索 =====
  /** 当前搜索词（空串 = 非搜索态，树恢复原样） */
  searchQuery: string;
  /** 拆好的词项，树高亮与本地即时剪枝共用 */
  searchTerms: string[];
  /** 后端命中的业务引用集合（`entity:key`），用于覆盖「词只在描述里」的命中 */
  searchMatchedRefs: Set<string>;
  /** true = 后端已返回，剪枝只认 ref（否则带 risk: 等筛选时树会比列表多出一堆节点） */
  searchStrict: boolean;
  /** 搜索请求在途 —— 供搜索框显示 loading，不进 effect 依赖 */
  searchBusy: boolean;
  /** 命中结果点击后待消费的地图定位请求（ResultPage 挂载/切换任务后消费一次） */
  pendingFocus: {
    taskId: string;
    sectionId: string;
    sectionName?: string;
    lng?: number | null;
    lat?: number | null;
    nonce: number;
  } | null;
  setSearch: (query: string, terms: string[], refs: Set<string>, strict?: boolean) => void;
  setSearchBusy: (busy: boolean) => void;
  clearSearch: () => void;
  setPendingFocus: (focus: {
    taskId: string;
    sectionId: string;
    sectionName?: string;
    lng?: number | null;
    lat?: number | null;
  }) => void;
  clearPendingFocus: () => void;
}

export const useResourceTreeStore = create<ResourceTreeState>((set) => ({
  // 规则组默认展开：它只有三层、九个叶子，展开也不会淹没数据资源；
  // 折叠起来反而会让"规则"这个新节点看起来像个空壳。
  expanded: { 'group:resources': true, 'group:rules': true, 'group:tasks': true, 'folder:banks': false, 'folder:sections': false, 'folder:params': false, 'folder:dems': false },
  selectedId: null,
  selectedIds: new Set<string>(),
  anchorIndex: -1,
  currentTaskId: null,
  dataVersion: 0,
  loadingIds: {},
  banks: [],
  params: [],
  tiffs: [],
  tasks: [],
  sectionsByTask: {},
  toggleExpanded: (id) => set((s) => ({ expanded: { ...s.expanded, [id]: !s.expanded[id] } })),
  expandNode: (id) => set((s) => (s.expanded[id] ? s : { expanded: { ...s.expanded, [id]: true } })),
  selectNode: (id) => set({ selectedId: id }),
  setSelection: (ids, anchorIndex) => set({ selectedIds: new Set(ids), anchorIndex }),
  clearSelection: () => set({ selectedIds: new Set<string>(), anchorIndex: -1 }),
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

  searchQuery: '',
  searchTerms: [],
  searchMatchedRefs: new Set<string>(),
  searchStrict: false,
  searchBusy: false,
  pendingFocus: null,
  // 每次搜索都换新的 Set/数组引用：树剪枝的 useMemo 靠引用变化触发重算
  setSearch: (query, terms, refs, strict = false) =>
    set({ searchQuery: query, searchTerms: terms, searchMatchedRefs: refs, searchStrict: strict }),
  setSearchBusy: (busy) => set({ searchBusy: busy }),
  // 清空时把 refs 一并清掉，否则残留的命中会把树留在半剪枝状态
  clearSearch: () =>
    set({
      searchQuery: '',
      searchTerms: [],
      searchMatchedRefs: new Set<string>(),
      searchStrict: false,
      searchBusy: false,
    }),
  setPendingFocus: (focus) => set({ pendingFocus: { ...focus, nonce: Date.now() } }),
  clearPendingFocus: () => set({ pendingFocus: null }),
}));
