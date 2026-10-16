import { describe, expect, it } from 'vitest';
import {
  boundsCoverage,
  describeScene,
  findSceneCoveringDem,
  findSceneForDem,
  inferPreferredTidal,
  SCENE_CONTAINMENT_MIN,
  type FlowFieldScene,
} from './flowFieldApi';
import { demBoundsOf, normalizeTiffKey, type LonLatBounds } from './tiffService';

/**
 * 这一组测的是"任务 DEM → 场景"的匹配规则。
 *
 * 规则看着简单，但有两个真会踩的点：
 *   1. 匹配必须走 `tiffKeys`（范围相等的一组 DEM），因为一个任务的 bench_id / ref_id
 *      通常是同一片区域的两个文件（`2018-Yangtze-uvhH.tif` 与 `2023-Yangtze-uvhH.tif`
 *      范围逐位相同，因此共用同一个场景）；只比 `tiffKey` 会漏掉一半任务。
 *   2. `tiff_bounds` / `basic_params` 里历史上既有 `tiff\A\B` 也有 `tiff/A/B`，分隔符不统一，
 *      所以要归一化后再比。
 */
function scene(partial: Partial<FlowFieldScene> & Pick<FlowFieldScene, 'sceneId'>): FlowFieldScene {
  return {
    tiffKey: '',
    tiffKeys: [],
    demBounds: null,
    waterQs: '84000',
    tidalLevel: '1998-2018',
    resolution: 1024,
    frames: 26,
    nx: 1024,
    ny: 316,
    cellSizeM: 304.684,
    coverage: 0.99,
    generatedAt: '2026-10-16T12:59:44',
    ...partial,
  };
}

const BIG_DEM_2018 = 'tiff/Yangtze/2018/standard/1998-2018/2018-Yangtze-uvhH.tif';
const BIG_DEM_2023 = 'tiff/Yangtze/2023/standard/1998-2023/2023-Yangtze-uvhH.tif';
const SMALL_DEM = 'tiff/YZ/2018/standard/201804/2018-YZ.tif';

// 三个真实包围盒（`tiff_bounds` 里登记的值，见 topics/flow-field.md §8.7）
const BIG_BOUNDS: LonLatBounds = [118.4313, 31.4543, 121.7272, 32.3322];
const YZ_BOUNDS: LonLatBounds = [119.6758, 31.9103, 120.2651, 32.3387];
const NJ_BOUNDS: LonLatBounds = [118.834, 32.1592, 119.0781, 32.2529];
/** 与大区完全不挨着的一片（华北），用来验证"不相交就不硬塞场景"。 */
const FAR_BOUNDS: LonLatBounds = [130, 40, 131, 41];

const BIG_SCENE = scene({
  sceneId: 'f-fab276146b9c',
  tiffKey: BIG_DEM_2018,
  tiffKeys: [BIG_DEM_2018, BIG_DEM_2023],
  tidalLevel: '1998-2018',
  demBounds: BIG_BOUNDS,
});
const BIG_SCENE_2023 = scene({
  sceneId: 'f-d64f861371b9',
  tiffKey: BIG_DEM_2018,
  tiffKeys: [BIG_DEM_2018, BIG_DEM_2023],
  tidalLevel: '1998-2023',
  demBounds: BIG_BOUNDS,
});

