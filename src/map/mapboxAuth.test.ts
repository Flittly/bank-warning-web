import { describe, expect, it, vi } from 'vitest';
import { disableMapboxAuthCheck } from './mapboxAuth';

/**
 * 回归锁：mapbox-gl v3 在首帧渲染完成、地图刚 idle 时会调用私有方法 `_authenticate()`
 * 校验 token；没有 token 时它 `gl.clear()` 清空整块画布，表现为「底图闪一下、随后
 * 连岸线断面一起全白」。这两条用例保证 patch 生效，且私有方法改名时不会抛错。
 */
describe('disableMapboxAuthCheck', () => {
  it('把 _authenticate 换成空操作（原实现会清屏）', () => {
    const original = vi.fn();
    const map = { _authenticate: original } as unknown as Parameters<typeof disableMapboxAuthCheck>[0];

    disableMapboxAuthCheck(map);

    const patched = (map as unknown as { _authenticate: () => void })._authenticate;
    expect(patched).not.toBe(original);
    expect(patched()).toBeUndefined();
    expect(original).not.toHaveBeenCalled();
  });

  it('私有方法不存在时安静跳过，不抛错（mapbox 升级改名也安全）', () => {
    const map = {} as unknown as Parameters<typeof disableMapboxAuthCheck>[0];
    expect(() => disableMapboxAuthCheck(map)).not.toThrow();
  });
});
