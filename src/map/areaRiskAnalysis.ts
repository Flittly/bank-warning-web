/**
 * 地图「框选分析」的统计口径 —— 全是纯函数，不碰 DOM / Mapbox / React。
 *
 * <h3>需求</h3>
 * 在任务列表右键「分析」后，用户在地图上画一个矩形或多边形选区，实时得到
 * 「选区内各风险等级的断面数、长度、占比」。
 *
 * <h3>为什么放在这里而不是写进页面</h3>
 * 统计口径是业务规则：分母是谁、低风险算不算、断面按什么判命中 —— 这些一旦散在
 * 事件回调里就既测不到、也没法在别处复用。`EditorPage` 只负责「拿选区几何 + 数据」，
 * 判定全在这里，`areaRiskAnalysis.test.ts` 逐条守着。
 *
 * <h3>两条独立的统计口径（刻意不混为一谈）</h3>
 * <ol>
 *   <li><b>长度</b>：取「岸段色带」在选区内的长度。也就是图上那条颜色实际覆盖了多少米 ——
 *       按断面几何中点投影到岸线、以相邻断面中点为界切段（Voronoi 式，与结果页色带
 *       同一套 `buildRiskBandSpans`），每段裁剪到选区后累加。所以「图上看着多长，统计就是多长」。</li>
 *   <li><b>断面数</b>：断面几何与选区<b>相交</b>即计入（不是「中点在内」）——
 *       贴边穿过选区的断面确实在范围内，按中点判会莫名其妙漏掉一条。</li>
 * </ol>
 * 两者分母各自独立：长度占比 = 该等级长度 ÷ 选区内岸段总长；断面占比 = 该等级断面数 ÷ 选区内断面数。
 *
 * <h3>单位</h3>
 * <ul>
 *   <li>长度：<b>米</b>（WGS84 球面大圆长度，`turf.length` + `units:'meters'`）；</li>
 *   <li>面积：<b>平方米</b>（`turf.area`），展示层折算成 km²；</li>
 *   <li>占比：0..1 的比例，展示层乘 100 加 %。</li>
 * </ul>
 *
 * <h3>低风险 / 未计算</h3>
 * 低风险（2026-10-26 起）在图上正常着绿；「未计算」在色带上不留颜色，改由灰色虚线层显示
 * （见 `sectionRenderVisibility`）。两者都**长度计入分母** ——
 * 否则「高风险占 60%」会因为分母只剩着色段而虚高成 100%。所以面板里它们各自单列一行。
 */

import * as turf from '@turf/turf';

import { RISK_COLORS, RISK_LABELS } from '../utils/riskScoring';
import { sectionProgressAlongBank } from './sectionBandProgress';
import {
  buildRiskBandSpans,
  isRiskLevelRenderable,
  NO_DATA_RISK_COLOR,
  TRANSPARENT_RISK_COLOR,
  type RiskBandSpan,
  type RiskGradientPoint,
} from './sectionRenderVisibility';

/** 无风险值（未计算 / 计算失败）那一行的固定键与文案。 */
export const UNKNOWN_RISK_KEY = 'none';
/** 无风险值的兜底色。与地图灰色虚线层、出图 `DEFAULT_RISK_COLOR` 同一个灰，
 *  色值唯一真源在 `sectionRenderVisibility.NO_DATA_RISK_COLOR`。 */
export const UNKNOWN_RISK_COLOR = NO_DATA_RISK_COLOR;
/** 无风险值那一行/图例的文案。 */
export const UNKNOWN_RISK_LABEL = '未计算';

export type AreaSelectionGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon;

export interface AreaAnalysisBank {
  bank_id: string;
  geometry: GeoJSON.LineString | null | undefined;
}

export interface AreaAnalysisSection {
  section_id: string;
  /** 归属岸段；为空表示「没绑上岸段」——仍计入断面数，但进不了岸段色带（没有位置） */
  bank_id?: string | null;
  geometry: GeoJSON.LineString | null | undefined;
  /**
   * **显示等级** 0..3（0 低风险、3 高风险）。
   *
   * ⚠ 不是库里的 `risk_level`（1..4）。调用方负责 `toDisplayLevel` 转换，
   * 与页面上 `RISK_LABELS` / `RISK_COLORS` 的键完全一致。
   * `null` / `undefined` = 没有风险值。
   */
  level: number | null | undefined;
}

