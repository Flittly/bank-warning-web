/**
 * DEM 预览请求层的守门测试。
 *
 * 这里锁的是两个「错了但不会报错」的点：
 * 1. **四角顺序** —— Mapbox `image` source 要的是 [左上, 右上, 右下, 左下]。
 *    顺序写错图不会报错，只会整张镜像/翻转，只有在和河面线对照时才看得出来。
 * 2. **缺范围时必须抛错** —— 拿不到 X-Dem-* 就用默认值 0,0 贴图，会把图钉到几内亚湾。
 *
 * 运行环境是 node（没有 localStorage / createObjectURL），所以两者都要 stub。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEM_PREVIEW_COLORS,
  demLegendGradient,
  fetchDemPreview,
  releaseDemPreview,
  type DemPreviewMeta,
} from './demPreviewService';

const OK_HEADERS: Record<string, string> = {
  'X-Dem-West': '120.46050751',
  'X-Dem-South': '31.99355041',
  'X-Dem-East': '120.58847047',
  'X-Dem-North': '32.07670508',
  'X-Dem-Width': '1536',
  'X-Dem-Height': '1177',
  'X-Dem-Min': '-46.048',
  'X-Dem-Max': '1.489',
  'X-Dem-Low': '-30.284',
  'X-Dem-High': '0.683',
  'X-Dem-Nodata': '-9999.000',
  'X-Dem-Nodata-Ratio': '0.2250',
};

function pngResponse(headers: Record<string, string> = OK_HEADERS, status = 200): Response {
  return new Response(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), {
    status,
    headers,
  });
}

describe('demPreviewService', () => {
  beforeEach(() => {
    // apiClient.authHeaders → tokenManager.getAccessToken → localStorage
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:dem-preview-test'),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('把地理范围排成 [左上, 右上, 右下, 左下]', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => pngResponse()));

    const preview = await fetchDemPreview('tiff/Mzs/2019/standard/201904/201904.tif');

    expect(preview.imageUrl).toBe('blob:dem-preview-test');
    expect(preview.coordinates).toEqual([
      [120.46050751, 32.07670508], // 左上 = 西, 北
      [120.58847047, 32.07670508], // 右上 = 东, 北
      [120.58847047, 31.99355041], // 右下 = 东, 南
      [120.46050751, 31.99355041], // 左下 = 西, 南
    ]);
    expect(preview.meta.nodataRatio).toBeCloseTo(0.225, 6);
    expect(preview.meta.min).toBeCloseTo(-46.048, 3);
  });

  it('请求 URL 会带上编码后的 tiff_key', async () => {
    // 形参必须声明：`vi.fn(async () => …)` 的 calls 是空元组，`calls[0][0]` 过不了 tsc
    const fetchMock = vi.fn(async (_url: string) => pngResponse());
    vi.stubGlobal('fetch', fetchMock);

    await fetchDemPreview('tiff/长江中游/2019/standard/201904/a.tif');

    const requested = String(fetchMock.mock.calls[0][0]);
    expect(requested).toContain('/v0/bank/tiffs/preview?tiff_key=');
    expect(requested).toContain(encodeURIComponent('长江中游'));
  });

  it('缺少 X-Dem 范围头时抛错，而不是用 0,0 硬贴', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => pngResponse({ 'X-Dem-Width': '10' })));

    await expect(fetchDemPreview('tiff/a.tif')).rejects.toThrow(/地理范围/);
  });

  it('范围反了（西 >= 东）也要拒绝', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        pngResponse({ ...OK_HEADERS, 'X-Dem-West': '121', 'X-Dem-East': '120' }),
      ),
    );

    await expect(fetchDemPreview('tiff/a.tif')).rejects.toThrow(/地理范围/);
  });

  it('非 2xx 时把后端给的原因抛出来', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'DEM 文件不存在：tiff/a.tif' }), { status: 404 })),
    );

    await expect(fetchDemPreview('tiff/a.tif')).rejects.toThrow('DEM 文件不存在：tiff/a.tif');
  });

  it('releaseDemPreview 只回收 blob URL，且容忍空值', () => {
    const revoke = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(), revokeObjectURL: revoke });

    releaseDemPreview({ tiffKey: 'a', imageUrl: 'blob:x', coordinates: [[0, 0], [0, 0], [0, 0], [0, 0]], meta: {} as any });
    expect(revoke).toHaveBeenCalledWith('blob:x');

    revoke.mockClear();
    releaseDemPreview({ tiffKey: 'a', imageUrl: 'https://cdn/x.png', coordinates: [[0, 0], [0, 0], [0, 0], [0, 0]], meta: {} as any });
    releaseDemPreview(null);
    releaseDemPreview(undefined);
    expect(revoke).not.toHaveBeenCalled();
  });

  it('图例色值与后端 Python 常量一致', () => {
    // 后端 model/demPreview.py: PREVIEW_DARK=14, PREVIEW_LIGHT=208, PREVIEW_NODATA=(230,32,32)
    expect(DEM_PREVIEW_COLORS.dark).toBe(14);
    expect(DEM_PREVIEW_COLORS.light).toBe(208);
    expect(DEM_PREVIEW_COLORS.nodata).toBe('rgb(230, 32, 32)');
  });

  it('选了配色就把 ramp 带进查询参数', async () => {
    const fetchMock = vi.fn(async (_url: string) => pngResponse());
    vi.stubGlobal('fetch', fetchMock);

    await fetchDemPreview('tiff/a.tif', { ramp: 'hypsometric' });

    expect(String(fetchMock.mock.calls[0][0])).toContain('ramp=hypsometric');
  });

  it('不传配色时不写 ramp 参数（让服务端用默认灰度）', async () => {
    const fetchMock = vi.fn(async (_url: string) => pngResponse());
    vi.stubGlobal('fetch', fetchMock);

    await fetchDemPreview('tiff/a.tif');

    expect(String(fetchMock.mock.calls[0][0])).not.toContain('ramp=');
  });

  it('请求绕开 HTTP 缓存（换配色必须真的重取，不能吃旧图）', async () => {
    // 后端曾给预览图加 max-age=3600：浏览器把灰度图存在 ?ramp=hypsometric 名下，
    // 前端拿回的 X-Dem-Ramp 还是 gray，Segmented 立刻弹回灰度 ⇒「点了没反应」。
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => pngResponse());
    vi.stubGlobal('fetch', fetchMock);

    await fetchDemPreview('tiff/a.tif', { ramp: 'hypsometric' });

    expect(fetchMock.mock.calls[0][1]?.cache).toBe('no-store');
  });

  it('配色与图例断点以响应头回显为准', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        pngResponse({
          ...OK_HEADERS,
          'X-Dem-Ramp': 'hypsometric',
          // 故意乱序 + 夹一个非法项：解析后必须按高程升序、非法项丢弃
          'X-Dem-Legend': '[[8,"#f08a5d"],[-60,"#1d5fa8"],["x","#000000"],[0,"#e6f4f8"]]',
        }),
      ),
    );

    const preview = await fetchDemPreview('tiff/a.tif', { ramp: 'hypsometric' });

    expect(preview.meta.ramp).toBe('hypsometric');
    expect(preview.meta.legendStops).toEqual([
      [-60, '#1d5fa8'],
      [0, '#e6f4f8'],
      [8, '#f08a5d'],
    ]);
  });

  it('缺 X-Dem-Ramp 时按灰度处理，图例不至于空着', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => pngResponse()));

    const preview = await fetchDemPreview('tiff/a.tif');

    expect(preview.meta.ramp).toBe('gray');
    expect(preview.meta.legendStops).toEqual([]);
  });
});

describe('demLegendGradient', () => {
  function meta(overrides: Partial<DemPreviewMeta>): DemPreviewMeta {
    return {
      west: 0, south: 0, east: 1, north: 1, width: 1, height: 1,
      min: null, max: null, low: null, high: null, nodata: null, nodataRatio: null,
      ramp: 'gray', legendStops: [],
      ...overrides,
    };
  }

  it('灰度配色用固定两端色', () => {
    const gradient = demLegendGradient(meta({ min: -50, max: 10 }));
    expect(gradient).toContain('rgb(14,14,14)');
    expect(gradient).toContain('rgb(208,208,208)');
  });

  it('分层设色按本图 min~max 把断点映射成百分比，并夹在 0~100%', () => {
    const gradient = demLegendGradient(meta({
      min: -60,
      max: 10,
      ramp: 'hypsometric',
      legendStops: [
        [-80, '#08306b'],
        [-20, '#78b4d8'],
        [30, '#9e1c26'],
      ],
    }));

    // -80 低于 min ⇒ 0%；-20 落在 40/70 ⇒ 57.1%；30 高于 max ⇒ 100%
    expect(gradient).toBe(
      'linear-gradient(90deg, #08306b 0.0%, #78b4d8 57.1%, #9e1c26 100.0%)',
    );
  });
});
