import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('antd', () => ({
  message: {
    loading: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('../../utils/apiClient', () => ({
  authHeaders: () => ({ Authorization: 'Bearer test-token' }),
}));

import {
  __resetSectionRecomputeState,
  recomputeSectionAfterGeometryChange,
  scheduleSectionRecompute,
} from './sectionRecompute';

/** 造一个够用的 Response 替身。 */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** 手动控制的 fetch：每次调用挂起，由测试决定何时返回。 */
function deferredFetch() {
  const pending: Array<(value: Response) => void> = [];
  const fetchMock = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        pending.push(resolve);
      }),
  );
  return { fetchMock, pending };
}

describe('recomputeSectionAfterGeometryChange', () => {
  beforeEach(() => {
    __resetSectionRecomputeState();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('单次调用把 computed 与风险等级透出来', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ status: 'computed', risk_level: 3 })));

    const outcome = await recomputeSectionAfterGeometryChange('sec-1');

    expect(outcome).toEqual({ status: 'computed', riskLevel: 3 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch as any).mock.calls[0][0]).toBe('/v0/bank/sections/sec-1/recompute');
    expect((fetch as any).mock.calls[0][1].method).toBe('POST');
  });

  it('同一断面在途时不并发发第二次，完成后用最新几何补算一次', async () => {
    const { fetchMock, pending } = deferredFetch();
    vi.stubGlobal('fetch', fetchMock);

    const first = recomputeSectionAfterGeometryChange('sec-1');
    const second = recomputeSectionAfterGeometryChange('sec-1');

    // 复用同一个 Promise，且只发出一次请求：后端对同一断面并发重算是 409，堆起来只是白烧模型调用
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    pending[0](jsonResponse({ status: 'computed', risk_level: 2 }));
    await first;
    await Promise.resolve();

    // 第一次收尾时看到「在途期间又变过」，于是补发一次
    expect(fetchMock).toHaveBeenCalledTimes(2);
    pending[1](jsonResponse({ status: 'computed', risk_level: 4 }));
  });

  it('409 视为 skipped 而不是失败（任务正在运行是正常状态）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'TASK_RUNNING' } }, 409)));

    const outcome = await recomputeSectionAfterGeometryChange('sec-1');

    expect(outcome.status).toBe('skipped');
    expect(outcome.errorMessage).toContain('任务正在运行');
  });

  it('业务失败把错误码与原因带出来', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          status: 'failed',
          error_code: 'DEM_COVERAGE_INSUFFICIENT',
          error_message: '断面落在 DEM 无数据区域内',
        }),
      ),
    );

    const outcome = await recomputeSectionAfterGeometryChange('sec-1');

    expect(outcome).toMatchObject({
      status: 'failed',
      errorCode: 'DEM_COVERAGE_INSUFFICIENT',
      errorMessage: '断面落在 DEM 无数据区域内',
    });
  });

  it('网络层异常也归到 failed，不抛出', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Failed to fetch');
      }),
    );

    const outcome = await recomputeSectionAfterGeometryChange('sec-1');

    expect(outcome.status).toBe('failed');
    expect(outcome.errorMessage).toBe('Failed to fetch');
  });

  it('一条断面失败不影响另一条', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('sec-bad')
          ? jsonResponse({ status: 'failed', error_message: 'boom' })
          : jsonResponse({ status: 'computed', risk_level: 1 }),
      ),
    );

    const [bad, good] = await Promise.all([
      recomputeSectionAfterGeometryChange('sec-bad'),
      recomputeSectionAfterGeometryChange('sec-good'),
    ]);

    expect(bad.status).toBe('failed');
    expect(good).toEqual({ status: 'computed', riskLevel: 1 });
  });
});

describe('scheduleSectionRecompute', () => {
  beforeEach(() => {
    __resetSectionRecomputeState();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('没有历史结果时不触发重算（新建断面不必烧模型调用）', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    scheduleSectionRecompute('sec-new', false);
    scheduleSectionRecompute('sec-new', undefined);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('没有 sectionId 时安全退出', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    scheduleSectionRecompute(undefined, true);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
