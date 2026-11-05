import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  RasterLayerSpecification,
  RasterSourceSpecification,
  StyleSpecification,
} from 'mapbox-gl';
import { buildBasemapStyle } from './basemapStyle';

/**
 * 底图样式的契约测试。
 *
 * 核心一条：**卫星影像必须是「纯影像」**，不能带天地图的 `cia`（影像注记）层 ——
 * 那层会把道路、行政区名、地名 POI 叠在断面线/岸段色带上面，既挡判读又干扰配色。
 * 这条曾经靠人工看截图发现，改成断言后回归会直接红。
 */

function styleOf(mode: 'standard' | 'satellite', token = 'test-token'): StyleSpecification {
  return buildBasemapStyle(mode, token) as StyleSpecification;
}

function rasterLayerIds(style: StyleSpecification): string[] {
  return style.layers.filter((l) => l.type === 'raster').map((l) => l.id);
}

function tileUrls(style: StyleSpecification): string[] {
  const source = style.sources['tdt-base'] as RasterSourceSpecification | undefined;
  return source?.tiles ?? [];
}

function rasterBase(style: StyleSpecification): RasterLayerSpecification {
  return style.layers.find((l) => l.id === 'tdt-base') as RasterLayerSpecification;
}

describe('buildBasemapStyle / 卫星影像', () => {
  it('只有影像底图，不叠注记层（无道路、无地名）', () => {
    const style = styleOf('satellite');
    expect(rasterLayerIds(style)).toEqual(['tdt-base']);
    expect(style.sources['tdt-label']).toBeUndefined();
    expect(style.layers.map((l) => l.id)).toEqual(['tdt-background', 'tdt-base']);
  });

  it('瓦片 URL 走 img，且整体不出现任何 cia 注记请求', () => {
    const style = styleOf('satellite');
    const json = JSON.stringify(style);
    expect(json).toContain('/img_w/');
    expect(json).not.toContain('/cia_w/');
    expect(json).not.toContain('LAYER=cia');
  });

  it('影像层不加矢量底图的淡化 paint（生搬会让人误以为影像发灰）', () => {
    const base = rasterBase(styleOf('satellite'));
    expect(base?.type).toBe('raster');
    expect(base.paint).toBeUndefined();
  });
});

describe('buildBasemapStyle / 标准底图与兜底', () => {
  it('标准底图仍走 vec，并保留淡化 paint', () => {
    const style = styleOf('standard');
    const base = rasterBase(styleOf('standard'));
    expect(rasterLayerIds(style)).toEqual(['tdt-base']);
    expect(JSON.stringify(style)).toContain('/vec_w/');
    expect(base.paint?.['raster-opacity'] as number).toBeCloseTo(0.55);
  });

  it('无 token 时退回 Mapbox 官方样式（卫星本身即无标注）', () => {
    expect(buildBasemapStyle('satellite', undefined)).toBe('mapbox://styles/mapbox/satellite-v9');
    expect(buildBasemapStyle('standard', '')).toBe('mapbox://styles/mapbox/light-v10');
  });
});

/**
 * 瓦片来源的可配置性。
 *
 * 背景：内网部署时客户端机器常常上不了外网，浏览器直连 `t{n}.tianditu.gov.cn` 会
 * 直接 `TypeError: Failed to fetch`（key、CORS 都没问题，纯粹连不通）。
 * 这时把 VITE_TIANDITU_BASE 设成 `/tdt`，由 nginx 同源代拉。
 * 这两条断言锁住两件事：默认仍走 8 个子域；一旦配置就**不再出现外域**。
 */
