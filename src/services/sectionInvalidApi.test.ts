import { afterEach, describe, expect, it, vi } from 'vitest';
import { setSectionManualInvalid } from './sectionInvalidApi';

/**
 * 「人工无效」接口的前端契约。
 *
 * 只测三件会直接伤到用户的事：
 *   1. 请求体字段名必须是 `section_ids`（服务端 record 里就是这个 @JsonProperty，
 *      写成 sectionIds 会被 Jackson 当成未知字段直接忽略 ⇒ invalid 缺失 ⇒ 400）；
 *   2. 恢复有效必须能把 `invalid: false` 发出去 —— 用 `if (params.invalid)` 之类的短路
 *      会把「恢复」变成「什么都不发」，界面上按钮变了、库里没变；
 *   3. `updated < requested` 必须原样返回，让调用方能提示「有 N 条没生效」而不是假装成功。
 */

const mockFetch = (status: number, body: unknown) => {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal('fetch', fn);
  return fn;
};

const sentBody = (fn: ReturnType<typeof vi.fn>) => {
  const init = fn.mock.calls[0]?.[1] as { body?: string } | undefined;
  return JSON.parse(String(init?.body ?? '{}'));
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('setSectionManualInvalid', () => {
  it('标记无效时按 section_ids 发送，并带上原因', async () => {
    const fn = mockFetch(200, { success: true, requested: 1, updated: 1, invalid: true });

    const res = await setSectionManualInvalid({
      sectionIds: ['sec-a', '  sec-b  ', 'sec-a', ''],
      invalid: true,
      reason: '线位偏移，先摘出去',
    });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(String(fn.mock.calls[0][0])).toBe('/v0/bank/sections/manual-invalid');
    expect((fn.mock.calls[0][1] as { method?: string }).method).toBe('PUT');

    const body = sentBody(fn);
    // 去空、去重、去首尾空格：批量操作的 id 来自 DOM 文本，脏值不能带到 SQL 的 IN 列表里
    expect(body.section_ids).toEqual(['sec-a', 'sec-b']);
    expect(body.invalid).toBe(true);
    expect(body.reason).toBe('线位偏移，先摘出去');

    expect(res).toEqual({ requested: 1, updated: 1, invalid: true });
  });

  it('恢复有效时 invalid=false 必须真的发出去', async () => {
    const fn = mockFetch(200, { success: true, requested: 1, updated: 1, invalid: false });

    await setSectionManualInvalid({ sectionIds: ['sec-a'], invalid: false });

    const body = sentBody(fn);
    // false 是最容易被 `if (x)` 短路掉的值；一旦被短路，后端会 400（invalid 必填），
    // 表现就是"点了恢复没反应"
    expect(body.invalid).toBe(false);
    expect(body.reason).toBeUndefined();
  });

  it('空 id 列表不发请求', async () => {
    const fn = mockFetch(200, {});
    await expect(setSectionManualInvalid({ sectionIds: ['', '  '], invalid: true }))
      .rejects.toThrow('没有选中任何断面');
    expect(fn).not.toHaveBeenCalled();
  });

  it('失败时把后端 message 透出，而不是"HTTP 400"', async () => {
    mockFetch(400, { error: { code: 'BAD_REQUEST', message: 'invalid 必填：true = 标记无效，false = 恢复有效' } });

    await expect(setSectionManualInvalid({ sectionIds: ['sec-a'], invalid: true }))
      .rejects.toThrow('invalid 必填');
  });

  it('updated 少于 requested 时如实返回，供调用方提示部分失败', async () => {
    mockFetch(200, { success: true, requested: 3, updated: 1, invalid: true });

    const res = await setSectionManualInvalid({ sectionIds: ['a', 'b', 'c'], invalid: true });

    // 不能"按请求条数回填成功"：另外 2 条是越权或已删，图上不会变，
    // 用户看到的必须是"只改了 1 条"，而不是全部成功
    expect(res.requested).toBe(3);
    expect(res.updated).toBe(1);
  });
});
