import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyTask, describeCopyResult, type TaskCopyResult } from './taskCopyService';

/**
 * 任务复制的前端契约。
 *
 * 只测两件会直接伤到用户的事：
 *   1. 失败时把后端 code 带出来 —— 「换名字再试」和「任务没了」必须能区分；
 *   2. 回执必须把 warnings 露出来 —— 「源任务在跑所以副本不含结果」这类事，
 *      不显示就等于没说，用户会以为复制丢了数据。
 */

const okBody: TaskCopyResult = {
  success: true,
  task_id: 'task-3f1c9a7e-5b2d-4c8a-9e01-77aa2b6c4d33',
  task_name: '岸线分析任务 - 副本',
  source_task_id: 'task-1792030029572',
  counts: { params: 1, sections: 398, results: 0, profiles: 0 },
  warnings: [],
  idempotent: false,
  elapsed_ms: 118,
};

const mockFetch = (status: number, body: unknown, raw?: string) => {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'x',
    text: async () => (raw !== undefined ? raw : JSON.stringify(body)),
  });
  vi.stubGlobal('fetch', fn);
  return fn;
};

beforeEach(() => {
  // authHeaders() 会读 localStorage 里的 access_token；本仓的 vitest 跑在 node 环境（无 jsdom），
  // 这里给一个空实现即可 —— 这条链路测的是请求形状与错误码，不测鉴权。
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: 0,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('copyTask', () => {
  it('POST 到 /tasks/{id}/copy 并回传 counts', async () => {
    const fn = mockFetch(200, okBody);
    const result = await copyTask('task-1792030029572', { task_name: '副本', include_results: false });

    expect(result.counts.sections).toBe(398);
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/v0/bank/tasks/task-1792030029572/copy');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ task_name: '副本', include_results: false });
  });

  it('409 把后端 code 带出来，前端才能提示「换个名字」或「等跑完」', async () => {
    mockFetch(409, { error: { code: 'SOURCE_RUNNING', message: '源任务正在运行' } });
    await expect(copyTask('t1', { include_results: true })).rejects.toThrow(/SOURCE_RUNNING/);
  });

  it('非 JSON 响应不抛 SyntaxError，改成带状态码的可读错误', async () => {
    mockFetch(500, null, '<html>500</html>');
    await expect(copyTask('t1')).rejects.toThrow(/HTTP 500/);
  });
});

describe('describeCopyResult', () => {
  it('只复制配置时只报断面数与参数份数', () => {
    const text = describeCopyResult(okBody);
    expect(text).toContain('398 条断面');
    expect(text).toContain('1 份参数');
    expect(text).not.toContain('条结果');
  });

  it('复制结果时带上结果与剖面条数', () => {
    const text = describeCopyResult({ ...okBody, counts: { ...okBody.counts, results: 302, profiles: 302 } });
    expect(text).toContain('302 条结果');
    expect(text).toContain('302 条剖面');
  });

  it('warnings 必须出现在回执里', () => {
    const text = describeCopyResult({
      ...okBody,
      warnings: [{ code: 'SOURCE_RUNNING', message: '源任务正在运行，副本仅复制配置' }],
    });
    expect(text).toContain('源任务正在运行');
  });
});
