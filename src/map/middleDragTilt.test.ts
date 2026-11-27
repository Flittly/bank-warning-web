import { describe, expect, it } from 'vitest';

import { BEARING_PER_PIXEL, PITCH_PER_PIXEL, tiltFromDrag } from './middleDragTilt';

describe('中键拖动的角度换算', () => {
  it('向上拖（dy<0）是抬头，pitch 变大', () => {
    const r = tiltFromDrag({ pitch: 20, bearing: 0 }, 0, -100, 85);
    expect(r.pitch).toBeCloseTo(20 + 100 * PITCH_PER_PIXEL, 5);
  });

  it('向下拖是低头，pitch 变小', () => {
    const r = tiltFromDrag({ pitch: 60, bearing: 0 }, 0, 100, 85);
    expect(r.pitch).toBeCloseTo(60 - 100 * PITCH_PER_PIXEL, 5);
  });

  it('pitch 夹在 [0, maxPitch]，拖过头也不会翻到负角度或超过 85', () => {
    expect(tiltFromDrag({ pitch: 10, bearing: 0 }, 0, 5000, 85).pitch).toBe(0);
    expect(tiltFromDrag({ pitch: 10, bearing: 0 }, 0, -5000, 85).pitch).toBe(85);
  });

  it('向右拖是顺时针转方位，且结果归一化到 [-180,180)', () => {
    const r = tiltFromDrag({ pitch: 0, bearing: 0 }, 100, 0, 85);
    expect(r.bearing).toBeCloseTo(100 * BEARING_PER_PIXEL, 5);

    const wrapped = tiltFromDrag({ pitch: 0, bearing: 170 }, 1000, 0, 85);
    expect(wrapped.bearing).toBeGreaterThanOrEqual(-180);
    expect(wrapped.bearing).toBeLessThan(180);
  });

  it('始终相对按下时的值计算，拖回原点能精确回到起始角度', () => {
    // 关键：不能拿上一帧结果迭代，否则 clamp 截断 + 浮点误差会累积，回不到原位
    const start = { pitch: 42.5, bearing: -33.25 };
    const out = tiltFromDrag(start, 0, 0, 85);
    expect(out.pitch).toBe(42.5);
    expect(out.bearing).toBeCloseTo(-33.25, 10);

    const moved = tiltFromDrag(start, 120, -80, 85);
    const back = tiltFromDrag(start, 0, 0, 85);
    expect(moved.pitch).not.toBe(start.pitch);
    expect(back.pitch).toBe(start.pitch);
  });
});
