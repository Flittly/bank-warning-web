import type { StyleSpecification } from 'mapbox-gl';

export type BasemapMode = 'standard' | 'satellite';

const TDT_TOKEN: string | undefined = import.meta.env.VITE_TIANDITU_TOKEN;

const FALLBACK: Record<BasemapMode, string> = {
  standard: 'mapbox://styles/mapbox/light-v10',
  satellite: 'mapbox://styles/mapbox/satellite-v9',
};

/** 直连天地图时的 8 个瓦片子域（浏览器按域并发，单域会被 6 连接上限卡住）。 */
const TDT_SUBDOMAINS = ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'];

/**
 * 瓦片「主机根」列表。
 *
 * 默认直连 `https://t{n}.tianditu.gov.cn`。
 * 客户端机器不能出网（内网隔离、DNS 不解析 gov.cn、必须走代理）时，把它设成同源路径
 * `/tdt`，由 nginx 代拉（见 `deploy/nginx/default.conf` 的 `/tdt/` location）：
 *
 *   VITE_TIANDITU_BASE=/tdt
 *
 * 这样浏览器只跟自己的服务器通信，天地图的连通性由服务器负责，顺带把 tk 藏在服务端。
 * ⚠ 构建期变量，改完必须 `docker compose build web`，`up -d` 不生效。
 *
 * 相对路径必须补成绝对地址：Mapbox 对相对 tile URL 的解析依赖文档 base，跨部署不稳。
 */
function tdtOrigins(): string[] {
  const raw = (import.meta.env.VITE_TIANDITU_BASE as string | undefined)?.trim();
  if (!raw) return TDT_SUBDOMAINS.map((s) => `https://${s}.tianditu.gov.cn`);

  const base = raw.replace(/\/+$/, '');
  if (!base.startsWith('/')) return [base];
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return [`${origin}${base}`];
}

/**
 * 是否走「本地离线瓦片」：VITE_TIANDITU_BASE 以 `/tiles` 结尾。
 *
 * 天地图前面挂着华为云 WAF，机房 IP / 非浏览器指纹的请求会被 418「访问被拦截」挡掉，
 * 连服务器反代都拿不到瓦片。这种部署就把瓦片预先下载到 deploy/tiles/，
 * 由 nginx 静态服务（见 deploy/nginx/default.conf 的 /tiles/），运行时完全不碰外网。
 * 布局是标准 XYZ：tiles/{layer}/{z}/{x}/{y}.png，由 deploy/scripts/download-tiles.py 生成。
 *
 * 判定用 `endsWith('/tiles')` 而不是全等，是为了同时接受 `/tiles` 和
 * `http://<host>:8081/tiles`（瓦片独立端口形态，见 {@link localTilesEndpoint}）。
 */
function isLocalTiles(): boolean {
  const raw = (import.meta.env.VITE_TIANDITU_BASE as string | undefined) ?? '';
  return raw.trim().replace(/\/+$/, '').endsWith('/tiles');
}

/**
 * 本地瓦片的「源站 + 路径前缀」。
 *
 * <p>为什么会有独立端口：HTTP/1.1 下浏览器对**同一个 origin** 只开 6 条 TCP 连接。
 * 瓦片一屏几十张，如果和 `/v0/` 的接口挤在同一批连接上，几百条断面校验就要排队
 * （实测后端单次校验 4ms，389 条却花了 16.4s，时间全花在等连接）。
 * 把瓦片放到另一个端口 = 另一个 origin = 浏览器为它单独开 6 条，互不挤占。
 *
 * <p>两种写法都支持：
 * - `VITE_TIANDITU_BASE=/tiles` + `VITE_TILES_PORT=8081` →
 *   `http://<当前页面主机>:8081/tiles`（**推荐**：只配端口，不写死 IP）
 * - `VITE_TIANDITU_BASE=http://10.0.0.5:8081/tiles` → 原样使用（反代/域名场景）
 * - `VITE_TILES_PORT` 留空 → 与页面同源（老行为，8080 单端口部署）
 *
 * ⚠ 跨 origin 后 mapbox 用 `fetch` + WebGL 纹理加载瓦片，必须能过 CORS 校验 ——
 * nginx 那个端口上必须带 `Access-Control-Allow-Origin`，否则底图整片空白。
 */
function localTilesEndpoint(): { origin: string; basePath: string } {
  const raw = ((import.meta.env.VITE_TIANDITU_BASE as string | undefined) ?? '').trim().replace(/\/+$/, '');

  // 绝对地址：按它自己解析，origin 和 path 都取里面的
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      return { origin: url.origin, basePath: url.pathname.replace(/\/+$/, '') || '/tiles' };
    } catch {
      // 解析失败就退化到相对路径分支
    }
  }

  const basePath = raw.startsWith('/') ? raw : '/tiles';
  const port = ((import.meta.env.VITE_TILES_PORT as string | undefined) ?? '').trim();
  const loc = typeof window !== 'undefined' ? window.location : undefined;
  if (!loc) return { origin: '', basePath };
  // 端口与页面一致时别拼出 `http://host:80` 这种多余串
  if (!port || port === loc.port) return { origin: loc.origin, basePath };
  return { origin: `${loc.protocol}//${loc.hostname}:${port}`, basePath };
}

/** 本地瓦片最高层级；mapbox 超过它会放大复用（overzoom），不会请求不存在的瓦片。 */
function localTileMaxzoom(): number {
  const n = Number(import.meta.env.VITE_TIANDITU_MAXZOOM);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 22) : 13;
}

