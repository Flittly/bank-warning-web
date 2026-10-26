import { describe, expect, it } from 'vitest';
import {
  SECTION_START_LAYER_ID,
  SECTION_START_SOURCE_ID,
  raiseSectionStartLayer,
  sectionStartCoordinate,
  sectionStartPointPaint,
  sectionStartRadiusExpr,
} from './sectionStartPoints';

/**
 * 断面起点圆的两个易错点，各一组用例：
 *   1. 取**首点**（岸侧）而不是尾点（江心）—— 全库 28191 条 start_point ≡ 首点，
 *      真取反了，圆点会全落在江心，肉眼也能看出来但很难定位到代码；
 *   2. 半径随缩放收缩 —— 单任务断面可达 2000+ 条，写死 4px 会把岸段色带整片盖住。
 */

const line = (...coords: number[][]) => ({ type: 'LineString', coordinates: coords });

describe('sectionStartCoordinate', () => {
  it('LineString 取首点，即岸侧起点', () => {
    const geo = line([120.581288, 32.033286], [120.549457, 31.999521]);
    expect(sectionStartCoordinate(geo)).toEqual([120.581288, 32.033286]);
  });

  it('绝不取尾点（尾点在江心，离岸几百到几千米）', () => {
    const geo = line([120.5, 32.0], [120.6, 32.1]);
    const got = sectionStartCoordinate(geo);
    expect(got).not.toEqual([120.6, 32.1]);
  });

  it('三个点的折线仍只取第一个', () => {
    const geo = line([120.1, 31.1], [120.2, 31.2], [120.3, 31.3]);
    expect(sectionStartCoordinate(geo)).toEqual([120.1, 31.1]);
  });

  it('MultiLineString 取第一段首点（裁剪只可能发生在江心一侧，方向不变）', () => {
    const geo = {
      type: 'MultiLineString',
      coordinates: [[[121.1, 31.5], [121.2, 31.4]], [[121.3, 31.3], [121.4, 31.2]]],
    };
    expect(sectionStartCoordinate(geo)).toEqual([121.1, 31.5]);
  });

  it('只有一个点的退化 LineString 返回 null（画不出来，也不该落个点）', () => {
    expect(sectionStartCoordinate(line([120.5, 32.0]))).toBeNull();
  });

  it('坐标为空 / 缺失 / 非数组一律 null', () => {
    expect(sectionStartCoordinate({ type: 'LineString', coordinates: [] })).toBeNull();
    expect(sectionStartCoordinate({ type: 'LineString' })).toBeNull();
    expect(sectionStartCoordinate({ type: 'LineString', coordinates: [[120, 32]] })).toBeNull();
    expect(sectionStartCoordinate({})).toBeNull();
  });

  it('Point / Polygon 等非线类型返回 null（断面只会是线，别静默当成点）', () => {
    expect(sectionStartCoordinate({ type: 'Point', coordinates: [120, 32] })).toBeNull();
    expect(
      sectionStartCoordinate({
        type: 'Polygon',
        coordinates: [[[120, 32], [121, 32], [121, 33], [120, 32]]],
      }),
    ).toBeNull();
  });

  it('null / undefined / 字符串输入不抛异常', () => {
    expect(sectionStartCoordinate(null)).toBeNull();
    expect(sectionStartCoordinate(undefined)).toBeNull();
    expect(sectionStartCoordinate('LineString')).toBeNull();
  });

  it('坐标里混进字符串数字时按数字收（后端 jsonb 偶尔把数值写成字符串）', () => {
    expect(sectionStartCoordinate(line(['120.5', '32.25'] as any, [120.6, 32.3]))).toEqual([120.5, 32.25]);
  });

  it('NaN / Infinity 坐标返回 null —— 宁可少一个点，也不要落个幽灵点', () => {
    expect(sectionStartCoordinate(line([NaN, 32], [120, 31]))).toBeNull();
    expect(sectionStartCoordinate(line([120, Infinity], [120, 31]))).toBeNull();
  });

  it('null / false 坐标返回 null，不能被 Number() 同化成 0 落到 (0, 0)', () => {
    // Number(null) === 0、Number(false) === 0 —— 直接 Number() 会造出一个
    // 经度 0 的点（几内亚湾），图上看起来像"有数据"，比不画更误导。
    expect(sectionStartCoordinate(line([null as any, 32], [120, 31]))).toBeNull();
    expect(sectionStartCoordinate(line([false as any, 32], [120, 31]))).toBeNull();
    expect(sectionStartCoordinate(line([[], 32] as any, [120, 31]))).toBeNull();
    expect(sectionStartCoordinate(line(['', 32] as any, [120, 31]))).toBeNull();
  });
});

