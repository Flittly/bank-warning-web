import { afterEach, describe, expect, it, vi } from 'vitest';
import { newTaskId } from './taskId';

/**
 * 任务标识生成契约。
 *
 * 历史 `task-${Date.now()}` 可碰撞、可预测，改为 `task-` + UUID v4：
 *  - 前缀固定为 `task-`，便于链路日志与既有数据辨识；
 *  - 后半段必须是 36 位标准 UUID v4（8-4-4-4-12），版本位 = 4、变体位 ∈ {8,9,a,b}；
 *  - 高并发下多次生成不得碰撞。
 */
describe('newTaskId', () => {
  const UUID_V4_RE =
    /^task-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('固定以 task- 前缀开头', () => {
    expect(newTaskId().startsWith('task-')).toBe(true);
  });

  it('后半段是 36 位标准 UUID v4', () => {
    for (let i = 0; i < 100; i++) {
      expect(newTaskId()).toMatch(UUID_V4_RE);
    }
  });

  it('总长度 41（5 前缀 + 36 uuid），远小于数据库 VARCHAR(100) 上限', () => {
    const id = newTaskId();
    expect(id.length).toBe(41);
    expect(id.length).toBeLessThanOrEqual(100);
  });

  it('连续生成 10000 次不碰撞', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10000; i++) {
      const id = newTaskId();
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });

  it('不再包含时间戳形态（避免回归到可预测实现）', () => {
    // 旧实现形如 task-1792030029572，是一串纯数字；新实现必须含连字符分段的 uuid
    const id = newTaskId();
    expect(id).not.toMatch(/^task-\d+$/);
  });
});

/**
 * secure context 缺失时的降级（生产事故回归测试）。
 *
 * 现场：部署后用 `http://192.168.245.153:8080` 访问（明文 HTTP + 局域网 IP），
 * 浏览器不把该页面判为 secure context ⇒ `crypto.randomUUID` 是 `undefined` ⇒
 * `TypeError: crypto.randomUUID is not a function` ⇒「生成断面失败」，一条断面都建不出来。
 *
 * 本地开发用 `http://localhost:5173`／`8090` 时 localhost 属于安全上下文，
 * 所以开发期永远复现不了 —— 这类缺陷只能靠这组"故意把 randomUUID 摘掉"的测试来守。
 */
describe('newTaskId — secure context 缺失时的降级', () => {
  const UUID_V4_RE =
    /^task-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** 模拟非 secure context：crypto 对象在，但 randomUUID 是 undefined。 */
  const stubNonSecureCrypto = () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
        return arr;
      },
    });
  };

  it('crypto.randomUUID 缺失时不再抛错，仍产出合法 uuid v4', () => {
    stubNonSecureCrypto();
    expect(() => newTaskId()).not.toThrow();
    for (let i = 0; i < 200; i++) {
      expect(newTaskId()).toMatch(UUID_V4_RE);
    }
  });

  it('版本位固定为 4、变体位落在 8/9/a/b（不是"长得像"就行）', () => {
    stubNonSecureCrypto();
    for (let i = 0; i < 500; i++) {
      const hex = newTaskId().slice('task-'.length).replace(/-/g, '');
      expect(hex[12]).toBe('4'); // 版本位：第 13 个 hex 字符
      expect(['8', '9', 'a', 'b']).toContain(hex[16]); // 变体位：第 17 个 hex 字符
    }
  });

  it('降级路径同样 10000 次不碰撞', () => {
    stubNonSecureCrypto();
    const seen = new Set<string>();
    for (let i = 0; i < 10000; i++) {
      const id = newTaskId();
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });

  it('连 getRandomValues 都没有时也不抛错（最后兜底），且格式不变', () => {
    vi.stubGlobal('crypto', {});
    expect(() => newTaskId()).not.toThrow();
    expect(newTaskId()).toMatch(UUID_V4_RE);
  });

  it('crypto 完全不存在（如某些非浏览器宿主）时也不抛错', () => {
    vi.stubGlobal('crypto', undefined);
    expect(() => newTaskId()).not.toThrow();
    expect(newTaskId()).toMatch(UUID_V4_RE);
  });
});
