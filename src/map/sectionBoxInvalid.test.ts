/**
 * 框选设为无效的判定单测。
 *
 * <p>这里钉的是**口径**，不是实现：起点在框内（含边界）才算命中、线与框相交不算、
 * 撤销只回滚先验有效的那批。这三条任意一条被改，用户看到的"我框住的没变灰"
 * 或"撤销把别的也放出来了"都会重现，而且只在真机上才看得出来。
 */
import { describe, expect, it } from 'vitest';

import {
  boxMatchFeatures,
  pickSectionIdsByStartPoint,
  pointInBoxInclusive,
  raiseSectionBoxMatchLayers,
  sectionBoxBoundsOf,
  sectionBoxInvalidConfirmText,
  sectionBoxInvalidEmptyHint,
  splitBoxInvalidByPriorState,
  type SectionBoxCandidate,
} from './sectionBoxInvalid';
import type { BoxBounds } from './boxSelection';

const BOX: BoxBounds = { west: 119.0, east: 119.2, south: 32.0, north: 32.2 };

/** 断面：起点 = 几何首点（岸侧端点）。 */
const section = (
  id: string,
  start: [number, number],
  end: [number, number] = [119.5, 32.5],
  extra: Partial<SectionBoxCandidate> = {},
): SectionBoxCandidate => ({
  section_id: id,
  geometry: { type: 'LineString', coordinates: [start, end] },
  ...extra,
});

describe('pointInBoxInclusive', () => {
  it('内部命中', () => {
    expect(pointInBoxInclusive(119.1, 32.1, BOX)).toBe(true);
  });

  it('四条边与四个角都算命中（边界含在内）', () => {
    expect(pointInBoxInclusive(119.0, 32.1, BOX)).toBe(true); // 西边
    expect(pointInBoxInclusive(119.2, 32.1, BOX)).toBe(true); // 东边
    expect(pointInBoxInclusive(119.1, 32.0, BOX)).toBe(true); // 南边
    expect(pointInBoxInclusive(119.1, 32.2, BOX)).toBe(true); // 北边
    expect(pointInBoxInclusive(119.0, 32.0, BOX)).toBe(true); // 西南角
    expect(pointInBoxInclusive(119.2, 32.2, BOX)).toBe(true); // 东北角
  });

  it('出界一点点就不再命中', () => {
    expect(pointInBoxInclusive(118.999999, 32.1, BOX)).toBe(false);
    expect(pointInBoxInclusive(119.200001, 32.1, BOX)).toBe(false);
    expect(pointInBoxInclusive(119.1, 31.999999, BOX)).toBe(false);
    expect(pointInBoxInclusive(119.1, 32.200001, BOX)).toBe(false);
  });

  it('非法框（null / 零面积）一律不命中', () => {
    expect(pointInBoxInclusive(119.1, 32.1, null)).toBe(false);
    expect(pointInBoxInclusive(119.1, 32.1, { west: 119.1, east: 119.1, south: 32, north: 32.2 })).toBe(false);
  });
});