describe('sectionStartRadiusExpr', () => {
  it('是 zoom 的 linear 插值，不是写死的像素值', () => {
    const expr = sectionStartRadiusExpr() as any[];
    expect(expr[0]).toBe('interpolate');
    expect(expr[1]).toEqual(['linear']);
    expect(expr[2]).toEqual(['zoom']);
  });

  it('stop 严格递增，且半径随缩放单调变大', () => {
    const expr = sectionStartRadiusExpr() as any[];
    const stops = expr.slice(3);
    let prevZoom = -Infinity;
    let prevRadius = -Infinity;
    for (let i = 0; i < stops.length; i += 2) {
      expect(stops[i]).toBeGreaterThan(prevZoom);
      expect(stops[i + 1]).toBeGreaterThan(prevRadius);
      prevZoom = stops[i];
      prevRadius = stops[i + 1];
    }
  });

  it('低缩放时足够小（≤2px），高缩放时足够大（≥4px）', () => {
    const expr = sectionStartRadiusExpr() as any[];
    const stops = expr.slice(3);
    expect(stops[1]).toBeLessThanOrEqual(2);
    expect(stops[stops.length - 1]).toBeGreaterThanOrEqual(4);
  });
});

describe('sectionStartPointPaint', () => {
  it('颜色取自 feature 的 color —— 与断面线共用同一个解析结果', () => {
    const paint = sectionStartPointPaint();
    expect(paint['circle-color']).toEqual(['get', 'color']);
  });

  it('有白色描边：低风险绿压在绿色卫星影像上没有描边就看不见', () => {
    const paint = sectionStartPointPaint();
    expect(paint['circle-stroke-color']).toBe('#ffffff');
    expect(paint['circle-stroke-width']).toBeTruthy();
  });

  it('不透明：半透的白环压在同色色带上会糊成一片', () => {
    const paint = sectionStartPointPaint();
    expect(Number(paint['circle-opacity'])).toBe(1);
    expect(Number(paint['circle-stroke-opacity'])).toBe(1);
  });
});

describe('图层 / 数据源命名', () => {
  it('与断面线用不同 id，clearMapLayers 才能分别清理', () => {
    expect(SECTION_START_LAYER_ID).toBe('sections-start-point');
    expect(SECTION_START_SOURCE_ID).toBe('sections-start-source');
    expect(SECTION_START_LAYER_ID).not.toBe('sections-line');
    expect(SECTION_START_SOURCE_ID).not.toBe('sections-source');
  });
});

describe('raiseSectionStartLayer', () => {
  /** 最小 map 桩：只实现用到的三个方法，记录 moveLayer 调用。 */
  const makeMap = (layerIds: string[], hasStart = true) => {
    const calls: string[] = [];
    return {
      calls,
      map: {
        getLayer: (id: string) => (hasStart && id === SECTION_START_LAYER_ID ? {} : undefined),
        getStyle: () => ({ layers: layerIds.map(id => ({ id })) }),
        moveLayer: (id: string) => { calls.push(id); },
      },
    };
  };

  it('起点层不在顶层时提到顶层', () => {
    const { calls, map } = makeMap(['sections-line', SECTION_START_LAYER_ID, 'bankline-b1']);
    expect(raiseSectionStartLayer(map)).toBe(true);
    expect(calls).toEqual([SECTION_START_LAYER_ID]);
  });

  it('已经在顶层就不动（moveLayer 会触发 styledata，没必要白跑）', () => {
    const { calls, map } = makeMap(['sections-line', 'bankline-b1', SECTION_START_LAYER_ID]);
    expect(raiseSectionStartLayer(map)).toBe(false);
    expect(calls).toEqual([]);
  });

  it('起点层还没创建时返回 false 且不抛异常', () => {
    const { calls, map } = makeMap(['sections-line'], false);
    expect(raiseSectionStartLayer(map)).toBe(false);
    expect(calls).toEqual([]);
  });

  it('空样式（layers 为空）也不当成「已在顶层」', () => {
    const { calls, map } = makeMap([]);
    expect(raiseSectionStartLayer(map)).toBe(false);
    expect(calls).toEqual([]);
  });

  it('map 为 null / 缺方法时安全返回 false', () => {
    expect(raiseSectionStartLayer(null)).toBe(false);
    expect(raiseSectionStartLayer(undefined)).toBe(false);
    expect(raiseSectionStartLayer({} as any)).toBe(false);
  });
});
