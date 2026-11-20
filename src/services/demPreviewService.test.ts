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
import { DEM_PREVIEW_COLORS, fetchDemPreview, releaseDemPreview } from './demPreviewService';

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
});
