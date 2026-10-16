import { describe, expect, it } from 'vitest';
import type { FeatureCollection } from 'geojson';
import { isDemBoundsShown, resolveVisibleTiffBounds, toggleDemBounds } from './tiffBoundsView';

const A = 'tiff/Yangtze/2018/standard/1998-2018/2018-Yangtze-uvhH.tif';
const B = 'tiff/YZ/2018/standard/201804/2018-YZ.tif';

const bounds: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { tiff_key: A }, geometry: null },
    { type: 'Feature', properties: { tiff_key: B }, geometry: null },
  ] as any,
};

const keysOf = (fc: FeatureCollection | null) =>
  (fc?.features || []).map((f: any) => f.properties?.tiff_key);

describe('resolveVisibleTiffBounds', () => {
  it('还没取到全库范围时返回 null（让地图保持空 source）', () => {
    expect(resolveVisibleTiffBounds({ showTiffBounds: true, tiffBoundsData: null, focusedDemKeys: [A] }))
      .toBeNull();
  });

  it('聚焦一条时只给这一条', () => {
    const out = resolveVisibleTiffBounds({ showTiffBounds: true, tiffBoundsData: bounds, focusedDemKeys: [A] });
    expect(keysOf(out)).toEqual([A]);
  });

  it('聚焦多条时给这几条', () => {
    const out = resolveVisibleTiffBounds({ showTiffBounds: true, tiffBoundsData: bounds, focusedDemKeys: [A, B] });
    expect(keysOf(out)).toEqual([A, B]);
  });

  it('没有聚焦时给全量（「显示全部」是明确语义，不是漏出来的）', () => {
    const out = resolveVisibleTiffBounds({ showTiffBounds: true, tiffBoundsData: bounds, focusedDemKeys: null });
    expect(keysOf(out)).toEqual([A, B]);
    expect(out).toBe(bounds);
  });

  it('空数组与 null 等价：都表示全部', () => {
    expect(keysOf(resolveVisibleTiffBounds({ showTiffBounds: true, tiffBoundsData: bounds, focusedDemKeys: [] })))
      .toEqual([A, B]);
  });

  it('聚焦到一个库里不存在的 key 时给空集合，而不是退回全量', () => {
    const out = resolveVisibleTiffBounds({
      showTiffBounds: true,
      tiffBoundsData: bounds,
      focusedDemKeys: ['tiff/不存在.tif'],
    });
    expect(keysOf(out)).toEqual([]);
  });

  // —— 这一条是这次 bug 的回归测试 ——
  // 关掉开关时必须喂空集合：以前数据留在 source 里、只靠图层 visibility 隐藏，
  // 一旦可见性 effect 因 isStyleLoaded() 早退，就会把全库 DEM 画到图上。
  it('关闭开关时给空集合（不把全量留在 source 里）', () => {
    const out = resolveVisibleTiffBounds({ showTiffBounds: false, tiffBoundsData: bounds, focusedDemKeys: null });
    expect(keysOf(out)).toEqual([]);
  });

  it('关闭开关时即使还聚焦着某一条也不画', () => {
    const out = resolveVisibleTiffBounds({ showTiffBounds: false, tiffBoundsData: bounds, focusedDemKeys: [A] });
    expect(keysOf(out)).toEqual([]);
  });

  it('feature 缺 properties 时不炸（后端几何异常时也要稳）', () => {
    const weird: FeatureCollection = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: null, geometry: null }, ...(bounds.features as any)],
    } as any;
    const out = resolveVisibleTiffBounds({ showTiffBounds: true, tiffBoundsData: weird, focusedDemKeys: [A] });
    expect(keysOf(out)).toEqual([A]);
  });
});

