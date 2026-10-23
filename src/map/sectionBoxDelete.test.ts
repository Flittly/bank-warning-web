import { describe, expect, it } from 'vitest';
import {
  pickSectionIndicesInBox,
  sectionBoxDeleteConfirmText,
  sectionBoxDeleteEmptyHint,
  sectionIdOfFeature,
} from './sectionBoxDelete';

const BOX = { west: 119.9, south: 31.8, east: 120.1, north: 32.2 };

/** 断面形如「横跨岸段法向的短垂线」：这里用一竖一横的短线模拟 */
const section = (id: string, coordinates: number[][]) => ({
  type: 'Feature',
  properties: { sectionId: id, distance: 100 },
  geometry: { type: 'LineString', coordinates },
});

const INSIDE = section('sec-inside', [[120.0, 32.0], [120.01, 32.0]]);
const CROSSING = section('sec-crossing', [[120.0, 32.0], [120.0, 32.5]]); // 上端在框外
const OUTSIDE = section('sec-outside', [[118.0, 30.0], [118.01, 30.0]]);

describe('断面身份标识', () => {
  it('只认 sectionId / section_id，不拿 id 兜底', () => {
    expect(sectionIdOfFeature({ properties: { sectionId: 'a' } })).toBe('a');
    expect(sectionIdOfFeature({ properties: { section_id: 'b' } })).toBe('b');
    // 有 id 但没有 sectionId：必须返回空串，否则会算出一个地图上不存在的断面 id
    expect(sectionIdOfFeature({ properties: { id: 'c' } })).toBe('');
    expect(sectionIdOfFeature(null)).toBe('');
  });
});

describe('框选命中判定', () => {
  it('完全落在框内的断面命中', () => {
    expect(pickSectionIndicesInBox([INSIDE], BOX)).toEqual([0]);
  });

  it('一端在框外的断面也算命中（口径是相交，不是包含）', () => {
    expect(pickSectionIndicesInBox([CROSSING], BOX)).toEqual([0]);
  });

  it('完全在框外的断面不命中', () => {
    expect(pickSectionIndicesInBox([OUTSIDE], BOX)).toEqual([]);
  });

  it('混合列表返回升序下标，且不影响未命中的断面', () => {
    expect(pickSectionIndicesInBox([OUTSIDE, INSIDE, CROSSING], BOX)).toEqual([1, 2]);
  });

  it('缺几何时退化为锚点（首尾中点）判定', () => {
    const broken = { type: 'Feature', properties: { sectionId: 'sec-broken' } };
    expect(pickSectionIndicesInBox([broken], BOX)).toEqual([]);
    // 只有一个点：锚点就是它自己
    const singlePoint = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[120.0, 32.0]] } };
    expect(pickSectionIndicesInBox([singlePoint], BOX)).toEqual([0]);
  });

  it('非法框 / 空列表一律返回空', () => {
    expect(pickSectionIndicesInBox([INSIDE], null)).toEqual([]);
    expect(pickSectionIndicesInBox([INSIDE], { west: 120, south: 32, east: 120, north: 32 })).toEqual([]);
    expect(pickSectionIndicesInBox([], BOX)).toEqual([]);
    expect(pickSectionIndicesInBox(null, BOX)).toEqual([]);
  });
});

describe('文案', () => {
  it('确认文案带命中数量，并说明会影响已算结果', () => {
    const text = sectionBoxDeleteConfirmText(12);
    expect(text).toContain('12 条断面');
    expect(text).toContain('重新计算');
  });

  it('空命中提示区分「地图上没有断面」与「框里没框到」', () => {
    expect(sectionBoxDeleteEmptyHint(0)).toContain('地图上没有断面');
    expect(sectionBoxDeleteEmptyHint(24)).toContain('框内没有断面');
    expect(sectionBoxDeleteEmptyHint(24)).toContain('24');
  });
});
