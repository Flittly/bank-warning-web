/**
 * DEM 三维地形在地图上的挂载：`raster-dem` 源 + `setTerrain` + `hillshade` 图层。
 *
 * <h3>为什么放这一层而不是塞进 EditorMap</h3>
 * 挂/摘/换源的时序有几条硬约定（见 {@link applyTerrain}），EditorMap 已经两千多行。
 * URL 拼接、源规格、状态文案都是纯函数，抽出来可以用 vitest 直接钉住。
 *
 * <h3>鉴权怎么过的</h3>
 * Mapbox 内部用 `new Request(url, { headers })` 取瓦片，`utils/apiClient` 那个只认
 * 字符串 URL 的全局拦截器**命中不到**它 —— 与 DEM 预览注释里写的是同一个坑
 * （预览只能先取 blob 再喂图；瓦片走不了这条路，几百张都要浏览器 HTTP 缓存）。
 * 这里改用地图的 `transformRequest`：只对地形瓦片 URL 追加 `Authorization`，
 * 其余请求原样放行。
 */
import type {
  HillshadeLayerSpecification,
  Map as MapboxMap,
  RequestParameters,
  RequestTransformFunction,
  RasterDemTileSource,
  RasterDEMSourceSpecification,
} from 'mapbox-gl';

export const TERRAIN_SOURCE = 'dem-terrain';
export const TERRAIN_HILLSHADE_LAYER = 'dem-hillshade';

/** 瓦片路径标识：`transformRequest` 靠它认出哪些请求要带 token。 */
const TILE_PATH_MARKER = '/v0/bank/tiffs/terrain/';

/**
 * 打开地形时若当前几乎是俯视，抬到这个角度让人立刻看到起伏。
 *
 * <p>俯仰上限这里不动：实装的 Mapbox 3.19.0 默认上限就是 85°（`defaultMaxPitch`），
 * 项目建图时也没传 `maxPitch`。早先把摘掉地形写成「还原 60」是照着旧版文档写的，
 * 实测会把用户原本能到的 85° 收窄。
 */
export const TERRAIN_ENTER_PITCH = 60;
const PITCH_ALREADY_TILTED = 15;

/**
 * 默认垂直夸张。
 *
 * <p>长江中下游河床起伏只有几米到几十米，1 倍远看像平板。实测同一视角（zoom 14 / pitch 72）
 * 下与 2 倍相比：**4 倍**有 20% 的像素发生变化、岸坡开始出现可读的明暗过渡；8 倍 32%、
 * 12 倍 36% 但已经明显失真（河槽像深沟，岸线矢量悬空）。4 倍是「看得起伏 + 不失真」的交点，
 * 用户还可以用面板上的滑块自己往上调。
 */
export const DEFAULT_TERRAIN_EXAGGERATION = 4;

export interface DemTerrainSpec {
  tiffKey: string;
  fingerprint: string;
  minzoom: number;
  maxzoom: number;
  /** Mapbox `bounds` 的顺序：[西, 南, 东, 北] */
  bounds: [number, number, number, number];
}

/** XYZ 瓦片模板：`{origin}/v0/bank/tiffs/terrain/{指纹}/{z}/{x}/{y}.png?tiff_key=…` */
export function buildTerrainTileUrl(origin: string, tiffKey: string, fingerprint: string): string {
  return `${origin}${TILE_PATH_MARKER}${fingerprint}/{z}/{x}/{y}.png?tiff_key=${encodeURIComponent(tiffKey)}`;
}

/**
 * `raster-dem` 源。
 *
 * <p>`bounds` 不能省：Mapbox 只请求落在其中的瓦片。后端给的范围已经比 DEM 外包框
 * 多出一圈（裙边），既盖住了缓坡，又不会让地图去拉走廊以外的空白瓦片。
 *
 * <p>`encoding` 只认 `mapbox | terrarium`（实装的 3.19.0），后端按 Terrarium 编码。
 *
 * <p>⚠ `minzoom` 必须信后端的值（金字塔真实的最低层），**不能抬高**：两次实测都是
 * 低缩放缺图区变空洞 —— 钉到 `maxzoom`（只用最高层 + overzoom）时 z10/z9 的
 * `queryTerrainElevation` 返回 `null`、瓦片请求从个位数涨到几百；抬到 9 时同样在
 * map zoom 9（恰等于 minzoom）返回 `null`。换层的落差是地形 LOD 的固有代价，
 * 只能靠金字塔层级本身保证「粗层尽量别失真」，不能靠改这个字段绕过去。
 */
export function buildTerrainSourceSpec(
  spec: DemTerrainSpec,
  origin: string,
): RasterDEMSourceSpecification {
  return {
    type: 'raster-dem',
    tiles: [buildTerrainTileUrl(origin, spec.tiffKey, spec.fingerprint)],
    encoding: 'terrarium',
    tileSize: 256,
    minzoom: spec.minzoom,
    maxzoom: spec.maxzoom,
    bounds: spec.bounds,
  };
}

