import { extractErrorMessage } from './taskRunControl';
import { parseFlowFieldGeometry, type FlowFieldGeometry } from '../map/flowField';
import type { LonLatBounds } from './tiffService';

/**
 * 流场取数（前端侧）。所有请求都走 Java 后端 `/v0/bank/flow-field/**`，
 * 由后端转发模型服务 —— 前端不直连模型服务的 8088。
 *
 * <p>鉴权由 `utils/apiClient.ts` 装的全局 fetch 拦截器负责（`/v0/` 前缀自动带 Bearer）。
 */

export interface FlowFieldCase {
  caseId: string;
  /** 流量档，如 `84000`。 */
  waterQs: string;
  /** 潮型：`dc` / `xc` / `zc`。 */
  tidalLevel: string;
  frames: number;
}

const TIDAL_LABELS: Record<string, string> = { dc: '大潮', xc: '小潮', zc: '中潮' };

/** 潮型的中文标签；未知取值原样返回，免得将来加了潮型就显示空白。 */
export function tidalLevelLabel(level: string): string {
  return TIDAL_LABELS[level] ?? level;
}

/** 工况的中文描述，如 `84000 m³/s · 大潮`。 */
export function describeCase(item: Pick<FlowFieldCase, 'waterQs' | 'tidalLevel'>): string {
  return `${item.waterQs} m³/s · ${tidalLevelLabel(item.tidalLevel)}`;
}