function tdtTiles(layer: 'vec' | 'img' | 'cva' | 'cia', tk: string): string[] {
  if (isLocalTiles()) {
    const { origin, basePath } = localTilesEndpoint();
    // 天地图 img（遥感影像）返回 JPEG、vec（矢量）返回 PNG；离线文件名按层对应，
    // nginx 才能给出正确 MIME。与 deploy/scripts/download-tiles.py 的 LAYER_EXT 必须一致。
    const ext = layer === 'img' ? 'jpg' : 'png';
    return [`${origin}${basePath}/${layer}/{z}/{x}/{y}.${ext}`];
  }
  const path = `/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${tk}`;
  return tdtOrigins().map((origin) => `${origin}${path}`);
}

const TDT_STANDARD_RASTER_PAINT = {
  'raster-opacity': 0.55,
  'raster-saturation': -0.4,
  'raster-contrast': -0.1,
};

/**
 * 天地图底图样式。
 *
 * ⚠ **卫星影像不带注记层**（需求 2026-10-21）：原来的 `img` + `cia`（影像注记）会叠上一层
 * 道路、行政区名、地名 POI，压在本系统的断面线/岸段色带下面既挡判读又干扰配色。
 * `img` 本身是纯影像，不叠 `cia` 就只剩地貌 —— 但千万不要改成「叠上再把 layer 设
 * `visibility: none`」，那样照样下瓦片、白耗流量。
 * 将来若要恢复道路/地名，在 layers 里再 push 一层 `tdtTiles('cia', tk)` 的 raster 即可
 * （`tdtTiles` 仍保留 `cia`/`cva` 等图层名的构造能力）。
 */
function tdtStyle(base: 'vec' | 'img', tk: string): StyleSpecification {
  return {
    version: 8,
    sources: {
      'tdt-base': {
        type: 'raster',
        tiles: tdtTiles(base, tk),
        tileSize: 256,
        // 本地瓦片只下载到 MAXZOOM，超过就放大复用；直连/代理仍用天地图的 18
        maxzoom: isLocalTiles() ? localTileMaxzoom() : 18,
        attribution: '<a href="https://www.tianditu.gov.cn/" target="_blank" rel="noreferrer">天地图</a>',
      },
    },
    layers: [
      { id: 'tdt-background', type: 'background', paint: { 'background-color': '#ffffff' } },
      {
        id: 'tdt-base',
        type: 'raster',
        source: 'tdt-base',
        ...(base === 'vec' ? { paint: TDT_STANDARD_RASTER_PAINT } : {}),
      },
    ],
  };
}

const cache = new Map<BasemapMode, string | StyleSpecification>();

/**
 * 构造某模式下的底图样式（纯函数，token 由外部传入，便于单测）。
 *
 * <p>三种来源，判断顺序**不能颠倒**：
 * 1. `VITE_TIANDITU_BASE=/tiles`（本地离线瓦片）→ 不管有没有 tk 都走本地。
 *    瓦片是我们自己的 nginx 提供的静态文件，跟 tk 一点关系都没有。
 * 2. 有 tk → 直连 / 反代天地图。
 * 3. 都没有 → 退回 Mapbox 官方样式（需要 `VITE_MAPBOX_TOKEN`，见下方警告）。
 *
 * <p>⚠ 第 1 条必须排在 token 判断**之前**。历史版本写成 `if (!token) return FALLBACK`，
 * 于是「改用离线瓦片 ⇒ 顺手清空 tk」这种最自然的操作，会让前端退回
 * `mapbox://styles/...`；而本项目从没配过 `VITE_MAPBOX_TOKEN`，
 * 请求直接 401 ⇒ **样式加载失败 ⇒ `map.on('load')` 永不触发 ⇒
 * 岸线、断面、框选层全都不存在，整张图纯白**，控制台只剩一句
 * `The layer 'xxx' does not exist in the map's style`（每个 effect 各报一次），
 * 完全看不出根因就在 tk 上。
 */
export function buildBasemapStyle(
  mode: BasemapMode,
  token: string | undefined,
): string | StyleSpecification {
  if (isLocalTiles()) return tdtStyle(mode === 'satellite' ? 'img' : 'vec', token ?? '');
  if (!token) return FALLBACK[mode];
  return tdtStyle(mode === 'satellite' ? 'img' : 'vec', token);
}

export function getBasemapStyle(mode: BasemapMode): string | StyleSpecification {
  const hit = cache.get(mode);
  if (hit) return hit;
  const value = buildBasemapStyle(mode, TDT_TOKEN);
  cache.set(mode, value);
  // 退回 Mapbox 官方样式必须同时有 VITE_MAPBOX_TOKEN，否则 style 请求 401、
  // `map.on('load')` 永不触发，表现为「整张图纯白、岸线断面全都不存在」。
  // 这个组合极难从现象反推，直接在这里说清楚。
  if (typeof value === 'string' && !import.meta.env.VITE_MAPBOX_TOKEN) {
    console.error(
      '[底图] 未配置 VITE_TIANDITU_TOKEN，已退回 Mapbox 官方样式；' +
        '但 VITE_MAPBOX_TOKEN 也是空的 ⇒ 样式必然加载失败、地图会整片空白。' +
        '走离线瓦片请把 VITE_TIANDITU_BASE 设成 /tiles。',
    );
  }
  return value;
}
