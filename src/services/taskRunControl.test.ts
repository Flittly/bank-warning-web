import { describe, it, expect } from 'vitest';
import { extractErrorMessage, interpretCancelResponse } from './taskRunControl';

describe('终止任务 · 错误文案提取', () => {
  it('两种响应体形状都能抠出一句话，不能吐出 [object Object]', () => {
    expect(extractErrorMessage({ message: '直给' })).toBe('直给');
    // 本仓全局异常处理器的形状
    expect(extractErrorMessage({ error: { code: 'INTERNAL_ERROR', message: '没这个接口' } })).toBe('没这个接口');
    // 防御：error 是字符串
    expect(extractErrorMessage({ error: '裸字符串' })).toBe('裸字符串');
    expect(extractErrorMessage(null)).toBe('');
    expect(extractErrorMessage({})).toBe('');

    const wrapped = interpretCancelResponse(500, { error: { code: 'INTERNAL_ERROR', message: '没这个接口' } });
    expect(wrapped.ok).toBe(false);
    expect(wrapped.message).toContain('没这个接口');
    expect(wrapped.message).not.toContain('object');
  });
});

describe('终止任务 · 响应判定', () => {
  it('cooperative：只受理不代劳，必须报"正在停止"而不是"已终止"', () => {
    const r = interpretCancelResponse(200, { mode: 'cooperative', status: 'running', message: '已请求终止' });
    expect(r.ok).toBe(true);
    expect(r.kind).toBe('stopping');
    expect(r.status).toBe('running');
    expect(r.message).toBe('已请求终止');
  });

  it('cooperative 不带 message 时给一条说明后果的兜底文案', () => {
    const r = interpretCancelResponse(200, { mode: 'cooperative' });
    expect(r.kind).toBe('stopping');
    expect(r.message).toContain('算完后停止');
    expect(r.message).toContain('保留');
  });

  it('stale：进程已死的僵尸，服务端当场收尾 ⇒ 这一刻就算终止完成', () => {
    const r = interpretCancelResponse(200, { mode: 'stale', status: 'cancelled' });
    expect(r.ok).toBe(true);
    expect(r.kind).toBe('stale-cleared');
    expect(r.status).toBe('cancelled');
    expect(r.message).toContain('已终止');
  });

  it('not-running：本来就没跑，属于"已经达成目的"而不是失败', () => {
    const r = interpretCancelResponse(200, { mode: 'not-running', status: 'completed' });
    expect(r.ok).toBe(true);
    expect(r.kind).toBe('not-running');
    expect(r.status).toBe('completed');
  });

  it('200 但 mode 不认识 ⇒ 当失败：宁可报错也不给假绿灯', () => {
    const r = interpretCancelResponse(200, { status: 'running' });
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('error');
    expect(r.message).toContain('无法识别');

    expect(interpretCancelResponse(200, null).ok).toBe(false);
    expect(interpretCancelResponse(200, { mode: 'weird' }).ok).toBe(false);
  });

  it('权限问题单独成文案（401/403），不要和"任务不存在"混在一起', () => {
    for (const code of [401, 403]) {
      const r = interpretCancelResponse(code, null);
      expect(r.ok).toBe(false);
      expect(r.kind).toBe('error');
      expect(r.message).toContain('权限');
    }
  });

  it('404 说明任务已被删；其它 5xx/4xx 带上服务端 detail', () => {
    expect(interpretCancelResponse(404, null).message).toContain('不存在');
    expect(interpretCancelResponse(500, { message: 'boom' }).message).toContain('boom');
    expect(interpretCancelResponse(503, null).message).toContain('503');
    // 状态码不是 2xx 就一定是失败，哪怕 body 里装着一份看似正常的 mode
    const spoof = interpretCancelResponse(500, { mode: 'stale', message: 'ok' });
    expect(spoof.ok).toBe(false);
    expect(spoof.kind).toBe('error');
  });

  it('HTTP 状态异常值（0/NaN）也走失败分支', () => {
    expect(interpretCancelResponse(0, null).ok).toBe(false);
    expect(interpretCancelResponse(NaN, null).ok).toBe(false);
  });
});