export interface AreaRiskRow {
  /** `'3' | '2' | '1' | '0' | 'none'` */
  key: string;
  /** 显示等级；`null` = 未计算 */
  level: number | null;
  label: string;
  color: string;
  /**
   * 图上是否有**实色**（四个等级为 true）。
   * 「未计算」为 false，但它不等于「看不见」—— 色带上留空、另有灰色虚线层显示，
   * 所以面板标签写的是「图上为灰色虚线」，不是「不渲染」。
   */
  rendered: boolean;
  sectionCount: number;
  /** 断面占比 0..1 */
  sectionRatio: number;
  /** 长度（米） */
  lengthM: number;
  /** 长度占比 0..1 */
  lengthRatio: number;
}

export interface AreaRiskStats {
  /** 选区面积（平方米）。多边形自相交等导致算不出时为 0。 */
  areaM2: number;
  /** 选区内有长度的岸段条数（不是「选区碰到的岸段数」） */
  bankCount: number;
  /** 与选区相交的断面总数 */
  sectionCount: number;
  /** 选区内岸段总长（米）。长度占比的分母。 */
  totalLengthM: number;
  /** 固定 5 行：3 / 2 / 1 / 0 / 未计算（顺序即展示顺序） */
  rows: AreaRiskRow[];
}

export interface ComputeAreaRiskParams {
  selection: AreaSelectionGeometry | null | undefined;
  banks: AreaAnalysisBank[];
  sections: AreaAnalysisSection[];
}

const LEVEL_ORDER: Array<{ key: string; level: number | null }> = [
  { key: '3', level: 3 },
  { key: '2', level: 2 },
  { key: '1', level: 1 },
  { key: '0', level: 0 },
  { key: UNKNOWN_RISK_KEY, level: null },
];

/** 把选区的裸几何包成 turf feature；非法几何返回 null。 */
export function toSelectionFeature(
  selection: AreaSelectionGeometry | null | undefined,
): GeoJSON.Feature<AreaSelectionGeometry> | null {
  if (!selection) return null;
  const type = selection.type;
  if (type !== 'Polygon' && type !== 'MultiPolygon') return null;
  const coords = (selection as GeoJSON.Polygon).coordinates;
  if (!Array.isArray(coords) || coords.length === 0) return null;
  try {
    const feature = turf.feature(selection as any) as GeoJSON.Feature<AreaSelectionGeometry>;
    // turf.area 对退化环会返回 0，这里顺手挡掉「点出来的两个点」这种无效选区
    if (!Number.isFinite(turf.area(feature)) || turf.area(feature) <= 0) return null;
    return feature;
  } catch {
    return null;
  }
}

/** 空统计（没有选区 / 选区非法 / 没有任何岸段时返回它，UI 直接渲染成 0）。 */
export function emptyAreaRiskStats(): AreaRiskStats {
  return {
    areaM2: 0,
    bankCount: 0,
    sectionCount: 0,
    totalLengthM: 0,
    rows: LEVEL_ORDER.map(({ key, level }) => ({
      key,
      level,
      label: level === null ? UNKNOWN_RISK_LABEL : (RISK_LABELS[level] ?? `等级 ${level}`),
      color: level === null
        ? UNKNOWN_RISK_COLOR
        : (RISK_COLORS[String(level)] ?? UNKNOWN_RISK_COLOR),
      rendered: level !== null && isRiskLevelRenderable(level),
      sectionCount: 0,
      sectionRatio: 0,
      lengthM: 0,
      lengthRatio: 0,
    })),
  };
}

/** 显示等级 → 行键。非 0..3 的有限整数一律算「未计算」。 */
export function rowKeyOfLevel(level: number | null | undefined): string {
  if (level === null || level === undefined) return UNKNOWN_RISK_KEY;
  const n = Number(level);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 3) return UNKNOWN_RISK_KEY;
  return String(n);
}

