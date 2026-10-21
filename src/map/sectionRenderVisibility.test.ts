import { describe, expect, it } from 'vitest';
import {
  TRANSPARENT_RISK_COLOR,
  buildRiskBandSpans,
  buildRiskGradientStops,
  hasRenderableRisk,
  isRiskLevelRenderable,
  shouldRenderRisk,
} from './sectionRenderVisibility';

/** 从 Mapbox 表达式里把 [val, color] 对抽出来，便于断言。 */
function pairsOf(stops: unknown[]): Array<[number, string]> {
  const out: Array<[number, string]> = [];
  for (let i = 3; i < stops.length; i += 2) out.push([stops[i] as number, stops[i + 1] as string]);
  return out;
}

const GREEN = '#10b981';
const RED = '#ef4444';
const ORANGE = '#f97316';

describe('isRiskLevelRenderable', () => {
  it('低风险(0) 不渲染，1/2/3 渲染', () => {
    expect(isRiskLevelRenderable(0)).toBe(false);
    expect(isRiskLevelRenderable(1)).toBe(true);
    expect(isRiskLevelRenderable(2)).toBe(true);
    expect(isRiskLevelRenderable(3)).toBe(true);
  });

  it('无值 / 越界 / 非整数一律不渲染', () => {
    expect(isRiskLevelRenderable(null)).toBe(false);
    expect(isRiskLevelRenderable(undefined)).toBe(false);
    expect(isRiskLevelRenderable(NaN)).toBe(false);
    expect(isRiskLevelRenderable(4)).toBe(false);
    expect(isRiskLevelRenderable(-1)).toBe(false);
    expect(isRiskLevelRenderable(1.5)).toBe(false);
  });
});

describe('shouldRenderRisk', () => {
  it('valid=false 即使 level 有值也不渲染（计算失败/无风险值）', () => {
    expect(shouldRenderRisk({ valid: false, level: 2 })).toBe(false);
    expect(shouldRenderRisk(null)).toBe(false);
    expect(shouldRenderRisk(undefined)).toBe(false);
  });

  it('valid=true 时再看等级', () => {
    expect(shouldRenderRisk({ valid: true, level: 0 })).toBe(false);
    expect(shouldRenderRisk({ valid: true, level: 2 })).toBe(true);
    expect(shouldRenderRisk({ valid: true, level: null })).toBe(false);
  });
});

describe('hasRenderableRisk', () => {
  it('岸段内只要有一条需要渲染就画', () => {
    expect(hasRenderableRisk([0, 0, null, 1])).toBe(true);
  });

  it('全低风险 / 全无值 → 整条岸段不画', () => {
    expect(hasRenderableRisk([0, 0, null])).toBe(false);
    expect(hasRenderableRisk([])).toBe(false);
  });
});

describe('buildRiskBandSpans', () => {
  it('区间首尾相接覆盖整条岸段（0 到 1 不留空白）', () => {
    const spans = buildRiskBandSpans([
      { val: 0.2, level: 2, color: ORANGE },
      { val: 0.6, level: 3, color: RED },
    ]);
    expect(spans).toHaveLength(2);
    expect(spans[0].start).toBe(0);
    expect(spans[0].end).toBeCloseTo(0.4, 9);
    expect(spans[1].start).toBeCloseTo(0.4, 9);
    expect(spans[1].end).toBe(1);
  });

  it('低风险断面的管辖段整段透明，宽度取前后断面中点', () => {
    const spans = buildRiskBandSpans([
      { val: 0, level: 3, color: RED },
      { val: 0.5, level: 0, color: GREEN },
      { val: 1, level: 2, color: ORANGE },
    ]);
    // 中间那条低风险断面管 [0.25, 0.75]，整整半条岸段留空
    expect(spans[1].visible).toBe(false);
    expect(spans[1].start).toBeCloseTo(0.25, 9);
    expect(spans[1].end).toBeCloseTo(0.75, 9);
    expect(spans[1].color).toBe(TRANSPARENT_RISK_COLOR);
  });

  it('相邻两条低风险/无值断面 → 它们的管辖段连成一大片透明', () => {
    const spans = buildRiskBandSpans([
      { val: 0, level: 3, color: RED },
      { val: 0.3, level: 0, color: GREEN },
      { val: 0.6, level: null, color: '#94a3b8' },
      { val: 1, level: 2, color: ORANGE },
    ]);
    expect(spans[1].color).toBe(TRANSPARENT_RISK_COLOR);
    expect(spans[2].color).toBe(TRANSPARENT_RISK_COLOR);
    // [0.15, 0.8] 这一整段都没有实色
    expect(spans[1].start).toBeCloseTo(0.15, 9);
    expect(spans[2].end).toBeCloseTo(0.8, 9);
  });
});