describe('pickSectionIdsByStartPoint', () => {
  it('起点在框内 → 命中；终点在框内但起点在外 → 不命中', () => {
    const list = [
      section('inside', [119.1, 32.1]),
      // 从框西侧外面穿到东侧外面：线与框相交，但起点不在框里
      section('crossing', [118.8, 32.1], [119.4, 32.1]),
      // 终点落在框里，起点在框外 —— 同样不算
      section('end-inside', [118.8, 32.1], [119.1, 32.1]),
    ];
    expect(pickSectionIdsByStartPoint(list, BOX)).toEqual(['inside']);
  });

  it('起点正好落在边界上算命中', () => {
    const list = [section('on-west', [119.0, 32.1]), section('on-ner', [119.2, 32.2])];
    expect(pickSectionIdsByStartPoint(list, BOX)).toEqual(['on-west', 'on-ner']);
  });

  it('退化几何（无坐标 / 单点 / NaN）跳过，不落到 (0,0)', () => {
    const list: SectionBoxCandidate[] = [
      { section_id: 'no-geom' },
      { section_id: 'empty', geometry: { type: 'LineString', coordinates: [] } },
      { section_id: 'single', geometry: { type: 'LineString', coordinates: [[119.1, 32.1]] } },
      { section_id: 'nan', geometry: { type: 'LineString', coordinates: [[NaN, 32.1], [119.2, 32.1]] } },
      { section_id: 'null-coord', geometry: { type: 'LineString', coordinates: [[null, null], [119.2, 32.1]] } },
      section('ok', [119.1, 32.1]),
    ];
    expect(pickSectionIdsByStartPoint(list, BOX)).toEqual(['ok']);
  });

  it('坐标是字符串时照常判（后端 JSON 里偶有数字串）', () => {
    const list: SectionBoxCandidate[] = [{
      section_id: 'str',
      geometry: { type: 'LineString', coordinates: [['119.1', '32.1'], ['119.2', '32.1']] },
    }];
    expect(pickSectionIdsByStartPoint(list, BOX)).toEqual(['str']);
  });

  it('MultiLineString 取第一段首点', () => {
    const list: SectionBoxCandidate[] = [{
      section_id: 'multi',
      geometry: { type: 'MultiLineString', coordinates: [[[119.1, 32.1], [119.2, 32.1]], [[118.0, 30.0], [118.1, 30.1]]] },
    }];
    expect(pickSectionIdsByStartPoint(list, BOX)).toEqual(['multi']);
  });

  it('重复 id 只出一次（批量接口按 id 提交，重复会让 updated 虚高）', () => {
    const list = [section('dup', [119.1, 32.1]), section('dup', [119.1, 32.1])];
    expect(pickSectionIdsByStartPoint(list, BOX)).toEqual(['dup']);
  });

  it('空候选 / 非法框返回空数组', () => {
    expect(pickSectionIdsByStartPoint([], BOX)).toEqual([]);
    expect(pickSectionIdsByStartPoint(null, BOX)).toEqual([]);
    expect(pickSectionIdsByStartPoint([section('x', [119.1, 32.1])], null)).toEqual([]);
    expect(pickSectionIdsByStartPoint([section('x', [119.1, 32.1])], {
      west: 119.2, east: 119.0, south: 32.2, north: 32.0,
    })).toEqual([]);
  });
});

describe('splitBoxInvalidByPriorState', () => {
  it('先验有效的一批进 toMark，已无效的进 alreadyInvalid', () => {
    const list = [
      section('a', [119.1, 32.1]),
      section('b', [119.1, 32.1], undefined, { manual_invalid: true }),
      section('c', [119.1, 32.1], undefined, { manual_invalid: false }),
    ];
    const { toMark, alreadyInvalid } = splitBoxInvalidByPriorState(list, ['a', 'b', 'c']);
    expect(toMark).toEqual(['a', 'c']);
    expect(alreadyInvalid).toEqual(['b']);
  });

  it('空输入不炸', () => {
    expect(splitBoxInvalidByPriorState(null, null)).toEqual({ toMark: [], alreadyInvalid: [] });
  });
});

describe('boxMatchFeatures', () => {
  it('命中断面产出「整条线 + 起点圆」，未命中的一条都不产出', () => {
    const list = [section('hit', [119.1, 32.1]), section('miss', [118.0, 31.0])];
    const features = boxMatchFeatures(list, ['hit']);
    expect(features).toHaveLength(2);
    expect(features.map(f => f.geometry.type).sort()).toEqual(['LineString', 'Point']);
    expect(features.every(f => f.properties?.id === 'hit')).toBe(true);
  });

  it('起点缺失时只画线，不画幽灵点', () => {
    const list: SectionBoxCandidate[] = [{ section_id: 'x', geometry: { type: 'LineString', coordinates: [] } }];
    const features = boxMatchFeatures(list, ['x']);
    expect(features).toHaveLength(1);
    expect(features[0].geometry.type).toBe('LineString');
  });

  it('空 ids 直接返回空（每帧都会调用，不能白跑一遍全量）', () => {
    expect(boxMatchFeatures([section('a', [119.1, 32.1])], [])).toEqual([]);
  });
});

describe('sectionBoxBoundsOf', () => {
  it('矩形 Polygon 要素 → west/south/east/north', () => {
    const feature: GeoJSON.Feature<GeoJSON.Polygon> = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [[[119.0, 32.0], [119.2, 32.0], [119.2, 32.2], [119.0, 32.2], [119.0, 32.0]]],
      },
    };
    expect(sectionBoxBoundsOf(feature)).toEqual({ west: 119.0, south: 32.0, east: 119.2, north: 32.2 });
  });

  it('null / 退化几何返回 null', () => {
    expect(sectionBoxBoundsOf(null)).toBeNull();
    expect(sectionBoxBoundsOf({ type: 'Polygon', coordinates: [] })).toBeNull();
  });
});

