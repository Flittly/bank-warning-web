import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type CSSProperties } from 'react';
import mapboxgl from 'mapbox-gl';
import * as turf from '@turf/turf';
import 'mapbox-gl/dist/mapbox-gl.css';
import { getBasemapStyle } from '../map/basemapStyle';
import '../App.css';
import { getVerticalFootPointFromAny } from '../utils/verticalFootPoint';
import ChatPanel from '../components/ChatPanel';
import ResizeHandle from '../components/ResizeHandle';
import WorkspacePanel from '../components/WorkspacePanel';
import type { ReportTab } from '../components/WorkspacePanel';
import VerticalResizeHandle from '../components/VerticalResizeHandle';
import { Box, FileText, List, BarChart3, MessageCircle, Globe, Download, Search, Waves, Play, Pause, ScanSearch, SquareDashed } from 'lucide-react';
import { ConfigProvider, Modal } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { cancelTask } from '../services/taskRunControl';
import { setSectionManualInvalid } from '../services/sectionInvalidApi';
import { FlowFieldLayer, FLOW_FIELD_LAYER_ID, type FlowFieldStatus } from '../map/flowFieldLayer';
import { bankShadeWidthExpr } from '../map/bankShadeWidth';
import { sectionProgressAlongBank } from '../map/sectionBandProgress';
import {
  NO_DATA_RISK_COLOR,
  TRANSPARENT_RISK_COLOR,
  buildRiskBandSpans,
  buildRiskGradientStops,
  collectNoDataSpans,
  emptyRiskGradientStops,
  sectionLayerFilters,
  shouldRenderRisk,
  type RiskGradientPoint,
} from '../map/sectionRenderVisibility';
import {
  SECTION_START_LAYER_ID,
  SECTION_START_SOURCE_ID,
  raiseSectionStartLayer,
  sectionStartCoordinate,
  sectionStartPointPaint,
} from '../map/sectionStartPoints';
import {
  BANK_EDIT_DRAFT_HALO_LAYER_ID,
  BANK_EDIT_DRAFT_LAYER_ID,
  BANK_EDIT_DRAFT_SOURCE_ID,
  BANK_EDIT_VERTEX_HIT_LAYER_ID,
  BANK_EDIT_VERTEX_LAYER_ID,
  BANK_EDIT_VERTEX_SOURCE_ID,
  bankEditDraftHaloPaint,
  bankEditDraftPaint,
  bankEditVertexHitPaint,
  bankEditVertexPaint,
  coordsSignature,
  coordsToLineFeature,
  type BankCoord,
  deleteVertex,
  dropCoincidentVertices,
  insertVertexAfter,
  moveVertex,
  nearestPointOnBank,
  normalizeBankCoords,
  vertexFeatures,
} from '../map/bankGeometryEdit';
import BankGeometryEditBar from '../components/BankGeometryEditBar';
import {
  DEFAULT_FLOW_COLOR_SCHEME,
  FLOW_COLOR_SCHEMES,
  flowColorSchemeGradient,
  latFromMercatorY,
  type FlowColorSchemeId,
  type FlowFieldGeometry,
} from '../map/flowField';
import {
  describeCase,
  describeScene,
  fetchFlowFieldCases,
  fetchFlowFieldGeometry,
  fetchFlowFieldScenes,
  findSceneForDem,
  inferPreferredTidal,
  tidalLevelLabel,
  type FlowFieldCase,
  type FlowFieldScene,
} from '../services/flowFieldApi';
import { demBoundsOf, fetchTiffBounds } from '../services/tiffService';
import {
  formatCellValue,
  formatIndicatorResult,
} from '../utils/indicatorDisplay';
import SectionResultEditor from '../components/SectionResultEditor';
import AreaRiskAnalysisPanel, {
  type AreaAnalysisShape,
} from '../components/AreaRiskAnalysisPanel';
import {
  computeAreaRiskStats,
  type AreaAnalysisBank,
  type AreaAnalysisSection,
  type AreaRiskStats,
} from '../map/areaRiskAnalysis';
import {
  attachAreaSelection,
  ensureAreaSelectionLayers,
  hasAreaSelectionLayers,
  setAreaSelection,
  type AreaSelectionCancelReason,
} from '../map/areaSelection';
import {
  SECTION_BOX_INVALID_RULE_TEXT,
  clearSectionBoxMatch,
  paintSectionBoxMatch,
  pickSectionIdsByStartPoint,
  removeSectionBoxMatchLayers,
  sectionBoxBoundsOf,
  sectionBoxInvalidConfirmText,
  sectionBoxInvalidEmptyHint,
  splitBoxInvalidByPriorState,
  type SectionBoxCandidate,
} from '../map/sectionBoxInvalid';
import SectionBoxInvalidPanel from '../components/SectionBoxInvalidPanel';
import { useResourceTreeStore } from '../store/useResourceTreeStore';
import {
  RISK_COLORS,
  RISK_LABELS,
  RISK_MATRIX_GROUPS,
  bucketRiskValue,
  displayLevelOfResult,
  resolveIndicatorTier,
  resolveRiskParams,
  toDisplayLevel,
  type RiskIndicatorKey,
  type RiskMatrixGroup,
} from '../utils/riskScoring';

// —— Mapbox token
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

// —— AI 出图弹窗：分幅设置的输入框样式（与弹窗内既有手写样式保持一致的细边框小输入框）
const vizNumInputStyle: CSSProperties = {
  width: 52,
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  padding: '2px 6px',
  fontSize: '0.8rem',
  background: 'rgba(255,255,255,0.6)',
};
const vizEdgeInputStyle: CSSProperties = {
  width: 74,
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  padding: '2px 6px',
  fontSize: '0.78rem',
  background: 'rgba(255,255,255,0.6)',
};

// —— 分幅设置（AI 出图 与 AI 出报告 共用）
// 两处共用同一份状态形状、同一份面板与同一份 JSON 组装逻辑：用户在哪儿配的
// 分幅都走同一套语义，报告的分区边界因此必然与出图分区一致。

/** 逐幅边界的四个输入值（字符串；空串 = 沿用均分网格的对应边） */
type TileEdges = { west: string; south: string; east: string; north: string };

const EMPTY_TILE_EDGES: TileEdges = { west: '', south: '', east: '', north: '' };
const EDGE_KEYS = ['west', 'south', 'east', 'north'] as const;
const EDGE_PLACEHOLDER: Record<(typeof EDGE_KEYS)[number], string> =
  { west: '西', south: '南', east: '东', north: '北' };

/** 行×列限幅：单方向 1~6（36 幅封顶，防误操作） */
const clampGrid = (n: number) => Math.min(6, Math.max(1, Number.isFinite(n) ? n : 1));

/**
 * 逐幅边界 → splitTiles JSON：只打包非空边，row/col 按行优先序号对齐网格。
 * 出图与出报告共用，保证两处提交的分幅参数形状一致。
 */
function buildSplitTilesJson(cols: number, edges: TileEdges[]): string | undefined {
  const custom = edges.map((tile, i) => {
    const out: Record<string, number> = { row: Math.floor(i / cols), col: i % cols };
    EDGE_KEYS.forEach(key => {
      const raw = tile[key].trim();
      if (raw !== '') {
        const num = Number(raw);
        if (Number.isFinite(num)) out[key] = num;
      }
    });
    return out;
  }).filter(t => Object.keys(t).length > 2); // 至少自定义了一条边
  return custom.length > 0 ? JSON.stringify(custom) : undefined;
}

/**
 * 阈值方向：`阈值1 > 阈值3` ⇒ 该指标的阈值是**降序**，也就是「反向指标」。
 *
 * 全库 9 个指标里只有抗冲流速(Ky) 属于这种：后端 `antiImpactSpeed.py` 用 `Ky > 阈值[0]` 落第 1 档，
 * 其余 8 个（Zb/Sa/Ln/PQ/Zd/Dsed）都是 `X < 阈值[0]` 落第 1 档、阈值升序。
 * 两边的「第 N 档」语义完全一致（1 档最安全），只是**原始数值的方向相反** ——
 * 所以 Ky 偏小才会是红，不标一句「值越大越安全」会被读成「分档反了」。
 */
function thresholdDirectionOf(thresholds: any): 'asc' | 'desc' | null {
  if (!Array.isArray(thresholds) || thresholds.length < 3) return null;
  const first = Number(thresholds[0]);
  const last = Number(thresholds[2]);
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === last) return null;
  return first > last ? 'desc' : 'asc';
}

/**
 * 「按经纬度分幅」设置面板——AI 出图 与 AI 出报告 共用同一份 UI。
 * 两处配置出来的分区边界因此完全一致，报告的分区才能与出图分区对齐。
 */