describe('buildRiskGradientStops', () => {
  it('全部低风险 → null（整条岸段不画）', () => {
    expect(
      buildRiskGradientStops([
        { val: 0, level: 0, color: GREEN },
        { val: 0.5, level: 0, color: GREEN },
        { val: 1, level: 0, color: GREEN },
      ]),
    ).toBeNull();
  });

  it('全部无风险值 → null', () => {
    expect(
      buildRiskGradientStops([
        { val: 0.2, level: null, color: '#94a3b8' },
        { val: 0.8, level: null, color: '#94a3b8' },
      ]),
    ).toBeNull();
  });

  it('空输入 → null', () => {
    expect(buildRiskGradientStops([])).toBeNull();
  });

  it('低风险断面的整段区间都是透明，低风险绿一个都不出现', () => {
    const stops = buildRiskGradientStops([
      { val: 0, level: 0, color: GREEN },
      { val: 0.3, level: 3, color: RED },
      { val: 0.6, level: 0, color: GREEN },
      { val: 0.9, level: 2, color: ORANGE },
    ])!;
    const pairs = pairsOf(stops);
    // 首条低风险管 [0, 0.15]，中间低风险管 [0.45, 0.75]
    expect(pairs[0]).toEqual([0, TRANSPARENT_RISK_COLOR]);
    expect(pairs.some(([, c]) => c === GREEN)).toBe(false);
    // 高风险段的实色仍然存在，且落在自己的区间内
    expect(pairs.some(([v, c]) => c === RED && v >= 0.15 && v <= 0.45)).toBe(true);
    expect(pairs.some(([v, c]) => c === ORANGE && v >= 0.75 && v <= 1)).toBe(true);
  });

  it('每个区间内部是同一种颜色（阶梯而不是渐变）', () => {
    const stops = buildRiskGradientStops([
      { val: 0, level: 3, color: RED },
      { val: 0.5, level: 2, color: ORANGE },
      { val: 1, level: 3, color: RED },
    ])!;
    const pairs = pairsOf(stops);
    // 区间 [0, 0.25]（红）、[0.25, 0.75]（橙）、[0.75, 1]（红）内部各自纯色
    const inRed = pairs.filter(([v]) => v < 0.25);
    const inOrange = pairs.filter(([v]) => v > 0.25 && v < 0.75);
    const inRedTail = pairs.filter(([v]) => v >= 0.75);
    expect(inRed.every(([, c]) => c === RED)).toBe(true);
    expect(inOrange.every(([, c]) => c === ORANGE)).toBe(true);
    expect(inRedTail.every(([, c]) => c === RED)).toBe(true);
    // 每段至少「起点 + 终点前」两个 stop，否则区间内会被邻居插值
    expect(inRed.length).toBeGreaterThanOrEqual(2);
    expect(inOrange.length).toBeGreaterThanOrEqual(1);
    expect(inRedTail.length).toBeGreaterThanOrEqual(2);
  });

  it('可见 ↔ 隐藏交界是硬边：换色只发生在极窄的 gap 内', () => {
    const stops = buildRiskGradientStops([
      { val: 0, level: 3, color: RED },
      { val: 0.5, level: 0, color: GREEN },
    ])!;
    const pairs = pairsOf(stops);
    // 交界在 0.25：0.25 之前最后一个是红，0.25 处立刻切透明，两者相差只有 gap
    const idx = pairs.findIndex(([v]) => Math.abs(v - 0.25) < 1e-9);
    expect(idx).toBeGreaterThan(0);
    expect(pairs[idx - 1][1]).toBe(RED);
    expect(pairs[idx][1]).toBe(TRANSPARENT_RISK_COLOR);
    expect(pairs[idx][0] - pairs[idx - 1][0]).toBeLessThan(0.01);
  });

  it('stop 严格递增（同位置多条断面不会让 interpolate 报错）', () => {
    const stops = buildRiskGradientStops([
      { val: 0.4, level: 2, color: ORANGE },
      { val: 0.4, level: 0, color: GREEN },
      { val: 0.4, level: 3, color: RED },
    ])!;
    const vals = pairsOf(stops).map(([v]) => v);
    for (let i = 1; i < vals.length; i += 1) {
      expect(vals[i]).toBeGreaterThan(vals[i - 1]);
    }
  });

  it('乱序输入按 val 升序整理，越界 val 被夹到 0..1', () => {
    const stops = buildRiskGradientStops([
      { val: 0.9, level: 3, color: RED },
      { val: -3, level: 1, color: '#3b82f6' },
      { val: 12, level: 2, color: ORANGE },
    ])!;
    const vals = pairsOf(stops).map(([v]) => v);
    expect(vals[0]).toBe(0);
    expect(vals[vals.length - 1]).toBe(1);
    expect([...vals].sort((a, b) => a - b)).toEqual(vals);
  });

  it('表达式头三段固定为 interpolate/linear/line-progress', () => {
    const stops = buildRiskGradientStops([{ val: 0.5, level: 2, color: ORANGE }])!;
    expect(stops[0]).toBe('interpolate');
    expect(stops[1]).toEqual(['linear']);
    expect(stops[2]).toEqual(['line-progress']);
  });

  it('单条断面 → 其颜色铺满整条岸段（首尾各延伸一半）', () => {
    const stops = buildRiskGradientStops([{ val: 0.5, level: 2, color: ORANGE }])!;
    const pairs = pairsOf(stops);
    expect(pairs.every(([, c]) => c === ORANGE)).toBe(true);
    expect(pairs[0][0]).toBe(0);
    expect(pairs[pairs.length - 1][0]).toBe(1);
  });
});