async function readError(res: Response, fallback: string): Promise<string> {
  let body: any = null;
  try {
    const text = await res.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (res.status === 401 || res.status === 403) return '没有查看流场的权限，登录可能已过期，请重新登录';

  const detail = extractErrorMessage(body) || fallback;
  // 404 最常见的原因是后端还是旧进程：流场接口是新增的，已经跑着的 JVM 不会热加载新 Controller。
  // Spring 默认的错误体里 error 字段是 "Not Found" 这种通用文案，所以这里不直接返回它。
  if (res.status === 404) {
    return `${detail}（HTTP 404）—— 流场接口是新增的；若后端进程在本次改动之前就已启动，请重启后端服务`;
  }
  return `${detail}（HTTP ${res.status}）`;
}

/** 拉取可用工况清单。清单由后端从模型服务的资源树读出，前端不要硬编码工况表。 */
export async function fetchFlowFieldCases(): Promise<{ cases: FlowFieldCase[]; frames: number }> {
  let res: Response;
  try {
    res = await fetch('/v0/bank/flow-field/cases');
  } catch (err: any) {
    throw new Error(`流场工况清单请求失败：${err?.message || String(err)}`);
  }
  if (!res.ok) {
    throw new Error(await readError(res, '流场工况清单获取失败'));
  }
  const body = await res.json();
  const rows: any[] = Array.isArray(body?.cases) ? body.cases : [];
  const cases = rows
    .map((row) => ({
      caseId: String(row?.case_id ?? '').trim(),
      waterQs: String(row?.water_qs ?? '').trim(),
      tidalLevel: String(row?.tidal_level ?? '').trim(),
      frames: Number(row?.frames ?? body?.frames ?? 0) || 0,
    }))
    .filter((row) => row.caseId);
  const frames = Number(body?.frames ?? 0) || cases.reduce((max, row) => Math.max(max, row.frames), 0);
  return { cases, frames };
}

/**
 * 按场景生成的流场（一个场景覆盖一整片 DEM）。
 *
 * <p>与 {@link FlowFieldCase} 的区别：工况是 2024-08 一次性算的固定素材，只盖住大区 DEM 的约 8%；
 * 场景是按任务所属 DEM 的范围从库里点云现生成的，`extent` 就是那片 DEM 的范围。
 * 两类 id **共用同一组请求路径**（`/{id}/description|velocity/{frame}|mask`），
 * 所以场景可以直接塞进 `fetchFlowFieldGeometry` 之类的现有函数，不需要另写一套。
 */
export interface FlowFieldScene {
  sceneId: string;
  /** 生成这个场景时用的 DEM（tiff_key）。 */
  tiffKey: string;
  /**
   * 范围与这个场景相同的**全部** DEM。
   *
   * <p>这是"按任务匹配场景"的依据：一个任务的 `bench_id` / `ref_id` 往往都是这片区域的 DEM
   * （例如 `2018-Yangtze-uvhH.tif` 与 `2023-Yangtze-uvhH.tif` 范围逐位相同），
   * 所以按范围哈希后两个文件指向同一个场景，命中任意一个都算命中。
   */
  tiffKeys: string[];
  /** DEM 的经纬度包围盒 `[west, south, east, north]`；DEM 未登记时为 null。 */
  demBounds: number[] | null;
  waterQs: string;
  tidalLevel: string;
  resolution: number;
  frames: number;
  nx: number;
  ny: number;
  cellSizeM: number;
  /** 数据包围盒与 DEM 包围盒的重叠比例（0~1）。1 表示完全盖住。 */
  coverage: number | null;
  generatedAt: string;
}

/** 拉取已生成的场景清单。没有已生成的场景时返回空数组（不是错误）。 */
export async function fetchFlowFieldScenes(): Promise<FlowFieldScene[]> {
  let res: Response;
  try {
    res = await fetch('/v0/bank/flow-field/scenes');
  } catch (err: any) {
    throw new Error(`流场场景清单请求失败：${err?.message || String(err)}`);
  }
  if (!res.ok) {
    throw new Error(await readError(res, '流场场景清单获取失败'));
  }
  const body = await res.json();
  const rows: any[] = Array.isArray(body?.scenes) ? body.scenes : [];
  return rows
    .map((row): FlowFieldScene => {
      const grid = row?.grid ?? {};
      const coverage = Number(row?.coverage?.overlap_ratio);
      const demBounds = Array.isArray(row?.dem_bounds)
        ? row.dem_bounds.map((v: unknown) => Number(v))
        : null;
      return {
        sceneId: String(row?.scene_id ?? '').trim(),
        tiffKey: String(row?.tiff_key ?? '').trim(),
        tiffKeys: Array.isArray(row?.tiff_keys) ? row.tiff_keys.map((v: unknown) => String(v)) : [],
        demBounds,
        waterQs: String(row?.water_qs ?? '').trim(),
        tidalLevel: String(row?.tidal_level ?? '').trim(),
        resolution: Number(row?.resolution ?? 0) || 0,
        frames: Number(row?.frames ?? 0) || 0,
        nx: Number(grid?.nx ?? 0) || 0,
        ny: Number(grid?.ny ?? 0) || 0,
        cellSizeM: Number(grid?.cell_size_m ?? 0) || 0,
        coverage: Number.isFinite(coverage) ? coverage : null,
        generatedAt: String(row?.generated_at ?? ''),
      };
    })
    .filter((row) => row.sceneId);
}

/** 场景的中文描述：`84000 m³/s · 1998-2018 · 1024×316`。 */
export function describeScene(scene: Pick<FlowFieldScene, 'waterQs' | 'tidalLevel' | 'nx' | 'ny'>): string {
  const size = scene.nx > 0 && scene.ny > 0 ? ` · ${scene.nx}×${scene.ny}` : '';
  return `${scene.waterQs} m³/s · ${scene.tidalLevel}${size}`;
}

/**
 * 找出覆盖某片 DEM 的场景。
 *
 * <p>匹配分两级，顺序固定：
 *   1. **同范围**：`dem_id` 落在场景的 `tiff_keys` 里（范围相等的一组 DEM 共用一个场景）。
 *      任务的 `bench_id` / `ref_id` 任一命中都算。
 *   2. **被包含**（仅在给了 `demBounds` 时）：库里还有一批小区域 DEM（`2018-YZ.tif` 12 个任务、
 *      `2018-NJ.tif` 1 个任务），它们**没有自己的场景**，也不在任何场景的 `tiff_keys` 里。
 *      实测这些区域只被大区那批点云覆盖（YZ 98.75%、NJ 100%），而内置工况用的 `10000` 点云
 *      对它们只有 0.77% / 0.00%（NJ 完全无交集）。所以这里退一步选"范围包住这片 DEM"的场景，
 *      总比退到内置工况强。
 *
 * <p>第 2 级要调用方把 DEM 自己的包围盒传进来（`demBoundsOf(tiffBounds, demId)`）：
 * 只有 `tiff-bounds` 接口知道每片 DEM 的范围，场景清单里没有别人的范围。
 *
 * @param demId  任务的 DEM（`section_profiles.dem_id` 或 `basic_params.bench_id`）
 * @param preferredTidal  优先潮位。可以给完整档位（`1998-2018`，精确优先），
 *   也可以只给年份（`2018`，按后缀匹配）—— 后者方便从 `dem_id` 里直接推。
 * @param demBounds 该 DEM 的经纬包围盒 `[w,s,e,n]`；没有就只走第 1 级
 */
export function findSceneForDem(
  scenes: FlowFieldScene[],
  demId: string | null | undefined,
  preferredTidal?: string | null,
  demBounds?: number[] | null,
): FlowFieldScene | null {
  const wanted = String(demId ?? '').trim();
  if (!wanted) return null;
  const target = normalizeDemKey(wanted);
  const tidal = String(preferredTidal ?? '').trim();
  const matched = scenes.filter(
    (scene) =>
      scene.tiffKeys.some((key) => normalizeDemKey(key) === target) ||
      normalizeDemKey(scene.tiffKey) === target,
  );
  if (matched.length > 0) return preferByTidal(matched, tidal);
  const box = toBounds(demBounds);
  return box ? findSceneCoveringDem(scenes, box, tidal) : null;
}

/** 归一化 DEM key：`tiff_bounds` / `basic_params` 里 `\` 与 `/` 两种写法都出现过。 */
function normalizeDemKey(key: string): string {
  return key.replace(/\\/g, '/').replace(/^\/+/, '');
}

function toBounds(value: number[] | null | undefined): LonLatBounds | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const box = value.map((v) => Number(v));
  if (!box.every((v) => Number.isFinite(v))) return null;
  return box as LonLatBounds;
}