/**
 * 山体阴影 + 三维地形的光照。
 *
 * <h3>为什么要显式设 light</h3>
 * Mapbox 不设 `light` 时用默认值（方位角 210°、极角 30°，几乎是**正上方照**）。地形表面
 * 的明暗和这个 hillshade 图层**共用同一盏灯**，正上方照的后果是：长江中下游河床只有几米
 * 到几十米的起伏，坡面几乎不产生阴面，看起来就是一张有纹理的平板。
 *
 * 改成**西北光**（制图惯例，光来自左上）并把极角压到 45°，同一个夸张系数下的起伏立刻能
 * 读出「哪边是岸、哪边是槽」。极角不能再低：实测 60° 以上背阴面会糊成一片黑，把岸线矢量
 * 和断面线一起吞掉。
 */
export const TERRAIN_LIGHT = {
  anchor: 'viewport' as const,
  color: '#ffffff',
  intensity: 0.45,
  position: [1.15, 315, 45] as [number, number, number],
};

/**
 * Mapbox 未设 light 时的默认值（3.19：viewport / 210° / 30°）。
 * **摘掉地形必须还原** —— 否则普通二维底图会一直顶着这盏斜射灯，整幅图偏暗。
 */
const DEFAULT_LIGHT = {
  anchor: 'viewport' as const,
  color: '#ffffff',
  intensity: 0.5,
  position: [1.15, 210, 30] as [number, number, number],
};

/**
 * 山体阴影。压在 DEM 灰度预览之上 —— 灰度图有 0.9 的不透明度，
 * 阴影层放到它下面会被盖住大半。插入位置由调用方的 `beforeLayers` 决定：
 * `addLayer(layer, before)` 是插到 `before` **下面**，所以候选要写预览层**上面**那一层
 * （`river-surface-fill`），写成预览层自己就正好插反了。
 *
 * <p>系数从 0.5 提到 0.85：这是「阴影浓度」而不是开关，0.5 在河床这种小起伏上几乎看不出
 * 明暗差；接近 1 会让阳面发白、丢掉高程渐变。0.85 是实测能压出阴面又不糊掉底图的档位。
 */
export function buildTerrainHillshadeLayer(): HillshadeLayerSpecification {
  return {
    id: TERRAIN_HILLSHADE_LAYER,
    type: 'hillshade',
    source: TERRAIN_SOURCE,
    paint: {
      'hillshade-exaggeration': 0.85,
      'hillshade-shadow-color': '#0a2d45',
      'hillshade-highlight-color': '#ffffff',
      // 阴影与高光之间的坡面：给一点冷灰，起伏才"实"，否则中间调全靠底图透出来
      'hillshade-accent-color': '#4a6b82',
    },
  };
}

/**
 * 只给地形瓦片请求加头，其余请求原样放行（回 `{ url }` 与不干预等价：Mapbox 内部就是
 * `transformRequest(url) || { url }`；类型上要求必须返回对象，所以不能回 undefined）。
 */
export function terrainTileRequest(url: string, headers: Record<string, string>): RequestParameters {
  if (!url.includes(TILE_PATH_MARKER) || Object.keys(headers).length === 0) return { url };
  return { url, headers };
}

/** 地图的 `transformRequest`：每次取瓦片时现读 token（用户重新登录后不会带着旧 token）。 */
export function createTerrainTransformRequest(
  getHeaders: () => Record<string, string>,
): RequestTransformFunction {
  return (url: string) => terrainTileRequest(url, getHeaders());
}

export interface TerrainStatusView {
  /** 现在就能挂到地图上 */
  ready: boolean;
  /** 后台正在切 / 排队中 */
  busy: boolean;
  failed: boolean;
  label: string;
}

/** 状态 → 界面文案。文案集中在这里，页面不许自己拼。 */
export function terrainStatusView(status: string | null | undefined, error?: string | null): TerrainStatusView {
  switch (status) {
    case 'ready':
      return { ready: true, busy: false, failed: false, label: '' };
    case 'building':
      return { ready: false, busy: true, failed: false, label: '正在生成三维地形…' };
    case 'pending':
      return { ready: false, busy: true, failed: false, label: '三维地形排队中…' };
    case 'unavailable':
      return {
        ready: false,
        busy: false,
        failed: true,
        label: '三维地形暂不可用：服务端表结构未就绪，请重启模型服务',
      };
    case 'missing':
      return { ready: false, busy: false, failed: true, label: 'DEM 不存在或无权访问' };
    case 'failed':
      return { ready: false, busy: false, failed: true, label: `三维地形生成失败${error ? `：${error}` : ''}` };
    case 'none':
    default:
      return { ready: false, busy: true, failed: false, label: '正在生成三维地形…' };
  }
}