// —— 资源树上那个「显示/隐藏 TIF 范围」开关的语义 ——
// 用户的要求：这是**某一条 DEM 行上的开关**，所以它只管这一条；
// 再点一次 = 关掉它自己，绝不能变成"把全库画出来"。
describe('toggleDemBounds', () => {
  const off = { showTiffBounds: false, focusedDemKeys: null };

  it('本来没显示时点一条 → 只打开这一条', () => {
    expect(toggleDemBounds(off, A)).toEqual({ showTiffBounds: true, focusedDemKeys: [A] });
  });

  it('同一条点第二下 → 关掉，并且总开关一起关（这就是用户要的"关掉"）', () => {
    const once = toggleDemBounds(off, A);
    expect(toggleDemBounds(once, A)).toEqual({ showTiffBounds: false, focusedDemKeys: null });
  });

  it('连着点两次回到原点（幂等可逆）', () => {
    const twice = toggleDemBounds(toggleDemBounds(off, A), A);
    expect(twice).toEqual(off);
  });

  it('已开 A 时点 B → A 不受影响，两条都显示', () => {
    const next = toggleDemBounds({ showTiffBounds: true, focusedDemKeys: [A] }, B);
    expect(next).toEqual({ showTiffBounds: true, focusedDemKeys: [A, B] });
  });

  it('两条都在时关掉其中一条 → 另一条还在', () => {
    const next = toggleDemBounds({ showTiffBounds: true, focusedDemKeys: [A, B] }, A);
    expect(next).toEqual({ showTiffBounds: true, focusedDemKeys: [B] });
  });

  it('关掉最后一条 → 总开关跟着关，不留"开关亮着但图上空的"状态', () => {
    const next = toggleDemBounds({ showTiffBounds: true, focusedDemKeys: [A] }, A);
    expect(next.showTiffBounds).toBe(false);
    expect(next.focusedDemKeys).toBeNull();
  });

  it('当前是"全部"时点某一条 → 收窄到这一条（无从表达"除了它"的意图）', () => {
    expect(toggleDemBounds({ showTiffBounds: true, focusedDemKeys: null }, A))
      .toEqual({ showTiffBounds: true, focusedDemKeys: [A] });
  });

  it('没有 key（文件夹行的开关）→ 退化成总开关', () => {
    expect(toggleDemBounds(off, null)).toEqual({ showTiffBounds: true, focusedDemKeys: null });
    expect(toggleDemBounds({ showTiffBounds: true, focusedDemKeys: [A] }, ''))
      .toEqual({ showTiffBounds: false, focusedDemKeys: [A] });
  });

  it('key 前后带空格也能对上同一条（归一后比较）', () => {
    const once = toggleDemBounds(off, A);
    expect(once).toEqual({ showTiffBounds: true, focusedDemKeys: [A] });
    // 再点一次、这次 key 带空格 → 仍然算同一条，关掉
    const twice = toggleDemBounds(once, `  ${A}  `);
    expect(twice).toEqual({ showTiffBounds: false, focusedDemKeys: null });
  });
});

describe('isDemBoundsShown（树上"已开"高亮的依据）', () => {
  it('总开关关着 → 都不算显示', () => {
    expect(isDemBoundsShown({ showTiffBounds: false, focusedDemKeys: [A] }, A)).toBe(false);
  });

  it('聚焦时只对命中的那一条为真', () => {
    const s = { showTiffBounds: true, focusedDemKeys: [A] };
    expect(isDemBoundsShown(s, A)).toBe(true);
    expect(isDemBoundsShown(s, B)).toBe(false);
  });

  it('全部模式（null）下每条都为真', () => {
    const s = { showTiffBounds: true, focusedDemKeys: null };
    expect(isDemBoundsShown(s, A)).toBe(true);
    expect(isDemBoundsShown(s, B)).toBe(true);
  });

  it('空 key 或空数组不误判', () => {
    expect(isDemBoundsShown({ showTiffBounds: true, focusedDemKeys: [A] }, '')).toBe(false);
    // 空数组按"全部"处理（与 resolveVisibleTiffBounds 一致）
    expect(isDemBoundsShown({ showTiffBounds: true, focusedDemKeys: [] }, A)).toBe(true);
  });
});