function SplitSettingsPanel(props: {
  enabled: boolean;
  onToggle: (next: boolean) => void;
  rows: number;
  cols: number;
  onGridChange: (rows: number, cols: number) => void;
  edges: TileEdges[];
  onEdgesChange: (updater: (prev: TileEdges[]) => TileEdges[]) => void;
  title: string;
  hint: string;
  summary?: string;
}) {
  const { enabled, onToggle, rows, cols, onGridChange, edges, onEdgesChange,
          title, hint, summary } = props;
  return (
    <div style={{ marginTop: 14, borderTop: '1px dashed #e2e8f0', paddingTop: 10 }}>
      <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: '#444' }}>
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
        {title}{' '}
        <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>{hint}</span>
      </label>
      {enabled && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: '0.8rem', color: '#475569' }}>
            <span>分块数</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              行（纬度方向）
              <input
                type="number" min={1} max={6} value={rows}
                onChange={(e) => onGridChange(parseInt(e.target.value || '1', 10) || 1, cols)}
                style={vizNumInputStyle}
              />
            </label>
            <span>×</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              列（经度方向）
              <input
                type="number" min={1} max={6} value={cols}
                onChange={(e) => onGridChange(rows, parseInt(e.target.value || '1', 10) || 1)}
                style={vizNumInputStyle}
              />
            </label>
            <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
              某方向填 1 = 该方向不切；共 {rows * cols} 幅{summary ? ` · ${summary}` : ''}
            </span>
          </div>
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, marginTop: 8, maxHeight: 230, overflowY: 'auto', background: 'rgba(255,255,255,0.4)' }}>
            <div style={{ color: '#64748b', fontSize: '0.75rem', marginBottom: 6 }}>
              每幅经纬度边界（选填）：留空的边沿用均分网格默认值；各幅范围允许重叠，重叠部分会分别出图，互不干扰。
            </div>
            {edges.map((tileEdges, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', fontSize: '0.78rem' }}>
                <span style={{ width: 52, color: '#475569', flexShrink: 0 }}>第 {i + 1} 幅</span>
                {EDGE_KEYS.map(key => (
                  <input
                    key={key}
                    type="number"
                    step="any"
                    placeholder={EDGE_PLACEHOLDER[key]}
                    value={tileEdges[key]}
                    onChange={(e) => onEdgesChange(prev =>
                      prev.map((t, j) => (j === i ? { ...t, [key]: e.target.value } : t)))}
                    style={vizEdgeInputStyle}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
//  类型定义
// ============================================================

// 后端返回的任务结构
interface Task {
  id: number;
  task_id: string;
  task_name: string;
  bank_ids: string[];
  description: string;
  created_at: string;
  status?: string;
  run_started_at?: string | null;
  run_completed_at?: string | null;
  error_message?: string | null;
}

// 断面结构（带模型结果）
interface SectionResult {
  section_id: string;
  id?: number;
  section_name?: string;
  distance: number;
  bank_id: string;
  geometry: any;
  vertical_foot_point?: { type: 'Point'; coordinates: [number, number] } | null;
  // legacy compatibility
  anchorPoint?: number[] | null;
  risk_level?: string | number;
  indicator_result?: number | null; // 字符串(high, medium, low, no) 或 数字(1, 2, 3, 4)
  /** 该断面结果自带的 all 阈值；缺失时按默认 0.25/0.5/0.75 分级。 */
  risk_thresholds?: number[] | null;
  risk_score?: number;
  /**
   * 人工标记为无效断面：不参与着色 / 框选统计 / 报告与导出，图上按「无数据」的灰虚线画。
   *
   * <p>它是**断面**属性（`cross_sections.manual_invalid`），与结果无关 —— 有结果的断面也可能被标记，
   * 恢复有效时立刻重新上色（结果没被删）。与几何校验 `is_valid` 是两件事，别混用。
   */
  manual_invalid?: boolean;
  manual_invalid_reason?: string | null;
}

type SectionProfilePoint = {
  index?: number;
  distance?: number;
  elevation?: number;
  x?: number;
  y?: number;
};

type SectionProfile = {
  id?: number;
  task_id?: string;
  section_id?: string;
  section_name?: string;
  bank_id?: string;
  interval?: number;
  point_count?: number;
  profile_data?: {
    profile?: SectionProfilePoint[];
    interval?: number;
    points_v?: Array<[number, number, number]>;
  };
  [k: string]: any;
};

type TaskProgressSnapshot = {
  taskId: string;
  taskName?: string;
  status?: string;
  runStartedAt?: string | null;
  runCompletedAt?: string | null;
  expectedTotal: number;
  processedCount: number;
  successCount: number;
  errorCount: number;
  lastUpdatedAt: string;
  errors: Array<{
    section_id: string;
    section_name?: string;
    bank_id?: string;
    message: string;
    raw?: any;
    detail?: any;
    detailError?: string;
  }>;
};

// ============================================================
//  模块级常量 & 工具函数
// ============================================================

// 通用 fetch + JSON 解析 + 错误处理
async function fetchJSON(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text?.slice(0, 500)}`);
  return json ?? text;
}

// 通用列表解析：从后端多种返回格式中提取数组
function parseList(data: any, key?: string): any[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (key && Array.isArray(data[key])) return data[key];
  if (Array.isArray(data.profiles)) return data.profiles;
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.items)) return data.items;
  if (key && Array.isArray(data.data?.[key])) return data.data[key];
  return [];
}

// 矩阵指标分组配置统一由 utils/riskScoring 提供（与人工修改的重算共用同一份定义）
const MATRIX_GROUPS = RISK_MATRIX_GROUPS;

// ============================================================
//  岸段折点编辑：图层与拾取工具
// ============================================================

/**
 * 从色带 / 虚线图层 id 反解 bank_id。
 *
 * <p>为什么不能读 `feature.properties.bank_id`：色带的数据源是
 * `turf.lineString(coords)`，几何上没有任何属性（`bankline-source-<id>` 的 data 就是一条裸线）。
 * 而图层 id 里编了 bank_id，是唯一可靠的来源。虚线层的数据源的**有** bank_id，
 * 但两条路径各写一套判断迟早漂移，所以统一走 id 反解。
 */
function bankIdFromLayerId(layerId: string): string | null {
  for (const prefix of ['bankline-result-', 'bankline-nodata-']) {
    if (layerId.startsWith(prefix)) return layerId.slice(prefix.length);
  }
  return null;
}

/** 编辑期间要临时藏掉的两层：实色色带与灰色虚线。 */
function bankBandLayerIds(bankId: string): string[] {
  return [`bankline-result-${bankId}`, `bankline-nodata-${bankId}`];
}

/**
 * 建（或复用）编辑态图层：白描边 → 草稿线 → 折点命中层 → 折点圆点。
 *
 * <p>顺序是硬要求：命中层必须压在折点**下面**，否则点击折点时先命中的是那个
 * 透明大圆（没有 `index` 属性），拖拽会变成「点了没反应」。而命中层又必须比圆点大，
 * 那是鼠标容错，不是视觉元素。
 */
function ensureBankEditLayers(map: mapboxgl.Map) {
  if (!map.getSource(BANK_EDIT_DRAFT_SOURCE_ID)) {
    map.addSource(BANK_EDIT_DRAFT_SOURCE_ID, {
      type: 'geojson',
      data: turf.featureCollection([]),
    });
  }
  if (!map.getSource(BANK_EDIT_VERTEX_SOURCE_ID)) {
    map.addSource(BANK_EDIT_VERTEX_SOURCE_ID, {
      type: 'geojson',
      data: turf.featureCollection([]),
    });
  }

  if (!map.getLayer(BANK_EDIT_DRAFT_HALO_LAYER_ID)) {
    map.addLayer({
      id: BANK_EDIT_DRAFT_HALO_LAYER_ID,
      type: 'line',
      source: BANK_EDIT_DRAFT_SOURCE_ID,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: bankEditDraftHaloPaint() as any,
    });
  }
  if (!map.getLayer(BANK_EDIT_DRAFT_LAYER_ID)) {
    map.addLayer({
      id: BANK_EDIT_DRAFT_LAYER_ID,
      type: 'line',
      source: BANK_EDIT_DRAFT_SOURCE_ID,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: bankEditDraftPaint() as any,
    });
  }
  if (!map.getLayer(BANK_EDIT_VERTEX_HIT_LAYER_ID)) {
    map.addLayer({
      id: BANK_EDIT_VERTEX_HIT_LAYER_ID,
      type: 'circle',
      source: BANK_EDIT_VERTEX_SOURCE_ID,
      paint: bankEditVertexHitPaint() as any,
    });
  }
  if (!map.getLayer(BANK_EDIT_VERTEX_LAYER_ID)) {
    map.addLayer({
      id: BANK_EDIT_VERTEX_LAYER_ID,
      type: 'circle',
      source: BANK_EDIT_VERTEX_SOURCE_ID,
      paint: bankEditVertexPaint() as any,
    });
  }
}

/** 拆掉编辑态图层。退出编辑时调用，避免留一条「看得见但拖不动」的青色线。 */
function removeBankEditLayers(map: mapboxgl.Map) {
  [BANK_EDIT_VERTEX_LAYER_ID, BANK_EDIT_VERTEX_HIT_LAYER_ID, BANK_EDIT_DRAFT_LAYER_ID, BANK_EDIT_DRAFT_HALO_LAYER_ID]
    .forEach(layerId => {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
    });
  [BANK_EDIT_VERTEX_SOURCE_ID, BANK_EDIT_DRAFT_SOURCE_ID].forEach(sourceId => {
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  });
}

/**
 * 把草稿折点推给地图。
 *
 * <p>拖拽过程中**每帧只调这个函数**，不走 React setState ——
 * 一条岸段平均上百个折点，每帧全页重渲染会让拖拽明显掉帧。
 * 折点数据在拖拽结束后才写回 state（见 mouseup）。
 */
function pushBankEditDraft(map: mapboxgl.Map, coords: BankCoord[]) {
  const draftSrc = map.getSource(BANK_EDIT_DRAFT_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
  if (draftSrc) draftSrc.setData(coordsToLineFeature(coords) as any);
  const vertexSrc = map.getSource(BANK_EDIT_VERTEX_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
  if (vertexSrc) vertexSrc.setData(vertexFeatures(coords) as any);
}


/**
 * 「无数据」虚线带的线宽倍率（相对实色色带）。
 *
 * 刻意比色带细：无数据段**不是一种等级**，跟彩色带同宽同位置会让它读起来像第 5 档；
 * 细一档之后「灰 + 虚线 + 更窄」三重信号叠在一起，才不会被误读。
 * 同时窄一点也给小比例尺下密集的平行岸段让位（见 map/bankShadeWidth.ts 的曲线理由）。
 */
const NO_DATA_BAND_WIDTH_SCALE = 0.75;

interface ResultPageProps {
  initialTaskId?: string;
}

function ResultPage(props: ResultPageProps) {
  const { initialTaskId } = props;

  // ============================================================
  //  Refs & State
  // ============================================================
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  const selectedTaskRef = useRef<string | null>(null);
  const autoOpenTaskRef = useRef<string | null>(null);

  const pollTimerRef = useRef<number | null>(null);
  const activePollTaskIdRef = useRef<string | null>(null);
  const lastSectionsByTaskRef = useRef<Record<string, SectionResult[]>>({});
  const sectionIndicatorResultCacheRef = useRef<Record<string, Record<string, number | null>>>({});
  const sectionIndicatorResultPromiseRef = useRef<Record<string, Record<string, Promise<number | null> | null>>>({});
  /** 每条结果自带的 all 阈值（人工修改后分级必须用它，不能写死 0.25/0.5/0.75）。 */
  const sectionRiskThresholdsRef = useRef<Record<string, Record<string, number[] | null>>>({});
  /** 当前打开的地图 Popup：保存后要把它关掉，避免悬停卡片仍显示旧等级。 */
  const activePopupRef = useRef<mapboxgl.Popup | null>(null);
  const activePopupSectionIdRef = useRef<string | null>(null);
  const bankGeometryCacheRef = useRef<Record<string, GeoJSON.LineString | null>>({});
  /**
   * 断面→色带位置的缓存。值是 `签名 + 位置`：签名由断面几何与岸段长度组成，
   * 断面没动就直接复用，动了签名变、自然重算。
   * 必要性：投影是 O(断面数 × 岸段顶点数)，而色带跟着轮询每几秒重绘一次，
   * 不缓存的话整条岸线的重绘会被这一步拖到秒级。
   */
  const bandProgressCacheRef = useRef<Map<string, { signature: string; progress: number | null }>>(new Map());
  /**
   * 每条岸段「只剩可见区间」的几何切片，供 `uploaded-data` 的灰色底线使用。
   *
   * 为什么需要：色带（`bankline-result-*`）用 line-gradient 局部透明就够了，但底下那条
   * 贯穿全程的 2px 灰线不会断开，视觉上仍然读作「岸段还在」。这里按与色带完全相同的
   * 区间口径把它切成碎片，不可见的区间直接不输出 —— 于是岸段看起来真的是断的。
   *
   * 按 bank 分开存是为了支持 `onlyBankId` 的单岸段局部刷新：只替换该岸段那一条，
   * 再整体合并 setData，不会把其它岸段刷掉。
   */
  const bankVisibleSegmentsRef = useRef<Record<string, GeoJSON.Feature[]>>({});

  // ==================== 岸段折点编辑 ====================
  //
  // 编辑的对象是 `banks` 表里的岸段几何，**不是**当前任务的副本 —— 岸段是用户级共享资源
  // （没有 task_id），所以改一条会同时挪动所有引用它的任务的色带。这一点在浮栏里显式提示。
  //
  // 编辑期间：
  //   * 该岸段的实色色带与灰色虚线被临时藏掉，改由青色草稿线承担视觉（避免旧位置还留着颜色）；
  //   * `applyShorelineGradient` 整段跳过（见 bankEditActiveRef 闸门），否则轮询每 2 秒
  //     会把色带按旧几何画回去，用户看到的是「线在跳」。
  const [bankEditTarget, setBankEditTarget] = useState<{ bankId: string; bankName: string } | null>(null);
  const [bankEditCoords, setBankEditCoords] = useState<BankCoord[] | null>(null);
  const [bankEditUsage, setBankEditUsage] = useState<{ taskCount: number; sectionCount: number } | null>(null);
  const [bankEditPicking, setBankEditPicking] = useState(false);
  const [bankEditSaving, setBankEditSaving] = useState(false);
  const [bankEditDirty, setBankEditDirty] = useState(false);
  /**
   * 撤销 / 重做栈。栈里存**整份折点数组**而不是 diff：
   * 折点最多一两千个，一次拷贝几十 KB，比维护一套「反向操作」可靠得多
   * （反向操作要在拖动、插入、删除三条路径上各自写对，错一处就会撤销出错误几何）。
   */
  const bankEditHistoryRef = useRef<{ stack: BankCoord[][]; cursor: number }>({ stack: [], cursor: -1 });
  /** 只为了让撤销/重做按钮的禁用态跟着栈变 —— 栈本身放 ref，不参与渲染。 */
  const [bankEditHistoryVersion, setBankEditHistoryVersion] = useState(0);
  /** 正在拖的折点下标；null = 没在拖。 */
  const bankEditDragRef = useRef<{ index: number } | null>(null);
  /** 供地图事件回调读取最新值（事件闭包捕获的是注册那一刻的 state，读 state 会拿到旧值）。 */
  const bankEditTargetRef = useRef<{ bankId: string; bankName: string } | null>(null);
  const bankEditCoordsRef = useRef<BankCoord[] | null>(null);
  /** 编辑期闸门：true 时色带重绘整体跳过。 */
  const bankEditActiveRef = useRef(false);
  /**
   * 「正在选岸段」的镜像。断面点击处理器是在 renderSections 里一次性赋值的，
   * 那里读 state 只能读到赋值那一刻的值 ⇒ 必须走 ref，否则选岸段时点断面仍会弹矩阵。
   */
  const bankEditPickingRef = useRef(false);
  /** 提交一步折点改动的函数。用 ref 持有，避免地图事件监听随每次渲染重建。 */
  const bankEditCommitRef = useRef<((next: BankCoord[]) => void) | null>(null);

  const sectionClickHandlerRef = useRef<((e: any) => void) | null>(null);
  const sectionEnterHandlerRef = useRef<(() => void) | null>(null);
  const sectionLeaveHandlerRef = useRef<(() => void) | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const [taskList, setTaskList] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSections, setShowSections] = useState(true);
  // 任务搜索（T0：纯前端本地过滤，零后端改动）
  // 分两个 state：input 是输入框实时值，query 是「已提交」的关键字（点搜索按钮/回车才同步）
  const [taskSearchInput, setTaskSearchInput] = useState('');
  const [taskSearchQuery, setTaskSearchQuery] = useState('');

  const [progressOpen, setProgressOpen] = useState(false);
  const [progress, setProgress] = useState<TaskProgressSnapshot | null>(null);
  /** 「终止」请求在途：按钮置灰防重复点（协作式取消可能要等一条模型调用才算完） */
  const [cancelling, setCancelling] = useState(false);
  const [expandedErrorIds, setExpandedErrorIds] = useState<Record<string, boolean>>({});

  const [matrixOpen, setMatrixOpen] = useState(false);
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [matrixError, setMatrixError] = useState<string | null>(null);
  const [matrixSectionId, setMatrixSectionId] = useState<string | null>(null);
  const [matrixSectionName, setMatrixSectionName] = useState<string | null>(null);
  const [matrixDetail, setMatrixDetail] = useState<any | null>(null);
  /** 矩阵弹窗是否处于「人工修改」态 */
  const [resultEditing, setResultEditing] = useState(false);
  /** 「人工无效」标记提交中：只锁那一个按钮，不锁整个弹窗（用户仍可看图表）。 */
  const [invalidSaving, setInvalidSaving] = useState(false);
  /** 轻量提示：保存成功后给一句明确反馈（出图/报告不会自动变，也要在这里说清） */
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  const [chatCollapsed, setChatCollapsed] = useState<boolean>(false);
  const [satellite, setSatellite] = useState<boolean>(false);
  // —— 流场（水动力粒子图层）
  // 素材只在模型服务里，经 Java 后端 /v0/bank/flow-field/** 代理转发；见 topics/flow-field.md。
  const flowLayerRef = useRef<FlowFieldLayer | null>(null);
  const flowGeometryRef = useRef<FlowFieldGeometry | null>(null);
  /** 在途的工况清单请求，用于 StrictMode 双挂载时去重（见下方 effect 注释） */
  const flowCasesRequestRef = useRef<Promise<unknown> | null>(null);
  /**
   * 清单是否已经拉到过一次（无论成功还是失败）。
   *
   * 用"结果长度 > 0"当守卫会在**两边都返回空**时变成死循环：effect 跑完 → 长度仍是 0 →
   * 依赖变化或重渲染又跑一次 → 再打两个请求。服务器上真有一个场景都没有的时候，那就是一直打。
   */
  const flowListSettledRef = useRef<boolean>(false);
  const [flowEnabled, setFlowEnabled] = useState<boolean>(false);
  const [flowCases, setFlowCases] = useState<FlowFieldCase[]>([]);
  /** 按场景生成的流场（覆盖整片 DEM）。与 flowCases 共用同一套取数路径，只是 id 形态不同。 */
  const [flowScenes, setFlowScenes] = useState<FlowFieldScene[]>([]);
  const [flowCaseId, setFlowCaseId] = useState<string>('');
  /**
   * 用户是否手动挑过工况/场景。
   *
   * 【为什么需要它】默认行为是"跟着所选任务的 DEM 自动切场景"，但如果用户已经手动选了
   * 某个工况，再被自动切走就很烦。这一位一旦置起，自动切换就永久让位给用户的选择。
   */
  const flowUserPickedRef = useRef<boolean>(false);
  /**
   * `tiff-bounds` 的惰性缓存。
   *
   * 自动选场景的"被包含"那一级要知道任务 DEM 自己的范围，而这份数据只有 `tiff-bounds` 接口有
   * （场景清单里只有场景自己的范围）。它跟流场没关系，所以**只在真的需要时**才拉一次，
   * 并且把 promise 存起来 —— 同一个页面里多个任务来回切时不会重复请求。
   */
  const tiffBoundsPromiseRef = useRef<Promise<GeoJSON.FeatureCollection | null> | null>(null);
  const loadTiffBounds = () => {
    if (!tiffBoundsPromiseRef.current) {
      tiffBoundsPromiseRef.current = fetchTiffBounds();
    }
    return tiffBoundsPromiseRef.current;
  };
  /** 当前生效的场景（选了场景才有值），用来在面板上显示"覆盖整片 DEM"的说明。 */
  const activeFlowScene = useMemo(
    () => flowScenes.find((scene) => scene.sceneId === flowCaseId) ?? null,
    [flowScenes, flowCaseId],
  );
  const [flowStatus, setFlowStatus] = useState<FlowFieldStatus | null>(null);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [flowCasesLoading, setFlowCasesLoading] = useState<boolean>(false);
  /** 流场配色：换配色走 setParameters，不重建图层（重建会白丢已下载的 26 帧纹理）。 */
  const [flowColorScheme, setFlowColorScheme] = useState<FlowColorSchemeId>(DEFAULT_FLOW_COLOR_SCHEME);
  const flowColorSchemeRef = useRef<FlowColorSchemeId>(flowColorScheme);
  const [resizeTrigger, setResizeTrigger] = useState(0);
  const [leftPanelWidth, setLeftPanelWidth] = useState(350);
  const [rightPanelWidth, setRightPanelWidth] = useState(350);
  const [reportTabs, setReportTabs] = useState<ReportTab[]>([]);
  const [activeReportTab, setActiveReportTab] = useState(0);
  const [workspaceHeight, setWorkspaceHeight] = useState(300);
  const [generatingTaskId, setGeneratingTaskId] = useState<string | null>(null);
  const [reportList, setReportList] = useState<any[]>([]);
  const [activeSidebarPanel, setActiveSidebarPanel] = useState<'tasks' | 'reports' | 'progress' | 'skills'>('tasks');
  const [vizTarget, setVizTarget] = useState<{ taskId: string; taskName: string } | null>(null);
  const [vizMode, setVizMode] = useState<'merged' | 'per_bank'>('per_bank');
  const [vizBanks, setVizBanks] = useState<string[]>([]);
  const [vizSelected, setVizSelected] = useState<string[]>([]);
  const [vizBankCounts, setVizBankCounts] = useState<Record<string, number>>({});
  const [vizGenerating, setVizGenerating] = useState(false);
  // 分幅出图：每张图再按经纬度切成 行×列 幅子图；每幅四项边界均为字符串，
  // 留空 = 该边沿用均分网格默认值；各幅范围允许重叠，重叠部分分别出图。
  const [vizSplit, setVizSplit] = useState(false);
  const [vizSplitRows, setVizSplitRows] = useState(1);
  const [vizSplitCols, setVizSplitCols] = useState(1);
  const [vizTileEdges, setVizTileEdges] = useState<TileEdges[]>([]);

  // —— AI 出报告：与出图完全相同的分幅语义（同一份面板、同一份 JSON 组装）
  const [rptSplit, setRptSplit] = useState(false);
  const [rptSplitRows, setRptSplitRows] = useState(1);
  const [rptSplitCols, setRptSplitCols] = useState(1);
  const [rptTileEdges, setRptTileEdges] = useState<TileEdges[]>([]);
  const [taskMenu, setTaskMenu] = useState<{ x: number; y: number; taskId: string; taskName: string } | null>(null);

  /**
   * 任务 → 有效结果条数。右键菜单「分析」的前置条件靠它判断。
   *
   * 缺失（`undefined`）代表"还不知道"（接口没回来 / 老后端没有这个接口），
   * 这时菜单项**可点**，点下去由 `startAreaAnalysis` 自己再确认真空 —— 不能因为
   * 一次计数接口失败就把功能锁死。0 才是明确"没有结果"。
   */
  const [resultCountByTask, setResultCountByTask] = useState<Record<string, number>>({});
  /**
   * 计数是否已经成功取到过一次。
   *
   * <p>这一位决定"缺失"怎么解释：取到了 ⇒ 没出现在 map 里就是 0 条（`GROUP BY` 不会给
   * 零结果的任务发一行）；没取到（接口 404 / 网络失败）⇒ 缺失只能算"不知道"，
   * 这时不能把整列任务的「分析」都锁上。
   */
  const [resultCountsReady, setResultCountsReady] = useState(false);

  /**
   * 框选分析会话。null = 没在分析；`drawing` = 正在等用户画选区。
   *
   * `selection` 存的是已经画好的 Polygon（矩形也转成 Polygon），既用于地图上重绘，
   * 也用于面板里"关掉再打开"时复用；`stats` 是它的统计结果，两者同时失效。
   */
  const [areaAnalysis, setAreaAnalysis] = useState<{
    taskId: string;
    taskName: string;
    shape: AreaAnalysisShape;
    drawing: boolean;
    selection: GeoJSON.Feature<GeoJSON.Polygon> | null;
    stats: AreaRiskStats | null;
  } | null>(null);
  /** 给绘制 effect 读的实时会话（effect 里不能闭包旧 state，否则画完一次就再也算不出新选区） */
  const areaAnalysisRef = useRef<typeof areaAnalysis>(null);
  areaAnalysisRef.current = areaAnalysis;

  /**
   * 「框选设为无效断面」会话。与 `areaAnalysis` 互斥：两者共用同一套选区图层与左键，
   * 同时开着会互相抢鼠标（一个想拖矩形、一个想点地图）。
   *
   * <p>`matched` 只在松手后算定；拖拽期间面板读 `draftCount`（每帧更新，但只在数字变化时
   * setState，否则拖一次要重渲染整棵结果页几十次）。`undoIds` = 本次真正从「有效」改成
   * 「无效」的那批，撤销只回滚它。
   */
  const [sectionBoxInvalid, setSectionBoxInvalid] = useState<{
    taskId: string;
    taskName: string;
    drawing: boolean;
    selection: GeoJSON.Feature<GeoJSON.Polygon> | null;
    matched: string[];
    alreadyInvalid: number;
    draftCount: number;
    /** 本次已经生效的条数（0 = 还没应用）。与 `undoIds` 分开：全部命中断面本来就无效时，
     *  生效了 N 条但可撤销 0 条 —— 用撤销数反推「是否已应用」会让按钮又亮起来。 */
    appliedCount: number;
    /** 可撤销的那批（本次真正从「有效」改成「无效」的），撤销只回滚它 */
    undoIds: string[];
    applying: boolean;
  } | null>(null);
  const sectionBoxInvalidRef = useRef<typeof sectionBoxInvalid>(null);
  sectionBoxInvalidRef.current = sectionBoxInvalid;
  /** 上一次写进面板的草稿命中数：拖拽每帧都会来，只有数字变了才需要动 React。 */
  const boxMatchCountRef = useRef<number>(-1);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const panel = searchParams.get('panel');
    if (panel === 'tasks' || panel === 'reports' || panel === 'progress' || panel === 'skills') {
      setActiveSidebarPanel(panel);
    }
  }, [searchParams]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [skillList, setSkillList] = useState<any[]>([]);
  const [chatTasks, setChatTasks] = useState<{ taskId: string; taskName: string }[]>([]);
  const [chatReports, setChatReports] = useState<{ filename: string; taskId: string }[]>([]);

  const profilesCacheRef = useRef<Record<string, Record<string, SectionProfile>>>({});
  const profilesPromiseRef = useRef<Record<string, Promise<Record<string, SectionProfile>> | null>>({});
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileDetail, setProfileDetail] = useState<SectionProfile | null>(null);
  const [regenerateTarget, setRegenerateTarget] = useState<{ taskId: string; taskName: string } | null>(null);
  /** 出报告弹窗的语义：首次生成 / 已存在报告再生成（仅影响文案） */
  const [reportDialogMode, setReportDialogMode] = useState<'create' | 'regenerate'>('create');

  // ============================================================
  //  API 请求 & 报告生成
  // ============================================================

  /**
   * 生成报告。
   *
   * @param split 按经纬度分幅参数（可选）。语义与「AI 出图」完全一致：
   *              同一个 rows×cols 网格 + 同一份逐幅边界 → 出图与报告用同一组分区。
   *              不传 = 不分幅，报告结构与历史版本一致。
   */
  const doGenerateReport = async (
    taskId: string,
    taskName: string,
    split?: { rows: number; cols: number; tiles?: string },
  ) => {
    setGeneratingTaskId(taskId);
    const ts = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    console.log(`[doGenerateReport] 开始生成报告: taskId=${taskId}, split=${split ? `${split.rows}x${split.cols}` : '无'}, 时间=${ts}`);
    try {
      // 不分幅时**不带请求体**，与历史行为逐字节一致
      const init: RequestInit = { method: 'POST' };
      if (split) {
        init.headers = { 'Content-Type': 'application/json' };
        init.body = JSON.stringify({
          splitRows: split.rows,
          splitCols: split.cols,
          ...(split.tiles ? { splitTiles: split.tiles } : {}),
        });
      }
      const res = await fetch(`/v0/bank/ai/agent/report/task/${taskId}`, init);
      const data = await res.json();
      console.log(`[doGenerateReport] API 响应:`, data);
      if (data.success && data.data) {
        const content = String(data.data).replace(/\.\/([^\s)]+\.png)/g, '/v0/bank/ai/viz-output/$1');
        const newTab: ReportTab = { taskId, taskName: `${taskName} (${ts})`, content, filename: data.filename };
        const prevLength = reportTabs.length;
        setReportTabs(prev => [...prev, newTab]);
        setActiveReportTab(prevLength);
        console.log(`[doGenerateReport] 新增标签页: 索引=${prevLength}, 标签总数=${prevLength + 1}`);
        if (prevLength === 0) setWorkspaceHeight(300);
      } else {
        console.error(`[doGenerateReport] API 返回失败:`, data.error);
        alert(translateError(data.error || '未知错误'));
      }
    } catch (e: any) {
      console.error(`[doGenerateReport] 网络异常:`, e.message);
      alert(translateError(e.message || '网络错误'));
    } finally {
      setGeneratingTaskId(null);
    }
  };

  /**
   * 打开出报告弹窗。**总是弹窗**（而不是首次直接生成）——弹窗里要能配置
   * 「按经纬度分幅」，否则首次生成根本没有机会设置分区。默认不分幅，
   * 直接点「生成报告」即等价于历史行为。
   */
  const handleGenerateReport = (taskId: string, taskName: string) => {
    const existsInList = reportList.some((r: any) => r.taskId === taskId);
    setReportDialogMode(existsInList ? 'regenerate' : 'create');
    setRegenerateTarget({ taskId, taskName });
  };

  /** 打开出图弹窗：先拉该任务断面，按岸段聚合出可选清单 */
  const openVizDialog = async (taskId: string, taskName: string) => {
    setVizTarget({ taskId, taskName });
    setVizMode('per_bank');
    setVizBanks([]);
    setVizSelected([]);
    setVizBankCounts({});
    setVizSplit(false);
    setVizSplitRows(1);
    setVizSplitCols(1);
    setVizTileEdges([]);
    try {
      const res = await fetch(`/v0/bank/sections?task_id=${encodeURIComponent(taskId)}`);
      const js = await res.json().catch(() => null);
      const raw = js?.sections ?? js?.data ?? js;
      const list: any[] = Array.isArray(raw) ? raw : [];
      const counts: Record<string, number> = {};
      list.forEach((s: any) => {
        const bid = String(s?.bank_id ?? s?.bankId ?? '');
        if (bid) counts[bid] = (counts[bid] || 0) + 1;
      });
      const banks = Object.keys(counts).sort();
      setVizBankCounts(counts);
      setVizBanks(banks);
      setVizSelected(banks);
    } catch {
      // 拉不到清单时不再传 bankIds，由后端按任务解析全部有结果的岸段
    }
  };

  /** 分块数钳制：单方向 1~6（6×6=36 幅封顶，防止误操作产生上百个 Python 进程） */
  /** 调整 行×列：同步把逐幅边界数组伸缩到 rows*cols 项（保留已填内容） */
  const applyVizSplitGrid = (rows: number, cols: number) => {
    const r = clampGrid(rows);
    const c = clampGrid(cols);
    setVizSplitRows(r);
    setVizSplitCols(c);
    setVizTileEdges(prev =>
      Array.from({ length: r * c }, (_, i) => prev[i] ?? { ...EMPTY_TILE_EDGES }));
  };

  /** 出报告的分幅 行×列 调整（与出图同一套限幅/伸缩规则） */
  const applyRptSplitGrid = (rows: number, cols: number) => {
    const r = clampGrid(rows);
    const c = clampGrid(cols);
    setRptSplitRows(r);
    setRptSplitCols(c);
    setRptTileEdges(prev =>
      Array.from({ length: r * c }, (_, i) => prev[i] ?? { ...EMPTY_TILE_EDGES }));
  };

  /** 触发批量出图，并把返回的图片清单渲染成一个报告标签页 */
  const runViz = async () => {
    if (!vizTarget) return;
    setVizGenerating(true);
    try {
      const splitTilesJson = vizSplit ? buildSplitTilesJson(vizSplitCols, vizTileEdges) : undefined;
      const res = await fetch('/v0/bank/ai/viz/risk-map/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: vizTarget.taskId,
          mode: vizMode,
          bankIds: vizMode === 'per_bank' ? vizSelected : [],
          ...(vizSplit ? { splitRows: vizSplitRows, splitCols: vizSplitCols } : {}),
          ...(splitTilesJson ? { splitTiles: splitTilesJson } : {}),
        }),
      });
      const data = await res.json();
      if (!data?.success) {
        alert(translateError(data?.error || '出图失败'));
        return;
      }
      const ts = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const images: any[] = Array.isArray(data.images) ? data.images : [];
      const splitOn = vizSplit && (vizSplitRows > 1 || vizSplitCols > 1 || !!splitTilesJson);
      const lines: string[] = [
        '# AI 出图结果', '',
        `**任务**：${vizTarget.taskName}（${vizTarget.taskId}）`, '',
        `**模式**：${data.mode === 'per_bank' ? '按岸段分开出图' : '合并出图（整任务一张）'}`,
        splitOn ? `（分幅 ${vizSplitRows} 行 × ${vizSplitCols} 列）` : '', '',
        `**结果**：成功 ${data.succeeded} / 共 ${data.total} 张`,
        (data.imageTotal > data.total ? `（分幅展开共 ${data.imageTotal} 幅子图）` : ''), '',
      ];
      let rendered = 0;
      images.forEach((img: any) => {
        const title = img.bankName || img.bankId || '岸段风险分布图';
        // 分幅条目：images[] 为多幅子图（行优先），逐幅渲染
        if (img.success && Array.isArray(img.images) && img.images.length > 0) {
          lines.push(`### ${title}（分幅 ${img.images.length} 幅）`, '');
          img.images.forEach((sub: any, i: number) => {
            const label = `第 ${i + 1}/${img.images.length} 幅`;
            const range = Array.isArray(sub.bbox)
              ? `（lng ${sub.bbox[0]}~${sub.bbox[2]}，lat ${sub.bbox[1]}~${sub.bbox[3]}）` : '';
            rendered++;
            lines.push(`**${label}**${range}`, '');
            lines.push(sub.url ? `![${label}](${sub.url})` : `> ${label} 缺失文件`);
            lines.push('');
          });
          return;
        }
        lines.push(`### ${title}`, '');
        if (img.success && img.url) {
          rendered++;
          lines.push(`![${title}](${img.url})`);
        } else {
          lines.push(`> 出图失败：${img.error || '未知错误'}`);
        }
        lines.push('');
      });
      const content = lines.join('\n');
      // 持久化：出图结果原本只活在内存标签页里，关掉页面/窗口就找不回来了。
      // 这里把**同一份** markdown 落盘到「报告查看」目录（kind=viz），
      // 出图接口、分幅参数、返回结构全都不动 —— 生成流程本身没有任何改变，
      // 只是在出图成功后多写一个索引文件。图片本身一直在 viz_ 目录里，不会丢。
      try {
        await fetch('/v0/bank/ai/reports/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: vizTarget.taskId, kind: 'viz', content }),
        });
        void fetchReportList();
      } catch {
        // 落盘失败不影响本次查看，也不该让已经出好的图打不开
      }
      const prevLength = reportTabs.length;
      setReportTabs(prev => [...prev, {
        taskId: vizTarget.taskId,
        taskName: `出图 · ${vizTarget.taskName} (${ts})`,
        content,
      }]);
      setActiveReportTab(prevLength);
      if (prevLength === 0) setWorkspaceHeight(300);
      setVizTarget(null);
    } catch (e: any) {
      alert(translateError(e?.message || '网络错误'));
    } finally {
      setVizGenerating(false);
    }
  };

  /** 右键任务卡片弹出操作菜单，位置按视口边界收敛 */
  const openTaskMenu = (e: ReactMouseEvent<HTMLDivElement>, task: { task_id: string; task_name: string }) => {
    e.preventDefault();
    e.stopPropagation();
    const MENU_W = 200;
    // 五个操作项 + 标题 ≈ 190px；少估会让最后一行的菜单被视口底边裁掉
    const MENU_H = 220;
    // 顺手刷一次结果计数：刚在编辑器算完就切回来右键时，缓存的 0 会把「分析」错误置灰
    void refreshResultCounts();
    setTaskMenu({
      x: Math.max(8, Math.min(e.clientX, window.innerWidth - MENU_W - 8)),
      y: Math.max(8, Math.min(e.clientY, window.innerHeight - MENU_H - 8)),
      taskId: task.task_id,
      taskName: task.task_name,
    });
  };

  /** 菜单打开时：点击空白 / 右键别处 / 滚动 / Esc 都关闭 */
  useEffect(() => {
    if (!taskMenu) return;
    const close = () => setTaskMenu(null);
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setTaskMenu(null); };
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [taskMenu]);

  const handleExportSectionsDetail = async (taskId: string, taskName: string) => {
    try {
      const sectionsRes = await fetch(`/v0/bank/sections?task_id=${encodeURIComponent(taskId)}`);
      if (!sectionsRes.ok) throw new Error('获取断面列表失败');
      const sectionsJs = await sectionsRes.json().catch(() => null);
      const sections: any[] = (sectionsJs?.sections ?? sectionsJs?.data ?? sectionsJs) || [];

      const resultsRes = await fetch(`/v0/bank/results?task_id=${encodeURIComponent(taskId)}`);
      const resultsJs = resultsRes.ok ? await resultsRes.json().catch(() => null) : null;
      const resultsList: any[] = parseList(resultsJs);

      const detailPromises = sections.map(async (s: any) => {
        try {
          const r = await fetch(`/v0/bank/results/${encodeURIComponent(s.section_id)}`);
          if (!r.ok) return null;
          return await r.json().catch(() => null);
        } catch { return null; }
      });
      const details = await Promise.all(detailPromises);

      // 收集所有指标 key（动态列）
      const indicatorKeys = new Set<string>();
      details.forEach(d => {
        if (!d) return;
        const ind = d?.indicators ?? d?.result?.indicators ?? d?.data?.indicators ?? d?.data?.result?.indicators;
        if (ind && typeof ind === 'object') {
          Object.keys(ind).forEach(k => indicatorKeys.add(k));
        }
      });
      const indKeys = Array.from(indicatorKeys).sort();

      const esc = (v: any): string => {
        if (v === null || v === undefined) return '';
        const s = String(v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };

      const headers = [
        '断面ID', '断面名称', '沿程距离(m)', '岸段ID', '风险等级', '状态', '信息',
        '垂足经度', '垂足纬度', '起点经度', '起点纬度', '终点经度', '终点纬度',
        ...indKeys,
      ];

      const rows: string[] = [headers.map(esc).join(',')];

      sections.forEach((s: any, i: number) => {
        const rid = s.section_id;
        const matched = resultsList.find((r: any) =>
          r?.section_id === rid || r?.id === rid || r?.section?.section_id === rid,
        );
        const geom = s.geometry ?? s.section_geometry;
        const coords = geom?.coordinates as number[][] | undefined;
        const vfp = s.vertical_foot_point?.coordinates as number[] | undefined;
        const detail = details[i];
        const ind = detail?.indicators ?? detail?.result?.indicators ?? detail?.data?.indicators ?? detail?.data?.result?.indicators;

        const riskLabel = (() => {
          const lv = matched?.risk_level ?? matched?.riskLevel ?? s.risk_level;
          if (lv === null || lv === undefined) return '';
          const n = Number(lv);
          if (!Number.isFinite(n)) return String(lv);
          return RISK_LABELS[n] ?? String(lv);
        })();

        const row = [
          s.section_id, s.section_name, s.distance, s.bank_id,
          riskLabel, matched?.status ?? '', matched?.message ?? '',
          vfp?.[0] ?? '', vfp?.[1] ?? '',
          coords?.[0]?.[0] ?? '', coords?.[0]?.[1] ?? '',
          coords?.[coords.length - 1]?.[0] ?? '', coords?.[coords.length - 1]?.[1] ?? '',
          ...indKeys.map(k => ind?.[k] ?? ''),
        ];
        rows.push(row.map(esc).join(','));
      });

      const csv = '\uFEFF' + rows.join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `断面详情_${taskName}_${new Date().toISOString().slice(0, 10)}.csv`;
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      // 同一次导出再取一份「风险段汇总」（连续同类风险段的位置 / 长度 km / 占比）。
      // 计算口径只在后端 RiskSegmentSummaryService 里有一份，前端不重算 ——
      // 否则两套实现迟早对不上，而且「长度/占比」这类数字对不上最难解释。
      // 汇总失败不影响已经下载成功的明细表，只提示一句。
      try {
        const segRes = await fetch(`/v0/bank/risk-segments/export?task_id=${encodeURIComponent(taskId)}`);
        if (!segRes.ok) throw new Error(`HTTP ${segRes.status}`);
        const segBlob = await segRes.blob();
        const segUrl = URL.createObjectURL(segBlob);
        const segLink = document.createElement('a');
        segLink.href = segUrl;
        const disposition = segRes.headers.get('Content-Disposition');
        const utf8Name = disposition && /filename\*=UTF-8''([^;]+)/i.exec(disposition);
        segLink.download = utf8Name
          ? decodeURIComponent(utf8Name[1].trim())
          : `风险段汇总_${taskName}_${new Date().toISOString().slice(0, 10)}.csv`;
        segLink.style.visibility = 'hidden';
        document.body.appendChild(segLink);
        segLink.click();
        document.body.removeChild(segLink);
        URL.revokeObjectURL(segUrl);
      } catch (segErr) {
        console.warn('导出风险段汇总失败（断面明细已下载）:', segErr);
        alert('断面明细已下载，但「风险段汇总」导出失败，请稍后重试。');
      }
    } catch (err: any) {
      console.error('导出断面详情失败:', err);
      alert(`导出失败: ${err.message || err}`);
    }
  };

  const fetchReportList = async () => {
    try {
      const res = await fetch('/v0/bank/ai/reports');
      const data = await res.json();
      if (data.success) setReportList(data.reports || []);
    } catch { /* ignore */ }
  };

  const fetchSkills = async () => {
    try {
      const res = await fetch('/v0/bank/ai/skill/list');
      const data = await res.json();
      if (data.success) setSkillList(data.skills || []);
    } catch { /* ignore */ }
  };

  const openReport = async (filename: string) => {
    try {
      const res = await fetch(`/v0/bank/ai/reports/${encodeURIComponent(filename)}`);
      const data = await res.json();
      if (data.success && data.content) {
        const content = String(data.content).replace(/\.\/([^\s)]+\.png)/g, '/v0/bank/ai/viz-output/$1');
        // 文件名两类：report_<taskId>_<ts>.md / viz_<taskId>_<ts>.md（AI 出图结果）
        const taskId = filename.replace(/^(report|viz)_/, '').replace(/_\d{8}_\d{6}\.md$/, '');
        handleTaskClick(taskId);
        setReportTabs(prev => {
          const existing = prev.findIndex(t => t.filename === filename);
          const tab: ReportTab = { taskId, taskName: filename, content, filename };
          if (existing >= 0) {
            const next = [...prev];
            next[existing] = tab;
            setActiveReportTab(existing);
            return next;
          }
          setActiveReportTab(prev.length);
          if (prev.length === 0) setWorkspaceHeight(300);
          return [...prev, tab];
        });
      }
    } catch { /* ignore */ }
  };

  const translateError = (msg: string) => {
    const m = msg.toLowerCase();
    if (m.includes('insufficient balance') || m.includes('402') || m.includes('insufficient_balance')) {
      return 'DeepSeek API 余额不足，请前往 platform.deepseek.com 充值后再试。';
    }
    if (m.includes('401') || m.includes('unauthorized')) {
      return 'API Key 无效或已过期，请检查配置。';
    }
    if (m.includes('429') || m.includes('rate limit')) {
      return 'API 请求过于频繁，请稍后再试。';
    }
    if (m.includes('timeout') || m.includes('timed out')) {
      return '请求超时，请检查网络后重试。';
    }
    return '报告生成失败: ' + msg;
  };

  useEffect(() => {
    selectedTaskRef.current = selectedTask;
  }, [selectedTask]);

  useEffect(() => {
    if (!initialTaskId) return;
    setSelectedTask(initialTaskId);
  }, [initialTaskId]);

  const parseProfilesList = (data: any): any[] => parseList(data, 'profiles');

  // — 断面剖面数据加载与缓存
  //
  // 注意这是「一次性快照」：一次请求把整个任务的剖面都拉下来，之后整个会话都复用。
  // 任务运行期间剖面是逐条入库的，快照里不会自动包含后跑出来的断面 ——
  // 所以 openMatrixDetail 里对 miss 的 section 还有一次单条兜底（fetchSingleProfile）。
  // 重新进入任务时（handleTaskClick）会清掉该任务的快照，保证重跑后拿到新剖面。
  const ensureTaskProfilesLoaded = async (taskId: string) => {
    if (!taskId) return {} as Record<string, SectionProfile>;
    if (profilesCacheRef.current[taskId]) return profilesCacheRef.current[taskId];
    if (profilesPromiseRef.current[taskId]) return profilesPromiseRef.current[taskId]!;

    const promise = (async () => {
      const payload = await fetchJSON(`/v0/bank/tasks/${encodeURIComponent(taskId)}/section-profiles`);
      const list = parseProfilesList(payload);
      const bySection: Record<string, SectionProfile> = {};
      list.forEach((p: any) => {
        const sid = p?.section_id ?? p?.sectionId ?? p?.sectionID;
        if (!sid) return;
        bySection[String(sid)] = p as SectionProfile;
      });
      profilesCacheRef.current[taskId] = bySection;
      return bySection;
    })();

    profilesPromiseRef.current[taskId] = promise;
    try {
      return await promise;
    } finally {
      profilesPromiseRef.current[taskId] = null;
    }
  };

  // 单条断面剖面：按 section_id 直取，用于「任务级列表里没有这条」时兜底。
  //
  // 为什么需要它：任务级列表是一次性快照（见 profilesCacheRef 的说明），而任务运行期间
  // 结果是一条条新增的 —— 先打开详情、后跑出结果的断面，在这个快照里根本不存在。
  // 结果页的「指标矩阵」走的是 /results/{section_id} 单条查询，不受这个快照影响，
  // 所以会表现为「指标正常、只有剖面显示无剖面数据」。
  const fetchSingleProfile = async (sectionId: string): Promise<SectionProfile | null> => {
    try {
      const payload = await fetchJSON(`/v0/bank/sections/${encodeURIComponent(sectionId)}/profile`);
      const one = payload?.profile ?? payload?.data?.profile ?? payload;
      if (one && (one.section_id || one.sectionId)) return one as SectionProfile;
      return null;
    } catch {
      // 该断面确实还没落剖面档案（例如模型刚返回、剖面还没写完）——交给上层显示空态。
      return null;
    }
  };

  const getProfileSeries = (p: SectionProfile | null) => {
    const profile = p?.profile_data?.profile;
    if (Array.isArray(profile) && profile.length > 0) {
      const points = profile
        .map((pt, idx) => {
          const d = pt?.distance;
          const e = pt?.elevation;
          const distance = typeof d === 'number' ? d : idx;
          const elevation = typeof e === 'number' ? e : null;
          if (elevation === null || !Number.isFinite(distance) || !Number.isFinite(elevation)) return null;
          return { distance, elevation };
        })
        .filter(Boolean) as Array<{ distance: number; elevation: number }>;
      return points;
    }
    return [] as Array<{ distance: number; elevation: number }>;
  };

  const renderProfileChart = (series: Array<{ distance: number; elevation: number }>) => {
    if (!series || series.length < 2) {
      return <div className="profile-empty">无剖面数据</div>;
    }

    const width = 900;
    const height = 220;
    const padL = 44;
    const padR = 16;
    const padT = 12;
    const padB = 30;

    const xs = series.map(p => p.distance);
    const ys = series.map(p => p.elevation);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;

    const xToSvg = (x: number) => padL + ((x - minX) / spanX) * (width - padL - padR);
    const yToSvg = (y: number) => padT + (1 - (y - minY) / spanY) * (height - padT - padB);

    const polylinePoints = series.map(p => `${xToSvg(p.distance)},${yToSvg(p.elevation)}`).join(' ');

    return (
      <div className="profile-chart-wrap">
        <svg className="profile-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="断面剖面折线">
          <line x1={padL} y1={height - padB} x2={width - padR} y2={height - padB} className="profile-axis" />
          <line x1={padL} y1={padT} x2={padL} y2={height - padB} className="profile-axis" />
          <polyline points={polylinePoints} className="profile-polyline" fill="none" />

          <text x={padL} y={padT + 10} className="profile-label" textAnchor="start">{Number.isFinite(maxY) ? maxY.toFixed(3) : ''}</text>
          <text x={padL} y={height - padB - 6} className="profile-label" textAnchor="start">{Number.isFinite(minY) ? minY.toFixed(3) : ''}</text>
          <text x={padL} y={height - 8} className="profile-label" textAnchor="start">{Number.isFinite(minX) ? minX.toFixed(2) : ''}</text>
          <text x={width - padR} y={height - 8} className="profile-label" textAnchor="end">{Number.isFinite(maxX) ? maxX.toFixed(2) : ''}</text>
        </svg>
      </div>
    );
  };

  // — 矩阵详情弹窗
  const openMatrixDetail = async (taskId: string | null, sectionId: string, sectionName?: string, editMode = false) => {
    if (!sectionId) return;
    setMatrixOpen(true);
    setMatrixLoading(true);
    setMatrixError(null);
    setMatrixSectionId(sectionId);
    setMatrixSectionName(sectionName || null);
    setMatrixDetail(null);
    setResultEditing(editMode);

    setProfileLoading(true);
    setProfileError(null);
    setProfileDetail(null);

    const effectiveTaskId = taskId || selectedTaskRef.current;

    const matrixPromise = (async () => {
      const payload = await fetchJSON(`/v0/bank/results/${encodeURIComponent(sectionId)}`);
      // 断面存在但没算出结果：后端返回 200 + status=not_computed（不再用 404）。
      //
      // 【不要在这里中断】没算出结果恰恰是最该人工评定的对象。以前这里 throw，
      // 弹窗只剩一句「该断面尚无计算结果」，无数据断面的数值永远改不了。
      // 现在摊一张**空表**并直接进编辑态：用户填完 9 个指标即落库成一条人工结果
      // （后端 overrideRiskResult 的「新建」分支）。
      //
      // 空表的 thresholds 必须用后端回带的**任务级**参数，不能用前端内置默认值 ——
      // 否则同任务里这一条按 0.25/0.5/0.75 判档、其它条按自定义阈值判档，图上一片混账。
      if (payload?.status === 'not_computed') {
        const sectionInfo = payload?.section ?? {};
        setMatrixDetail({
          id: null,
          section_id: sectionInfo.section_id ?? sectionId,
          section_name: sectionInfo.section_name ?? sectionName ?? null,
          bank_id: sectionInfo.bank_id ?? null,
          region_code: sectionInfo.region_code ?? null,
          task_id: sectionInfo.task_id ?? effectiveTaskId ?? null,
          raw_values: {},
          thresholds: payload?.thresholds ?? null,
          matrices: {},
          result: null,
          risk_level: null,
          /** 标记「这一条是空白待录入」，决定 banner 文案与撤销语义。 */
          not_computed: true,
          not_computed_reason: payload?.reason ?? null,
          manual_editable: payload?.manual_editable !== false,
          // 人工无效是断面属性，payload 顶层与 section 里各带一份（同一份数据，取到哪个都行）：
          // 弹窗靠它决定按钮文案与「已标记无效」标签。
          manual_invalid: payload?.manual_invalid === true || sectionInfo.manual_invalid === true,
          manual_invalid_reason: payload?.manual_invalid_reason ?? sectionInfo.manual_invalid_reason ?? null
        });
        setResultEditing(payload?.manual_editable !== false);
        return;
      }
      const result = payload?.result ?? payload?.data?.result ?? payload?.data ?? payload;
      const indicators = result?.indicators ?? payload?.indicators ?? {};
      const matrices = indicators?.matrices ?? result?.matrices ?? payload?.matrices ?? {};
      const matrix = {
        ...result,
        ...indicators,
        matrices,
        weight_matrix: matrices.weight_matrix ?? indicators.weight_matrix ?? result?.weight_matrix,
        concat_matrix: matrices.concat_matrix ?? indicators.concat_matrix ?? result?.concat_matrix,
        result_matrix: matrices.result_matrix ?? indicators.result_matrix ?? result?.result_matrix,
        risk_level: result?.['risk-level'] ?? result?.risk_level ?? result?.riskLevel,
        result: result?.result ?? indicators?.result ?? payload?.result?.result,
        // 人工无效标记不在结果行上（是 cross_sections 的列），payload 单独带回来的。
        manual_invalid: payload?.manual_invalid === true,
        manual_invalid_reason: payload?.manual_invalid_reason ?? null,
      };
      console.log('ResultPage: matrix detail payload:', payload);
      console.log('ResultPage: matrix detail resolved matrix:', matrix);
      setMatrixDetail(matrix);
    })().catch((err: any) => {
      setMatrixError(err?.message || '获取矩阵详情失败');
    }).finally(() => {
      setMatrixLoading(false);
    });

    const profilePromise = (async () => {
      // 没有当前任务时也能出剖面：单条接口只认 section_id，不依赖任务上下文
      // （典型场景：从资源树直接进结果页，selectedTask 还没落定）。
      if (!effectiveTaskId) {
        setProfileDetail(await fetchSingleProfile(sectionId));
        return;
      }
      const bySection = await ensureTaskProfilesLoaded(effectiveTaskId);
      let prof: SectionProfile | null = bySection[String(sectionId)] ?? null;
      if (!prof) {
        // 任务级快照里没有这条 —— 通常是「任务还在跑，这条结果是刚出来的」。
        // 回退到按 section_id 单条查询，并写回缓存，避免同一个断面反复打请求。
        prof = await fetchSingleProfile(sectionId);
        if (prof) bySection[String(sectionId)] = prof;
      }
      setProfileDetail(prof);
    })().catch((err: any) => {
      setProfileError(err?.message || '获取断面剖面失败');
    }).finally(() => {
      setProfileLoading(false);
    });

    await Promise.allSettled([matrixPromise, profilePromise]);
  };

  // — 矩阵详情弹窗 — 关闭
  const closeMatrixDetail = () => {
    setMatrixOpen(false);
    setMatrixLoading(false);
    setMatrixError(null);
    setMatrixSectionId(null);
    setMatrixSectionName(null);
    setMatrixDetail(null);
    setResultEditing(false);

    setProfileLoading(false);
    setProfileError(null);
    setProfileDetail(null);
  };

  /**
   * 保存/恢复成功后：把服务端返回的结果合并回弹窗数据。
   * 必须走 indicators 而不是简单 `{...prev, ...updated}` —— updated 是 RiskResultResponse，
   * 它没有铺平的 matrices/raw_values，直接展开会把表格数据打散。
   */
  const mergeResultIntoDetail = (prev: any, updated: any) => {
    if (!prev) return prev;
    const indicators = updated?.indicators ?? {};
    return {
      ...prev,
      ...indicators,
      // 人工「新建」的那一行在保存前 id 是 null，保存后必须换上真实 id ——
      // 否则再保存一次会走「新建」分支，同一个断面插出第二行。
      id: updated?.id ?? prev.id ?? null,
      section_id: updated?.section_id ?? prev.section_id,
      section_name: updated?.section_name ?? prev.section_name,
      bank_id: updated?.bank_id ?? prev.bank_id,
      task_id: updated?.task_id ?? prev.task_id,
      not_computed: false,
      not_computed_reason: null,
      matrices: indicators.matrices ?? prev.matrices,
      result: indicators.result ?? prev.result,
      risk_level: updated?.risk_level ?? prev.risk_level,
      'risk-level': indicators['risk-level'] ?? prev['risk-level'],
      risk_value: updated?.risk_value ?? prev.risk_value,
      edited: Boolean(updated?.edited),
      edited_at: updated?.edited_at ?? null,
      edit_note: updated?.edit_note ?? null,
    };
  };

  /**
   * 人工修改的就地生效：只 patch 受影响的那一条断面与它所属的岸段。
   *
   * 刻意**不**重新请求 /sections、不 fitBounds、不清图层：
   * 全量 reload 会让视野跳动、整条岸线闪一下，而这里其实只需要换一个色标。
   */
  const applyResultOverride = (sectionId: string, result: any) => {
    const taskId = selectedTaskRef.current;
    if (!taskId) return;
    const indicators = result?.indicators ?? {};
    const riskValue = Number(indicators.result);
    if (!Number.isFinite(riskValue)) return;

    const params = resolveRiskParams(indicators);
    const level = toDisplayLevel(result?.risk_level) ?? displayLevelOfResult({ indicators });

    if (!sectionIndicatorResultCacheRef.current[taskId]) sectionIndicatorResultCacheRef.current[taskId] = {};
    if (!sectionIndicatorResultPromiseRef.current[taskId]) sectionIndicatorResultPromiseRef.current[taskId] = {};
    if (!sectionRiskThresholdsRef.current[taskId]) sectionRiskThresholdsRef.current[taskId] = {};
    // 三处缓存同写：少了任一处，下一轮轮询/重绘就会把颜色改回旧值。
    sectionIndicatorResultCacheRef.current[taskId][sectionId] = riskValue;
    sectionIndicatorResultPromiseRef.current[taskId][sectionId] = null;
    sectionRiskThresholdsRef.current[taskId][sectionId] = params.all;

    const base = lastSectionsByTaskRef.current[taskId] ?? [];
    const target = base.find(s => s.section_id === sectionId) ?? null;
    const next = base.map(s => s.section_id === sectionId
      ? { ...s, indicator_result: riskValue, risk_thresholds: params.all, risk_level: level ?? s.risk_level }
      : s);
    lastSectionsByTaskRef.current[taskId] = next;

    if (mapRef.current) {
      renderSections(next);
      applyShorelineGradient(next, target?.bank_id ?? null);
    }

    // 悬停卡片的等级是构建 DOM 时写死的，保存后必须关掉；用户再点一次就是新值。
    if (activePopupSectionIdRef.current === sectionId) {
      activePopupRef.current?.remove();
      activePopupRef.current = null;
      activePopupSectionIdRef.current = null;
    }
  };

  /**
   * 撤销「人工新建」的结果：该断面回到无数据状态。
   *
   * <p>与 {@link applyResultOverride} 相反 —— 要**删掉**三处缓存里的这条，而不是写新值。
   * 漏删任何一处，下一轮轮询/重绘都会把刚撤销的颜色画回来。
   */
  const applyResultRevert = (sectionId: string) => {
    const taskId = selectedTaskRef.current;
    if (!taskId) return;
    delete sectionIndicatorResultCacheRef.current[taskId]?.[sectionId];
    delete sectionIndicatorResultPromiseRef.current[taskId]?.[sectionId];
    delete sectionRiskThresholdsRef.current[taskId]?.[sectionId];

    const base = lastSectionsByTaskRef.current[taskId] ?? [];
    const target = base.find(s => s.section_id === sectionId) ?? null;
    const next = base.map(s => {
      if (s.section_id !== sectionId) return s;
      // 解构掉 risk_level：该类型不接受 null，而「没有等级」必须是真的没有
      //（留着旧值会让断面继续按旧颜色画，灰色虚线也出不来）。
      const { risk_level: _dropped, ...rest } = s;
      return { ...rest, indicator_result: null, risk_thresholds: null };
    });
    lastSectionsByTaskRef.current[taskId] = next;

    if (mapRef.current) {
      renderSections(next);
      applyShorelineGradient(next, target?.bank_id ?? null);
    }
    if (activePopupSectionIdRef.current === sectionId) {
      activePopupRef.current?.remove();
      activePopupRef.current = null;
      activePopupSectionIdRef.current = null;
    }
  };

  const handleOverrideSaved = (updated: any) => {
    if (!matrixSectionId) return;
    setMatrixDetail((prev: any) => mergeResultIntoDetail(prev, updated));
    applyResultOverride(matrixSectionId, updated);
    setResultEditing(false);
    const level = toDisplayLevel(updated?.risk_level);
    const label = level === null ? '未知' : RISK_LABELS[level];
    setToast({
      tone: 'ok',
      text: `已保存：风险等级 ${label}，岸段已重绘；已生成的报告/图片需重新生成`,
    });
  };

  const handleOverrideReverted = (updated: any) => {
    if (!matrixSectionId) return;
    // 人工新建的那一行被撤销 ⇒ 后端软删，返回 result=null。
    // 此时不能留在弹窗里显示一份不存在的值，直接关掉并把断面打回无数据。
    if (!updated) {
      applyResultRevert(matrixSectionId);
      closeMatrixDetail();
      setToast({ tone: 'ok', text: '已撤销人工录入：该断面回到「无数据」，图上显示为灰色虚线' });
      return;
    }
    setMatrixDetail((prev: any) => mergeResultIntoDetail(prev, updated));
    applyResultOverride(matrixSectionId, updated);
    // 退出编辑态：草稿里还是那组被驳回的数值，留在页面上会与地图/表格不一致。
    setResultEditing(false);
    const level = toDisplayLevel(updated?.risk_level);
    const label = level === null ? '未知' : RISK_LABELS[level];
    setToast({ tone: 'ok', text: `已恢复模型原值：风险等级 ${label}` });
  };

  /**
   * 「人工无效」标记生效后：只改内存里的那一条，然后重绘断面与它所属岸段。
   *
   * <p>为什么不重新拉一次断面列表：标记只改一个布尔，重拉 2000+ 断面等于给后端一次
   * 无谓的全量读；而这里用的 `renderSections` + `applyShorelineGradient(onlyBankId, …)`
   * 与轮询走的是同一套链路，不会出现「手动改的和自动刷的不一致」。
   *
   * <p>**刻意不清** `sectionIndicatorResultCacheRef`：结果没被删，恢复有效时那份数值还要用。
   * 顺手清掉会让"恢复有效"变成"恢复成灰的，但也不是无数据"这种中间状态。
   */
  const applyManualInvalidMany = (sectionIds: string[], invalid: boolean, reason: string | null) => {
    const taskId = selectedTaskRef.current;
    if (!taskId) return;
    const ids = new Set(sectionIds.map(id => String(id ?? '').trim()).filter(Boolean));
    if (ids.size === 0) return;

    const base = lastSectionsByTaskRef.current[taskId] ?? [];
    const next = base.map(s => (ids.has(s.section_id)
      ? { ...s, manual_invalid: invalid, manual_invalid_reason: reason }
      : s));
    lastSectionsByTaskRef.current[taskId] = next;

    if (mapRef.current) {
      renderSections(next);
      // 只重画受影响的岸段：结果没变，其它岸段的色带没必要跟着重算（全量重绘会让整条岸线闪一下）。
      // 批量时可能跨多条岸段：一条都不涉及 → 传 null 全量（等价于"没有可局部重绘的目标"），
      // 恰好一条 → 局部重绘，多条 → 全量重绘（比逐条重绘少 N 次 setPaintProperty 抖动）。
      const bankIds = new Set<string>();
      base.forEach(s => { if (ids.has(s.section_id) && s.bank_id) bankIds.add(s.bank_id); });
      applyShorelineGradient(next, bankIds.size === 1 ? [...bankIds][0] : null);
    }

    // 悬停卡片里的等级文案是构建 DOM 时写死的，改完必须关掉；用户再点一次才是新状态。
    if (activePopupSectionIdRef.current && ids.has(activePopupSectionIdRef.current)) {
      activePopupRef.current?.remove();
      activePopupRef.current = null;
      activePopupSectionIdRef.current = null;
    }
  };

  /** 单条：批量版的退化用法。两条路径共用同一套本地刷新，避免"单条改了、批量没改"。 */
  const applyManualInvalid = (sectionId: string, invalid: boolean, reason: string | null) => {
    applyManualInvalidMany([sectionId], invalid, reason);
  };

  /**
   * 弹窗里切换「人工无效」。
   *
   * <p>确认框只在**标记**时弹：那是把一条有颜色的断面变灰，用户需要知道「结果没删、随时能恢复」；
   * 恢复不做二次确认 —— 它是纯增益动作，且按钮文案已经写明。
   */
  const handleToggleManualInvalid = async () => {
    const sectionId = matrixSectionId;
    if (!sectionId) return;
    const nextInvalid = matrixDetail?.manual_invalid !== true;
    if (nextInvalid) {
      const ok = window.confirm([
        '把这条断面标记为「无效」？',
        '',
        '· 该断面与它管辖的那段岸线会变成灰色虚线；',
        '· 不再参与着色、框选统计、报告配图与导出；',
        '· 计算结果会保留，随时可以恢复，不需要重算。',
      ].join('\n'));
      if (!ok) return;
    }

    setInvalidSaving(true);
    try {
      const res = await setSectionManualInvalid({ sectionIds: [sectionId], invalid: nextInvalid });
      if (res.updated === 0) {
        // 0 行 = 该 id 越权或已被删除。这类失败不能静默：界面会以为改成功了，图上却毫无变化。
        setToast({ tone: 'warn', text: '未生效：该断面可能已被删除，或不属于当前账号' });
        return;
      }
      applyManualInvalid(sectionId, nextInvalid, null);
      setMatrixDetail((prev: any) => (prev
        ? { ...prev, manual_invalid: nextInvalid, manual_invalid_reason: null }
        : prev));
      setToast({
        tone: 'ok',
        text: nextInvalid
          ? '已标记为无效断面：图上显示为灰色虚线，不参与统计与导出；结果数据已保留'
          : '已恢复为有效断面：颜色与统计立即恢复，无需重算',
      });
    } catch (e: any) {
      setToast({ tone: 'warn', text: e?.message || '操作失败' });
    } finally {
      setInvalidSaving(false);
    }
  };

  // — 单指标风险等级
  // 公式只认 riskScoring.resolveIndicatorTier（① 库内 indicator_tiers → ② 按本记录阈值现算
  // → ③ PL/LC 从矩阵列反推），这里只负责把它翻成与地图图例同一套的文案与配色。
  const indicatorTierOf = (key: RiskIndicatorKey, rawValues: any, matrices: any) =>
    resolveIndicatorTier(key, {
      indicators: matrixDetail?.indicators ?? matrixDetail,
      rawValues,
      matrices,
    });

  /** 1..4 档 → 与地图/图例同一套文案与配色（4 档 = 高风险 = 红）。 */
  const renderIndicatorTierBadge = (tier: number | null, direction: 'asc' | 'desc' | null = null) => {
    if (tier === null) {
      return <span className="indicator-tier-badge is-unknown" title="该指标缺值或缺阈值，无法判定档位">未判定</span>;
    }
    const level = tier - 1;
    const label = RISK_LABELS[level] ?? `第${tier}档`;
    const color = RISK_COLORS[String(level)] ?? RISK_COLORS.default;
    // Ky 这种反向指标必须在 tooltip 里说清方向，否则「0.7 → 高风险」看着像算反了。
    const tip = [
      `单指标分档：第 ${tier} 档（1 档最安全、4 档最危险）→ ${label}`,
      direction === 'desc' ? '该指标阈值降序：数值越大越安全，数值偏小才是高等级。' : '',
    ].filter(Boolean).join('\n');
    return (
      <span
        className="indicator-tier-badge"
        style={{ color, borderColor: color, background: `${color}1f` }}
        title={tip}
      >
        {label}
      </span>
    );
  };

  const generateMatrixCSV = () => {
    if (!matrixDetail) return '';

    const rows: string[][] = [];
    
    // 头部信息
    rows.push(['断面矩阵详情']);
    rows.push([]);
    rows.push(['字段', '值']);
    rows.push(['断面名称', String(matrixSectionName || '-')]);
    rows.push(['断面ID', String(matrixSectionId || '-')]);
    rows.push(['岸段ID', formatCellValue(matrixDetail.bank_id ?? matrixDetail.bankId)]);
    rows.push(['风险等级', formatCellValue(matrixDetail.risk_level ?? matrixDetail.riskLevel)]);
    rows.push([]);
    
    // 指标矩阵部分
    const indicators = matrixDetail?.indicators?.thresholds ?? matrixDetail?.thresholds ?? {};
    
    MATRIX_GROUPS.forEach((group, groupIdx) => {
      const weightKey = group.weightKey as keyof typeof indicators;
      const weightValues = indicators?.[weightKey];
      const subThresholds = indicators?.sub_thresholds || {};
      const matrices = matrixDetail?.matrices ?? matrixDetail?.indicators?.matrices ?? {};
      const groupWeight = Array.isArray(indicators?.wRL) ? indicators.wRL[groupIdx] : weightValues;
      
      // 组标题
      rows.push([]);
      rows.push([group.title]);
      rows.push(['准则权重', formatCellValue(groupWeight)]);
      rows.push([]);
      
      // 表头
      rows.push(['指标', '阈值1', '阈值2', '阈值3', '权重', '统计值', '风险等级']);
      
      // 数据行
      group.indicatorKeys.forEach(({ label, key }, idx) => {
        const thresholdRow = subThresholds[key] || [];
        const displayThresholds = Array.isArray(thresholdRow) ? thresholdRow : [];
        const displayWeight = Array.isArray(weightValues) ? formatCellValue(weightValues[idx]) : formatCellValue(weightValues);
        const rawValues = matrixDetail?.raw_values || {};
        const resultValue = formatIndicatorResult(key, rawValues, matrices);
        const tier = indicatorTierOf(key, rawValues, matrices);
        const reverse = thresholdDirectionOf(displayThresholds) === 'desc';
        const tierText = tier === null
          ? '未判定'
          : `${RISK_LABELS[tier - 1] ?? `第${tier}档`}（第 ${tier} 档${reverse ? '｜该指标反向：值越大越安全' : ''}）`;
        rows.push([
          label,
          displayThresholds[0] !== undefined ? formatCellValue(displayThresholds[0]) : 'N/A',
          displayThresholds[1] !== undefined ? formatCellValue(displayThresholds[1]) : 'N/A',
          displayThresholds[2] !== undefined ? formatCellValue(displayThresholds[2]) : 'N/A',
          displayWeight !== undefined ? displayWeight : 'N/A',
          resultValue,
          tierText,
        ]);
      });
    });
    
    // 转换为 CSV 格式
    return rows.map(row => 
      row.map(cell => {
        const str = String(cell);
        // 如果包含逗号、双引号或换行符，则用双引号包围并转义双引号
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(',')
    ).join('\n');
  };

  const downloadMatrixCSV = () => {
    const csv = generateMatrixCSV();
    if (!csv) {
      alert('无可导出的数据');
      return;
    }
    
    // 创建 Blob 并下载
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `断面矩阵详情_${matrixSectionId || 'export'}_${new Date().toISOString().slice(0, 10)}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // — 矩阵详情 — 指标组渲染
  const renderAssessmentGroup = (group: RiskMatrixGroup, indicators: any, groupIdx: number) => {
    const weightKey = group.weightKey as keyof typeof indicators;
    const weightValues = indicators?.[weightKey];
    const subThresholds = indicators?.sub_thresholds || {};
    const rawValues = matrixDetail?.raw_values || {};
    const matrices = matrixDetail?.matrices ?? matrixDetail?.indicators?.matrices ?? {};
    const groupWeight = Array.isArray(indicators?.wRL) ? indicators.wRL[groupIdx] : weightValues;
    
    const hasAnyData = group.indicatorKeys.length > 0 && (groupWeight || Object.keys(subThresholds).length > 0 || weightValues);
    if (!hasAnyData) return null;

    return (
      <div className="matrix-assessment-group" key={group.title}>
        <div className="matrix-assessment-meta">
          <div className="matrix-assessment-title">{group.title}</div>
          <div className="matrix-assessment-weight">
            <span>准则权重</span>
            <span className="matrix-assessment-weight-value">{formatCellValue(groupWeight)}</span>
          </div>
        </div>

        <div className="matrix-assessment-table-wrap">
          <table className="matrix-assessment-table">
            <thead>
              <tr>
                <th className="matrix-assessment-row-header" />
                <th colSpan={3}>风险阈值</th>
                <th>权重</th>
                <th>统计值</th>
                <th className="matrix-assessment-level-col">风险等级</th>
              </tr>
            </thead>
            <tbody>
              {group.indicatorKeys.map(({ label, key }, idx) => {
                const thresholdRow = subThresholds[key] || [];
                const displayThresholds = Array.isArray(thresholdRow) ? thresholdRow : [];
                const displayWeight = Array.isArray(weightValues) ? weightValues[idx] : weightValues;
                const resultValue = formatIndicatorResult(key, rawValues, matrices);
                const direction = thresholdDirectionOf(displayThresholds);
                
                return (
                  <tr key={key}>
                    <th scope="row" className="matrix-assessment-row-name">
                      {label}
                    </th>
                    <td>{displayThresholds[0] !== undefined ? formatCellValue(displayThresholds[0]) : 'N/A'}</td>
                    <td>{displayThresholds[1] !== undefined ? formatCellValue(displayThresholds[1]) : 'N/A'}</td>
                    <td>{displayThresholds[2] !== undefined ? formatCellValue(displayThresholds[2]) : 'N/A'}</td>
                    <td>{displayWeight !== undefined ? formatCellValue(displayWeight) : '-'}</td>
                    <td>{resultValue}</td>
                    <td className="matrix-assessment-level-col">
                      {renderIndicatorTierBadge(indicatorTierOf(key, rawValues, matrices), direction)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // 提示 2.6s 自动消失；不阻塞地图操作
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // 切换断面可见性
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    
    ['sections-line', 'sections-nodata-line', 'sections-line-hit', SECTION_START_LAYER_ID].forEach(layer => {
      if (map.getLayer(layer)) {
        map.setLayoutProperty(layer, 'visibility', showSections ? 'visible' : 'none');
      }
    });
  }, [showSections]);

  // 清理地图上所有断面和中线图层/数据源
  const clearMapLayers = (map: mapboxgl.Map) => {
    // 顺序按「图层叠放从上到下」删，起点圆在最上面。把定义分散到多处迟早漏掉新层 ——
    // 漏掉的表现就是切到别的任务后，上一批起点圆还钉在原地。
    [SECTION_START_LAYER_ID, 'sections-line-hit', 'sections-nodata-line', 'sections-line'].forEach(layer => {
      if (map.getLayer(layer)) map.removeLayer(layer);
    });
    if (map.getSource(SECTION_START_SOURCE_ID)) map.removeSource(SECTION_START_SOURCE_ID);
    if (map.getSource('sections-source')) map.removeSource('sections-source');

    // 岸段折点编辑层也要清：它的图层 id 是 `bank-edit-*`，不在下面那两个
    // `bankline-` 前缀的清理范围内，漏掉会在新任务地图上留一条青色草稿线。
    removeBankEditLayers(map);

    // 框选设无效的命中断面高亮（`sections-box-match-*`）同理：它是按上一个任务的
    // 断面 id 画出来的，留在新任务地图上会指着一批无关断面。
    removeSectionBoxMatchLayers(map);

    const style = map.getStyle();
    if (style && style.layers) {
      style.layers.forEach((layer: any) => {
        if (layer.id && String(layer.id).startsWith('bankline-')) {
          if (map.getLayer(layer.id)) map.removeLayer(layer.id);
        }
      });
    }
    if (style && style.sources) {
      Object.keys(style.sources).forEach((sourceId: string) => {
        if (sourceId.startsWith('bankline-')) {
          if (map.getSource(sourceId)) map.removeSource(sourceId);
        }
      });
    }

    // 清空岸段几何缓存和基底图层，防止跨任务污染
    bankGeometryCacheRef.current = {};
    bankVisibleSegmentsRef.current = {};
    const uploadedSrc = map.getSource('uploaded-data') as mapboxgl.GeoJSONSource | undefined;
    if (uploadedSrc) {
      uploadedSrc.setData(turf.featureCollection([]));
    }
  };

  const stopPolling = () => {
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    activePollTaskIdRef.current = null;
  };

  useEffect(() => {
    return () => {
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 风险解析辅助：把 indicators.result(0-1) 映射到 0-3 风险等级。
  // 阈值必须用**该结果自带的** risk_thresholds —— 任务参数里的 risk_thresholds.all 可能不是
  // 默认的 0.25/0.5/0.75，写死会让地图配色与库内 risk_level 不一致（人工修改后尤其明显）。
  const mapIndicatorResultToRiskLevel = (value: any, thresholds?: number[] | null) => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 1) return null;
    const all: [number, number, number] = thresholds && thresholds.length >= 3
      ? [Number(thresholds[0]), Number(thresholds[1]), Number(thresholds[2])]
      : [0.25, 0.5, 0.75];
    return bucketRiskValue(n, all);
  };

  const getRiskInfo = (indicatorResult: any, thresholds?: number[] | null) => {
    const level = mapIndicatorResultToRiskLevel(indicatorResult, thresholds);
    if (level === null) {
      return { valid: false, color: RISK_COLORS.default, label: '未知', level: null };
    }
    return { valid: true, color: RISK_COLORS[String(level)] || RISK_COLORS.default, label: level, level };
  };

  const parseIndicatorResultFromSectionDetail = (payload: any): number | null => {
    const indicators =
      payload?.indicators ??
      payload?.result?.indicators ??
      payload?.data?.indicators ??
      payload?.data?.result?.indicators;
    const raw = indicators?.result;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 1) return null;
    return n;
  };

  // 颜色展示：按 indicators.result 对应的四级风险颜色展示
  // 不同等级之间的过渡（岸线/中线）仍由 Mapbox 的 line-gradient 插值完成
  const computeColorWithMatrix = (indicatorResult: any, thresholds?: number[] | null) => {
    return getRiskInfo(indicatorResult, thresholds);
  };

  /**
   * 断面 / 岸段着色的**唯一**入口（2026-10-20 起）。
   *
   * 相比 `computeColorWithMatrix` 多做一件事：`indicators.result` 还没拿到、但结果行里
   * `risk_level` 已经落库时，按 `risk_level` 推出等级与配色，而不是一律涂成灰色 ——
   * 灰线会被当成「一种等级」，而它其实是「没数」。两者都没有才返回 `valid:false`。
   *
   * 注意 `risk_level` 是库里的 1..4（1 最安全），显示等级要减 1（`toDisplayLevel`）。
   */
  const resolveSectionRisk = (section: SectionResult) => {
    // 【人工无效优先于一切】标记的语义是「这条断面先别算进来」，不是「这条断面没有值」：
    // 它可能明明有结果，只是用户判定位置/数据不可用，要先从图面与分析里摘出去。
    // 所以必须在任何「拿到值」的判定**之前**返回 valid:false —— 下游（断面线、起点圆、
    // 岸段色带、框选统计）都只认 `valid`，一处早退即可全链路按「无数据」口径处理。
    if (section.manual_invalid) {
      return { valid: false as const, color: RISK_COLORS.default, label: '无效', level: null };
    }
    const info = computeColorWithMatrix(section.indicator_result, section.risk_thresholds);
    if (info.valid) return info;

    const fallbackLevel = toDisplayLevel(section.risk_level);
    if (fallbackLevel === null) return info;

    return {
      valid: true,
      level: fallbackLevel,
      color: RISK_COLORS[String(fallbackLevel)] ?? RISK_COLORS.default,
      label: fallbackLevel,
    };
  };

  const ensureSectionIndicatorResultLoaded = async (taskId: string, sectionId: string): Promise<number | null> => {
    if (!taskId || !sectionId) return null;
    if (!sectionIndicatorResultCacheRef.current[taskId]) {
      sectionIndicatorResultCacheRef.current[taskId] = {};
    }
    if (!sectionIndicatorResultPromiseRef.current[taskId]) {
      sectionIndicatorResultPromiseRef.current[taskId] = {};
    }
    if (!sectionRiskThresholdsRef.current[taskId]) {
      sectionRiskThresholdsRef.current[taskId] = {};
    }
    if (Object.prototype.hasOwnProperty.call(sectionIndicatorResultCacheRef.current[taskId], sectionId)) {
      return sectionIndicatorResultCacheRef.current[taskId][sectionId] ?? null;
    }
    const pending = sectionIndicatorResultPromiseRef.current[taskId][sectionId];
    if (pending) return pending;
    const promise = (async () => {
      const payload = await fetchJSON(`/v0/bank/results/${encodeURIComponent(sectionId)}`);
      const value = parseIndicatorResultFromSectionDetail(payload);
      sectionIndicatorResultCacheRef.current[taskId][sectionId] = value;
      // 阈值与数值同源：老记录没有 thresholds 时这里存 null，渲染层再回落默认值。
      const indicators = payload?.result?.indicators ?? payload?.indicators ?? payload?.data?.result?.indicators;
      const params = resolveRiskParams(indicators ?? payload?.result ?? payload);
      const recordedAll = indicators?.thresholds?.risk_threshold;
      sectionRiskThresholdsRef.current[taskId][sectionId] = Array.isArray(recordedAll) && recordedAll.length >= 3
        ? params.all
        : null;
      return value;
    })();
    sectionIndicatorResultPromiseRef.current[taskId][sectionId] = promise;
    try { return await promise; } finally { sectionIndicatorResultPromiseRef.current[taskId][sectionId] = null; }
  };

  /** 该任务的结果条数；`undefined` = 还不知道（计数接口没成功过）。 */
  const resultCountOfTask = (taskId: string): number | undefined => (
    resultCountsReady ? (resultCountByTask[taskId] ?? 0) : resultCountByTask[taskId]
  );

  /**
   * 刷新「任务 → 结果条数」。
   *
   * <p>为什么单独一个函数而不是塞在任务列表 effect 里：任务刚在编辑器里算完、用户切回结果页
   * 右键时，几十秒前取到的计数可能还是 0 —— 那样「分析」会被错误地置灰，用户只能刷新整页。
   * 所以**每次右键都顺手刷一次**（一次 group by，很便宜），列表加载时也刷一次。
   * 取不到就保持原样（老后端无此端点 ⇒ 一直"未知" ⇒ 按放行处理，点击后再确认）。
   */
  const refreshResultCounts = async () => {
    try {
      const res = await fetch('/v0/bank/tasks/result-counts');
      if (!res.ok) return;
      const data = await res.json();
      const counts = data?.counts;
      if (!counts || typeof counts !== 'object') return;
      const normalized: Record<string, number> = {};
      Object.entries(counts as Record<string, unknown>).forEach(([taskId, n]) => {
        const value = Number(n);
        if (taskId && Number.isFinite(value)) normalized[taskId] = value;
      });
      setResultCountByTask(normalized);
      setResultCountsReady(true);
    } catch {
      /* 计数不可用：菜单保持"未知"，点击时再确认一次 */
    }
  };

  // 获取所有任务列表（顺带取"每个任务有多少条结果"，供右键「分析」判前置条件）
  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const res = await fetch('/v0/bank/tasks');
        if (!res.ok) throw new Error('获取任务列表失败');
        const data = await res.json();
        if (data.success) {
          setTaskList(data.tasks || []);
        }
      } catch (err: any) {
        console.error('获取任务列表失败:', err);
        setError('无法加载任务列表');
      }

      // 结果计数与任务列表分开取：一个接口挂了不该让整个列表空着。
      await refreshResultCounts();
    };
    fetchTasks();
    // refreshResultCounts 每次渲染都是新引用，但它只发一次请求 + setState，捕获旧的也无副作用
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTaskId]);

  useEffect(() => {
    if (!initialTaskId) return;
    if (autoOpenTaskRef.current === initialTaskId) return;
    if (!mapReady) return;

    autoOpenTaskRef.current = initialTaskId;
    void handleTaskClick(initialTaskId);
  }, [initialTaskId, taskList, mapReady]);

  useEffect(() => {
    fetchReportList();
  }, []);

  useEffect(() => {
    fetchSkills();
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      fetchReportList();
      const taskId = (e as CustomEvent).detail?.taskId;
      if (taskId) handleTaskClick(taskId);
    };
    window.addEventListener('report-saved', handler);
    return () => window.removeEventListener('report-saved', handler);
  }, []);

  // 报告导出成功后（报告会打包分区断面详情 CSV 与风险段汇总 CSV）给一句明确回执，
  // 否则浏览器只是静默下载一个 zip，用户不知道里面多了什么。
  useEffect(() => {
    const handler = (e: Event) => {
      const csvCount = Number((e as CustomEvent).detail?.csvCount || 0);
      if (csvCount > 0) {
        alert(`已导出报告压缩包：报告.docx + ${csvCount} 个 CSV（分区断面详情、风险段汇总）。`);
      }
    };
    window.addEventListener('report-exports-saved', handler);
    return () => window.removeEventListener('report-exports-saved', handler);
  }, []);

  const parseResultsList = (data: any): any[] => parseList(data, 'results');

  // — 标准化结果记录
  const normalizeResultRecord = (r: any) => {
    const sectionId = r?.section_id ?? r?.sectionId ?? r?.sectionID;
    const riskLevel = r?.risk_level ?? r?.riskLevel ?? r?.risk;
    const status = r?.status ?? r?.state ?? r?.code;
    const message = r?.error_message ?? r?.errorMessage ?? r?.error ?? r?.message;
    return { sectionId, riskLevel, status, message, raw: r };
  };

  const isTaskCompleted = (taskInfo: any) => {
    const st = String(taskInfo?.status ?? '').toLowerCase();
    if (st === 'completed' || st === 'success' || st === 'done') return true;
    if (taskInfo?.run_completed_at) return true;
    if (taskInfo?.runCompletedAt) return true;
    return false;
  };

  const loadErrorDetail = async (taskId: string, sectionId: string) => {
    // 仅在当前任务仍为选中时才更新
    if (!taskId || taskId !== selectedTask) return;

    try {
      const res = await fetch(`/v0/bank/results/${sectionId}`);
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      setProgress(prev => {
        if (!prev || prev.taskId !== taskId) return prev;
        const nextErrors = prev.errors.map(e => {
          if (e.section_id !== sectionId) return e;
          if (!res.ok) {
            return { ...e, detailError: `HTTP ${res.status}: ${text?.slice(0, 500)}` };
          }
          if (json?.status === 'not_computed') {
            // 断面还在、只是没有结果（新建或上次算失败了）：这是状态不是错误，
            // 用中性文本展示，不要再套一层 HTTP 错误吓人。
            return { ...e, detail: { status: json.status, reason: json.reason } };
          }
          return { ...e, detail: json ?? text };
        });
        return { ...prev, errors: nextErrors };
      });
    } catch (err: any) {
      setProgress(prev => {
        if (!prev || prev.taskId !== taskId) return prev;
        const nextErrors = prev.errors.map(e => {
          if (e.section_id !== sectionId) return e;
          return { ...e, detailError: err?.message || '获取错误详情失败' };
        });
        return { ...prev, errors: nextErrors };
      });
    }
  };

  // — 轮询核心：拉取任务状态 + 结果，更新进度 & 地图
  const updateProgressAndMap = async (taskId: string, taskName: string | undefined, baseSections: SectionResult[]) => {
    const startedAt = new Date().toISOString();
    const map = mapRef.current;

    let taskInfo: any = null;
    let resultsList: any[] = [];

    try {
      const taskRes = await fetch(`/v0/bank/tasks/${taskId}`);
      if (taskRes.ok) {
        const jt = await taskRes.json().catch(() => null);
        taskInfo = jt?.task ?? jt?.data ?? jt;
      }
    } catch {
      // 忽略：任务状态接口可能不可用，但轮询结果仍可继续
    }

    // 兼容：部分后端只在 /full 中返回 status/run_completed_at 等字段
    if (!taskInfo || (!taskInfo.status && !taskInfo.run_completed_at && !taskInfo.runCompletedAt)) {
      try {
        const fullRes = await fetch(`/v0/bank/tasks/${taskId}/full`);
        if (fullRes.ok) {
          const jf = await fullRes.json().catch(() => null);
          const d = jf?.data ?? jf;
          taskInfo = d?.task ?? d?.data?.task ?? taskInfo;
        }
      } catch {
        // ignore
      }
    }

    try {
      const resultsRes = await fetch(`/v0/bank/results?task_id=${encodeURIComponent(taskId)}`);
      if (resultsRes.ok) {
        const jr = await resultsRes.json().catch(() => null);
        resultsList = parseResultsList(jr);
      }
    } catch {
      // 忽略：临时网络错误不应中断轮询
    }

    if (activePollTaskIdRef.current !== taskId) return;

    const latestBySection: Record<string, ReturnType<typeof normalizeResultRecord>> = {};
    resultsList.forEach(r => {
      const nr = normalizeResultRecord(r);
      if (!nr.sectionId) return;
      latestBySection[String(nr.sectionId)] = nr;
    });

    const resultBySection: Record<string, { riskLevel?: any; status?: any; message?: any; raw?: any }> = {};
    const errorsFromResults: TaskProgressSnapshot['errors'] = [];
    Object.keys(latestBySection).forEach(sectionId => {
      const nr = latestBySection[sectionId];
      resultBySection[sectionId] = {
        riskLevel: nr.riskLevel,
        status: nr.status,
        message: nr.message,
        raw: nr.raw
      };

      const st = String(nr.status ?? '').toUpperCase();
      const hasError = (nr.message && String(nr.message).trim().length > 0) || (st && st !== 'SUCCESS' && st !== 'COMPLETED' && st !== '200');
      const riskIsValidNumber = (() => {
        const n = Number(nr.riskLevel);
        return !isNaN(n) && Number.isFinite(n) && n >= 0 && n <= 3;
      })();

      if (hasError && !riskIsValidNumber) {
        errorsFromResults.push({
          section_id: String(sectionId),
          message: String(nr.message ?? nr.status ?? '未知错误'),
          raw: nr.raw
        });
      }
    });

    const mergedSections = baseSections.map(s => {
      const hit = resultBySection[s.section_id];
      if (!hit) return s;
      return { ...s, risk_level: hit.riskLevel ?? s.risk_level };
    });

    const detailSectionIds = Object.keys(latestBySection);
    if (detailSectionIds.length > 0) {
      await Promise.allSettled(
        detailSectionIds.map(sectionId => ensureSectionIndicatorResultLoaded(taskId, sectionId))
      );
    }

    const thresholdsBySection = sectionRiskThresholdsRef.current[taskId] ?? {};
    const sectionsWithIndicatorResult = mergedSections.map(s => {
      const cached = sectionIndicatorResultCacheRef.current[taskId]?.[s.section_id];
      const thresholds = thresholdsBySection[s.section_id] ?? s.risk_thresholds ?? null;
      if (cached === undefined && !thresholds) return s;
      return { ...s, indicator_result: cached ?? null, risk_thresholds: thresholds };
    });

    // 注：result 的数值意义尚不明确，暂不再轮询 /matrix（避免高频额外请求）

    // 统计成功数：以 risk_level(0-3) 为准
    const successCount = mergedSections.reduce((acc, s) => {
      const n = Number(s.risk_level);
      if (!isNaN(n) && Number.isFinite(n) && n >= 0 && n <= 3) return acc + 1;
      return acc;
    }, 0);

    // 如果任务已完成，但仍有部分断面没有结果，则把它们当作“无结果/计算失败”展示出来。
    // 例外：任务是被**终止**的 —— 那些断面根本没跑过，报成"计算失败"会冤枉它们，
    // 所以换一条如实文案。终止后进度条能立刻收尾、不再空转，也靠这里区分开。
    const cancelled = String(taskInfo?.status ?? '').toLowerCase() === 'cancelled';
    const completed = isTaskCompleted(taskInfo);
    const missingAsErrors: TaskProgressSnapshot['errors'] = [];
    if (completed) {
      mergedSections.forEach(s => {
        const hasAnyResult = Boolean(resultBySection[s.section_id]);
        const n = Number(s.risk_level);
        const riskOk = !isNaN(n) && Number.isFinite(n) && n >= 0 && n <= 3;
        if (!hasAnyResult || !riskOk) {
          const already = errorsFromResults.some(e => e.section_id === s.section_id);
          if (!already) {
            missingAsErrors.push({
              section_id: s.section_id,
              section_name: s.section_name,
              bank_id: s.bank_id,
              message: cancelled
                ? '任务已终止，该断面未运行'
                : (hasAnyResult ? '计算未返回有效风险等级' : '未返回结果（可能计算失败）')
            });
          }
        }
      });
    }

    const allErrors = [...errorsFromResults, ...missingAsErrors].map(e => {
      const sec = baseSections.find(s => s.section_id === e.section_id);
      return {
        ...e,
        section_name: e.section_name ?? sec?.section_name,
        bank_id: e.bank_id ?? sec?.bank_id
      };
    });

    const expectedTotal = baseSections.length;
    const processedCount = completed ? expectedTotal : Math.min(expectedTotal, successCount + allErrors.length);

    setProgress({
      taskId,
      taskName,
      status: taskInfo?.status,
      runStartedAt: taskInfo?.run_started_at ?? taskInfo?.runStartedAt ?? null,
      runCompletedAt: taskInfo?.run_completed_at ?? taskInfo?.runCompletedAt ?? null,
      expectedTotal,
      processedCount,
      successCount,
      errorCount: allErrors.length,
      lastUpdatedAt: startedAt,
      errors: allErrors
    });

    // 轮询驱动地图刷新（断面颜色 + 岸段插值）
    if (map) {
      // 把「已带上 indicator_result / 阈值」的数组写回基准快照：
      // 人工修改后的就地重绘要以它为底，否则会丢其它断面的颜色。
      lastSectionsByTaskRef.current[taskId] = sectionsWithIndicatorResult;
      renderSections(sectionsWithIndicatorResult);
      applyShorelineGradient(sectionsWithIndicatorResult);
    }

    const shouldStop = completed || (expectedTotal > 0 && processedCount >= expectedTotal);
    if (shouldStop) {
      stopPolling();
    }
  };

  // ============================================================
  //  任务操作
  // ============================================================

  // 点击任务：获取任务详情（包含所有断面及其结果）并在地图可视化
  const handleTaskClick = async (taskId: string) => {
    stopPolling();

    // 换任务 = 上一次的框选分析作废：选区是画在"上一个任务的岸段"上的，
    // 数据换了还留着面板，统计口径就对不上了。
    setAreaAnalysis(null);
    // 框选设无效同理：命中集合是上一个任务的断面 id，留着只会误操作
    setSectionBoxInvalid(null);
    boxMatchCountRef.current = -1;

    setSelectedTask(taskId);
    selectedTaskRef.current = taskId;
    setLoading(true);
    setError(null);
    setProgressOpen(true);
    setProgress(null);
    setExpandedErrorIds({});

    // 清理地图上之前任务的图层和数据源
    const map = mapRef.current;
    if (map) clearMapLayers(map);

    // 重新进入任务 = 重新取剖面快照。任务可能重跑过，剖面已更新，旧快照不能用。
    delete profilesCacheRef.current[taskId];

    try {
      // 1) 先拉取断面列表（含几何），先渲染“未着色”的断面
      const sectionsRes = await fetch(`/v0/bank/sections?task_id=${encodeURIComponent(taskId)}`);
      if (!sectionsRes.ok) throw new Error('获取断面列表失败');
      const js = await sectionsRes.json().catch(() => null);
      const sectionsRaw: any[] = (js?.sections ?? js?.data ?? js) || [];
      console.log('ResultPage: raw sections response:', sectionsRaw);
      const sectionResults: SectionResult[] = (Array.isArray(sectionsRaw) ? sectionsRaw : [])
        .filter(s => s && (s.geometry || s.section_geometry))
        .map((s: any) => ({
          section_id: s.section_id,
          section_name: s.section_name,
          distance: Number(s.distance ?? 0),
          bank_id: s.bank_id ?? 'unknown',
          geometry: s.geometry ?? s.section_geometry,
          vertical_foot_point: getVerticalFootPointFromAny(s) ?? null,
          // legacy compatibility
          anchorPoint: (s.anchorPoint ?? s.anchor_point ?? s.anchor) ?? null,
          risk_level: s.risk_level,
          indicator_result: null,
          manual_invalid: s.manual_invalid === true,
          manual_invalid_reason: s.manual_invalid_reason ?? null
        }));

      // 打印处理后的断面列表 JSON，便于调试（也可在控制台查看）
      try {
        console.log('ResultPage: parsed sectionResults:', JSON.stringify(sectionResults, null, 2));
      } catch {
        console.log('ResultPage: parsed sectionResults (non-serializable):', sectionResults);
      }

      lastSectionsByTaskRef.current[taskId] = sectionResults;

      // 3) 加载岸段几何（用于后续色带渲染）
      try {
        const uniqueBankIds = [...new Set(sectionResults.map(s => s.bank_id).filter(Boolean))];
        const bankFeatures: GeoJSON.Feature<GeoJSON.LineString>[] = [];
        const bankFetchPromises = uniqueBankIds.map(async (bankId) => {
          try {
            let res = await fetch(`/v0/bank/banks/${encodeURIComponent(bankId)}`);
            if (!res.ok) {
              res = await fetch(`/v0/bank/banks?bank_id=${encodeURIComponent(bankId)}`);
            }
            if (!res.ok) {
              console.warn(`岸段 ${bankId} 加载失败: HTTP ${res.status}`);
              return;
            }
            const data = await res.json().catch(() => null);
            const bank = (data?.bank || data?.banks?.[0] || data?.data || data) as any;
            const b = Array.isArray(bank) ? bank[0] : bank;
            const geom = b?.bank_geometry || b?.geometry;
            if (geom && geom.type === 'LineString') {
              bankGeometryCacheRef.current[bankId] = geom as GeoJSON.LineString;
              bankFeatures.push({
                type: 'Feature',
                properties: {
                  bank_id: b.bank_id || bankId,
                  bank_name: b.bank_name || '',
                  from_backend: true,
                },
                geometry: geom as GeoJSON.LineString,
              });
            } else {
              console.warn(`岸段 ${bankId} 无有效 LineString 几何数据`);
            }
          } catch (err) {
            console.warn(`岸段 ${bankId} 加载异常:`, err);
          }
        });
        await Promise.allSettled(bankFetchPromises);

        // 推送岸段几何到地图基底图层
        const map = mapRef.current;
        if (map && bankFeatures.length > 0) {
          const src = map.getSource('uploaded-data') as mapboxgl.GeoJSONSource | undefined;
          if (src) {
            src.setData(turf.featureCollection(bankFeatures as any));
          }
        }
      } catch {
        // 忽略岸段加载异常
      }

      // 2) 地图初始渲染（先灰色/未知风险），并缩放到断面范围
      renderSections(sectionResults);
      applyShorelineGradient(sectionResults);

      const map = mapRef.current;
      if (map && sectionResults.length > 0) {
        const sectionFeatures = sectionResults
          .filter(s => s.geometry)
          .map(s => ({ type: 'Feature', geometry: s.geometry, properties: {} }));
        if (sectionFeatures.length > 0) {
          const bbox = turf.bbox({ type: 'FeatureCollection', features: sectionFeatures as any });
          map.fitBounds([bbox[0], bbox[1], bbox[2], bbox[3]], { padding: 80 });
        }
      }

      // 3) 打开进度窗口并开始轮询（任务状态 + 结果列表），驱动地图插值持续更新
      activePollTaskIdRef.current = taskId;

      // 任务名用于弹窗展示（优先用列表中的名称）
      const taskName = taskList.find(t => t.task_id === taskId)?.task_name;

      // 立即执行一次，再开启定时轮询
      await updateProgressAndMap(taskId, taskName, sectionResults);

      pollTimerRef.current = window.setInterval(() => {
        if (activePollTaskIdRef.current !== taskId) return;
        const latestSections = lastSectionsByTaskRef.current[taskId] ?? sectionResults;
        updateProgressAndMap(taskId, taskName, latestSections);
      }, 2000);

    } catch (e: any) {
      console.error(e);
      setError(e.message || '加载任务数据失败');
    } finally {
      setLoading(false);
    }
  };

  // ============================================================
  //  框选分析（任务列表右键 → 分析）
  // ============================================================
  //
  // 入口只在**结果页的任务列表**：分析的对象是「任务已落库的结果在地图上画出的色带」，
  // 断面编辑器里那份数据是"待计算/可编辑"的草稿，口径不同，不能混为一个入口。
  // 前置条件 = 该任务已有结果（`resultCountByTask[taskId] > 0`），没有结果的任务菜单项置灰。

  /** 把内存里的断面 + 岸段整理成统计输入（显示等级 0..3，与地图着色同一套解析）。 */
  const buildAreaRiskInput = (taskId: string): { banks: AreaAnalysisBank[]; sections: AreaAnalysisSection[] } => {
    const sections: AreaAnalysisSection[] = [];
    for (const s of lastSectionsByTaskRef.current[taskId] ?? []) {
      if (!s?.geometry) continue;
      const info = resolveSectionRisk(s);
      sections.push({
        section_id: String(s.section_id ?? ''),
        bank_id: s.bank_id ?? null,
        geometry: s.geometry,
        level: info.valid ? info.level : null,
      });
    }
    const banks: AreaAnalysisBank[] = [];
    Object.entries(bankGeometryCacheRef.current).forEach(([bankId, geom]) => {
      if (geom && geom.type === 'LineString') banks.push({ bank_id: bankId, geometry: geom });
    });
    return { banks, sections };
  };

  /** 该任务有没有「至少一条有效风险值」—— 决定能不能开始分析，也用于兜底拦一次。 */
  const taskHasRiskValue = (taskId: string): boolean => {
    for (const s of lastSectionsByTaskRef.current[taskId] ?? []) {
      const info = resolveSectionRisk(s);
      if (info.valid && info.level !== null && info.level !== undefined) return true;
    }
    return false;
  };

  const startAreaAnalysis = async (taskId: string, taskName: string) => {
    // 两种框选互斥（共用同一套选区图层与左键）
    closeSectionBoxInvalid();

    // 已经有明确计数且为 0：直接拒，不去加载地图（省一次整任务的断面+结果拉取）
    if (resultCountOfTask(taskId) === 0) {
      setToast({ text: `任务「${taskName}」还没有计算结果，无法框选分析`, tone: 'warn' });
      return;
    }

    // 地图上不是这个任务（或该任务的数据还没铺上去）时先加载：分析必须对着"已加载结果的地图"
    const loaded = selectedTaskRef.current === taskId
      && (lastSectionsByTaskRef.current[taskId]?.length ?? 0) > 0;
    if (!loaded) {
      await handleTaskClick(taskId);
    }

    if (!taskHasRiskValue(taskId)) {
      setToast({ text: `任务「${taskName}」暂无计算结果，无法框选分析`, tone: 'warn' });
      return;
    }

    setAreaAnalysis({
      taskId,
      taskName,
      shape: 'rect',
      drawing: true,
      selection: null,
      stats: null,
    });
    setToast({ text: '在地图上框选范围，统计各风险等级的占比与长度', tone: 'ok' });
  };

  /** 画完一个选区：立刻按当前内存数据算一遍统计。 */
  const applyAreaSelection = (taskId: string, polygon: GeoJSON.Feature<GeoJSON.Polygon>) => {
    const { banks, sections } = buildAreaRiskInput(taskId);
    const stats = computeAreaRiskStats({ selection: polygon.geometry, banks, sections });
    setAreaAnalysis(prev => (prev && prev.taskId === taskId
      ? { ...prev, drawing: false, selection: polygon, stats }
      : prev));
  };

  const closeAreaAnalysis = () => setAreaAnalysis(null);

  // 绘制监听：只在"等用户画选区"期间存在。依赖里只放真正决定监听行为的三个值，
  // 别把整个 areaAnalysis 放进去 —— 每次 setState 都会重装监听，正在拖的矩形会被打断。
  const areaDrawing = areaAnalysis?.drawing === true;
  const areaShape = areaAnalysis?.shape ?? 'rect';
  const areaTaskId = areaAnalysis?.taskId ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !areaDrawing || !areaTaskId) return;
    ensureAreaSelectionLayers(map);
    const detach = attachAreaSelection(map, {
      shape: areaShape,
      onDone: (polygon) => applyAreaSelection(areaTaskId, polygon),
      onCancel: (reason: AreaSelectionCancelReason) => {
        if (reason === 'too-small') {
          // 误点不退出绘制：用户还要接着画，退出去反而要再点一次「重新绘制」
          setToast({ text: '选区太小，已忽略；请拖出更大的范围或在多点几处', tone: 'warn' });
          return;
        }
        setAreaAnalysis(prev => (prev ? { ...prev, drawing: false } : prev));
      },
    });
    return detach;
    // applyAreaSelection 每次渲染都是新引用，但只读 ref + setState，捕获旧的也无副作用
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaDrawing, areaShape, areaTaskId, mapReady]);

  // 选区重绘：换底图（setStyle）会把 source / 图层全部清空，所以既要补图层，也要把选区画回来。
  //
  // ⚠ 必须同时听 `styledata`：`map.setStyle()` 默认带 diff，**这种情况下 mapbox 只发
  //    `styledata`，不发 `style.load`** —— 只听后者就会出现"切到卫星底图后选区消失"。
  //    也不能只看 `isStyleLoaded()`，装载过程中它是 false 但 addLayer 往往已经可用。
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    let retries = 0;
    let timer: number | null = null;
    const apply = () => {
      ensureAreaSelectionLayers(map);
      if (hasAreaSelectionLayers(map)) {
        retries = 0;
        // 两个会话共用同一个选区 source（互斥，不会同时有值）：分析优先，其次框选设无效。
        setAreaSelection(
          map,
          areaAnalysisRef.current?.selection ?? sectionBoxInvalidRef.current?.selection ?? null,
        );
        return;
      }
      // 样式还在换：短间隔重试几次（换底图是几百毫秒级的事）
      if (retries < 10) {
        retries += 1;
        timer = window.setTimeout(apply, 150);
      }
    };
    const onStyleEvent = () => {
      retries = 0;
      apply();
    };
    apply();
    map.on('style.load', onStyleEvent);
    map.on('styledata', onStyleEvent);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      map.off('style.load', onStyleEvent);
      map.off('styledata', onStyleEvent);
    };
  }, [mapReady, areaAnalysis?.selection, sectionBoxInvalid?.selection, satellite]);

  // 注：原先这里还有一个 handleDeleteTask（删除"当前选中"的任务，约 40 行），
  // 但全仓库已无调用方 —— 实际在用的是列表行上的 handleDeleteTaskById。
  // 已于 2026-10-12 冗余清理中删除（git 历史可查）。

  // ============================================================
  //  框选批量设为无效断面（任务列表右键 → 框选设为无效断面）
  // ============================================================
  //
  // 与「框选分析」共用同一套画框交互与选区图层，但**判定口径完全不同**：
  //   · 分析：断面几何与选区**相交**（统计走的是"图上那一段色带有多长"）；
  //   · 这里：只看**断面起点**（岸侧端点）是否落在框内（见 map/sectionBoxInvalid）。
  // 提交复用单条按钮那条链路：同一个 `setSectionManualInvalid` 接口、同一个
  // `applyManualInvalidMany` 本地刷新 —— 不另写一套"批量"语义，否则两处迟早不一致。

  /** 框选提交时写进库的原因（≤200 字，单条路径不传原因）。 */
  const BOX_INVALID_REASON = '框选批量设为无效';

  /** 内存里的断面（拖拽每帧都要判，绝不可能走接口）。 */
  const boxCandidatesOf = (taskId: string): SectionBoxCandidate[] =>
    (lastSectionsByTaskRef.current[taskId] ?? []) as unknown as SectionBoxCandidate[];

  /**
   * 拖拽中的实时高亮。
   *
   * <p>每帧都跑，必须便宜：一次线性扫描（2000 条量级）+ 只把**命中项**写进 source
   * （通常几条到几十条），不重绘断面全量。React 只在命中数字变化时才 setState ——
   * 否则拖一次会触发几十次整页重渲染，拖框的手感会碎掉。
   */
  const previewSectionBoxInvalid = (polygon: GeoJSON.Feature<GeoJSON.Polygon> | null) => {
    const map = mapRef.current;
    const session = sectionBoxInvalidRef.current;
    if (!map || !session) return;
    const candidates = boxCandidatesOf(session.taskId);
    const bounds = sectionBoxBoundsOf(polygon);
    const ids = bounds ? pickSectionIdsByStartPoint(candidates, bounds) : [];
    paintSectionBoxMatch(map, candidates, ids);
    // 命中数没变就到此为止：`splitBoxInvalidByPriorState` 要建一个上千项的 Set，
    // 拖拽期间每帧都算等于白烧 60 次/秒，而它只影响"其中 N 条已是无效"这句提示。
    if (ids.length === boxMatchCountRef.current) return;
    boxMatchCountRef.current = ids.length;
    const alreadyInvalid = splitBoxInvalidByPriorState(candidates, ids).alreadyInvalid.length;
    setSectionBoxInvalid(prev => (prev
      ? { ...prev, draftCount: ids.length, alreadyInvalid }
      : prev));
  };

  /** 松手：把选区与命中集合定下来（此后只有「设为无效 / 撤销 / 重新框选」能动它）。 */
  const completeSectionBoxInvalid = (taskId: string, polygon: GeoJSON.Feature<GeoJSON.Polygon>) => {
    const map = mapRef.current;
    const candidates = boxCandidatesOf(taskId);
    const bounds = sectionBoxBoundsOf(polygon);
    const ids = bounds ? pickSectionIdsByStartPoint(candidates, bounds) : [];
    const alreadyInvalid = splitBoxInvalidByPriorState(candidates, ids).alreadyInvalid.length;
    // 收尾再画一次：最后一帧 mousemove 可能没赶上 mouseup（拖得很快时很常见）
    paintSectionBoxMatch(map, candidates, ids);
    boxMatchCountRef.current = ids.length;
    setSectionBoxInvalid(prev => (prev && prev.taskId === taskId
      ? {
        ...prev,
        drawing: false,
        selection: polygon,
        matched: ids,
        draftCount: ids.length,
        alreadyInvalid,
        // 新选区还没被应用 ⇒ 主按钮要重新可用；
        // 但 `undoIds` **要留着**：用户松手发现框错了会立刻「重新框选」，
        // 这时上一次应用的东西还必须能撤回来（撤销永远只针对「最近一次应用」）。
        appliedCount: 0,
      }
      : prev));
    if (ids.length === 0) {
      setToast({ text: sectionBoxInvalidEmptyHint(candidates.length), tone: 'warn' });
    } else {
      setToast({
        text: `框内 ${ids.length} 条断面起点落在选区里（含边界）；点「设为无效」应用`,
        tone: 'ok',
      });
    }
  };

  /** 进入框选（任务右键入口）。 */
  const startSectionBoxInvalid = async (taskId: string, taskName: string) => {
    // 两种框选互斥：共用同一套选区图层与左键，同时开着会互相抢鼠标
    closeAreaAnalysis();

    const loaded = selectedTaskRef.current === taskId
      && (lastSectionsByTaskRef.current[taskId]?.length ?? 0) > 0;
    if (!loaded) await handleTaskClick(taskId);

    const candidates = boxCandidatesOf(taskId);
    if (candidates.length === 0) {
      setToast({ text: `任务「${taskName}」没有断面，无法框选`, tone: 'warn' });
      return;
    }

    boxMatchCountRef.current = -1;
    setSectionBoxInvalid({
      taskId,
      taskName,
      drawing: true,
      selection: null,
      matched: [],
      alreadyInvalid: 0,
      draftCount: 0,
      appliedCount: 0,
      undoIds: [],
      applying: false,
    });
    setToast({ text: `${SECTION_BOX_INVALID_RULE_TEXT}。在地图上拖出矩形，Esc 或右键取消`, tone: 'ok' });
  };

  /** 应用：一次批量提交（与单条按钮同一个接口），成功后走同一套本地刷新。 */
  const applySectionBoxInvalid = async () => {
    const session = sectionBoxInvalidRef.current;
    if (!session || session.applying || session.matched.length === 0) return;
    if (!window.confirm(sectionBoxInvalidConfirmText(session.matched.length, session.alreadyInvalid))) {
      return;
    }

    // 必须在 applyManualInvalidMany **之前**算：它会就地改写这些断面为无效，
    // 之后 splitBoxInvalidByPriorState 会把全部算成"本来就无效"，撤销就没目标了。
    const { toMark } = splitBoxInvalidByPriorState(boxCandidatesOf(session.taskId), session.matched);

    setSectionBoxInvalid(prev => (prev ? { ...prev, applying: true } : prev));
    try {
      const res = await setSectionManualInvalid({
        sectionIds: session.matched,
        invalid: true,
        reason: BOX_INVALID_REASON,
      });
      if (res.updated === 0) {
        // 0 行 = 越权或已被删除。不能静默：面板会以为改成功了，图上却毫无变化
        setToast({ tone: 'warn', text: '未生效：这些断面可能已被删除，或不属于当前账号' });
        return;
      }
      applyManualInvalidMany(session.matched, true, BOX_INVALID_REASON);
      // 应用后把琥珀高亮撤掉：这一刻用户要看的是**结果**（那几条变成灰色虚线），
      // 高亮留在上面会把灰线盖住，反而看不到自己刚做了什么。选区矩形保留，便于对照范围。
      clearSectionBoxMatch(mapRef.current);
      setSectionBoxInvalid(prev => (prev
        ? { ...prev, applying: false, appliedCount: res.updated, undoIds: toMark }
        : prev));
      const partial = res.updated < session.matched.length
        ? `（提交 ${session.matched.length} 条，实际生效 ${res.updated} 条）`
        : '';
      setToast({
        tone: res.updated < session.matched.length ? 'warn' : 'ok',
        text: `已把 ${res.updated} 条断面设为无效${partial}；灰色虚线不参与统计与导出，可「撤销本次」恢复`,
      });
    } catch (e: any) {
      setSectionBoxInvalid(prev => (prev ? { ...prev, applying: false } : prev));
      setToast({ tone: 'warn', text: e?.message || '批量设为无效失败' });
    }
  };

  /** 撤销本次：只回滚这次真正从「有效」改成「无效」的那批，然后清空选区重新框选。 */
  const undoSectionsBoxInvalid = async () => {
    const session = sectionBoxInvalidRef.current;
    const ids = session?.undoIds ?? [];
    if (!session || session.applying || ids.length === 0) return;

    setSectionBoxInvalid(prev => (prev ? { ...prev, applying: true } : prev));
    try {
      const res = await setSectionManualInvalid({ sectionIds: ids, invalid: false });
      if (res.updated === 0) {
        setToast({ tone: 'warn', text: '撤销未生效：这些断面可能已被删除，或不属于当前账号' });
        return;
      }
      applyManualInvalidMany(ids, false, null);
      const map = mapRef.current;
      if (map) {
        clearSectionBoxMatch(map);
        setAreaSelection(map, null);
      }
      boxMatchCountRef.current = -1;
      setSectionBoxInvalid(prev => (prev
        ? {
          ...prev,
          applying: false,
          appliedCount: 0,
          undoIds: [],
          matched: [],
          alreadyInvalid: 0,
          draftCount: 0,
          selection: null,
          drawing: true,
        }
        : prev));
      setToast({ text: `已撤销：${res.updated} 条断面恢复为有效，可继续框选`, tone: 'ok' });
    } catch (e: any) {
      setSectionBoxInvalid(prev => (prev ? { ...prev, applying: false } : prev));
      setToast({ tone: 'warn', text: e?.message || '撤销失败' });
    }
  };

  /** 重新框选（重置）：清高亮与选区，重新进入绘制。**不动**已经生效的无效标记。 */
  const redrawSectionBoxInvalid = () => {
    const map = mapRef.current;
    if (map) {
      clearSectionBoxMatch(map);
      setAreaSelection(map, null);
    }
    boxMatchCountRef.current = -1;
    setSectionBoxInvalid(prev => (prev
      ? {
        ...prev,
        drawing: true,
        selection: null,
        matched: [],
        alreadyInvalid: 0,
        draftCount: 0,
      }
      : prev));
  };

  const closeSectionBoxInvalid = () => {
    const map = mapRef.current;
    if (map) {
      clearSectionBoxMatch(map);
      setAreaSelection(map, null);
    }
    boxMatchCountRef.current = -1;
    setSectionBoxInvalid(null);
  };

  // 画框监听：只在"等用户画矩形"期间存在。依赖只放真正决定监听行为的两个值，
  // 别把整个会话对象放进来 —— 每帧 setState 都会重装监听、把正在拖的矩形打断。
  const boxInvalidDrawing = sectionBoxInvalid?.drawing === true;
  const boxInvalidTaskId = sectionBoxInvalid?.taskId ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !boxInvalidDrawing || !boxInvalidTaskId) return;
    ensureAreaSelectionLayers(map);
    const detach = attachAreaSelection(map, {
      shape: 'rect',
      onPreview: (polygon) => previewSectionBoxInvalid(polygon),
      onDone: (polygon) => completeSectionBoxInvalid(boxInvalidTaskId, polygon),
      onCancel: (reason: AreaSelectionCancelReason) => {
        if (reason === 'too-small') {
          // 误点不退出绘制：用户还要接着画，退出去反而要再点一次「重新框选」
          setToast({ text: '选区太小，已忽略；请拖出更大的范围', tone: 'warn' });
          return;
        }
        setSectionBoxInvalid(prev => (prev ? { ...prev, drawing: false } : prev));
      },
    });
    return detach;
    // 两个回调每次渲染都是新引用，但只读 ref + setState，捕获旧的也无副作用
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxInvalidDrawing, boxInvalidTaskId, mapReady]);

  // 停止框选时把高亮留住还是清掉：留着 —— 用户松手后还要看"到底哪几条会被隐藏"，
  // 清掉的话面板上的数字和图上就对不上了。只有关闭 / 撤销 / 重新框选才清。

  const handleDeleteTaskById = async (taskId: string) => {
    try {
      const res = await fetch(`/v0/bank/tasks/${taskId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('删除任务失败');
      setTaskList(prev => prev.filter(t => t.task_id !== taskId));
      if (selectedTask === taskId) { stopPolling(); setSelectedTask(null); }
    } catch (e: any) { setError(e.message); }
  };

  // ============================================================
  //  地图渲染 & 可视化
  // ============================================================

  // 渲染断面集合几何并在地图显示
  //
  // 【可见性口径】
  //   * 四个风险等级（含低风险，2026-10-26 起）→ 实色实线，颜色取 `resolveSectionRisk`；
  //   * 「无风险值」（未计算 / 计算失败）→ **灰色虚线**（`sections-nodata-line`），
  //     仍然画出来，并且**可点**。
  //
  // 2026-10-26 二次调整的原因：无数据断面原来直接给 `rgba(0,0,0,0)` 并从命中层过滤掉，
  // 结果它们在地图上既看不见也点不到 —— 而正是这些断面最需要人工评定。
  // 现在「看不见」变成「看得见但不是一种等级」：颜色沿用 `NO_DATA_RISK_COLOR`（与图例、
  // 框选面板同一个灰），线型用虚线把「没数」和「四个等级」彻底分开。
  // 判定只走 map/sectionRenderVisibility，别在这里就地写 level > 0。
  const renderSections = (sections: SectionResult[]) => {
    const map = mapRef.current;
    if (!map) return;

    // 转换断面数据为 GeoJSON
    //
    // 同一次遍历里顺带产出「起点圆」的 feature：点的颜色与文案必须与线**逐字一致**，
    // 分成两遍会出现「线是蓝的、点是绿的」而没人知道该信哪个。所以两者共用同一个 `info`。
    const startFeatures: any[] = [];
    const features = sections.filter(s => s.geometry).map(s => {
      const info = resolveSectionRisk(s);
      const renderable = shouldRenderRisk(info);
      const color = renderable ? info.color : TRANSPARENT_RISK_COLOR;
      const displayRisk = info.valid ? info.level : info.label;
      // 文案必须把「人工无效」「低风险」「无数据」三者分开 —— 前两者在图上同是灰虚线，
      // 但一个是"我故意关掉的"、一个是"还没算出来"，处理动作完全不同。
      const riskLabel = s.manual_invalid
        ? '已标记无效（不参与着色/统计）'
        : !info.valid
          ? '无数据（待人工评估）'
          : info.level === null
            ? '未知'
            : renderable
              ? RISK_LABELS[info.level]
              : `${RISK_LABELS[info.level]}（不渲染）`;
      const name = s.section_name || s.section_id;

      // —— 起点圆：标出这条断面挂在岸段的哪一点 ——
      // 起点 = 几何首点 = 岸侧（全库 28191 条已验证，见 map/sectionStartPoints 的注释）。
      // 无数据断面的线是透明的，点不能跟着透明，否则「这里有条断面」的锚点也没了，
      // 故点单独给 NO_DATA_RISK_COLOR（与虚线、图例、框选面板同一个灰）。
      const start = sectionStartCoordinate(s.geometry);
      if (start) {
        startFeatures.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: start },
          properties: {
            id: s.section_id,
            name,
            risk_level: displayRisk,
            risk_label: riskLabel,
            color: renderable ? info.color : NO_DATA_RISK_COLOR,
            noData: !renderable,
            /** 人工无效：断面线画得更淡（见 `sections-nodata-line` 的 line-opacity 表达式）。 */
            invalid: s.manual_invalid === true,
          },
        });
      }

      return {
        type: 'Feature',
        geometry: s.geometry,
        properties: {
          id: s.section_id,
          name,
          risk_level: displayRisk,
          risk_label: riskLabel,
          color: color,
          /** 无风险值 → 由 nodata 图层画灰色虚线；命中层**不再**用它过滤（这类断面必须可点）。 */
          noData: !renderable,
          /**
           * 人工无效 = `noData` 的子集，但视觉上要能分辨：同是灰虚线，
           * 无效的更淡（line-opacity 表达式按这个字段取值）。
           * 判断「这是不是我故意关掉的那条」不能靠记忆，得能从图上读出来。
           */
          invalid: s.manual_invalid === true
        }
      };
    });


    // 更新/创建 source（支持高频刷新）
    const fc = turf.featureCollection(features as any);
    const existingSource = map.getSource('sections-source') as mapboxgl.GeoJSONSource | undefined;
    if (existingSource) {
      existingSource.setData(fc as any);
    } else {
      map.addSource('sections-source', {
        type: 'geojson',
        data: fc as any
      });
    }

    // 起点圆单独一个 source：与线共用一个 geojson source 也能跑（Mapbox 各图层只取匹配的
    // 几何类型），但那样 line 图层会为每个 Point 做一次无谓的类型判断，且 clearMapLayers
    // 里「删线 source」时会连带删掉点。分开更省事。
    const startFc = turf.featureCollection(startFeatures as any);
    const existingStartSource = map.getSource(SECTION_START_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (existingStartSource) {
      existingStartSource.setData(startFc as any);
    } else {
      map.addSource(SECTION_START_SOURCE_ID, {
        type: 'geojson',
        data: startFc as any
      });
    }

    // 两个互补的过滤 + 不过滤的命中层，真源在 map/sectionRenderVisibility（有单测守着）。
    const { solid: solidFilter, noData: noDataFilter, hit: hitFilter } = sectionLayerFilters() as {
      solid: any; noData: any; hit: any;
    };

    // 若图层不存在则创建一次；后续仅更新 source 数据与可见性
    if (!map.getLayer('sections-line')) {
      map.addLayer({
        id: 'sections-line',
        type: 'line',
        source: 'sections-source',
        filter: solidFilter,
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
          'visibility': showSections ? 'visible' : 'none'
        },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 5,
          'line-opacity': 0.9
        }
      });
    } else {
      // filter 每次都要刷：旧图层上可能还留着上一版按 `hidden` 过滤的表达式。
      map.setFilter('sections-line', solidFilter);
    }

    // —— 无数据断面：灰色虚线 ——
    // 单开一层而不是复用 `sections-line`：Mapbox 的 line-dasharray 是**整层**属性，
    // 没法按 feature 决定虚实；而「虚线 = 没数」正是这里唯一需要的区分手段。
    if (!map.getLayer('sections-nodata-line')) {
      map.addLayer({
        id: 'sections-nodata-line',
        type: 'line',
        source: 'sections-source',
        filter: noDataFilter,
        layout: {
          'line-join': 'round',
          'line-cap': 'butt',
          'visibility': showSections ? 'visible' : 'none'
        },
        paint: {
          'line-color': NO_DATA_RISK_COLOR,
          // 断面上也用虚线，与岸段虚线同一套语义（虚线 = 没数）。
          'line-dasharray': [1.4, 1.4],
          'line-width': 3,
          /**
           * 「人工无效」比「没算出来」再淡一档。
           *
           * 两者共用这一层（虚线是整层属性，Mapbox 没法按 feature 决定 `line-dasharray`），
           * 但语义不同：没算 = 待办，无效 = 用户主动关掉、别再提醒我。图上要能分辨，
           * 否则「我标的那几条到底生效了没有」只能靠记忆。`opacity` 是 data-driven 的，
           * 正好承担这个区分，且不会引入第 5 种颜色。
           */
          'line-opacity': ['case', ['==', ['get', 'invalid'], true], 0.45, 0.95]
        }
      });
    } else {
      map.setFilter('sections-nodata-line', noDataFilter);
    }

    // 命中层**不按等级过滤**：无数据断面也得能点开 —— 点开才知道它是哪一条、
    // 才有下一步人工评定的落点。以前这类断面被 `hidden` 过滤掉，等于永远摸不到。
    if (!map.getLayer('sections-line-hit')) {
      map.addLayer({
        id: 'sections-line-hit',
        type: 'line',
        source: 'sections-source',
        filter: hitFilter,
        paint: {
          'line-width': 12,
          'line-opacity': 0
        },
        layout: {
          'visibility': showSections ? 'visible' : 'none'
        }
      });
    } else {
      map.setFilter('sections-line-hit', hitFilter);
    }

    // —— 断面起点圆 ——
    // 目的：让「这条断面挂在哪一段岸上」不用点开就能看出来。断面是横跨河道的线，
    // 只看线的话两根线交叉在江心，根本分不清谁连着哪段岸；起点落在岸线上才是一一对应的锚点。
    //
    // 放在命中层**之后**（= 图层顺序最上）：点击时 Mapbox 后加的层优先，圆点才点得中。
    // 半径随缩放收缩（见 map/sectionStartPoints）：单任务断面可达 2000+ 条，
    // 低缩放下全尺寸圆点会串成一排白点、把岸段色带整片盖住。
    if (!map.getLayer(SECTION_START_LAYER_ID)) {
      map.addLayer({
        id: SECTION_START_LAYER_ID,
        type: 'circle',
        source: SECTION_START_SOURCE_ID,
        layout: {
          'visibility': showSections ? 'visible' : 'none'
        },
        paint: sectionStartPointPaint() as any
      });
    }

    // 事件只绑定一次（防止轮询刷新导致重复绑定）
    if (!sectionClickHandlerRef.current) {
      sectionClickHandlerRef.current = (e: any) => {
        // 岸段折点编辑 / 选岸段期间不响应断面点击：这一刻点图是在选岸段或拖折点，
        // 弹一张断面矩阵会盖住编辑浮栏，等于把人从编辑态里踢出去。
        if (bankEditActiveRef.current || bankEditPickingRef.current) return;
        if (!e.features || e.features.length === 0) return;
        const f = e.features[0];
        const p = f.properties;
        if (!p) return;

        const root = document.createElement('div');
        root.style.padding = '6px 6px 4px';
        root.style.fontFamily = 'sans-serif';

        const title = document.createElement('div');
        title.textContent = String(p.name ?? '断面');
        title.style.margin = '0';
        title.style.fontWeight = '700';
        title.style.color = '#1e293b';
        title.style.fontSize = '13px';
        root.appendChild(title);

        const meta = document.createElement('div');
        meta.textContent = `断面ID: ${p.id}`;
        meta.style.marginTop = '4px';
        meta.style.fontSize = '12px';
        meta.style.color = '#64748b';
        root.appendChild(meta);

        const risk = document.createElement('div');
        risk.style.marginTop = '4px';
        risk.style.fontSize = '12px';
        risk.style.color = '#64748b';
        risk.innerHTML = `风险等级: <span style="color:${p.color}; font-weight:700;">${p.risk_label}</span>`;
        root.appendChild(risk);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = '查看细节';
        btn.style.marginTop = '8px';
        btn.style.border = 'none';
        btn.style.background = '#3b82f6';
        btn.style.color = 'white';
        btn.style.borderRadius = '6px';
        btn.style.padding = '4px 8px';
        btn.style.cursor = 'pointer';
        btn.style.fontSize = '12px';
        btn.onclick = () => {
          const sid = String(p.id);
          const sname = String(p.name ?? '断面');
          const tid = selectedTaskRef.current;
          openMatrixDetail(tid, sid, sname);
        };
        root.appendChild(btn);

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.textContent = '编辑数值';
        editBtn.style.marginTop = '8px';
        editBtn.style.marginLeft = '6px';
        editBtn.style.border = '1px solid #cbd5e1';
        editBtn.style.background = '#ffffff';
        editBtn.style.color = '#334155';
        editBtn.style.borderRadius = '6px';
        editBtn.style.padding = '3px 8px';
        editBtn.style.cursor = 'pointer';
        editBtn.style.fontSize = '12px';
        editBtn.onclick = () => {
          const sid = String(p.id);
          const sname = String(p.name ?? '断面');
          const tid = selectedTaskRef.current;
          openMatrixDetail(tid, sid, sname, true);
        };
        root.appendChild(editBtn);

        activePopupRef.current?.remove();
        activePopupSectionIdRef.current = String(p.id ?? '');
        activePopupRef.current = new mapboxgl.Popup().setLngLat(e.lngLat).setDOMContent(root).addTo(map);
      };
      sectionEnterHandlerRef.current = () => {
        map.getCanvas().style.cursor = 'pointer';
      };
      sectionLeaveHandlerRef.current = () => {
        map.getCanvas().style.cursor = '';
      };

      // 命中层与起点圆共用同一个 handler：两处弹的是同一条断面，内容必须一模一样
      // （properties 已在上面用同一个 `info` 生成）。同一个点击可能同时命中线和点，
      // handler 会跑两遍 —— 第二遍先 remove 再 add 同一个 popup，同位置同内容，视觉无差。
      ['sections-line-hit', SECTION_START_LAYER_ID].forEach(layerId => {
        map.off('click', layerId, sectionClickHandlerRef.current!);
        map.on('click', layerId, sectionClickHandlerRef.current!);

        map.off('mouseenter', layerId, sectionEnterHandlerRef.current!);
        map.on('mouseenter', layerId, sectionEnterHandlerRef.current!);

        map.off('mouseleave', layerId, sectionLeaveHandlerRef.current!);
        map.on('mouseleave', layerId, sectionLeaveHandlerRef.current!);
      });
    }

    // 起点圆必须在最上层：岸段色带是沿整条岸线铺的宽带，而起点正落在带子覆盖范围内。
    // 首次渲染时色带还没建，这里先占位；真正生效靠 applyShorelineGradient 末尾那次。
    raiseSectionStartLayer(map as any);
  };

  /**
   * 色带逻辑：直接在岸段线几何上按断面风险渲染渐变色带。
   * `onlyBankId` 用于人工修改后的**局部重绘**：只重算受影响的那条岸段，
   * 其它岸段连 setPaintProperty 都不碰（全量重算会让整条岸线闪一下）。
   */
  const applyShorelineGradient = (sections: SectionResult[], onlyBankId?: string | null) => {
    const map = mapRef.current;
    if (!map) return;

    // 岸段折点编辑期间整体停画。理由：色带是按**库里那份几何**算的，编辑时草稿线已经换了
    // 位置，若这里照旧重绘（轮询每 2 秒一次），用户会看到色带在旧位置闪回，
    // 像是「拖了但没生效」。退出/保存时闸门放开，再按新几何完整重算一次。
    if (bankEditActiveRef.current) return;

    // 没有任何断面：把已存在的岸段色带全部藏掉，避免上一个任务的配色残留在地图上
    // （clearMapLayers 会删图层，但它只在切任务时调用，这里的防线针对「同任务内结果被清空」）。
    if (!sections || sections.length === 0) {
      const style = map.getStyle();
      (style?.layers ?? []).forEach((layer: any) => {
        const id = String(layer.id ?? '');
        // 前缀覆盖实色色带与灰色虚线两层；漏掉 nodata 的话，清空结果后地图上会留着
        // 上一个状态的虚线，看起来像「这条岸段一直没数据」。
        if (id.startsWith('bankline-') && map.getLayer(id)) {
          map.setLayoutProperty(id, 'visibility', 'none');
        }
      });
      return;
    }

    // 1. 按 bank_id 分组
    const groups: Record<string, SectionResult[]> = {};
    sections.forEach(s => {
      const bid = s.bank_id || 'unknown';
      if (!groups[bid]) groups[bid] = [];
      groups[bid].push(s);
    });

    // 注：这里不再按「全局有没有可渲染断面」决定要不要画灰底线。无数据区间的可见性
    // 一律由 `bankline-nodata-*` 灰色虚线承担 —— 任务还在算时整条岸段都是虚线，
    // 同样不会留下「地图一片空白、像加载失败」的观感。
    let bankSegmentsDirty = false;

    // 2. 遍历每个岸段组
    Object.keys(groups).forEach(bankId => {
      if (onlyBankId && bankId !== onlyBankId) return;
      const bankSections = groups[bankId];
      if (!bankSections || bankSections.length === 0) return;

      // 获取岸段真实几何
      const bankGeo = bankGeometryCacheRef.current[bankId];
      if (!bankGeo || bankGeo.type !== 'LineString') return;

      const bankCoords = bankGeo.coordinates as number[][];
      if (!bankCoords || bankCoords.length < 2) return;

      const bankLine = turf.lineString(bankCoords as any);
      const totalDist = turf.length(bankLine, { units: 'meters' });
      if (totalDist <= 0) return;

      /** 断面→沿线位置，按「岸段 + 断面 + 几何签名」缓存；断面被拖动后签名变化自动失效。 */
      const progressOf = (section: SectionResult): number | null => {
        const cache = bandProgressCacheRef.current;
        const key = `${bankId}|${section.section_id}`;
        const coords = (section.geometry?.coordinates ?? []) as number[][];
        const signature = `${coords.length}|${coords[0]?.join(',') ?? ''}|${coords[coords.length - 1]?.join(',') ?? ''}|${Math.round(totalDist)}`;
        const cached = cache.get(key);
        if (cached && cached.signature === signature) return cached.progress;
        const progress = sectionProgressAlongBank(section, bankLine, totalDist);
        if (cache.size > 5000) cache.clear();
        cache.set(key, { signature, progress });
        return progress;
      };

      // 每条断面按几何投影求沿线位置（见 sectionProgressAlongBank），再按位置升序排：
      // Mapbox 的 interpolate 要求 stop 单调递增，用桩号排序而用投影定位会乱序。
      const placedSections = bankSections
        .filter(s => s && s.geometry && s.geometry.type === 'LineString')
        .map(s => ({ section: s, progress: progressOf(s) }))
        .filter(item => item.progress !== null)
        .sort((a, b) => (a.progress as number) - (b.progress as number));

      // 【可见性口径】只有「无风险值」的断面不参与实色着色（见 map/sectionRenderVisibility）：
      //   * 整条岸段一条有值的断面都没有 → stops 为 null → 实色图层 visibility 关掉；
      //   * 部分断面无风险值 → 岸段按「最近断面」切成区间（Voronoi 式），无值的那条断面
      //     把它管辖的整段（前后各半个间距）填透明。注意不能只在该断面位置插一个透明点：
      //     两侧实色会跨过它插值，透明点不到 1 像素、肉眼完全看不出来 —— 这是早前修复过的根因。
      //   * 透明区间**不是什么都不画**：下面单开一层 `bankline-nodata-*` 用灰色虚线画出来，
      //     让「这里有一条岸段、但还没有数据」看得见（2026-10-26 用户要求，便于后续人工评定）。
      //   低风险自 2026-10-26 起正常着绿色，不走这条「留空」路径。
      const riskPoints: RiskGradientPoint[] = placedSections.map(({ section: s, progress }) => {
        const info = resolveSectionRisk(s);
        return {
          val: progress as number,
          level: info.valid ? (info.level ?? null) : null,
          color: info.color,
        };
      });

      // 区间划分只算一次：实色 stops、灰色底线、灰色虚线三层共用，
      // 任何一层自己再切一遍都会出现「实色与虚线错位」。
      const spans = buildRiskBandSpans(riskPoints);
      const noDataSpans = collectNoDataSpans(spans);

      const stops = buildRiskGradientStops(riskPoints);
      const bankVisible = stops !== null;

      /** 把区间按米切片成几何；亚米级碎片直接丢掉，避免生成一堆退化线段。 */
      const minLen = Math.max(1, totalDist * 1e-4);
      const sliceSpans = (list: typeof spans): GeoJSON.Feature[] => {
        const out: GeoJSON.Feature[] = [];
        list.forEach(span => {
          const from = span.start * totalDist;
          const to = span.end * totalDist;
          if (to - from < minLen) return;
          try {
            const slice = turf.lineSliceAlong(bankLine, from, to, { units: 'meters' });
            out.push({ type: 'Feature', properties: { bank_id: bankId }, geometry: slice.geometry });
          } catch {
            // 单段切片失败（几何退化）时跳过，不影响其它段
          }
        });
        return out;
      };

      // —— 灰色底线（uploaded-lines-base）：只留实色区间 ——
      // 它的作用是给半透明色带垫一条视觉连续的底座。无数据区间**不再**走这条 2px 灰实线 ——
      // 虚线画在它上面时，间隙会露出下面的实线，看起来又变回实线了。
      {
        const feats = sliceSpans(spans.filter(span => span.visible));
        bankVisibleSegmentsRef.current[bankId] = feats;
        bankSegmentsDirty = true;
      }

      // —— 无数据岸段：灰色虚线 ——
      // 与「四个等级的实色」严格区分：颜色用 `NO_DATA_RISK_COLOR`（框选面板「未计算」同一个灰），
      // 线型用虚线。整条岸段都没数据时这条虚线就是用户在地图上找到该岸段的唯一线索。
      {
        const noDataLayerId = `bankline-nodata-${bankId}`;
        const noDataSourceId = `bankline-nodata-source-${bankId}`;
        const noDataFeats = sliceSpans(noDataSpans);
        const fc = turf.featureCollection(noDataFeats as any);
        const noDataVisible = noDataFeats.length > 0;

        const existingNoDataSrc = map.getSource(noDataSourceId) as mapboxgl.GeoJSONSource | undefined;
        if (existingNoDataSrc) {
          existingNoDataSrc.setData(fc as any);
        } else {
          map.addSource(noDataSourceId, { type: 'geojson', data: fc as any });
        }

        if (!map.getLayer(noDataLayerId)) {
          map.addLayer({
            id: noDataLayerId,
            type: 'line',
            source: noDataSourceId,
            layout: {
              'visibility': noDataVisible ? 'visible' : 'none',
              'line-join': 'round',
              'line-cap': 'butt',
            },
            paint: {
              'line-color': NO_DATA_RISK_COLOR,
              // 虚线长度按线宽缩放（Mapbox 语义），故与色带同宽时 dash 会自动放大。
              // 间隙刻意大于实段（2.2 : 1.2）：整条岸段都没数据时，若间隙太小会糊成
              // 一条灰色实带，反被读成「第 5 个等级」。
              'line-dasharray': [1.2, 2.2],
              // 比色带略细：宽度差本身也是一层区分信号，同时给小比例尺下密集的岸段让位。
              'line-width': ['*', bankShadeWidthExpr(), NO_DATA_BAND_WIDTH_SCALE] as any,
              'line-opacity': 0.95,
            },
          });
        } else {
          map.setLayoutProperty(noDataLayerId, 'visibility', noDataVisible ? 'visible' : 'none');
          map.setPaintProperty(noDataLayerId, 'line-width', ['*', bankShadeWidthExpr(), NO_DATA_BAND_WIDTH_SCALE] as any);
        }
      }

      // 渲染到岸段线上
      const layerId = `bankline-result-${bankId}`;
      const sourceId = `bankline-source-${bankId}`;

      const existing = map.getSource(sourceId) as mapboxgl.GeoJSONSource | undefined;
      if (existing) {
        existing.setData(bankLine as any);
      } else {
        map.addSource(sourceId, { type: 'geojson', data: bankLine as any, lineMetrics: true } as any);
      }

      if (!map.getLayer(layerId)) {
        map.addLayer({
          id: layerId,
          type: 'line',
          source: sourceId,
          layout: {
            // 整条岸段都没有风险值时，图层先建出来但直接不显示 —— 之后人工改成有值
            // 只需切 visibility，不必重建图层（重建会丢掉 lineMetrics 的缓存）。
            'visibility': bankVisible ? 'visible' : 'none',
          },
          paint: {
            // 线宽必须随比例尺变化，不能写死像素值：Mapbox 的 line-width 单位是屏幕
            // CSS 像素，定值 20 在小比例尺下折合地面几十公里、把整段岸线糊成一条粗带。
            // 具体曲线与取值理由见 map/bankShadeWidth.ts。
            'line-width': bankShadeWidthExpr(),
            'line-gradient': (stops ?? emptyRiskGradientStops()) as any,
            'line-opacity': 0.7,
          },
        });
      } else {
        map.setPaintProperty(layerId, 'line-gradient', (stops ?? emptyRiskGradientStops()) as any);
        // 图层已存在时也把宽度表达式刷一遍：热更新之后旧图层上还留着上一版的定值宽度。
        map.setPaintProperty(layerId, 'line-width', bankShadeWidthExpr());
        map.setLayoutProperty(layerId, 'visibility', bankVisible ? 'visible' : 'none');
      }
    });

    // 所有岸段的可见切片合并成一次 setData（each bank 单独 setData 会互相覆盖）
    if (bankSegmentsDirty) {
      const segSrc = map.getSource('uploaded-data') as mapboxgl.GeoJSONSource | undefined;
      if (segSrc) {
        const all = Object.values(bankVisibleSegmentsRef.current).flat();
        segSrc.setData(turf.featureCollection(all as any));
      }
    }

    // 色带图层刚在上面被创建/更新，起点圆又被压到下面了 —— 这里必须再提一次。
    // 这是 `renderSections` 末尾那次的全量版本：局部重绘（onlyBankId）也会新建 bankline 图层。
    raiseSectionStartLayer(map as any);
  };

  // ============================================================
  //  岸段折点编辑：状态机
  // ============================================================

  /**
   * 提交一步折点改动（拖动结束 / 插入 / 删除 / 撤销都走它）。
   *
   * <p>「签名没变就不入栈」这一条不是优化而是必需：`mousedown` + `mouseup` 不移动鼠标
   * 也会走到提交，若照推，点一下折点就多一条空历史，撤销要连点好几次才有效果。
   */
  const commitBankEditCoords = (next: BankCoord[]) => {
    const history = bankEditHistoryRef.current;
    const currentSnapshot = history.cursor >= 0 ? history.stack[history.cursor] : null;
    if (currentSnapshot && coordsSignature(currentSnapshot) === coordsSignature(next)) {
      // 内容没变：只把地图上的草稿刷一遍（可能被重合点清理过），不记历史
      const map = mapRef.current;
      if (map) pushBankEditDraft(map, next);
      return;
    }
    // 新操作要截断 redo 分支：撤销几步后再改，原来的「重做」已经没有意义
    history.stack = history.stack.slice(0, history.cursor + 1);
    history.stack.push(next);
    history.cursor = history.stack.length - 1;

    bankEditCoordsRef.current = next;
    setBankEditCoords(next);
    const base = history.stack[0];
    setBankEditDirty(coordsSignature(base) !== coordsSignature(next));
    setBankEditHistoryVersion(v => v + 1);
    const map = mapRef.current;
    if (map) pushBankEditDraft(map, next);
  };

  /** 撤销 / 重做共用的「跳转到栈上某一步」。 */
  const jumpBankEditHistory = (delta: number) => {
    const history = bankEditHistoryRef.current;
    const target = history.cursor + delta;
    if (target < 0 || target >= history.stack.length) return;
    history.cursor = target;
    const coords = history.stack[target];
    bankEditCoordsRef.current = coords;
    setBankEditCoords(coords);
    const base = history.stack[0];
    setBankEditDirty(coordsSignature(base) !== coordsSignature(coords));
    setBankEditHistoryVersion(v => v + 1);
    const map = mapRef.current;
    if (map) pushBankEditDraft(map, coords);
  };

  /**
   * 进入某条岸段的折点编辑。
   *
   * <p>几何来源是 `bankGeometryCacheRef`（进任务时已缓存），**不重新请求**：
   * 编辑必须与地图上正在显示的那条线逐点一致，多打一次接口只会引入
   * 「缓存是旧的、服务端是新的」这种错位。
   */
  const enterBankEdit = async (bankId: string) => {
    const coords = normalizeBankCoords(bankGeometryCacheRef.current[bankId]);
    if (!coords) {
      setToast({ tone: 'warn', text: '该岸段几何读不出来（需要 LineString 且至少 2 个折点），无法编辑' });
      return;
    }

    setBankEditPicking(false);
    let bankName = bankId;
    let usage: { taskCount: number; sectionCount: number } | null = null;
    try {
      const payload = await fetchJSON(`/v0/bank/banks/${encodeURIComponent(bankId)}/usage`);
      if (payload?.bank_name) bankName = String(payload.bank_name);
      usage = {
        taskCount: Number(payload?.task_count ?? 0),
        sectionCount: Number(payload?.section_count ?? 0),
      };
    } catch {
      // 影响面取不到不影响编辑能力，只是少一条提示 —— 不要因此拒绝进入编辑
    }

    const target = { bankId, bankName };
    bankEditTargetRef.current = target;
    bankEditActiveRef.current = true;
    bankEditCoordsRef.current = coords;
    bankEditHistoryRef.current = { stack: [coords], cursor: 0 };
    setBankEditTarget(target);
    setBankEditCoords(coords);
    setBankEditUsage(usage);
    setBankEditDirty(false);
    setBankEditHistoryVersion(v => v + 1);

    const map = mapRef.current;
    if (!map) return;
    ensureBankEditLayers(map);
    pushBankEditDraft(map, coords);
    // 旧位置的色带与虚线必须藏掉：草稿线是「这条岸段现在在哪」的唯一真相，
    // 留着旧色带会让人以为改失败了。
    bankBandLayerIds(bankId).forEach(layerId => {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', 'none');
    });
    // 灰底线（uploaded-data）里也要摘掉这条岸段，否则旧位置还留一条 2px 灰线。
    const others = Object.entries(bankVisibleSegmentsRef.current)
      .filter(([id]) => id !== bankId)
      .flatMap(([, feats]) => feats);
    const segSrc = map.getSource('uploaded-data') as mapboxgl.GeoJSONSource | undefined;
    if (segSrc) segSrc.setData(turf.featureCollection(others as any));
  };

  /**
   * 退出编辑。
   *
   * @param refreshBand 是否按当前缓存几何重绘该岸段色带。取消时几何没变，但色带在编辑期间
   *                    被藏掉了，所以**两种退出都要重绘**；参数留着是为了未来「切任务」
   *                    这类不该重绘的场景。
   */
  const exitBankEdit = (refreshBand: boolean) => {
    const target = bankEditTargetRef.current;
    const map = mapRef.current;

    bankEditActiveRef.current = false;
    bankEditTargetRef.current = null;
    bankEditCoordsRef.current = null;
    bankEditDragRef.current = null;
    bankEditHistoryRef.current = { stack: [], cursor: -1 };
    setBankEditTarget(null);
    setBankEditCoords(null);
    setBankEditUsage(null);
    setBankEditDirty(false);
    setBankEditHistoryVersion(v => v + 1);

    if (map) {
      removeBankEditLayers(map);
      map.dragPan.enable();
      map.getCanvas().style.cursor = '';
    }
    if (refreshBand && target) {
      // 闸门已在上面放开，这里能真正重绘。只刷这一条岸段：全量重绘会顺带
      // 重算其它岸段的里程投影，纯属浪费。
      applyShorelineGradient(lastSectionsByTaskRef.current[selectedTask ?? ''] ?? [], target.bankId);
    }
  };

  /** 保存折点改动到 `bank_geometry`。成功后重绘色带；失败保留编辑态，让人能再试。 */
  const saveBankGeometry = async () => {
    const target = bankEditTargetRef.current;
    const coords = bankEditCoordsRef.current;
    if (!target || !coords) return;

    setBankEditSaving(true);
    try {
      const payload = await fetchJSON(
        `/v0/bank/banks/${encodeURIComponent(target.bankId)}/geometry`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bank_geometry: { type: 'LineString', coordinates: coords } }),
        },
      );

      bankGeometryCacheRef.current[target.bankId] = {
        type: 'LineString',
        coordinates: coords,
      } as unknown as GeoJSON.LineString;
      // 里程投影缓存：键里含岸段总长，改了折点本来就会失效；显式清掉是为了不留旧条目。
      for (const key of Array.from(bandProgressCacheRef.current.keys())) {
        if (key.startsWith(`${target.bankId}|`)) bandProgressCacheRef.current.delete(key);
      }

      exitBankEdit(true);
      const affected = Number(payload?.task_count ?? 0);
      setToast({
        tone: affected > 1 ? 'warn' : 'ok',
        text: affected > 1
          ? `岸段已保存：${affected} 个任务的色带位置随之改变；已生成的报告/图片需重新生成`
          : '岸段已保存，色带已重绘；已生成的报告/图片需重新生成',
      });
    } catch (e: any) {
      setToast({ tone: 'warn', text: `保存失败：${e?.message || '未知错误'}` });
    } finally {
      setBankEditSaving(false);
    }
  };

  // 用 ref 暴露提交函数：地图事件监听只在进入编辑时注册一次，
  // 若把 commit 放进依赖，每次折点变化都会重建全部监听 —— 拖拽中途被打断。
  useEffect(() => {
    bankEditCommitRef.current = commitBankEditCoords;
  });

  useEffect(() => {
    bankEditPickingRef.current = bankEditPicking;
  }, [bankEditPicking]);

  /**
   * 拾取模式：点地图选一条岸段。
   *
   * <p>为什么不在按钮上直接给一个下拉列表：任务里的岸段可能有几十条，
   * 名字相近（`Mzs` 系列），列表选不中「地图上我看到的那条」。
   * 点选才是「我指哪条就改哪条」。
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bankEditPicking) return;

    map.getCanvas().style.cursor = 'crosshair';
    const handler = (e: mapboxgl.MapMouseEvent) => {
      const layerIds = (map.getStyle()?.layers ?? [])
        .map(layer => layer.id)
        .filter(id =>
          id === 'uploaded-lines-base' || id.startsWith('bankline-result-') || id.startsWith('bankline-nodata-'));
      let bankId: string | null = null;
      if (layerIds.length > 0) {
        const features = map.queryRenderedFeatures(e.point, { layers: layerIds });
        for (const feature of features) {
          const fromLayer = bankIdFromLayerId(String((feature.layer as any)?.id ?? ''));
          const fromProps = feature.properties?.bank_id ? String(feature.properties.bank_id) : null;
          if (fromLayer || fromProps) {
            bankId = fromLayer ?? fromProps;
            break;
          }
        }
      }
      if (!bankId) {
        setToast({ tone: 'warn', text: '这里没有岸段，请点在彩色或灰色的岸段线上' });
        return;
      }
      void enterBankEdit(bankId);
    };

    map.on('click', handler);
    return () => {
      map.off('click', handler);
      map.getCanvas().style.cursor = '';
    };
    // enterBankEdit 只读 ref 与 setState，注册时捕获那一份即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankEditPicking]);

  /**
   * 编辑态的鼠标交互：拖动折点 / 双击线插点 / Alt 点击删点。
   *
   * <p>拖拽实现刻意「每帧只写地图、不写 React」：`bankEditCoordsRef` 承担拖拽中的真值，
   * `mouseup` 才提交一次 state。一条岸段平均上百个折点，每帧 setState 会让整页重渲染，
   * 手感立刻变成卡顿。
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bankEditTarget) return;
    const canvas = map.getCanvas();
    const prevCursor = canvas.style.cursor;

    const onVertexDown = (e: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapboxGeoJSONFeature[] }) => {
      const index = Number(e.features?.[0]?.properties?.index);
      if (!Number.isFinite(index)) return;

      // Alt / Option + 点击 = 删掉这个折点。用组合键而不是右键：
      // 右键在这张图上被框选分析占用，再抢会打架。
      if ((e.originalEvent as MouseEvent | undefined)?.altKey) {
        const current = bankEditCoordsRef.current;
        if (!current) return;
        const next = deleteVertex(current, index);
        if (!next) {
          setToast({ tone: 'warn', text: '至少要保留 2 个折点，无法再删' });
          return;
        }
        commitBankEditCoords(next);
        return;
      }

      bankEditDragRef.current = { index };
      map.dragPan.disable();
      canvas.style.cursor = 'grabbing';
      (e.originalEvent as MouseEvent | undefined)?.preventDefault?.();
    };

    const onMove = (e: mapboxgl.MapMouseEvent) => {
      const drag = bankEditDragRef.current;
      if (!drag) return;
      const current = bankEditCoordsRef.current;
      if (!current) return;
      const next = moveVertex(current, drag.index, e.lngLat.lng, e.lngLat.lat);
      bankEditCoordsRef.current = next;
      pushBankEditDraft(map, next);
    };

    const onUp = () => {
      if (!bankEditDragRef.current) return;
      bankEditDragRef.current = null;
      map.dragPan.enable();
      canvas.style.cursor = '';
      const current = bankEditCoordsRef.current;
      if (!current) return;
      // 收尾清一次重合折点：手抖常把两个折点拖到同一坐标，0 长度段会让
      // `lineSliceAlong` 抛错（色带整段消失）。
      commitBankEditCoords(dropCoincidentVertices(current));
    };

    const onDblClick = (e: mapboxgl.MapMouseEvent) => {
      const current = bankEditCoordsRef.current;
      if (!current) return;
      const hit = nearestPointOnBank(current, e.lngLat.lng, e.lngLat.lat);
      if (!hit) return;
      // 插的是**投影到线上的点**，不是鼠标位置：否则新折点会把岸线拽出一个尖角
      commitBankEditCoords(insertVertexAfter(current, hit.segmentIndex, hit.point[0], hit.point[1]));
    };

    const onEnterVertex = () => {
      if (!bankEditDragRef.current) canvas.style.cursor = 'grab';
    };
    const onLeaveVertex = () => {
      if (!bankEditDragRef.current) canvas.style.cursor = '';
    };

    map.on('mousedown', BANK_EDIT_VERTEX_HIT_LAYER_ID, onVertexDown as any);
    map.on('mousemove', onMove);
    map.on('mouseup', onUp);
    // 鼠标在地图外松开时 Mapbox 收不到 mouseup，拖拽会「粘住」不放 ⇒ 补一个 window 监听
    window.addEventListener('mouseup', onUp);
    map.on('dblclick', BANK_EDIT_DRAFT_LAYER_ID, onDblClick as any);
    map.on('mouseenter', BANK_EDIT_VERTEX_HIT_LAYER_ID, onEnterVertex);
    map.on('mouseleave', BANK_EDIT_VERTEX_HIT_LAYER_ID, onLeaveVertex);
    // 双击会同时触发一次缩放，编辑时那一下缩放会让刚插的点跑出视野
    map.doubleClickZoom.disable();

    return () => {
      map.off('mousedown', BANK_EDIT_VERTEX_HIT_LAYER_ID, onVertexDown as any);
      map.off('mousemove', onMove);
      map.off('mouseup', onUp);
      window.removeEventListener('mouseup', onUp);
      map.off('dblclick', BANK_EDIT_DRAFT_LAYER_ID, onDblClick as any);
      map.off('mouseenter', BANK_EDIT_VERTEX_HIT_LAYER_ID, onEnterVertex);
      map.off('mouseleave', BANK_EDIT_VERTEX_HIT_LAYER_ID, onLeaveVertex);
      map.doubleClickZoom.enable();
      map.dragPan.enable();
      canvas.style.cursor = prevCursor || '';
    };
    // commitBankEditCoords 通过 ref 间接调用；监听只在进入编辑时注册一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankEditTarget]);

  // Esc 退出编辑。有未保存改动时先确认 —— 拖了几十个折点被一次误按全丢掉，
  // 比多点一次麻烦得多。
  useEffect(() => {
    if (!bankEditTarget) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (bankEditDirty && !window.confirm('放弃未保存的岸段折点改动？')) return;
      exitBankEdit(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankEditTarget, bankEditDirty]);

  // 切任务时强制退出编辑：编辑态的折点属于上一个任务的岸段，
  // 留着会让人在新任务的地图上拖一条「看不见归属」的线。
  useEffect(() => {
    if (!bankEditTargetRef.current) return;
    bankEditActiveRef.current = false;
    bankEditTargetRef.current = null;
    bankEditCoordsRef.current = null;
    bankEditDragRef.current = null;
    bankEditHistoryRef.current = { stack: [], cursor: -1 };
    setBankEditTarget(null);
    setBankEditCoords(null);
    setBankEditUsage(null);
    setBankEditDirty(false);
    setBankEditPicking(false);
    setBankEditHistoryVersion(v => v + 1);
  }, [selectedTask]);


  // 搜索命中跳转：等地图真正就绪再飞（mapReady 之前 mapRef 还是 null）。
  // pendingFocus 由顶部搜索框写入；这里消费一次就清空 —— StrictMode 下 effect 会跑两次，
  // 不清的话会飞两遍、弹窗闪两下。
  const pendingFocusNonce = useResourceTreeStore((s) => s.pendingFocus?.nonce ?? 0);
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    const focus = useResourceTreeStore.getState().pendingFocus;
    if (!focus) return;
    useResourceTreeStore.getState().clearPendingFocus();
    if (focus.lng != null && focus.lat != null) {
      map.flyTo({
        center: [focus.lng, focus.lat],
        zoom: Math.max(map.getZoom(), 12),
        essential: true,
      });
    }
    void openMatrixDetail(focus.taskId, focus.sectionId, focus.sectionName);
    // openMatrixDetail 每次渲染都是新引用，放进依赖会无限触发；它只读 props/setState，捕获旧的也无副作用
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFocusNonce, mapReady]);

  // 底图切换
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(getBasemapStyle(satellite ? 'satellite' : 'standard'));

    // setStyle 会把**所有**自定义 source / 图层清掉（岸段色带、断面层、灰色底线）。
    // 之前只在 load 里补了 `uploaded-data`，于是「切到卫星底图后风险色带整片消失」。
    // 这里在样式重建后按内存里的断面快照把两套图层画回来；已经有图层就直接跳过，
    // 避免 addLayer → styledata → 再 addLayer 的死循环。
    const rehydrate = () => {
      try {
        const taskId = selectedTaskRef.current;
        if (!taskId) return;
        if (map.getLayer('sections-line-hit')) return;
        const sections = lastSectionsByTaskRef.current[taskId];
        if (!sections || sections.length === 0) return;
        renderSections(sections);
        applyShorelineGradient(sections);
      } catch {
        /* 样式还在换：下一次 styledata / 轮询会再试 */
      }
    };
    map.on('styledata', rehydrate);
    return () => {
      map.off('styledata', rehydrate);
    };
  }, [satellite]);

  // 初始化地图（沿用 EditorPage 的风格）
  useEffect(() => {
    if (!mapContainer.current) return;

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: getBasemapStyle('standard'),
      center: [119.89600633, 32.22907004],
      zoom: 7,
    });

    mapRef.current = map;
    // 开发期把地图挂到 window：结果页的图层（断面 / 色带 / 框选高亮）全在 canvas 上，
    // DOM 里查不到，真机脚本（CDP）只能靠它读 `getSource()._data` / `getStyle().layers`
    // 来区分「没画」和「画了但被压住」。生产构建不会带上（`import.meta.env.DEV` 为 false 时被裁掉）。
    if (import.meta.env.DEV) (window as any).__resultMap = map;
    map.addControl(new mapboxgl.NavigationControl(), 'top-left');

    const initLayers = () => {
      map.addSource('uploaded-data', { type: 'geojson', data: turf.featureCollection([]) });
      map.addLayer({
        id: 'uploaded-lines-base',
        type: 'line',
        source: 'uploaded-data',
        filter: ['==', '$type', 'LineString'],
        paint: { 'line-color': '#94a3b8', 'line-width': 2 }
      });
      setMapReady(true);
    };

    map.on('load', initLayers);
    map.on('style.load', initLayers);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    requestAnimationFrame(() => map.resize());
  }, [resizeTrigger]);

  // —— 流场：第一次打开流场时才拉清单，避免页面加载就多打两个请求。
  // 两条清单各来自一处：
  //   * 内置工况（51 个 = 17 档流量 × 3 种潮型）来自模型服务的资源树，2024-08 的固定素材，
  //     只盖住大区 DEM 的约 8%；
  //   * 场景来自 resource/flowField/<scene-id>/，是按 DEM 范围从库里点云生成的，覆盖整片 DEM。
  // 两者共用同一套取数路径，只是 id 形态不同，所以这里合并成一次加载、一个下拉。
  //
  // ⚠️ 这里刻意**不用** "let cancelled = false + cleanup 里置位" 那套写法，也不把
  // flowCasesLoading 放进依赖数组。原因（真机踩过）：StrictMode 会「挂载 → 卸载 → 再挂载」，
  // 而 loading 一旦进依赖，第二次挂载后状态更新触发的 cleanup 会把**唯一还活着**的那次请求
  // 标记成 cancelled ⇒ 面板永远停在"正在读取工况清单…"。改用一个 ref 持有在途请求来做去重，
  // 并且无论组件状态如何都清掉 loading。
  useEffect(() => {
    if (!flowEnabled || flowListSettledRef.current) return;
    if (flowCasesRequestRef.current) return;
    setFlowCasesLoading(true);
    setFlowError(null);
    // ⚠ 两个取数函数的**成功**返回形状不一样，必须在这里各自归一化成同一个对象形状：
    //     * fetchFlowFieldCases()  -> { cases, frames }（对象）
    //     * fetchFlowFieldScenes() -> FlowFieldScene[]（**数组本身**）
    //   之前写成 `(sceneResult as { scenes?: FlowFieldScene[] })?.scenes ?? []`，
    //   而数组没有 `.scenes` 字段 ⇒ 成功路径上**恒得空数组**；失败兜底的 `{ scenes: [] }`
    //   恰好长得像成功结果，于是既不报错也不显示场景，静默退回内置工况（老范围）。
    //   现在两条路径都产出 { ...: 数组, error? }，形状由 tsc 盯着，改错一侧就编译不过。
    const request = Promise.all([
      fetchFlowFieldCases().then(
        (r) => ({ cases: r.cases, frames: r.frames, error: undefined as string | undefined }),
        (err: any) => ({ cases: [] as FlowFieldCase[], frames: 0, error: err?.message as string | undefined }),
      ),
      fetchFlowFieldScenes().then(
        (r) => ({ scenes: r, error: undefined as string | undefined }),
        (err: any) => ({ scenes: [] as FlowFieldScene[], error: err?.message as string | undefined }),
      ),
    ]);
    flowCasesRequestRef.current = request;
    request
      .then(([caseResult, sceneResult]) => {
        const cases = caseResult?.cases ?? [];
        const scenes = sceneResult?.scenes ?? [];
        setFlowCases(cases);
        setFlowScenes(scenes);
        const firstError = caseResult?.error || sceneResult?.error;
        if (firstError) setFlowError(String(firstError));
        // 默认优先给场景 —— 它覆盖整片 DEM；没有场景才退回内置工况。
        // 场景的具体选哪一档交给下面那个"跟着任务 DEM 走"的 effect，这里只兜一个底。
        const fallbackScene = scenes[Math.floor(scenes.length / 2)];
        const preferredCase = cases.find((c) => c.caseId === '84000dc')
          ?? cases.find((c) => c.caseId === '10000dc')
          ?? cases[Math.floor(cases.length / 2)];
        const initial = fallbackScene?.sceneId ?? preferredCase?.caseId ?? '';
        if (initial) setFlowCaseId((prev) => prev || initial);
      })
      .finally(() => {
        flowCasesRequestRef.current = null;
        flowListSettledRef.current = true;
        setFlowCasesLoading(false);
      });
  }, [flowEnabled]);

  // —— 流场：把粒子图层挂到结果页地图上。
  // 三个必须处理的点：
  //  1. 切换卫星底图走的是 map.setStyle，会把图层全部清掉 ⇒ 要在 style.load 时重新挂；
  //  2. 内置工况的包围盒只有约 68km × 37km，地图默认 zoom 下只有几十像素 ⇒ 打开时飞到它上面；
  //     按场景生成的则是一整片 DEM（大区那份是 312 × 96 km），同样需要飞过去才看得见；
  //     两种情况都用 description 里的 extent 做 fitBounds，不用分别处理。
  //  3. 场景的 id 与内置工况形态不同，但请求路径一样，所以这里不需要分支。
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!flowEnabled || !flowCaseId) {
      const existing = flowLayerRef.current;
      if (existing) {
        try {
          if (map.getLayer(FLOW_FIELD_LAYER_ID)) map.removeLayer(FLOW_FIELD_LAYER_ID);
        } catch {
          // 样式正在切换时 getLayer 可能抛错，此时图层本来也会被清掉
        }
        existing.dispose();
        flowLayerRef.current = null;
      }
      flowGeometryRef.current = null;
      setFlowStatus(null);
      return;
    }

    let cancelled = false;
    setFlowError(null);
    const layer = new FlowFieldLayer({
      // 用 ref 读当前配色：配色变化只走下面的 setParameters，
      // 不放进本 effect 的依赖里 —— 否则换一次颜色就重建整层、白丢 26 帧纹理。
      colorScheme: flowColorSchemeRef.current,
      onStatus: (status) => {
        if (!cancelled) setFlowStatus(status);
      },
    });
    flowLayerRef.current = layer;

    const attach = () => {
      if (cancelled) return;
      try {
        if (!map.getLayer(FLOW_FIELD_LAYER_ID)) map.addLayer(layer);
      } catch {
        // 样式还没就绪：后面的 load / style.load 会再试一次
      }
    };
    map.on('load', attach);
    map.on('style.load', attach);
    attach();

    void (async () => {
      try {
        const geometry = await fetchFlowFieldGeometry(flowCaseId);
        if (cancelled) return;
        flowGeometryRef.current = geometry;
        await layer.loadCase(flowCaseId, geometry);
        if (cancelled) return;
        map.fitBounds(
          [
            [geometry.west * 360 - 180, latFromMercatorY(geometry.south)],
            [geometry.east * 360 - 180, latFromMercatorY(geometry.north)],
          ],
          { padding: 24, duration: 700 },
        );
      } catch (err: any) {
        if (!cancelled) setFlowError(err?.message || String(err));
      }
    })();

    return () => {
      cancelled = true;
      map.off('load', attach);
      map.off('style.load', attach);
      try {
        if (map.getLayer(FLOW_FIELD_LAYER_ID)) map.removeLayer(FLOW_FIELD_LAYER_ID);
      } catch {
        // 同上：样式切换中忽略
      }
      layer.dispose();
      if (flowLayerRef.current === layer) flowLayerRef.current = null;
      flowGeometryRef.current = null;
    };
  }, [flowEnabled, flowCaseId]);

  /** 换配色：只把新的色带重烘进 1 KB 的查找纹理，粒子状态与已下载的帧纹理都不动。 */
  useEffect(() => {
    flowColorSchemeRef.current = flowColorScheme;
    flowLayerRef.current?.setParameters({ colorScheme: flowColorScheme });
  }, [flowColorScheme]);

  /**
   * 流场跟着「当前任务的 DEM」走。
   *
   * 这是"流场要能展示所属"那条需求的落点：
   *   任务 → 断面档案里的 dem_id → 覆盖这片 DEM 的场景 → 场景的 extent 就是那片 DEM 的范围。
   * 内置工况那 68 km 的小框因此只在"没有对应场景"时才会被用到。
   *
   * 匹配分两级（细节见 {@link findSceneForDem}）：先找 `tiff_keys` 里有这片 DEM 的场景；
   * 找不到再退一步，找"范围包住这片 DEM"的场景。第二级要 DEM 自己的包围盒，所以这里
   * 惰性拉一次 `tiff-bounds` —— 只有第一级落空时才会真去打这个请求。
   *
   * 取 dem_id 走的是断面档案接口（`section_profiles.dem_id`），它已经按任务缓存过
   * （{@link ensureTaskProfilesLoaded}），所以这里一般不会多打请求。
   */
  useEffect(() => {
    if (!flowEnabled || flowScenes.length === 0) return;
    // 用户手动挑过就不再自动切，免得刚选好又被顶掉
    if (flowUserPickedRef.current) return;
    const taskId = selectedTask;
    if (!taskId) return;
    let cancelled = false;
    void (async () => {
      try {
        const profiles = await ensureTaskProfilesLoaded(taskId);
        if (cancelled) return;
        const demIds = Array.from(
          new Set(
            Object.values(profiles)
              .map((profile: any) => String(profile?.dem_id ?? profile?.demId ?? '').trim())
              .filter(Boolean),
          ),
        );
        // 第一级：同范围的 DEM（不需要额外请求）
        let hit = demIds
          .map((dem) => findSceneForDem(flowScenes, dem, inferPreferredTidal(dem)))
          .find(Boolean) ?? null;
        // 第二级：小区域 DEM 没有自己的场景，退一步找"范围包住它"的场景。
        // 这一步才需要各 DEM 的范围；拉不到（比如服务里没有登记这片 DEM）就保持原样。
        if (!hit) {
          const bounds = await loadTiffBounds();
          if (cancelled) return;
          hit = demIds
            .map((dem) =>
              findSceneForDem(flowScenes, dem, inferPreferredTidal(dem), demBoundsOf(bounds, dem)),
            )
            .find(Boolean) ?? null;
        }
        if (!hit || cancelled) return;
        setFlowCaseId(hit.sceneId);
      } catch {
        // 任务还没跑出断面档案时拿不到 dem_id —— 保持当前选择即可，不打扰用户。
      }
    })();
    return () => {
      cancelled = true;
    };
    // ensureTaskProfilesLoaded 是稳定的取数封装（内部有缓存），不进依赖以免每渲染都重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowEnabled, flowScenes, selectedTask]);

  /** 工况按流量档分组，51 条平铺在一个下拉里太糊。 */
  const flowCaseGroups = useMemo(() => {
    const groups = new Map<string, FlowFieldCase[]>();
    for (const item of flowCases) {
      const bucket = groups.get(item.waterQs);
      if (bucket) bucket.push(item);
      else groups.set(item.waterQs, [item]);
    }
    return [...groups.entries()].map(([waterQs, items]) => ({ waterQs, cases: items }));
  }, [flowCases]);

  const toggleFlowPlaying = () => {
    const layer = flowLayerRef.current;
    if (!layer) return;
    layer.setPlaying(flowStatus?.phase !== 'playing');
  };

  const progressPercent = useMemo(() => {
    if (!progress) return 0;
    if (progress.expectedTotal <= 0) return 0;
    return Math.round((progress.processedCount / progress.expectedTotal) * 100);
  }, [progress]);

  // 任务列表本地过滤（T0）。
  // 任务列表接口是整份拉下来的（无分页），所以在前端过滤即可，不发新请求。
  // 匹配范围：任务名称 + 任务 ID，大小写不敏感。
  const filteredTasks = useMemo(() => {
    const q = taskSearchQuery.trim().toLowerCase();
    if (!q) return taskList;
    return taskList.filter(t =>
      (t.task_name || '').toLowerCase().includes(q) ||
      String(t.task_id || '').toLowerCase().includes(q)
    );
  }, [taskList, taskSearchQuery]);

  const toggleErrorExpanded = (sectionId: string) => {
    const willExpand = !expandedErrorIds[sectionId];
    setExpandedErrorIds(prev => ({ ...prev, [sectionId]: willExpand }));
    if (willExpand && progress?.taskId && sectionId) loadErrorDetail(progress.taskId, sectionId);
  };

  // — 地图覆盖按钮通用样式（卫星/聊天切换）
  const MAP_OVERLAY_BTN_STYLE: React.CSSProperties = {
    position: 'absolute', right: 12, zIndex: 10,
    background: 'rgba(255,255,255,0.7)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    border: '1px solid rgba(0,0,0,0.08)',
    borderRadius: 14, padding: '6px 12px', cursor: 'pointer',
    fontSize: '0.8rem', color: '#334155',
    display: 'flex', alignItems: 'center', gap: 4,
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  };

  // ——— 终止当前选中的运行中任务 ———
  // 与资源树 / 侧栏下半区共用同一个接口。三段式：确认 → 调接口 → 就地刷新进度。
  // 刻意不干等 2s 轮询周期：终止后 status 与 run_completed_at 都会变，
  // 就地刷一次能让进度条立刻收尾、按钮立刻消失，反馈才跟得上点击。
  const handleStopRunningTask = async () => {
    const taskId = selectedTask;
    if (!taskId || cancelling) return;
    const taskName = taskList.find((t: any) => String(t?.task_id ?? t?.id) === String(taskId))?.task_name || taskId;

    const confirmed = await new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: '终止运行中的任务',
        content: `确认终止任务「${taskName}」？当前正在计算的那条断面会算完，之后的断面不再计算；已经算完并入库的断面结果全部保留。`,
        okText: '终止任务',
        cancelText: '再想想',
        okButtonProps: { danger: true },
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!confirmed) return;

    setCancelling(true);
    try {
      const outcome = await cancelTask(taskId);
      if (!outcome.ok) {
        alert(outcome.message);
        return;
      }
      if (outcome.kind === 'stopping') {
        alert(`已请求终止「${taskName}」：当前断面算完后停止，已完成的结果保留。`);
      } else if (outcome.kind === 'stale-cleared') {
        alert(`「${taskName}」的执行进程早已不存在，已直接标记为「已终止」。`);
      } else {
        alert(`「${taskName}」当前并不在运行中，已刷新状态。`);
      }
      const latest = (lastSectionsByTaskRef.current[taskId] ?? []) as SectionResult[];
      await updateProgressAndMap(taskId, taskName, latest);
    } finally {
      setCancelling(false);
    }
  };

  // ============================================================
  //  JSX 渲染
  // ============================================================

  // 撤销/重做按钮的可用态。栈本身在 ref 里（地图回调要读最新值），
  // 靠 version 计数做失效信号 —— 只有这三个小布尔需要参与渲染。
  const bankEditCanUndo = useMemo(
    () => bankEditHistoryRef.current.cursor > 0,
    [bankEditHistoryVersion],
  );
  const bankEditCanRedo = useMemo(() => {
    const history = bankEditHistoryRef.current;
    return history.cursor >= 0 && history.cursor < history.stack.length - 1;
  }, [bankEditHistoryVersion]);

  return (
    <div className="editor-layout">
      <div className="editor-sidebar-panel" style={{ width: leftPanelWidth, minWidth: leftPanelWidth, display: 'flex' }}>
        {/* Content panel - shows the active section only */}
        <div className="upload-control result-sidebar" style={{ position: 'static', flex: 1, height: '100%', top: 0, left: 0, background: 'transparent' }}>
          {/* === TASKS PANEL === */}
          {activeSidebarPanel === 'tasks' && (
            <div className="result-tasks-panel">
              <div className="sidebar-header" data-tour="result-tasks">
                <List size={14} />
                <h4>任务列表</h4>
              </div>

              {/* 任务搜索（T0：前端本地过滤） */}
              <div className="task-search-bar" data-tour="task-search">
                <div className="task-search-input-wrap">
                  <Search size={13} className="task-search-icon" />
                  <input
                    className="task-search-input"
                    type="text"
                    placeholder="搜索任务名称 / ID"
                    value={taskSearchInput}
                    onChange={(e) => {
                      setTaskSearchInput(e.target.value);
                      // 清空输入框时取消过滤，避免"看着空却还在筛"
                      if (e.target.value === '') setTaskSearchQuery('');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setTaskSearchQuery(taskSearchInput);
                    }}
                  />
                  {taskSearchInput && (
                    <button
                      className="task-search-clear"
                      title="清空"
                      onClick={() => { setTaskSearchInput(''); setTaskSearchQuery(''); }}
                    >×</button>
                  )}
                </div>
                <button
                  className="task-search-btn"
                  onClick={() => setTaskSearchQuery(taskSearchInput)}
                >
                  <Search size={13} />
                  搜索
                </button>
              </div>

              {taskSearchQuery.trim() && !loading && (
                <div className="task-search-hint">
                  找到 <b>{filteredTasks.length}</b> 条 / 共 {taskList.length} 条
                  <button
                    className="task-search-hint-reset"
                    onClick={() => { setTaskSearchInput(''); setTaskSearchQuery(''); }}
                  >重置</button>
                </div>
              )}

              <div className="task-list-container">
                {taskList.length === 0 && !loading && <p className="empty-hint">暂无任务</p>}
                {taskList.length > 0 && filteredTasks.length === 0 && (
                  <p className="empty-hint">没有匹配「{taskSearchQuery}」的任务</p>
                )}
                {filteredTasks.map(task => (
                  <div 
                    key={task.task_id} 
                    className={`task-item ${selectedTask === task.task_id ? 'active' : ''}`}
                    onClick={() => handleTaskClick(task.task_id)}
                    onContextMenu={(e) => openTaskMenu(e, task)}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/task-id', task.task_id);
                      e.dataTransfer.setData('application/task-name', task.task_name);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div className="task-title">{task.task_name}</div>
                        <div className="task-meta">
                          ID: {task.task_id} | {new Date(task.created_at).toLocaleDateString()}
                        </div>
                      </div>
                      <button className="task-delete-btn" onClick={(e) => {
                        e.stopPropagation();
                        if (!confirm(`确认删除任务「${task.task_name}」？`)) return;
                        handleDeleteTaskById(task.task_id);
                      }} title="删除任务">×</button>
                    </div>
                    <div className="task-hint">右键查看操作</div>
                  </div>
                ))}
              </div>

                    <div className="result-actions-row">
                      <button
                        className="toggle-sections-btn"
                        onClick={() => setShowSections(!showSections)}
                      >
                        {showSections ? '隐藏断面' : '显示断面'}
                      </button>
                      {/* 岸段折点编辑入口。放在「显示断面」旁边：两者都是「图上画什么」的开关。
                          进入后先选岸段再编辑，不做成下拉列表 —— 任务里岸段可能几十条、名字相近，
                          列表选不中「地图上我看到的这一条」。 */}
                      <button
                        className={`toggle-sections-btn ${bankEditTarget || bankEditPicking ? 'hidden' : ''}`}
                        onClick={() => {
                          if (bankEditTarget) {
                            if (bankEditDirty && !window.confirm('放弃未保存的岸段折点改动？')) return;
                            exitBankEdit(true);
                            return;
                          }
                          setBankEditPicking(v => !v);
                        }}
                        title={bankEditTarget
                          ? '退出岸段折点编辑'
                          : '拖动折点修改岸段位置（会写入共享岸段，所有引用它的任务都会跟着变）'}
                      >
                        {bankEditTarget ? '退出岸段编辑' : bankEditPicking ? '取消选择岸段' : '编辑岸段折点'}
                      </button>
                    </div>

              {loading && <div className="loading-spinner">数据加载中...</div>}
              {error && <p className="error-message">错误: {error}</p>}
              
              {selectedTask && !loading && (
                <div className="result-info">
                  <h5>当前分析结果</h5>
                  {/* 文案直读 RISK_LABELS，别再写死中文：名称只有 riskScoring.ts 一处真源。
                      四个等级全部着色（2026-10-26 起低风险也是绿色实色）；
                      灰色虚线 = 「无数据」—— 地图上看得见但不是一种等级，点断面可做人工评定。 */}
                  <div className="legend">
                    <div className="legend-item"><span className="dot lv3"></span>{RISK_LABELS[3]}</div>
                    <div className="legend-item"><span className="dot lv2"></span>{RISK_LABELS[2]}</div>
                    <div className="legend-item"><span className="dot lv1"></span>{RISK_LABELS[1]}</div>
                    <div className="legend-item"><span className="dot lv0"></span>{RISK_LABELS[0]}</div>
                    <div className="legend-item"><span className="dot none"></span>无数据（待人工评定）</div>
                  </div>
                  <div className="legend-hint">
                    四个风险等级以实色显示；灰色虚线表示该断面/岸段暂无计算结果。
                    这类岸段仍会完整显示，便于人工补充评定。
                  </div>
                  <div className="legend-hint">
                    断面在<strong>靠岸一侧的端点</strong>带一个小圆点，圆点颜色与断面一致 ——
                    顺着圆点就能看出这条断面挂在哪一段岸上。
                  </div>
                </div>
              )}
            </div>
          )}

          {/* === REPORTS PANEL === */}
          {activeSidebarPanel === 'reports' && (
            <>
              <div className="sidebar-header" data-tour="result-reports">
                <FileText size={14} />
                <h4>报告查看</h4>
              </div>
              <div className="task-list-container" style={{ maxHeight: 'calc(100% - 50px)', overflowY: 'auto' }}>
                {reportList.length === 0 && <p className="empty-hint">暂无报告或出图记录</p>}
                {reportList.map((r: any, i: number) => (
                  <div
                    key={r.filename || i}
                    className="task-item"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/report-filename', r.filename);
                      e.dataTransfer.setData('application/report-taskid', r.taskId || '');
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'grab' }}
                  >
                    <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => openReport(r.filename)}>
                      <div className="task-title" style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                        {/* AI 出图结果与 AI 报告同目录同查看器，靠 kind 区分来源 */}
                        <span style={{
                          flexShrink: 0, fontSize: '0.62rem', lineHeight: '1.4', padding: '0 4px', borderRadius: 3,
                          background: r.kind === 'viz' ? '#e0f2fe' : '#f1f5f9',
                          color: r.kind === 'viz' ? '#0369a1' : '#475569',
                        }}>{r.kind === 'viz' ? '出图' : '报告'}</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.taskId ? `任务 ${r.taskId}` : r.filename}
                        </span>
                      </div>
                      <div className="task-meta" style={{ fontSize: '0.7rem' }}>{r.time || ''}</div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!confirm(r.kind === 'viz'
                          ? '确定删除这条出图记录？它引用的图片文件会一并删除。'
                          : '确定删除此报告？')) return;
                        fetch(`/v0/bank/ai/reports/${encodeURIComponent(r.filename)}`, { method: 'DELETE' })
                          .then(() => fetchReportList());
                      }}
                      style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', padding: '2px 4px' }}
                      title="删除报告"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* === PROGRESS PANEL === */}
          {activeSidebarPanel === 'progress' && (
            <>
              <div className="sidebar-header" data-tour="result-progress">
                <BarChart3 size={14} />
                <h4>计算进度</h4>
              </div>
              {progressOpen && selectedTask ? (
                <div style={{ flex: 1, overflow: 'auto' }}>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: 8 }}>
                    任务: {progress?.taskName || selectedTask}
                    {progress?.status ? ` | 状态: ${progress.status}` : ''}
                  </div>
                  <progress
                    value={progress?.processedCount ?? 0}
                    max={Math.max(1, progress?.expectedTotal ?? 1)}
                    style={{ width: '100%', height: 6, accentColor: '#2563eb' }}
                  />
                  <div style={{ fontSize: '0.72rem', marginTop: 6, color: '#64748b' }}>
                    <div>进度: {progressPercent}% · 已处理: {progress?.processedCount ?? 0}/{progress?.expectedTotal ?? 0}</div>
                    <div>成功: {progress?.successCount ?? 0} · 失败: {progress?.errorCount ?? 0}</div>
                    <div style={{ marginTop: 2, fontSize: '0.65rem' }}>更新: {progress?.lastUpdatedAt ? new Date(progress.lastUpdatedAt).toLocaleTimeString() : '-'}</div>
                  </div>

                  {/* 终止入口：只在任务确实还在跑时出现；终止后 status 变化，按钮自动消失 */}
                  {String(progress?.status ?? '').toLowerCase() === 'running' && (
                    <button
                      type="button"
                      onClick={() => { void handleStopRunningTask(); }}
                      disabled={cancelling}
                      data-tour="result-stop"
                      style={{
                        marginTop: 10, width: '100%',
                        border: '1px solid #fca5a5',
                        background: cancelling ? '#fffbeb' : '#fff',
                        color: cancelling ? '#a16207' : '#b91c1c',
                        borderColor: cancelling ? '#fcd34d' : '#fca5a5',
                        borderRadius: 6,
                        cursor: cancelling ? 'default' : 'pointer',
                        fontSize: '0.72rem', padding: '5px 10px',
                      }}
                    >
                      {cancelling ? '终止中…（等一下当前断面算完）' : '终止任务'}
                    </button>
                  )}
                  {String(progress?.status ?? '').toLowerCase() === 'cancelled' && (
                    <div style={{ marginTop: 8, fontSize: '0.7rem', color: '#b45309', lineHeight: 1.6 }}>
                      该任务已终止：已算完的断面结果保留，未运行的断面不会补算。
                    </div>
                  )}
                  {(progress?.errors?.length ?? 0) > 0 ? (
                    <div className="task-list-container" style={{ marginTop: 10 }}>
                      {progress!.errors.map(err => {
                        const expanded = Boolean(expandedErrorIds[err.section_id]);
                        return (
                          <div key={err.section_id} className="task-item" style={{ cursor: 'default' }}>
                            <div className="task-title" style={{ fontSize: '0.8rem', color: '#ef4444' }}>{err.section_name || err.section_id}</div>
                            <div className="task-meta" style={{ fontSize: '0.7rem' }}>{err.message}</div>
                            <button
                              onClick={() => toggleErrorExpanded(err.section_id)}
                              style={{
                                marginTop: 4, width: '100%', border: '1px solid #e2e8f0',
                                background: '#f8fafc', borderRadius: 4, cursor: 'pointer',
                                fontSize: '0.7rem', color: '#2563eb', padding: '4px 10px',
                                textAlign: 'center',
                              }}
                            >
                              {expanded ? '收起详情' : '查看详情'}
                            </button>
                            {expanded && (
                              <div style={{ marginTop: 6, padding: 8, background: '#f8fafc', borderRadius: 4, border: '1px solid #e2e8f0' }}>
                                {err.detailError && <div className="task-meta" style={{ fontSize: '0.7rem', color: '#ef4444', marginBottom: 6 }}>{err.detailError}</div>}
                                <pre style={{ fontSize: '0.68rem', margin: 0, whiteSpace: 'pre-wrap', color: '#64748b', lineHeight: 1.4, fontFamily: 'monospace' }}>{JSON.stringify(err.detail ?? err.raw ?? err, null, 2)}</pre>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="task-list-container" style={{ marginTop: 10 }}>
                      <p className="empty-hint">暂无断面错误信息</p>
                    </div>
                  )}
                  <button onClick={() => setProgressOpen(false)} className="delete-task-btn" style={{ width: '100%', marginTop: 10 }}>
                    关闭进度
                  </button>
                </div>
              ) : (
                <p className="empty-hint" style={{ marginTop: 16 }}>请先选择一个任务查看进度</p>
              )}
            </>
          )}

    {/* === SKILLS PANEL === */}
    {activeSidebarPanel === 'skills' && (
      <>
        <div className="sidebar-header" data-tour="result-skills">
          <Box size={14} />
          <h4>Skills</h4>
        </div>
        <div className="task-list-container" style={{ maxHeight: 'calc(100% - 50px)', overflowY: 'auto' }}>
          {skillList.length === 0 && <p className="empty-hint">暂无 Skills</p>}
          {skillList.map((s: any) => (
            <div
              key={s.name}
              className="task-item"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', s.name);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              style={{ cursor: 'grab', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <div style={{ flex: 1 }}>
                <div className="task-title" style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {s.source === 'local' ? '📁' : s.source === 'synced' ? '✅' : '☁️'} {s.name}
                  <span style={{
                    fontSize: '0.6rem', padding: '1px 5px', borderRadius: 3,
                    background: s.source === 'local' ? '#dbeafe' : s.source === 'synced' ? '#dcfce7' : '#fef3c7',
                    color: s.source === 'local' ? '#2563eb' : s.source === 'synced' ? '#16a34a' : '#d97706',
                  }}>{s.source === 'local' ? '本地' : s.source === 'synced' ? '已同步' : 'Nacos'}</span>
                  {s.approval && (
                    <span style={{
                      fontSize: '0.6rem', padding: '1px 5px', borderRadius: 3,
                      background: s.approval === 'APPROVED' ? '#dcfce7' : s.approval === 'PENDING' ? '#fef3c7' : s.approval === 'REJECTED' ? '#fee2e2' : '#f1f5f9',
                      color: s.approval === 'APPROVED' ? '#16a34a' : s.approval === 'PENDING' ? '#d97706' : s.approval === 'REJECTED' ? '#dc2626' : '#64748b',
                    }}>{s.approval === 'APPROVED' ? '已批准' : s.approval === 'PENDING' ? '待审批' : s.approval === 'REJECTED' ? '已驳回' : '无需审批'}</span>
                  )}
                  {s.source === 'local' && (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        try {
                          const res = await fetch(`/v0/bank/ai/skill/upload/${encodeURIComponent(s.name)}`, { method: 'POST' });
                          const d = await res.json();
                          if (d.success) { alert('上传成功，已提交审批'); fetchSkills(); }
                          else alert('上传失败: ' + (d.error || '未知错误'));
                        } catch { alert('网络错误'); }
                      }}
                      style={{
                        marginLeft: 4, fontSize: '0.6rem', padding: '1px 6px',
                        border: '1px solid #2563eb', background: '#dbeafe',
                        color: '#2563eb', borderRadius: 3, cursor: 'pointer',
                      }}
                    >上传</button>
                  )}
                  {s.source === 'nacos' && (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        try {
                          const res = await fetch(`/v0/bank/ai/skill/download/${encodeURIComponent(s.name)}`, { method: 'POST' });
                          const d = await res.json();
                          if (d.success) alert('下载成功，已提交审批，立即生效');
                          else alert('下载失败: ' + (d.error || '未知错误'));
                        } catch (err: any) { alert('下载失败: ' + (err.message || '网络错误')); }
                      }}
                      style={{
                        marginLeft: 4, fontSize: '0.6rem', padding: '1px 6px',
                        border: '1px solid #d97706', background: '#fef3c7',
                        color: '#d97706', borderRadius: 3, cursor: 'pointer',
                      }}
                    >下载到本地</button>
                  )}
                </div>
                <div className="task-meta" style={{ fontSize: '0.7rem' }}>
                  {s.version ? <span style={{ color: '#64748b', marginRight: 4 }}>v{s.version}</span> : null}
                  {s.description || ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      </>
    )}
        </div>
      </div>
      <ResizeHandle onResize={(delta) => setLeftPanelWidth(w => Math.max(200, Math.min(600, w + delta)))} onDragEnd={() => setResizeTrigger(t => t + 1)} />
      <div className="editor-map-panel" data-tour="result-workspace" style={{ display: 'flex', flexDirection: 'column' }}>
        <div ref={mapContainer} className="map-full" style={{ flex: 1 }} />

        {/* 岸段折点编辑：拾取提示 / 编辑浮栏。都压在图上，不占侧栏宽度。 */}
        {bankEditPicking && !bankEditTarget && (
          <div className="map-bank-pick-hint">
            点击要编辑折点的岸段（彩色实线或灰色虚线）· Esc 取消
          </div>
        )}
        {bankEditTarget && bankEditCoords && (
          <BankGeometryEditBar
            bankId={bankEditTarget.bankId}
            bankName={bankEditTarget.bankName}
            vertexCount={bankEditCoords.length}
            dirty={bankEditDirty}
            canUndo={bankEditCanUndo}
            canRedo={bankEditCanRedo}
            saving={bankEditSaving}
            usage={bankEditUsage}
            onUndo={() => jumpBankEditHistory(-1)}
            onRedo={() => jumpBankEditHistory(1)}
            onSave={() => void saveBankGeometry()}
            onCancel={() => {
              if (bankEditDirty && !window.confirm('放弃未保存的岸段折点改动？')) return;
              exitBankEdit(true);
            }}
          />
        )}

        {/* 框选分析：提示条 + 结果面板都浮在这张图上（不遮右侧报告区与左侧任务列表）。
            颜色/文案与编辑器那套一致，只是这里统计的是「已落库结果」的色带。 */}
        {areaAnalysis?.drawing && (
          <div className="map-box-select-hint is-analytics" data-tour="map-box-select-hint">
            {areaAnalysis.shape === 'polygon'
              ? '单击逐点圈出分析范围，双击或回车闭合 · Esc 或右键取消'
              : '按住鼠标拖出矩形，统计选区内的风险占比与长度 · Esc 或右键取消'}
          </div>
        )}
        {areaAnalysis && (
          <AreaRiskAnalysisPanel
            state={{
              taskId: areaAnalysis.taskId,
              taskName: areaAnalysis.taskName,
              shape: areaAnalysis.shape,
              hasSelection: !!areaAnalysis.selection,
              stats: areaAnalysis.stats,
            }}
            drawing={areaAnalysis.drawing}
            onShapeChange={(shape) => setAreaAnalysis(prev => (prev
              ? { ...prev, shape: shape as AreaAnalysisShape, drawing: true, selection: null, stats: null }
              : prev))}
            onRedraw={() => setAreaAnalysis(prev => (prev
              ? { ...prev, drawing: true, selection: null, stats: null }
              : prev))}
            onClose={closeAreaAnalysis}
          />
        )}

        {/* 框选设为无效：与上面同位置、同交互，但只有矩形（起点判定不需要多边形）。
            提示条用琥珀色 —— 与"分析(青)"分开，"这一下会隐藏东西"必须一眼看出。 */}
        {sectionBoxInvalid?.drawing && (
          <div className="map-box-select-hint is-invalid" data-tour="map-box-select-hint">
            按住鼠标拖出矩形：起点落在框内的断面会被一起设为无效 · Esc 或右键取消
          </div>
        )}
        {sectionBoxInvalid && (
          <SectionBoxInvalidPanel
            taskName={sectionBoxInvalid.taskName}
            drawing={sectionBoxInvalid.drawing}
            hasSelection={!!sectionBoxInvalid.selection}
            matchedCount={sectionBoxInvalid.drawing
              ? sectionBoxInvalid.draftCount
              : sectionBoxInvalid.matched.length}
            alreadyInvalid={sectionBoxInvalid.alreadyInvalid}
            appliedCount={sectionBoxInvalid.appliedCount}
            undoCount={sectionBoxInvalid.undoIds.length}
            busy={sectionBoxInvalid.applying}
            onApply={() => { void applySectionBoxInvalid(); }}
            onUndo={() => { void undoSectionsBoxInvalid(); }}
            onRedraw={redrawSectionBoxInvalid}
            onClose={closeSectionBoxInvalid}
          />
        )}

        {matrixOpen && (
          <div className="matrix-modal-overlay" onClick={closeMatrixDetail}>
            <div className="matrix-modal" onClick={(e) => e.stopPropagation()}>
              <div className="matrix-modal-header">
                <div>
                  <div className="matrix-modal-title">
                    断面矩阵详情
                    {(matrixDetail?.edited || matrixDetail?.manual_override?.edited) && (
                      <span
                        className="matrix-edited-tag"
                        title={[matrixDetail?.edited_at ? `修改于 ${matrixDetail.edited_at}` : '', matrixDetail?.edit_note || '']
                          .filter(Boolean)
                          .join(' · ')}
                      >
                        已人工修改
                      </span>
                    )}
                    {matrixDetail?.manual_invalid === true && (
                      <span
                        className="matrix-invalid-tag"
                        title={matrixDetail?.manual_invalid_reason
                          || '该断面已被标记为无效：不参与着色、框选统计、报告配图与导出（结果数据仍保留）'}
                      >
                        已标记无效
                      </span>
                    )}
                  </div>
                  <div className="matrix-modal-subtitle">
                    {matrixSectionName ? `${matrixSectionName} | ` : ''}断面ID: {matrixSectionId || '-'}
                  </div>
                </div>
                <div className="matrix-modal-header-actions">
                  {/*
                    「设为无效」与「编辑结果」是两件事，刻意分成两个按钮：
                      · 编辑结果 = 改数值（会重算档位、写 edit_state，进编辑态）；
                      · 设为无效 = 改可见性（只动 cross_sections.manual_invalid，结果一行不碰）。
                    合并成一个"编辑"会让人以为标记无效等于删数据。
                    没有结果的断面（not_computed）同样可以标记 —— 不需要落在任务之外的校验。
                  */}
                  <button
                    className={`matrix-modal-edit ghost${matrixDetail?.manual_invalid === true ? ' active' : ''}`}
                    onClick={handleToggleManualInvalid}
                    disabled={!matrixDetail || matrixLoading || invalidSaving}
                    title={matrixDetail?.manual_invalid === true
                      ? '恢复为有效断面：颜色与统计立即回来（结果一直保留着，不需要重算）'
                      : '标记为无效断面：图上变成灰色虚线，不参与着色、框选统计、报告配图与导出'}
                  >
                    {invalidSaving
                      ? '提交中…'
                      : matrixDetail?.manual_invalid === true ? '恢复为有效断面' : '设为无效断面'}
                  </button>
                  <button
                    className="matrix-modal-edit"
                    onClick={() => setResultEditing(v => !v)}
                    // not_computed 的断面**可以**编辑 —— 那张空表就是它的录入入口。
                    // 只有断面没挂在任务下（后端 manual_editable=false，结果表 task_id NOT NULL）
                    // 才禁用，否则点了保存必然失败。
                    disabled={!matrixDetail || matrixLoading || matrixDetail?.manual_editable === false}
                    title={matrixDetail?.manual_editable === false
                      ? '该断面未挂到任何任务，无法保存结果'
                      : resultEditing
                        ? '退出编辑（未保存的改动会被丢弃）'
                        : '直接在结果上改数值，不重跑模型'}
                  >
                    {resultEditing ? '退出编辑' : (matrixDetail?.not_computed ? '录入风险数值' : '编辑结果')}
                  </button>
                  <button className="matrix-modal-download" onClick={downloadMatrixCSV} title="下载CSV数据">
                    下载CSV
                  </button>
                  <button className="matrix-modal-close" onClick={closeMatrixDetail}>关闭</button>
                </div>
              </div>

              <div className="matrix-body">
                {matrixLoading ? (
                  <div className="matrix-loading">加载中...</div>
                ) : matrixError ? (
                  <div className="matrix-error">{matrixError}</div>
                ) : matrixDetail ? (
                  resultEditing ? (
                    <SectionResultEditor
                      sectionId={String(matrixSectionId || matrixDetail.section_id || '')}
                      taskId={selectedTask || selectedTaskRef.current}
                      detail={matrixDetail}
                      onSaved={handleOverrideSaved}
                      onReverted={handleOverrideReverted}
                      onCancel={() => setResultEditing(false)}
                    />
                  ) : (<>
                    <div className="matrix-kv">
                      <div className="matrix-kv-row"><span>section_id</span><span>{formatCellValue(matrixDetail.section_id ?? matrixDetail.sectionId)}</span></div>
                      <div className="matrix-kv-row"><span>section_name</span><span>{formatCellValue(matrixDetail.section_name ?? matrixDetail.sectionName ?? matrixDetail.section_name)}</span></div>
                      <div className="matrix-kv-row"><span>bank_id</span><span>{formatCellValue(matrixDetail.bank_id ?? matrixDetail.bankId ?? matrixDetail.bank_id)}</span></div>
                      <div className="matrix-kv-row">
                        <span>风险等级</span>
                        <span>
                          {(() => {
                            // 库里存的是 1..4；这里翻译成与地图/图例一致的文案，避免"3"这种裸数字被误读。
                            // ⚠ 文案（2026-10-21）已改为「高风险/较高风险/中风险/低风险」，不带序号，
                            // 而 risk_level 是 1..4 升序 —— 所以只能标 "risk_level N"，不能再写「第 N 档」，
                            // 否则会自相矛盾。名称唯一真源仍是 `RISK_LABELS`，别在这里写死中文。
                            const level = toDisplayLevel(matrixDetail.risk_level ?? matrixDetail.riskLevel)
                              ?? displayLevelOfResult(matrixDetail);
                            return level === null ? '-' : `${RISK_LABELS[level]}（risk_level ${level + 1}）`;
                          })()}
                        </span>
                      </div>
                      
                    </div>

                    <div className="matrix-section-title">指标矩阵</div>
                    <div className="matrix-section-hint">
                      风险等级 = 该指标按自身阈值单独分档（第 1~4 档，1 档最安全、4 档最危险）：
                      4 档 → {RISK_LABELS[3]}（红）、3 档 → {RISK_LABELS[2]}（橙）、2 档 → {RISK_LABELS[1]}（蓝）、
                      1 档 → {RISK_LABELS[0]}（绿）。它只描述这单个指标，不是断面综合等级。
                      <b>抗冲流速(Ky) 是唯一的反向指标</b>（阈值降序 1.7 → 1.35 → 1.0），其余指标都是值越大越危险。
                    </div>
                    <div className="matrix-assessment-list">
                      {(() => {
                        const indicators = matrixDetail?.indicators?.thresholds ?? matrixDetail?.thresholds ?? {};
                        const renderedGroups = MATRIX_GROUPS.map((group, idx) => renderAssessmentGroup(group, indicators, idx)).filter(Boolean);
                        if (renderedGroups.length === 0) {
                          return <div className="matrix-empty">无矩阵数据</div>;
                        }
                        return renderedGroups;
                      })()}
                    </div>
                  </>)
                ) : (
                  <div className="matrix-empty">无矩阵数据</div>
                )}

                <div className="profile-section-title">断面剖面折线</div>
                {profileLoading ? (
                  <div className="profile-loading">加载中...</div>
                ) : profileError ? (
                  <div className="profile-error">{profileError}</div>
                ) : (
                  renderProfileChart(getProfileSeries(profileDetail))
                )}
              </div>
            </div>
          </div>
        )}

        {toast && (
          <div className={`result-toast${toast.tone === 'warn' ? ' warn' : ''}`}>{toast.text}</div>
        )}

        <button
          onClick={() => setSatellite(!satellite)}
          title={satellite ? '平面地图' : '卫星影像'}
          style={{ ...MAP_OVERLAY_BTN_STYLE, top: 12 }}
        >
          <Globe size={14} /> {satellite ? '平面' : '卫星'}
        </button>
        <button
          onClick={() => { setChatCollapsed(!chatCollapsed); setTimeout(() => setResizeTrigger(t => t + 1), 350); }}
          title={chatCollapsed ? '展开聊天' : '收起聊天'}
          style={{ ...MAP_OVERLAY_BTN_STYLE, top: 50 }}
        >
          <MessageCircle size={14} />
          {chatCollapsed ? 'AI' : '收起'}
        </button>
        {/* —— 流场开关与控件：接在卫星 / AI 这组浮层按钮之后 */}
        <button
          onClick={() => setFlowEnabled(v => !v)}
          title={flowEnabled ? '关闭流场' : '显示流场（水动力粒子）'}
          style={{
            ...MAP_OVERLAY_BTN_STYLE,
            top: 88,
            ...(flowEnabled
              ? { background: 'rgba(14,165,233,0.92)', color: '#ffffff', borderColor: 'rgba(14,165,233,0.65)' }
              : null),
          }}
        >
          <Waves size={14} /> 流场
        </button>

        {flowEnabled && (
          <div
            style={{
              position: 'absolute', right: 12, top: 126, zIndex: 10, width: 248,
              background: 'rgba(255,255,255,0.84)',
              backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
              border: '1px solid rgba(0,0,0,0.08)', borderRadius: 14,
              padding: '10px 12px', boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
              display: 'flex', flexDirection: 'column', gap: 8,
              fontSize: '0.78rem', color: '#334155',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600, color: '#0f172a' }}>流场 · 水动力</span>
              <span style={{ color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>
                {flowStatus?.phase === 'playing' ? `${flowStatus.fps} FPS` : ''}
              </span>
            </div>

            {flowCasesLoading ? (
              <div style={{ color: '#64748b' }}>正在读取场景与工况清单…</div>
            ) : flowScenes.length === 0 && flowCases.length === 0 ? (
              <div style={{ color: '#b45309' }}>没有可用的流场工况或场景</div>
            ) : (
              <select
                value={flowCaseId}
                onChange={(e) => {
                  // 手动选过之后，上面的"跟着任务 DEM 自动切"就永久让位，不再顶掉用户的选择
                  flowUserPickedRef.current = true;
                  setFlowCaseId(e.target.value);
                }}
                title={
                  activeFlowScene
                    ? `场景 ${activeFlowScene.sceneId}：${describeScene(activeFlowScene)}`
                    : flowCases.find(c => c.caseId === flowCaseId)
                      ? describeCase(flowCases.find(c => c.caseId === flowCaseId)!)
                      : ''
                }
                style={{
                  width: '100%', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)',
                  padding: '4px 6px', fontSize: '0.78rem', color: '#334155',
                  background: 'rgba(255,255,255,0.9)',
                }}
              >
                {/* 场景在前：它覆盖整片 DEM，是"展示所属 DEM"的正确选项 */}
                {flowScenes.length > 0 && (
                  <optgroup label="覆盖任务 DEM（按场景生成）">
                    {flowScenes.map(item => (
                      <option key={item.sceneId} value={item.sceneId}>{describeScene(item)}</option>
                    ))}
                  </optgroup>
                )}
                {flowCaseGroups.map(group => (
                  <optgroup key={group.waterQs} label={`内置工况 · 流量 ${group.waterQs} m³/s（仅局部）`}>
                    {group.cases.map(item => (
                      <option key={item.caseId} value={item.caseId}>{tidalLevelLabel(item.tidalLevel)}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}

            {activeFlowScene && (
              <div style={{ color: '#0f766e', lineHeight: 1.5 }}>
                场景覆盖整片 DEM：与 DEM 包围盒重叠
                {activeFlowScene.coverage != null ? ` ${(activeFlowScene.coverage * 100).toFixed(1)}%` : '—'}
                {activeFlowScene.cellSizeM > 0 ? `，格距 ${activeFlowScene.cellSizeM.toFixed(0)} m` : ''}
              </div>
            )}

            {/* —— 配色：每个按钮直接用该色带自己的 stop 画渐变，预览与地图上出现的颜色同源 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#64748b', flex: '0 0 auto' }}>配色</span>
              <div style={{ display: 'flex', gap: 4, flex: 1, minWidth: 0 }}>
                {FLOW_COLOR_SCHEMES.map(scheme => {
                  const active = scheme.id === flowColorScheme;
                  return (
                    <button
                      key={scheme.id}
                      onClick={() => setFlowColorScheme(scheme.id)}
                      title={`${scheme.label} —— ${scheme.hint}`}
                      aria-label={`流场配色：${scheme.label}`}
                      aria-pressed={active}
                      style={{
                        // ⚠ padding 必须显式清零：index.css 里 Vite 模板遗留的全局
                        // `button { padding: .6em 1.2em }` 会把固定尺寸按钮的内容区整个吃掉。
                        padding: 0,
                        flex: '1 1 0', minWidth: 0, height: 22, borderRadius: 6, cursor: 'pointer',
                        background: flowColorSchemeGradient(scheme),
                        border: active ? '2px solid #0f172a' : '1px solid rgba(0,0,0,0.12)',
                        boxShadow: active ? '0 0 0 2px rgba(14,165,233,0.35)' : 'none',
                        transition: 'box-shadow 0.15s ease, border-color 0.15s ease',
                      }}
                    />
                  );
                })}
              </div>
            </div>

            {(flowStatus?.frameCount ?? 0) > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={toggleFlowPlaying}
                  disabled={!flowStatus || flowStatus.phase === 'loading' || flowStatus.phase === 'error'}
                  title={flowStatus?.phase === 'playing' ? '暂停' : '播放'}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    // ⚠ padding 必须显式清零：index.css 里 Vite 模板遗留的全局
                    // `button { padding: .6em 1.2em }` 会把 26px 宽的按钮内容宽度整个吃掉，
                    // 内联 SVG 作为 flex 子项被压成 0 宽 ⇒ 图标静默消失（活动栏图标、断面「×」踩过同一个坑）。
                    padding: 0,
                    width: 26, height: 26, borderRadius: 8, cursor: 'pointer',
                    border: '1px solid rgba(0,0,0,0.10)', background: 'rgba(255,255,255,0.9)',
                    color: '#334155', flex: '0 0 auto',
                  }}
                >
                  {flowStatus?.phase === 'playing'
                    ? <Pause size={12} style={{ flex: '0 0 auto' }} />
                    : <Play size={12} style={{ flex: '0 0 auto' }} />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, flowStatus!.frameCount - 1)}
                  value={flowStatus?.frame ?? 0}
                  onChange={(e) => flowLayerRef.current?.seekFrame(Number(e.target.value))}
                  style={{ flex: 1, minWidth: 0 }}
                />
                <span style={{ color: '#64748b', fontVariantNumeric: 'tabular-nums', flex: '0 0 auto' }}>
                  {(flowStatus?.frame ?? 0) + 1}/{flowStatus!.frameCount}
                </span>
              </div>
            )}

            {flowError && <div style={{ color: '#b91c1c', lineHeight: 1.5 }}>{flowError}</div>}
            {!flowError && flowStatus?.message && (
              <div style={{ color: '#b45309', lineHeight: 1.5 }}>{flowStatus.message}</div>
            )}
            {!flowError && flowStatus?.phase === 'loading' && (
              <div style={{ color: '#64748b' }}>正在加载流场纹理…</div>
            )}
            {!flowError && flowStatus && flowStatus.phase !== 'loading'
              && flowStatus.loadedFrames < flowStatus.frameCount && (
                <div style={{ color: '#64748b' }}>
                  纹理缓存 {flowStatus.loadedFrames}/{flowStatus.frameCount}（后台补齐中）
                </div>
              )}
            <div style={{ color: '#94a3b8', lineHeight: 1.5 }}>
              流速已作视觉放大（×2600）—— 真实流速走完整个流场范围要几十小时，不放大看不出移动；
              粒子按流速取色带（右端为最大流速）。场景覆盖的 DEM 比内置工况大得多，同样的放大倍数下
              屏幕上会显得更慢，这是尺度差异，不是流速变小。
            </div>
          </div>
        )}
        {reportTabs.length > 0 && (
          <>
            <VerticalResizeHandle onResize={(delta) => setWorkspaceHeight(h => Math.max(80, h + delta))} onDragEnd={() => setResizeTrigger(t => t + 1)} />
            <WorkspacePanel
              tabs={reportTabs}
              activeTabIndex={activeReportTab}
              onSelectTab={setActiveReportTab}
              onCloseTab={(i) => {
                setReportTabs(prev => prev.filter((_, idx) => idx !== i));
                if (i <= activeReportTab && activeReportTab > 0) {
                  setActiveReportTab(prev => Math.max(0, prev - 1));
                }
              }}
              onUpdateTab={async (i, content) => {
                const tab = reportTabs[i];
                let filename = tab.filename;
                if (!filename) {
                  const ts = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
                  filename = `report_${tab.taskId}_${ts}.md`;
                }
                const res = await fetch(`/v0/bank/ai/reports/${encodeURIComponent(filename)}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ content }),
                });
                const data = await res.json();
                if (!data.success) throw new Error(data.error || '保存失败');
                setReportTabs(prev => {
                  const next = [...prev];
                  next[i] = { ...next[i], content, filename };
                  return next;
                });
                fetchReportList();
              }}
              height={workspaceHeight}
            />
          </>
        )}
      </div>
      {!chatCollapsed && <ResizeHandle onResize={(delta) => setRightPanelWidth(w => Math.max(200, Math.min(600, w - delta)))} onDragEnd={() => setResizeTrigger(t => t + 1)} />}
      <ChatPanel collapsed={chatCollapsed} width={rightPanelWidth} selectedSkills={selectedSkills} setSelectedSkills={setSelectedSkills} chatTasks={chatTasks} setChatTasks={setChatTasks} chatReports={chatReports} setChatReports={setChatReports} onReportsUpdated={() => { fetchReportList(); }} />
      {taskMenu && (
        <div
          className="task-menu"
          style={{ top: taskMenu.y, left: taskMenu.x }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          <div className="task-menu-title" title={taskMenu.taskName}>{taskMenu.taskName}</div>
          {/* 框选分析：前置条件 = 该任务已有结果。counting 缺失（接口没回 / 老后端）时按"未知"放行，
              点下去由 startAreaAnalysis 再确认一次；明确为 0 才置灰，并把原因写在按钮上。 */}
          <button
            className="task-menu-item"
            disabled={resultCountOfTask(taskMenu.taskId) === 0}
            title={
              resultCountOfTask(taskMenu.taskId) === 0
                ? '该任务还没有计算结果，框选分析不适用（先在编辑器里跑完任务再看）'
                : '在地图上框选矩形或多边形，统计该范围内各风险等级的断面数与长度'
            }
            onClick={() => { const t = taskMenu; setTaskMenu(null); void startAreaAnalysis(t.taskId, t.taskName); }}
          >
            <ScanSearch size={13} />
            {resultCountOfTask(taskMenu.taskId) === 0 ? '分析（暂无结果）' : '分析'}
          </button>
          <button
            className="task-menu-item"
            title="在地图上拖出矩形：断面起点（岸边端点）落在框内的断面一起设为无效（灰色虚线），可一键撤销"
            onClick={() => { const t = taskMenu; setTaskMenu(null); void startSectionBoxInvalid(t.taskId, t.taskName); }}
          >
            <SquareDashed size={13} />
            框选设为无效断面
          </button>
          <button
            className="task-menu-item"
            disabled={generatingTaskId === taskMenu.taskId}
            onClick={() => { const t = taskMenu; setTaskMenu(null); handleGenerateReport(t.taskId, t.taskName); }}
          >
            <FileText size={13} />
            {generatingTaskId === taskMenu.taskId ? '报告生成中…' : 'AI 出报告'}
          </button>
          <button
            className="task-menu-item"
            onClick={() => { const t = taskMenu; setTaskMenu(null); openVizDialog(t.taskId, t.taskName); }}
          >
            <BarChart3 size={13} />
            AI 出图
          </button>
          <button
            className="task-menu-item"
            title="整表导出 2 个 CSV：① 断面详情（逐断面一行，含指标明细）；② 风险段汇总（连续同类风险段的位置、长度 km、占比）。均不按经纬度分区拆分；分区断面详情请用「AI 出报告」生成报告后在报告面板右上角导出。"
            onClick={() => { const t = taskMenu; setTaskMenu(null); handleExportSectionsDetail(t.taskId, t.taskName); }}
          >
            <Download size={13} />
            导出断面详情（整表 CSV）
          </button>
        </div>
      )}
      {vizTarget && (
        <ConfigProvider theme={{ token: { borderRadiusLG: 24 } }}>
        <Modal
          title="AI 出图"
          open={true}
          onOk={runViz}
          confirmLoading={vizGenerating}
          onCancel={() => { if (!vizGenerating) setVizTarget(null); }}
          okText={vizSplit
            ? `分幅出图（${vizMode === 'per_bank'
              ? (vizBanks.length > 0 ? `${vizSelected.length} 岸段 × ${vizSplitRows * vizSplitCols} 幅` : `每岸段 ${vizSplitRows * vizSplitCols} 幅`)
              : `${vizSplitRows * vizSplitCols} 幅`}）`
            : vizMode === 'per_bank'
              ? (vizBanks.length > 0 ? `按岸段出图（${vizSelected.length} 张）` : '按岸段出图（全部岸段）')
              : '合并出图（1 张）'}
          cancelText="取消"
          centered
          okButtonProps={{
            disabled: vizGenerating || (vizMode === 'per_bank' && vizBanks.length > 0 && vizSelected.length === 0),
            style: {
              borderRadius: 14,
              background: 'linear-gradient(135deg, rgba(139,92,246,0.45) 0%, rgba(109,40,217,0.32) 100%)',
              border: '1px solid rgba(139,92,246,0.3)',
              color: '#fff',
              fontWeight: 500,
              backdropFilter: 'blur(8px) saturate(1.3)',
              WebkitBackdropFilter: 'blur(8px) saturate(1.3)',
            },
          }}
          cancelButtonProps={{
            style: {
              borderRadius: 14,
              background: 'rgba(255,255,255,0.35)',
              border: '1px solid rgba(150,150,150,0.35)',
              color: '#555',
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
            },
          }}
          styles={{
            mask: {
              background: 'rgba(0,0,0,0.3)',
              backdropFilter: 'blur(4px)',
              WebkitBackdropFilter: 'blur(4px)',
            },
            container: {
              background: 'radial-gradient(ellipse at 20% 0%, rgba(255,255,255,0.4) 0%, transparent 50%), radial-gradient(ellipse at 80% 100%, rgba(254,243,199,0.15) 0%, transparent 50%), rgba(255,255,255,0.82)',
              backdropFilter: 'blur(16px) saturate(1.5)',
              WebkitBackdropFilter: 'blur(16px) saturate(1.5)',
              borderRadius: 14,
              border: '1px solid rgba(255,255,255,0.35)',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.15), 0 8px 32px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.4)',
            },
            header: { background: 'transparent', borderBottom: 'none' },
            body: { background: 'transparent' },
            footer: { background: 'transparent', borderTop: 'none' },
          }}
        >
          <div style={{ fontSize: '0.85rem', color: '#444' }}>
            <div style={{ marginBottom: 10 }}>
              任务：<b>{vizTarget.taskName}</b>（{vizTarget.taskId}）
            </div>
            <div style={{ display: 'flex', gap: 20, marginBottom: 12 }}>
              <label style={{ cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="viz-mode"
                  checked={vizMode === 'merged'}
                  onChange={() => setVizMode('merged')}
                />{' '}
                合并出图 <span style={{ color: '#94a3b8' }}>（全部岸段合到一张）</span>
              </label>
              <label style={{ cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="viz-mode"
                  checked={vizMode === 'per_bank'}
                  onChange={() => setVizMode('per_bank')}
                />{' '}
                按岸段分开出图 <span style={{ color: '#94a3b8' }}>（每岸段一张）</span>
              </label>
            </div>
            {vizMode === 'per_bank' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span style={{ color: '#64748b' }}>共 {vizBanks.length} 个岸段</span>
                  <button
                    onClick={() => setVizSelected(vizBanks)}
                    style={{ border: 'none', background: 'transparent', color: '#2563eb', cursor: 'pointer', fontSize: '0.78rem', padding: 0 }}
                  >全选</button>
                  <button
                    onClick={() => setVizSelected([])}
                    style={{ border: 'none', background: 'transparent', color: '#2563eb', cursor: 'pointer', fontSize: '0.78rem', padding: 0 }}
                  >清空</button>
                </div>
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, maxHeight: 220, overflowY: 'auto' }}>
                  {vizBanks.length === 0 && (
                    <div style={{ color: '#94a3b8' }}>未取到岸段清单，将按该任务全部有结果的岸段出图</div>
                  )}
                  {vizBanks.map((bid) => (
                    <label key={bid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 2px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={vizSelected.includes(bid)}
                        onChange={(e) => setVizSelected(prev =>
                          e.target.checked ? [...prev, bid] : prev.filter(x => x !== bid))}
                      />
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{bid}</span>
                      <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>{vizBankCounts[bid] || 0} 断面</span>
                    </label>
                  ))}
                </div>
              </>
            )}
            {/* 分幅出图：把每张图按经纬度再切成 行×列 幅独立子图（两种模式下均可用） */}
            <SplitSettingsPanel
              enabled={vizSplit}
              onToggle={(next) => {
                setVizSplit(next);
                if (next) applyVizSplitGrid(vizSplitRows, vizSplitCols);
              }}
              rows={vizSplitRows}
              cols={vizSplitCols}
              onGridChange={applyVizSplitGrid}
              edges={vizTileEdges}
              onEdgesChange={setVizTileEdges}
              title="按经纬度分幅出图"
              hint="（每张图再切成 行×列 幅，各自独立文件）"
            />
          </div>
        </Modal>
        </ConfigProvider>
      )}
      {regenerateTarget && (
        <ConfigProvider theme={{ token: { borderRadiusLG: 24 } }}>
        <Modal
          title={reportDialogMode === 'regenerate' ? '确认生成报告' : '生成风险评估报告'}
          open={true}
          onOk={() => {
            const { taskId, taskName } = regenerateTarget;
            const tiles = rptSplit ? buildSplitTilesJson(rptSplitCols, rptTileEdges) : undefined;
            setRegenerateTarget(null);
            doGenerateReport(taskId, taskName,
              rptSplit ? { rows: rptSplitRows, cols: rptSplitCols, tiles } : undefined);
          }}
          onCancel={() => setRegenerateTarget(null)}
          okText={reportDialogMode === 'regenerate' ? '生成新报告' : '生成报告'}
          cancelText="取消"
          centered
          okButtonProps={{
            style: {
              borderRadius: 14,
              background: 'linear-gradient(135deg, rgba(59,130,246,0.45) 0%, rgba(37,99,235,0.32) 100%)',
              border: '1px solid rgba(59,130,246,0.3)',
              color: '#fff',
              fontWeight: 500,
              backdropFilter: 'blur(8px) saturate(1.3)',
              WebkitBackdropFilter: 'blur(8px) saturate(1.3)',
            },
          }}
          cancelButtonProps={{
            style: {
              borderRadius: 14,
              background: 'rgba(255,255,255,0.35)',
              border: '1px solid rgba(150,150,150,0.35)',
              color: '#555',
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
            },
          }}
          styles={{
            mask: {
              background: 'rgba(0,0,0,0.3)',
              backdropFilter: 'blur(4px)',
              WebkitBackdropFilter: 'blur(4px)',
            },
            // ⚠ 键名必须是 container 而不是 v5 时代的 content。
            // antd v6 把面板语义键改名了：@rc-component/dialog 的 Panel.js 第 104 行是
            //   className: clsx(prefixCls + '-container', modalClassNames?.container)
            // 即它只认 container 这个新键，旧的 content 会被静默忽略 ——
            // 后果是下面这块毛玻璃背景一直没生效，且运行时没有任何提示。
            container: {
              background: 'radial-gradient(ellipse at 20% 0%, rgba(255,255,255,0.4) 0%, transparent 50%), radial-gradient(ellipse at 80% 100%, rgba(254,243,199,0.15) 0%, transparent 50%), rgba(255,255,255,0.82)',
              backdropFilter: 'blur(16px) saturate(1.5)',
              WebkitBackdropFilter: 'blur(16px) saturate(1.5)',
              borderRadius: 14,
              border: '1px solid rgba(255,255,255,0.35)',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.15), 0 8px 32px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.4)',
            },
            header: {
              background: 'transparent',
              borderBottom: 'none',
            },
            body: {
              background: 'transparent',
            },
            footer: {
              background: 'transparent',
              borderTop: 'none',
            },
          }}
        >
          <p style={{ fontSize: '0.9rem', color: '#444' }}>
            {reportDialogMode === 'regenerate'
              ? '该任务已有报告记录，是否基于最新数据再生成一份新的报告？'
              : '将基于该任务的最新断面风险数据生成一份完整报告。'}
          </p>
          {regenerateTarget && (
            <div style={{ fontSize: '0.85rem', color: '#444' }}>
              <div>
                任务：<b>{regenerateTarget.taskName}</b>（{regenerateTarget.taskId}）
              </div>
              {/* 与「AI 出图」同一份面板：两处配出来的分区边界必然一致，
                  报告的分区章节因此天然对齐出图的子图 */}
              <SplitSettingsPanel
                enabled={rptSplit}
                onToggle={(next) => {
                  setRptSplit(next);
                  if (next) applyRptSplitGrid(rptSplitRows, rptSplitCols);
                }}
                rows={rptSplitRows}
                cols={rptSplitCols}
                onGridChange={applyRptSplitGrid}
                edges={rptTileEdges}
                onEdgesChange={setRptTileEdges}
                title="按经纬度分幅（报告与出图使用同一套分区）"
                hint="（报告按分区组织章节，每个分区对应一幅分布图子图）"
                summary={rptSplit ? `报告将分 ${rptSplitRows * rptSplitCols} 个区域` : undefined}
              />
            </div>
          )}
        </Modal>
        </ConfigProvider>
      )}
    </div>
  );
}

export default ResultPage;
