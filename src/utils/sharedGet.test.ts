import { afterEach, describe, expect, it, vi } from 'vitest';
import { sharedGetJSON, sharedGetText } from './sharedGet';

/**
 * 请求合并的契约。
 *
 * 背景：编辑器一次挂载里 EditorPage 与 ResourceSidebar 各自拉
 * `/v0/bank/banks`（184 KB）与 `/v0/bank/basic-params`，线上日志每次进页面都是 x2。
 * 这里锁住三件事：并发只发一次、落地后不再复用（不吃旧数据）、失败不缓存。
 */

function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  const fn = vi.fn(handler);
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('sharedGet / 在途合并', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('同一 URL 并发两次只发一次网络请求，两边都拿到完整数据', async () => {
    let calls = 0;
    stubFetch(async () => {
      calls += 1;
      // 故意延迟，确保两次调用确实重叠在「在途」窗口内
      await new Promise((r) => setTimeout(r, 10));
      return new Response(JSON.stringify({ banks: [{ bank_id: 'a' }] }), { status: 200 });
    });

    const [first, second] = await Promise.all([
      sharedGetJSON('/v0/bank/banks'),
      sharedGetJSON('/v0/bank/banks'),
    ]);

    expect(calls).toBe(1);
    expect(first).toEqual(second);
    // 各调用方独立 JSON.parse，拿到不同对象引用，不会一方改动影响另一方
    expect(first).not.toBe(second);
  });

  it('请求落地后立刻失效：下一次调用重新请求（不缓存，避免读到写前的旧数据）', async () => {
    let calls = 0;
    stubFetch(async () => {
      calls += 1;
      return new Response(JSON.stringify({ n: calls }), { status: 200 });
    });

    const a = await sharedGetJSON('/v0/bank/banks');
    const b = await sharedGetJSON('/v0/bank/banks');

    expect(calls).toBe(2);
    expect(a.n).toBe(1);
    expect(b.n).toBe(2);
  });

  it('不同身份不合并（Authorization 进合并键，多用户不能串数据）', async () => {
    const seen: string[] = [];
    stubFetch(async (_url, init) => {
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? '';
      seen.push(auth);
      await new Promise((r) => setTimeout(r, 5));
      return new Response(JSON.stringify({ auth }), { status: 200 });
    });

    const [a, b] = await Promise.all([
      sharedGetJSON('/v0/bank/banks', { Authorization: 'Bearer token-a' }),
      sharedGetJSON('/v0/bank/banks', { Authorization: 'Bearer token-b' }),
    ]);

    expect(seen).toHaveLength(2);
    expect(a.auth).toBe('Bearer token-a');
    expect(b.auth).toBe('Bearer token-b');
  });

  it('失败会清掉在途条目：不会让后续调用拿到同一个 rejected Promise', async () => {
    let calls = 0;
    stubFetch(async () => {
      calls += 1;
      if (calls === 1) return new Response('boom', { status: 500, statusText: 'Internal Server Error' });
      return new Response('ok', { status: 200 });
    });

    await expect(sharedGetText('/v0/bank/banks')).rejects.toThrow(/500/);
    await expect(sharedGetText('/v0/bank/banks')).resolves.toBe('ok');
    expect(calls).toBe(2);
  });
});