/**
 * 在地图上挂上 / 更新 / 摘掉三维地形。
 *
 * <p>几条硬约定：
 * <ol>
 *   <li>必须等样式加载完：style 没就绪就 `addLayer` 会抛错；调用方按
 *       「`isStyleLoaded()` 为真就立刻做，否则 `once('idle')`」的模板调用。</li>
 *   <li>同一份 DEM 只调 `setTerrain` 换夸张系数，不重建源 —— 重建会闪一下。</li>
 *   <li>摘掉时先 `setTerrain(null)` 再删层删源：地形还引用着源时删源会抛错。</li>
 * </ol>
 *
 * @param beforeLayers 阴影层的插入位置候选，按顺序取第一个已存在的图层之前。
 */
export function applyTerrain(
  map: MapboxMap,
  spec: DemTerrainSpec | null | undefined,
  exaggeration: number,
  options: { beforeLayers?: string[]; ensurePitch?: boolean } = {},
): void {
  if (!spec) {
    const hadTerrain = Boolean(map.getTerrain());
    if (hadTerrain) map.setTerrain(null);
    if (map.getLayer(TERRAIN_HILLSHADE_LAYER)) map.removeLayer(TERRAIN_HILLSHADE_LAYER);
    if (map.getSource(TERRAIN_SOURCE)) map.removeSource(TERRAIN_SOURCE);
    // 只有真摘掉了地形才还原光照：本来就没挂的时候不碰 light，
    // 否则这个函数会变成一个"顺手把别人的灯关掉"的隐式副作用。
    if (hadTerrain) map.setLight(DEFAULT_LIGHT);
    return;
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const tileUrl = buildTerrainTileUrl(origin, spec.tiffKey, spec.fingerprint);
  // `serialize()` 读的是建源时的 `_options`，建完立刻就有；实例上的 `tiles` 要等 TileJSON
  // 解析完才被 Object.assign 上去，那一小段窗口里读它是 undefined，会把刚建的源误拆掉。
  const existing = map.getSource(TERRAIN_SOURCE) as RasterDemTileSource | undefined;
  const existingUrl = (existing?.serialize?.() as { tiles?: string[] } | undefined)?.tiles?.[0];
  // 换了 DEM（指纹不同）必须重建源：瓦片 URL 变了，旧源的瓦片一张都不能复用
  if (existing && existingUrl !== tileUrl) {
    if (map.getTerrain()) map.setTerrain(null);
    if (map.getLayer(TERRAIN_HILLSHADE_LAYER)) map.removeLayer(TERRAIN_HILLSHADE_LAYER);
    map.removeSource(TERRAIN_SOURCE);
  }

  if (!map.getSource(TERRAIN_SOURCE)) {
    map.addSource(TERRAIN_SOURCE, buildTerrainSourceSpec(spec, origin));
    const beforeId = (options.beforeLayers ?? []).find((id) => Boolean(map.getLayer(id)));
    map.addLayer(buildTerrainHillshadeLayer(), beforeId);
    // 光照与地形同生共死：不挂地形时留着这盏斜射灯，二维底图会整体偏暗。
    // 只在建源时设一次 —— 拖夸张系数会高频走本函数，重复 setLight 会让 Mapbox 无谓重绘；
    // 全项目只有这里改 light，不存在被别处覆盖后需要纠正的情况。
    map.setLight(TERRAIN_LIGHT);
  }
  map.setTerrain({ source: TERRAIN_SOURCE, exaggeration });
  if (options.ensurePitch && map.getPitch() < PITCH_ALREADY_TILTED) {
    map.easeTo({ pitch: TERRAIN_ENTER_PITCH, duration: 900 });
  }
}

/**
 * 瓦片 404 是预期内的（走廊以外没有瓦片，Mapbox 按 0 米处理），不该被当成底图故障。
 *
 * Mapbox 抛的是 `ErrorEvent`：瓦片请求失败时 URL 挂在 `ev.error.url` 上（`ev.error` 是 AjaxError，
 * 带状态码）；少数路径直接把带 `url` 的对象发出来。两处都看。
 */
export function isTerrainTileError(event: unknown): boolean {
  const e = event as { url?: unknown; error?: { url?: unknown } | null } | null | undefined;
  const url = e?.url ?? e?.error?.url;
  return typeof url === 'string' && url.includes(TILE_PATH_MARKER);
}

/** 瓦片请求失败的 HTTP 状态码；取不到返回 undefined。 */
export function terrainTileErrorStatus(event: unknown): number | undefined {
  const e = event as { status?: unknown; error?: { status?: unknown } | null } | null | undefined;
  const status = e?.status ?? e?.error?.status;
  return typeof status === 'number' ? status : undefined;
}