/** 潮位偏好打分：完整命中 2、后缀（年份）命中 1、不相关 0。 */
function tidalScore(sceneTidal: string, wanted: string): number {
  if (!wanted) return 0;
  if (sceneTidal === wanted) return 2;
  return sceneTidal.endsWith(wanted) ? 1 : 0;
}

/** 按潮位偏好取一个；都不相关时退回首项（而不是 null）。 */
function preferByTidal<T extends { tidalLevel: string }>(items: T[], wanted: string): T {
  let best = items[0];
  let bestScore = tidalScore(best.tidalLevel, wanted);
  for (const item of items.slice(1)) {
    const score = tidalScore(item.tidalLevel, wanted);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

/** 从 `dem_id` 里推出想优先选哪档潮位：取最后出现的 4 位年份（`.../2018-YZ.tif` → `2018`，`1998-2018` → `2018`）。 */
export function inferPreferredTidal(demId: string | null | undefined): string {
  const years = String(demId ?? '').match(/(?:19|20)\d{2}/g);
  return years && years.length > 0 ? years[years.length - 1] : '';
}

/** 包围盒面积。这里只用它比"谁更贴身"，经纬度当平面算足够（同一纬度带内）。 */
function boundsArea(bounds: LonLatBounds): number {
  return Math.abs((bounds[2] - bounds[0]) * (bounds[3] - bounds[1]));
}

/**
 * `container` 盖住 `target` 的比例（0~1）。1 表示完全包住。
 *
 * <p>纯平面矩形相交 —— 与出图 / 报告分区里的含边判定同思路，不引 turf，免得
 * 在只做"要不要用这个场景"的粗判上背一个几何库。
 */
export function boundsCoverage(container: LonLatBounds, target: LonLatBounds): number {
  const overlapW = Math.min(container[2], target[2]) - Math.max(container[0], target[0]);
  const overlapH = Math.min(container[3], target[3]) - Math.max(container[1], target[1]);
  if (overlapW <= 0 || overlapH <= 0) return 0;
  const targetArea = boundsArea(target);
  return targetArea > 0 ? (overlapW * overlapH) / targetArea : 0;
}

/** 覆盖率低于这个值就不算"包住"：只是擦到一条边的话，拿它当这张 DEM 的流场没有意义。 */
export const SCENE_CONTAINMENT_MIN = 0.95;

/**
 * 找出"范围包住这片 DEM"的场景（{@link findSceneForDem} 的第 2 级）。
 *
 * <p>多个候选时先看潮位偏好，再取**最贴身**的那个（面积最小）——
 * 这样将来若真为 YZ / NJ 生成了局部场景，它们会自动压过大区场景，不用改这里。
 */
export function findSceneCoveringDem(
  scenes: FlowFieldScene[],
  demBounds: LonLatBounds,
  preferredTidal?: string | null,
): FlowFieldScene | null {
  const tidal = String(preferredTidal ?? '').trim();
  const covering = scenes
    .filter((scene) => Array.isArray(scene.demBounds) && scene.demBounds!.length === 4)
    .filter((scene) => boundsCoverage(scene.demBounds as LonLatBounds, demBounds) >= SCENE_CONTAINMENT_MIN);
  if (covering.length === 0) return null;
  return covering.sort((a, b) => {
    const byTidal = tidalScore(b.tidalLevel, tidal) - tidalScore(a.tidalLevel, tidal);
    if (byTidal !== 0) return byTidal;
    return boundsArea(a.demBounds as LonLatBounds) - boundsArea(b.demBounds as LonLatBounds);
  })[0];
}

/** 拉取并解析某工况的流场描述（几何 + 流速区间 + 帧数）。 */
export async function fetchFlowFieldGeometry(caseId: string): Promise<FlowFieldGeometry> {
  const id = String(caseId || '').trim();
  if (!id) throw new Error('缺少流场工况 id');
  let res: Response;
  try {
    res = await fetch(`/v0/bank/flow-field/${encodeURIComponent(id)}/description`);
  } catch (err: any) {
    throw new Error(`流场描述请求失败：${err?.message || String(err)}`);
  }
  if (!res.ok) {
    throw new Error(await readError(res, '流场描述获取失败'));
  }
  return parseFlowFieldGeometry(await res.json());
}

/**
 * 把 PNG 解码成纹理源。
 *
 * <p>两个选项都是**必须**的：纹理里装的是 float32 的字节，任何色彩管理或预乘 alpha
 * 都会改掉字节值，解码出来的流速就是垃圾。同样的理由，上传时还要关掉
 * `UNPACK_COLORSPACE_CONVERSION_WEBGL` 与 `UNPACK_PREMULTIPLY_ALPHA_WEBGL`。
 */
async function decodePng(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}

async function fetchBitmap(url: string, fallback: string): Promise<ImageBitmap> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err: any) {
    throw new Error(`${fallback}：${err?.message || String(err)}`);
  }
  if (!res.ok) {
    throw new Error(await readError(res, fallback));
  }
  return decodePng(await res.blob());
}

/** 取第 frame 帧的流速纹理（每个网格 2 个 texel：先 u 后 v，各是归一化值的 float32 字节）。 */
export function fetchFlowFieldVelocityBitmap(caseId: string, frame: number): Promise<ImageBitmap> {
  const id = String(caseId || '').trim();
  const f = Math.max(0, Math.floor(frame));
  return fetchBitmap(`/v0/bank/flow-field/${encodeURIComponent(id)}/velocity/${f}`, '流场流速纹理获取失败');
}

/** 取水域掩膜（每像素一对 16 位大端索引，水域格指自己、陆域格指一个随机水域格）。 */
export function fetchFlowFieldMaskBitmap(caseId: string): Promise<ImageBitmap> {
  const id = String(caseId || '').trim();
  return fetchBitmap(`/v0/bank/flow-field/${encodeURIComponent(id)}/mask`, '流场水域掩膜获取失败');
}