describe('findSceneForDem', () => {
  it('任务的 dem_id 命中场景的 tiffKeys 里任意一个都算命中', () => {
    // 任务用的是 2023 那份 DEM，但在场景里它排在 tiffKeys 的第二位
    expect(findSceneForDem([BIG_SCENE], BIG_DEM_2023)?.sceneId).toBe('f-fab276146b9c');
    expect(findSceneForDem([BIG_SCENE], BIG_DEM_2018)?.sceneId).toBe('f-fab276146b9c');
  });

  it('反斜杠分隔的 dem_id 也能匹配（库里两种写法都出现过）', () => {
    const backslashed = BIG_DEM_2018.replace(/\//g, '\\');
    expect(findSceneForDem([BIG_SCENE], backslashed)?.sceneId).toBe('f-fab276146b9c');
  });

  it('同一片 DEM 有多档水情时，优先选 preferredTidal 指定的那档', () => {
    const scenes = [BIG_SCENE, BIG_SCENE_2023];
    expect(findSceneForDem(scenes, BIG_DEM_2023, '1998-2023')?.sceneId).toBe('f-d64f861371b9');
    expect(findSceneForDem(scenes, BIG_DEM_2023, '1998-2018')?.sceneId).toBe('f-fab276146b9c');
  });

  it('偏好的潮位不存在时退回第一个匹配项，而不是返回 null', () => {
    expect(findSceneForDem([BIG_SCENE, BIG_SCENE_2023], BIG_DEM_2023, '1999-2000')?.sceneId)
      .toBe('f-fab276146b9c');
  });

  it('不给 DEM 范围时，没有同名场景就返回 null（调用方据此保留内置工况）', () => {
    expect(findSceneForDem([BIG_SCENE, BIG_SCENE_2023], SMALL_DEM)).toBeNull();
  });

  it('dem_id 为空或场景列表为空时都返回 null，不抛错', () => {
    expect(findSceneForDem([BIG_SCENE], null)).toBeNull();
    expect(findSceneForDem([BIG_SCENE], '   ')).toBeNull();
    expect(findSceneForDem([], BIG_DEM_2018)).toBeNull();
  });

  it('场景自带 tiffKeys 为空时，仍能靠 tiffKey 本身命中', () => {
    const bare = scene({ sceneId: 'f-000000000000', tiffKey: BIG_DEM_2018, tiffKeys: [] });
    expect(findSceneForDem([bare], BIG_DEM_2018)?.sceneId).toBe('f-000000000000');
  });
});

describe('describeScene', () => {
  it('拼出流量 / 潮位 / 网格尺寸', () => {
    expect(describeScene(BIG_SCENE)).toBe('84000 m³/s · 1998-2018 · 1024×316');
  });

  it('网格尺寸缺失时不留下多余分隔符', () => {
    expect(describeScene({ ...BIG_SCENE, nx: 0, ny: 0 })).toBe('84000 m³/s · 1998-2018');
  });
});

/**
 * 这一组测"被包含"回退。
 *
 * 背景：库里 13 个任务（YZ 12 个、NJ 1 个）用的是小区域 DEM，它们**没有自己的场景**，
 * 也不在任何场景的 `tiff_keys` 里；而内置工况用的 `10000` 点云对它们的覆盖是 0.77% / 0.00%
 * （NJ 完全无交集）。所以这两片 DEM 必须靠"范围被大区场景包住"落位，否则退到内置工况
 * 等于给它们看一片跟任务无关的水域。
 */
describe('findSceneForDem · 被包含回退', () => {
  it('小区域 DEM 没有同名场景时，落到包住它的大区场景', () => {
    const scenes = [BIG_SCENE, BIG_SCENE_2023];
    expect(findSceneForDem(scenes, SMALL_DEM, null, YZ_BOUNDS)?.sceneId).toBe('f-fab276146b9c');
  });

  it('NJ 完全落在大区场景里，同样能命中', () => {
    expect(findSceneCoveringDem([BIG_SCENE], NJ_BOUNDS)?.sceneId).toBe('f-fab276146b9c');
  });

  it('完全不相交的 DEM 不会硬塞一个场景进来', () => {
    expect(findSceneForDem([BIG_SCENE], 'tiff/X/2020/standard/202001/X.tif', null, FAR_BOUNDS))
      .toBeNull();
  });

  it('只擦到一条边的 DEM 也不算被包住（覆盖率低于阈值）', () => {
    // 与大区只在经度上重叠 0.73°，占自己 4° 的 18%
    const sliver: LonLatBounds = [121.0, 31.45, 125.0, 32.33];
    expect(boundsCoverage(BIG_BOUNDS, sliver)).toBeLessThan(SCENE_CONTAINMENT_MIN);
    expect(findSceneCoveringDem([BIG_SCENE], sliver)).toBeNull();
  });

  it('只给年份的潮位偏好也能挑对档（YZ 的 2018 → 1998-2018）', () => {
    const scenes = [BIG_SCENE_2023, BIG_SCENE];
    expect(findSceneCoveringDem(scenes, YZ_BOUNDS, inferPreferredTidal(SMALL_DEM))?.sceneId)
      .toBe('f-fab276146b9c');
    expect(findSceneCoveringDem(scenes, YZ_BOUNDS, inferPreferredTidal(BIG_DEM_2023))?.sceneId)
      .toBe('f-d64f861371b9');
  });

  it('多个容器时取最贴身的那个（将来为 YZ 单独生成局部场景会自动压过大区）', () => {
    const localScene = scene({
      sceneId: 'f-111111111111',
      tiffKeys: [SMALL_DEM],
      tidalLevel: '1998-2018',
      demBounds: YZ_BOUNDS,
      cellSizeM: 54.4,
    });
    expect(findSceneCoveringDem([BIG_SCENE, localScene], YZ_BOUNDS)?.sceneId).toBe('f-111111111111');
  });

  it('精确命中优先于被包含，且精确命中时不看 demBounds', () => {
    const localScene = scene({
      sceneId: 'f-222222222222',
      tiffKeys: [SMALL_DEM],
      demBounds: YZ_BOUNDS,
    });
    // 即使给了大区的范围，SMALL_DEM 在 tiffKeys 里直接命中 localScene，就轮不到回退
    expect(findSceneForDem([BIG_SCENE, localScene], SMALL_DEM, null, BIG_BOUNDS)?.sceneId)
      .toBe('f-222222222222');
  });

  it('形状不完整的 demBounds 被忽略，不会当成包含关系', () => {
    expect(findSceneForDem([BIG_SCENE], SMALL_DEM, null, [1, 2, 3])).toBeNull();
    const noBounds = scene({ sceneId: 'f-333333333333', demBounds: null });
    expect(findSceneCoveringDem([noBounds], YZ_BOUNDS)).toBeNull();
  });
});

describe('inferPreferredTidal', () => {
  it('取 dem_id 里最后出现的 4 位年份', () => {
    expect(inferPreferredTidal(BIG_DEM_2018)).toBe('2018');
    // 路径里 `1998-2018` 在前、文件名 `2018-...` 在后，最后一个才是这份 DEM 自己的年份
    expect(inferPreferredTidal(BIG_DEM_2023)).toBe('2023');
    expect(inferPreferredTidal(SMALL_DEM)).toBe('2018');
  });

  it('没有年份时返回空串（调用方据此不做潮位偏好）', () => {
    expect(inferPreferredTidal('tiff/foo/bar.tif')).toBe('');
    expect(inferPreferredTidal(null)).toBe('');
    expect(inferPreferredTidal('')).toBe('');
  });
});

describe('boundsCoverage', () => {
  it('完全包住是 1', () => {
    expect(boundsCoverage(BIG_BOUNDS, NJ_BOUNDS)).toBeCloseTo(1, 5);
  });

  it('自身对自身是 1', () => {
    expect(boundsCoverage(BIG_BOUNDS, BIG_BOUNDS)).toBeCloseTo(1, 5);
  });

  it('不相交是 0', () => {
    expect(boundsCoverage(BIG_BOUNDS, FAR_BOUNDS)).toBe(0);
  });

  it('YZ 那种"北边差一点点"的情形 ≥ 0.95，仍算包住', () => {
    // 实测 98.75%，与大区点云对 YZ 的覆盖率一致（见 topics/flow-field.md §8.7）
    expect(boundsCoverage(BIG_BOUNDS, YZ_BOUNDS)).toBeGreaterThanOrEqual(SCENE_CONTAINMENT_MIN);
  });
});

/**
 * `demBoundsOf` 是"被包含回退"的数据来源：从 `/v0/bank/tiff-bounds` 的 GeoJSON 里
 * 取某片 DEM 的范围。它踩的点是**分隔符**（`tiff\A\B` 与 `tiff/A/B` 库里都有）
 * 和**几何可能是 null**（后端解析 GeoJSON 失败时会塞 null）。
 */
describe('demBoundsOf', () => {
  const collection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { tiff_key: BIG_DEM_2018 },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [118.4313, 31.4543],
              [121.7272, 31.4543],
              [121.7272, 32.3322],
              [118.4313, 32.3322],
              [118.4313, 31.4543],
            ],
          ],
        },
      },
      { type: 'Feature', properties: { tiff_key: 'tiff/gone.tif' }, geometry: null },
    ],
  } as unknown as GeoJSON.FeatureCollection;

  it('按 tiff_key 取出经纬包围盒', () => {
    expect(demBoundsOf(collection, BIG_DEM_2018)).toEqual([118.4313, 31.4543, 121.7272, 32.3322]);
  });

  it('反斜杠分隔的 dem_id 也能取到', () => {
    expect(demBoundsOf(collection, BIG_DEM_2018.replace(/\//g, '\\'))).not.toBeNull();
  });

  it('几何为 null / 没登记的 DEM / 空入参都返回 null，不抛错', () => {
    expect(demBoundsOf(collection, 'tiff/gone.tif')).toBeNull();
    expect(demBoundsOf(collection, 'tiff/never/registered.tif')).toBeNull();
    expect(demBoundsOf(collection, '')).toBeNull();
    expect(demBoundsOf(null, BIG_DEM_2018)).toBeNull();
  });

  it('MultiPolygon 也能摊平取外包', () => {
    const multi = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { tiff_key: 'tiff/multi.tif' },
          geometry: {
            type: 'MultiPolygon',
            coordinates: [[[[1, 2], [3, 2], [3, 4], [1, 4], [1, 2]]], [[[5, 6], [7, 6], [7, 8], [5, 8], [5, 6]]]],
          },
        },
      ],
    } as unknown as GeoJSON.FeatureCollection;
    expect(demBoundsOf(multi, 'tiff/multi.tif')).toEqual([1, 2, 7, 8]);
  });

  it('与 tiffService 的 key 归一化用同一套规则', () => {
    expect(normalizeTiffKey('tiff\\YZ\\2018\\standard\\201804\\2018-YZ.tif'))
      .toBe('tiff/YZ/2018/standard/201804/2018-YZ.tif');
  });
});