describe('文案', () => {
  it('确认文案带条数、说明可撤销；有先验无效时单独提一句', () => {
    const text = sectionBoxInvalidConfirmText(12, 3);
    expect(text).toContain('12 条');
    expect(text).toContain('撤销本次');
    expect(text).toContain('3 条此前已是无效');
  });

  it('没先验无效时不出现那句废话', () => {
    expect(sectionBoxInvalidConfirmText(5, 0)).not.toContain('此前已是无效');
  });

  it('空框提示区分「没断面」与「起点都不在框里」', () => {
    expect(sectionBoxInvalidEmptyHint(0)).toContain('没有断面');
    expect(sectionBoxInvalidEmptyHint(2000)).toContain('起点');
    expect(sectionBoxInvalidEmptyHint(2000)).toContain('2000');
  });
});

/**
 * 层序：这一组不是"锦上添花"，而是 2026-10-26 真机事故的回归测试 ——
 * 高亮图层曾经被插在选区图层下面，而岸段色带是懒创建、追加到栈顶的，
 * 结果 source 里 388 条要素、面板报 194 条，地图上一条高亮都看不见。
 */
describe('raiseSectionBoxMatchLayers', () => {
  /** 只实现用到的四个方法：getLayer / getStyle / moveLayer / getSource。 */
  const fakeMap = (order: string[]) => {
    const layers = order.map((id) => ({ id }));
    return {
      layers,
      getLayer: (id: string) => (layers.some((l) => l.id === id) ? { id } : undefined),
      getStyle: () => ({ layers }),
      moveLayer: (id: string) => {
        const i = layers.findIndex((l) => l.id === id);
        if (i < 0) return;
        const [item] = layers.splice(i, 1);
        layers.push(item);
      },
    };
  };

  it('色带/断面线压在下面时，把它们依次提到选区框之下、内容层之上', () => {
    const map = fakeMap([
      'sections-box-match-line',
      'sections-box-match-start',
      'area-selection-fill',
      'area-selection-line',
      'sections-line',
      'bankline-result-bank_49',
      'sections-start-point',
    ]);
    const moved = raiseSectionBoxMatchLayers(map as any, { now: 1_000_000 });
    expect(moved).toBe(true);
    expect(map.layers.map((l) => l.id)).toEqual([
      'sections-line',
      'bankline-result-bank_49',
      'sections-start-point',
      'sections-box-match-line',
      'sections-box-match-start',
      'area-selection-fill',
      'area-selection-line',
    ]);
  });

  it('已经排好序时不重排（幂等，避免每帧都动样式）', () => {
    const map = fakeMap([
      'sections-line',
      'bankline-result-bank_49',
      'sections-box-match-line',
      'sections-box-match-start',
      'area-selection-fill',
      'area-selection-line',
    ]);
    expect(raiseSectionBoxMatchLayers(map as any, { now: 2_000_000 })).toBe(false);
    expect(map.layers.map((l) => l.id)).toEqual([
      'sections-line',
      'bankline-result-bank_49',
      'sections-box-match-line',
      'sections-box-match-start',
      'area-selection-fill',
      'area-selection-line',
    ]);
  });

  it('节流：间隔内第二次调用不动图层（getStyle 是深拷贝，拖拽每帧都调会掉帧）', () => {
    const map = fakeMap([
      'sections-box-match-line',
      'sections-box-match-start',
      'sections-line',
    ]);
    expect(raiseSectionBoxMatchLayers(map as any, { now: 3_000_000, intervalMs: 400 })).toBe(true);
    const snapshot = map.layers.map((l) => l.id);
    expect(raiseSectionBoxMatchLayers(map as any, { now: 3_000_100, intervalMs: 400 })).toBe(false);
    expect(map.layers.map((l) => l.id)).toEqual(snapshot);
    // 过了节流窗口就恢复正常
    expect(raiseSectionBoxMatchLayers(map as any, { now: 3_000_600, intervalMs: 400 })).toBe(false); // 已有序
  });

  it('图层不存在 / map 为空时安全返回 false', () => {
    expect(raiseSectionBoxMatchLayers(null)).toBe(false);
    const map = fakeMap(['sections-line']);
    expect(raiseSectionBoxMatchLayers(map as any, { now: 4_000_000 })).toBe(false);
  });
});