describe('buildBasemapStyle / 瓦片来源', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('默认直连天地图：8 个子域都在，地址是 https 外链', () => {
    const urls = tileUrls(styleOf('standard'));
    const hosts = urls.map((u) => u.split('/')[2]);

    expect(urls).toHaveLength(8);
    expect(new Set(hosts)).toEqual(
      new Set(['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'].map((s) => `${s}.tianditu.gov.cn`)),
    );
  });

  it('配了 VITE_TIANDITU_BASE=/tdt：改成同源单地址，任何外域都不再出现', () => {
    vi.stubEnv('VITE_TIANDITU_BASE', '/tdt');
    // 测试环境是 node，没有 window；给一个最小替身，验证相对路径被补成绝对地址
    vi.stubGlobal('window', { location: { origin: 'http://192.168.245.153:8080' } });

    const urls = tileUrls(styleOf('standard'));

    expect(urls).toHaveLength(1);
    expect(urls[0].startsWith('http://192.168.245.153:8080/tdt/vec_w/wmts?')).toBe(true);
    expect(urls[0]).not.toContain('tianditu.gov.cn');
  });

  it('配了 VITE_TIANDITU_BASE=/tiles：走 XYZ 本地路径，不带 tk、不带外域', () => {
    vi.stubEnv('VITE_TIANDITU_BASE', '/tiles');
    vi.stubGlobal('window', { location: { origin: 'http://192.168.245.153:8080' } });

    const urls = tileUrls(styleOf('standard'));

    expect(urls).toEqual(['http://192.168.245.153:8080/tiles/vec/{z}/{x}/{y}.png']);
    expect(urls[0]).not.toContain('tianditu.gov.cn');
    expect(urls[0]).not.toContain('tk=');
  });

  /**
   * 这条是线上事故的回归锁：改用离线瓦片时顺手清空了 tk，
   * 结果样式退回 `mapbox://styles/...`，而项目没配 MAPBOX_TOKEN ⇒ 401 ⇒
   * `map.on('load')` 不触发 ⇒ 岸线/断面/框选层全都不存在、整图纯白。
   * 离线瓦片与 tk 无关，必须照常生效。
   */
  it('/tiles 不依赖 tk：没有 token 也走本地瓦片，绝不退回 mapbox 样式', () => {
    vi.stubEnv('VITE_TIANDITU_BASE', '/tiles');
    vi.stubGlobal('window', { location: { origin: 'http://192.168.245.153:8080' } });

    expect(buildBasemapStyle('standard', undefined)).not.toBe('mapbox://styles/mapbox/light-v10');

    const style = buildBasemapStyle('standard', '') as StyleSpecification;
    expect(tileUrls(style)).toEqual(['http://192.168.245.153:8080/tiles/vec/{z}/{x}/{y}.png']);
    expect(tileUrls(style)[0]).not.toContain('tk=');
  });

  it('/tiles 时卫星模式走本地 img 路径，扩展名是 .jpg（影像层是 JPEG）', () => {
    vi.stubEnv('VITE_TIANDITU_BASE', '/tiles');
    vi.stubGlobal('window', { location: { origin: 'http://192.168.245.153:8080' } });

    expect(tileUrls(styleOf('satellite'))).toEqual([
      'http://192.168.245.153:8080/tiles/img/{z}/{x}/{y}.jpg',
    ]);
  });

  it('/tiles 两层扩展名不同：vec=.png、img=.jpg（与下载脚本 LAYER_EXT 一致）', () => {
    vi.stubEnv('VITE_TIANDITU_BASE', '/tiles');
    vi.stubGlobal('window', { location: { origin: 'http://192.168.245.153:8080' } });

    expect(tileUrls(styleOf('standard'))[0]).toContain('/tiles/vec/{z}/{x}/{y}.png');
    expect(tileUrls(styleOf('satellite'))[0]).toContain('/tiles/img/{z}/{x}/{y}.jpg');
  });

  it('/tiles 时 maxzoom 取 VITE_TIANDITU_MAXZOOM，避免请求不存在的瓦片', () => {
    vi.stubEnv('VITE_TIANDITU_BASE', '/tiles');
    vi.stubEnv('VITE_TIANDITU_MAXZOOM', '12');
    vi.stubGlobal('window', { location: { origin: 'http://192.168.245.153:8080' } });

    const source = styleOf('standard').sources['tdt-base'] as RasterSourceSpecification;
    expect(source.maxzoom).toBe(12);
  });

  it('直连/代理模式 maxzoom 仍是 18，不受本地瓦片层级影响', () => {
    vi.stubEnv('VITE_TIANDITU_MAXZOOM', '12');
    const source = styleOf('standard').sources['tdt-base'] as RasterSourceSpecification;
    expect(source.maxzoom).toBe(18);
  });
});

/**
 * 瓦片独立端口。
 *
 * 背景：HTTP/1.1 下浏览器对同一个 origin 只开 6 条 TCP。瓦片一屏几十张，
 * 和 /v0/ 的接口抢同一批连接时，几百条断面校验要排队十几秒（后端单次只要 4ms）。
 * 把瓦片放到 :8081 就是换一个 origin，浏览器会单独给 6 条连接。
 *
 * 这三条锁住：只换端口不换主机（不写死 IP）、端口与页面相同时不重复拼、
 * 绝对地址原样生效。
 */
describe('buildBasemapStyle / 瓦片独立端口', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function stubLocation(protocol: string, hostname: string, port: string) {
    const origin = `${protocol}//${hostname}${port ? `:${port}` : ''}`;
    vi.stubGlobal('window', { location: { protocol, hostname, port, origin } });
  }

  it('VITE_TILES_PORT=8081：瓦片走同主机的 8081，不写死 IP', () => {
    vi.stubEnv('VITE_TIANDITU_BASE', '/tiles');
    vi.stubEnv('VITE_TILES_PORT', '8081');
    stubLocation('http:', '10.0.0.5', '8080');

    expect(tileUrls(styleOf('standard'))).toEqual([
      'http://10.0.0.5:8081/tiles/vec/{z}/{x}/{y}.png',
    ]);
    // 独立端口后瓦片不再是页面同源，但仍不能出现外域
    expect(tileUrls(styleOf('standard'))[0]).not.toContain('tianditu.gov.cn');
  });

  it('VITE_TILES_PORT 与页面端口相同：不拼出重复端口', () => {
    vi.stubEnv('VITE_TIANDITU_BASE', '/tiles');
    vi.stubEnv('VITE_TILES_PORT', '8080');
    stubLocation('http:', '10.0.0.5', '8080');

    expect(tileUrls(styleOf('standard'))).toEqual([
      'http://10.0.0.5:8080/tiles/vec/{z}/{x}/{y}.png',
    ]);
  });

  it('VITE_TIANDITU_BASE 给绝对地址时原样生效（反代/域名场景）', () => {
    vi.stubEnv('VITE_TIANDITU_BASE', 'https://tiles.example.com/tiles');
    vi.stubEnv('VITE_TILES_PORT', '8081');
    stubLocation('http:', '10.0.0.5', '8080');

    expect(tileUrls(styleOf('satellite'))).toEqual([
      'https://tiles.example.com/tiles/img/{z}/{x}/{y}.jpg',
    ]);
  });
});
