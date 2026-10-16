import { describe, expect, it } from 'vitest';
import { DEFAULT_REQUEST_CONCURRENCY, isNetworkLevelError, mapWithConcurrency } from './concurrency';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('mapWithConcurrency', () => {
  it('按输入顺序返回结果，不因完成先后乱序', async () => {
    const items = [40, 5, 20, 1, 10];
    const out = await mapWithConcurrency(items, 3, async (ms) => {
      await sleep(ms);
      return ms;
    });
    expect(out).toEqual(items);
  });

  it('并发度不超过 limit（这是本工具存在的唯一理由）', async () => {
    let running = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 30 }, (_, i) => i), 6, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await sleep(1);
      running -= 1;
      return null;
    });
    expect(peak).toBeLessThanOrEqual(6);
    expect(peak).toBeGreaterThan(1);
  });

  it('空数组不启动 worker，直接返回空', async () => {
    let called = 0;
    const out = await mapWithConcurrency([], 6, async () => {
      called += 1;
      return 1;
    });
    expect(out).toEqual([]);
    expect(called).toBe(0);
  });

  it('limit 大于条目数 / 非法值都被安全收敛', async () => {
    const items = [1, 2, 3];
    expect(await mapWithConcurrency(items, 999, async (v) => v * 2)).toEqual([2, 4, 6]);
    expect(await mapWithConcurrency(items, 0, async (v) => v)).toEqual([1, 2, 3]);
  });

  it('onProgress 累计到 total', async () => {
    const seen: number[] = [];
    await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (v) => v, (done, total) => {
      expect(total).toBe(5);
      seen.push(done);
    });
    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });

  it('默认并发常量为 6（与浏览器同源 HTTP/1.1 连接上限对齐）', () => {
    expect(DEFAULT_REQUEST_CONCURRENCY).toBe(6);
  });
});

describe('isNetworkLevelError', () => {
  it('识别 fetch 被浏览器拒绝的 TypeError: Failed to fetch', () => {
    expect(isNetworkLevelError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkLevelError(new TypeError('Load failed'))).toBe(true);
    expect(isNetworkLevelError(new Error('net::ERR_INSUFFICIENT_RESOURCES'))).toBe(true);
  });

  it('不把后端真实返回的 4xx/5xx 当作网络层错误（不可重试）', () => {
    expect(isNetworkLevelError(new Error('500 Internal Server Error'))).toBe(false);
    expect(isNetworkLevelError(new Error('403 Forbidden'))).toBe(false);
    expect(isNetworkLevelError(undefined)).toBe(false);
  });
});
