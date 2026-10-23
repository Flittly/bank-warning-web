/**
 * 选区几何构造的纯函数测试。
 *
 * <p>只测 `polygonFromPoints`：画框的事件绑定部分依赖真实 mapbox 实例（没有 jsdom+mock 的
 * 价值），而「点几下算一个合法选区」是会被复用的规则，必须钉住。
 */
import { describe, expect, it } from 'vitest';

import { polygonFromPoints } from './areaSelection';

describe('polygonFromPoints', () => {
  it('三个点组成闭合环（首尾补第一个点）', () => {
    const poly = polygonFromPoints([[119.2, 32.2], [119.4, 32.2], [119.4, 32.4]]);
    expect(poly).not.toBeNull();
    const ring = (poly as GeoJSON.Feature<GeoJSON.Polygon>).geometry.coordinates[0];
    expect(ring.length).toBe(4);
    expect(ring[0]).toEqual(ring[3]);
  });

  it('不足三个点返回 null（"点两下"不算选区）', () => {
    expect(polygonFromPoints([[119.2, 32.2], [119.4, 32.4]])).toBeNull();
    expect(polygonFromPoints([])).toBeNull();
  });

  it('共线三点面积为 0，返回 null', () => {
    expect(polygonFromPoints([[119.2, 32.2], [119.3, 32.2], [119.4, 32.2]])).toBeNull();
  });

  it('相邻重复点被去掉，剩下的三点仍能成环', () => {
    const poly = polygonFromPoints([
      [119.2, 32.2], [119.2, 32.2], [119.4, 32.2], [119.4, 32.4],
    ]);
    expect(poly).not.toBeNull();
    expect((poly as GeoJSON.Feature<GeoJSON.Polygon>).geometry.coordinates[0].length).toBe(4);
  });

  it('非法坐标（NaN / 越界字符串）返回 null，不抛错', () => {
    expect(polygonFromPoints([[NaN, 32.2], [119.4, 32.2], [119.4, 32.4]])).toBeNull();
    expect(polygonFromPoints([[119.2, 32.2], [undefined as any, 32.2], [119.4, 32.4]])).toBeNull();
  });
});
