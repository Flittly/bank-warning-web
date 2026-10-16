import { describe, expect, it } from 'vitest';
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
