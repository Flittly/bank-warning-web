import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SectionParams } from '../types/sections';
import type { SelectionGroup } from '../types/selection';

// -- pure data (serializable)
interface EditorData {
  uploadedData: GeoJSON.FeatureCollection | null;
  perpendicularData: GeoJSON.FeatureCollection | null;
  groups: SelectionGroup[];
  globalInterval: number;
  globalLength: number;
  globalProperties: SectionParams | null;
  selectedLines: Set<string>;
  selectedBankGroup: string[];
  selectedLoadedBanks: Set<string>;
  showCrossLines: boolean;
  satellite: boolean;
  colorBanks: boolean;
  loadedBanks: any[];
  crossLineControlMode: 'shoreline' | 'free';
  selectedBasicParamIdState: string | number | null;
}

// -- actions (not persisted)
interface EditorActions {
  setUploadedData: (
    v: GeoJSON.FeatureCollection | null | ((prev: GeoJSON.FeatureCollection | null) => GeoJSON.FeatureCollection | null),
  ) => void;
  setPerpendicularData: (
    v: GeoJSON.FeatureCollection | null | ((prev: GeoJSON.FeatureCollection | null) => GeoJSON.FeatureCollection | null),
  ) => void;
  setGroups: (v: SelectionGroup[] | ((prev: SelectionGroup[]) => SelectionGroup[])) => void;
  setGlobalInterval: (v: number) => void;
  setGlobalLength: (v: number) => void;
  setGlobalProperties: (v: SectionParams | null) => void;
  setSelectedLines: (v: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  setSelectedBankGroup: (v: string[] | ((prev: string[]) => string[])) => void;
  setSelectedLoadedBanks: (v: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  setShowCrossLines: (v: boolean) => void;
  setSatellite: (v: boolean) => void;
  setColorBanks: (v: boolean) => void;
  setLoadedBanks: (v: any[] | ((prev: any[]) => any[])) => void;
  setCrossLineControlMode: (v: 'shoreline' | 'free') => void;
  setSelectedBasicParamIdState: (v: string | number | null) => void;
  /** 清除所有编辑器数据（切换任务/重置时调用） */
  clearEditorData: () => void;
}

type EditorState = EditorData & EditorActions;

// -- helpers
function setter<T>(set: any, key: string) {
  return (v: T | ((prev: T) => T)) =>
    set((state: any) => ({ [key]: typeof v === 'function' ? (v as any)(state[key]) : v }));
}

// -- initial defaults
const initialData: EditorData = {
  uploadedData: null,
  perpendicularData: null,
  groups: [],
  globalInterval: 1000,
  globalLength: 1000,
  globalProperties: null,
  selectedLines: new Set<string>(),
  selectedBankGroup: [],
  selectedLoadedBanks: new Set<string>(),
  showCrossLines: true,
  satellite: false,
  colorBanks: false,
  loadedBanks: [],
  crossLineControlMode: 'shoreline',
  selectedBasicParamIdState: null,
};

export const useEditorStore = create<EditorState>()(
  persist(
    (set, _get) => ({
      ...initialData,

      setUploadedData: setter(set, 'uploadedData'),
      setPerpendicularData: setter(set, 'perpendicularData'),
      setGroups: setter(set, 'groups'),
      setGlobalInterval: setter(set, 'globalInterval'),
      setGlobalLength: setter(set, 'globalLength'),
      setGlobalProperties: setter(set, 'globalProperties'),
      setSelectedLines: setter(set, 'selectedLines'),
      setSelectedBankGroup: setter(set, 'selectedBankGroup'),
      setSelectedLoadedBanks: setter(set, 'selectedLoadedBanks'),
      setShowCrossLines: setter(set, 'showCrossLines'),
      setSatellite: setter(set, 'satellite'),
      setColorBanks: setter(set, 'colorBanks'),
      setLoadedBanks: setter(set, 'loadedBanks'),
      setCrossLineControlMode: setter(set, 'crossLineControlMode'),
      setSelectedBasicParamIdState: setter(set, 'selectedBasicParamIdState'),
      clearEditorData: () => set({ ...initialData }),
    }),
    {
      name: 'editor-storage',
      partialize: (state): any => ({
        uploadedData: state.uploadedData,
        perpendicularData: state.perpendicularData,
        groups: state.groups,
        globalInterval: state.globalInterval,
        globalLength: state.globalLength,
        globalProperties: state.globalProperties,
        selectedLines: Array.from(state.selectedLines),
        selectedBankGroup: state.selectedBankGroup,
        selectedLoadedBanks: Array.from(state.selectedLoadedBanks),
        showCrossLines: state.showCrossLines,
        satellite: state.satellite,
        colorBanks: state.colorBanks,
        loadedBanks: state.loadedBanks,
        crossLineControlMode: state.crossLineControlMode,
        selectedBasicParamIdState: state.selectedBasicParamIdState,
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<EditorData> | undefined;
        if (!p) return { ...current, ...initialData };
        return {
          ...current,
          ...p,
          selectedLines: new Set<string>(p.selectedLines ?? []),
          selectedLoadedBanks: new Set<string>(p.selectedLoadedBanks ?? []),
        };
      },
    },
  ),
);