function bboxOverlaps(a: number[], b: number[]): boolean {
  // [minX, minY, maxX, maxY]
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

/**
 * 一条线落在多边形内的长度（米）。
 *
 * <p>做法：`lineSplit` 用多边形边界把线切开，逐段取中点判内外。三处坑：
 * <ol>
 *   <li><b>线被多边形完全包含时 `lineSplit` 返回 0 段</b>（没有交点就切不了）——
 *       必须单独处理成「整条在内」，否则「框住整条岸段」会算出长度 0；
 *       但贴边相切也会返回 0 段，所以再用中点确认一次，不能无条件给全长。</li>
 *   <li>凹多边形会被切成多段（内-外-内），逐段判定天然正确，不需要额外处理。</li>
 *   <li>`lineSplit` 抛错（自相交多边形等）时直接放弃这条线：宁可少算也不能把
 *       一个不确定的数混进汇总 —— 调用方拿到的永远是可解释的长度。</li>
 * </ol>
 */
export function lengthInsidePolygon(
  line: GeoJSON.Feature<GeoJSON.LineString>,
  polygon: GeoJSON.Feature<AreaSelectionGeometry>,
): number {
  const total = turf.length(line, { units: 'meters' });
  if (!Number.isFinite(total) || total <= 0) return 0;

  try {
    if (!bboxOverlaps(turf.bbox(line), turf.bbox(polygon))) return 0;
    if (!turf.booleanIntersects(line, polygon)) return 0;

    const split = turf.lineSplit(line, polygon as any);
    const parts = (split?.features ?? []) as Array<GeoJSON.Feature<GeoJSON.LineString>>;

    if (parts.length === 0) {
      // 无交点：整条要么完全在内，要么只是贴着边界走
      const mid = turf.along(line, total / 2, { units: 'meters' });
      return turf.booleanPointInPolygon(mid, polygon as any) ? total : 0;
    }

    let inside = 0;
    for (const part of parts) {
      const len = turf.length(part, { units: 'meters' });
      if (!Number.isFinite(len) || len <= 0) continue;
      const mid = turf.along(part, len / 2, { units: 'meters' });
      if (turf.booleanPointInPolygon(mid, polygon as any)) inside += len;
    }
    return inside;
  } catch {
    return 0;
  }
}

/** 取岸段折线上 [startM, endM] 这一段；整段时直接用原线（省一次重采样）。 */
function sliceByMeters(
  bankLine: GeoJSON.Feature<GeoJSON.LineString>,
  totalM: number,
  startM: number,
  endM: number,
): GeoJSON.Feature<GeoJSON.LineString> | null {
  const from = Math.max(0, Math.min(totalM, startM));
  const to = Math.max(0, Math.min(totalM, endM));
  if (!(to > from)) return null;
  if (from <= 0 && to >= totalM) return bankLine;
  try {
    return turf.lineSliceAlong(bankLine, from, to, { units: 'meters' });
  } catch {
    return null;
  }
}

/**
 * 汇总选区内各风险等级的断面数与长度。
 *
 * <p>入参里的断面 `level` 必须是**显示等级**（0..3）；缺值算「未计算」。
 * 返回的 `rows` 永远是 5 行（含 0 计数行），UI 不用再补空行。
 */
export function computeAreaRiskStats(params: ComputeAreaRiskParams): AreaRiskStats {
  const stats = emptyAreaRiskStats();
  const selection = toSelectionFeature(params.selection);
  if (!selection) return stats;

  stats.areaM2 = turf.area(selection);

  const byKey = new Map(stats.rows.map((row) => [row.key, row]));
  const bumpLength = (key: string, meters: number) => {
    if (!Number.isFinite(meters) || meters <= 0) return;
    const row = byKey.get(key);
    if (!row) return;
    row.lengthM += meters;
  };
  const bumpSection = (key: string) => {
    const row = byKey.get(key);
    if (row) row.sectionCount += 1;
  };

  const sections = params.sections || [];
  const banks = params.banks || [];

  // 断面按岸段分组：色带的插值 stop 只认「这条岸段上的断面」。
  const sectionsByBank = new Map<string, AreaAnalysisSection[]>();
  for (const section of sections) {
    const bid = section?.bank_id ? String(section.bank_id) : '';
    if (!bid) continue;
    if (!sectionsByBank.has(bid)) sectionsByBank.set(bid, []);
    sectionsByBank.get(bid)!.push(section);
  }

  const drawnBanks = new Set<string>();

  for (const bank of banks) {
    const bankId = bank?.bank_id ? String(bank.bank_id) : '';
    const coords = bank?.geometry?.coordinates;
    if (!bankId || bank?.geometry?.type !== 'LineString' || !Array.isArray(coords) || coords.length < 2) {
      continue;
    }

    let bankLine: GeoJSON.Feature<GeoJSON.LineString>;
    let totalM: number;
    try {
      bankLine = turf.lineString(coords as any);
      totalM = turf.length(bankLine, { units: 'meters' });
    } catch {
      continue;
    }
    if (!Number.isFinite(totalM) || totalM <= 0) continue;

    // 岸段级快筛：整条都不在选区里就跳过（大任务几百条岸段时省掉绝大部分几何运算）
    try {
      if (!bboxOverlaps(turf.bbox(bankLine), turf.bbox(selection))) continue;
    } catch {
      continue;
    }

    const points: RiskGradientPoint[] = [];
    for (const section of sectionsByBank.get(bankId) ?? []) {
      const progress = sectionProgressAlongBank(section as any, bankLine, totalM);
      if (progress === null) continue;
      const level = section.level ?? null;
      const renderable = level !== null && isRiskLevelRenderable(level);
      points.push({
        val: progress,
        level,
        color: renderable
          ? (RISK_COLORS[String(level)] ?? UNKNOWN_RISK_COLOR)
          : TRANSPARENT_RISK_COLOR,
      });
    }

    // 没有断面（或全部投影失败）的岸段：整条按「未计算」计长度。
    // 不能因为「没着色」就跳过 —— 那会把分母做小，让其余等级的占比虚高。
    let spans: RiskBandSpan[];
    if (points.length === 0) {
      spans = [{ start: 0, end: 1, color: TRANSPARENT_RISK_COLOR, level: null, visible: false }];
    } else {
      spans = buildRiskBandSpans(points);
      if (spans.length === 0) {
        spans = [{ start: 0, end: 1, color: TRANSPARENT_RISK_COLOR, level: null, visible: false }];
      }
    }

    let bankLengthInside = 0;
    for (const span of spans) {
      const piece = sliceByMeters(bankLine, totalM, span.start * totalM, span.end * totalM);
      if (!piece) continue;
      const inside = lengthInsidePolygon(piece, selection);
      if (inside <= 0) continue;
      bankLengthInside += inside;
      bumpLength(rowKeyOfLevel(span.level), inside);
    }

    if (bankLengthInside > 0) {
      drawnBanks.add(bankId);
      stats.totalLengthM += bankLengthInside;
    }
  }

  // —— 断面计数：与选区相交即计入（与「中点在内」口径不同，见文件头说明）——
  const selectionBbox = (() => {
    try {
      return turf.bbox(selection);
    } catch {
      return null;
    }
  })();

  for (const section of sections) {
    const geometry = section?.geometry;
    const coords = geometry?.coordinates;
    if (geometry?.type !== 'LineString' || !Array.isArray(coords) || coords.length < 2) continue;
    let hit = false;
    try {
      const line = turf.lineString(coords as any);
      const box = turf.bbox(line);
      if (selectionBbox && !bboxOverlaps(box, selectionBbox)) continue;
      hit = turf.booleanIntersects(line, selection);
    } catch {
      hit = false;
    }
    if (!hit) continue;
    stats.sectionCount += 1;
    bumpSection(rowKeyOfLevel(section.level ?? null));
  }

  stats.bankCount = drawnBanks.size;

  // 比率最后统一算，避免累加过程中反复除零
  for (const row of stats.rows) {
    row.lengthRatio = stats.totalLengthM > 0 ? row.lengthM / stats.totalLengthM : 0;
    row.sectionRatio = stats.sectionCount > 0 ? row.sectionCount / stats.sectionCount : 0;
  }

  return stats;
}
