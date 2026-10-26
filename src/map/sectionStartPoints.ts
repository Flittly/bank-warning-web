/**
 * 断面「岸侧起点」标记。
 *
 * ## 为什么起点就是岸侧
 *
 * 断面是一条从岸边横切到江心的线。`cross_sections` 表里存了三份互相冗余的几何：
 * `start_point` / `end_point`（Point）与 `geom`（LineString）。全库 28191 条实测：
 *
 *   * `start_point` 与 `ST_StartPoint(geom)` **逐条完全相等**（28 191/28 191），
 *     而与 `ST_EndPoint(geom)` 相等的数量是 **0**；
 *   * 起点到所属岸线的距离是 0～83 m（个别断面被简化过岸线，略有偏移），
 *     终点到岸线的距离是 500～4800 m。
 *
 * 也就是说：**几何第一个点 = 起点 = 岸侧端**，这个顺序是不变量，不是巧合。
 * 编辑器「先在岸段上点起点、再点终点」的交互把这条不变量写死在了创建路径上。
 *
 * 因此这里直接读几何首点，不去后端加字段：少一次接口改动，也不会出现
 * 「数据库有 start_point、前端却用另一套推断」的两份真相。
 *
 * ## 标记的用途与外观约束
 *
 * 用户要的是「一眼看出这条断面挂在哪个岸段上」。所以圆点必须：
 *
 *   1. **落在岸线上**（起点本来就在那，不做任何吸附/纠偏 —— 偏了就偏着画，那才是事实）；
 *   2. **颜色跟断面本体一致**，否则同一个断面在图上出现两种颜色，反而不知道该信哪个；
 *   3. **随缩放变小到接近不可见**。单任务断面可达 2000+ 条，低缩放下全尺寸圆点会糊成一串
 *      白点，把岸段色带全遮住 —— 那时用户根本不关心单条断面。
 *
 * 颜色不在这里算：调用方传入与断面线同一个 `color`。
 */

/** 结果页地图上断面起点圆的图层 id。 */
export const SECTION_START_LAYER_ID = 'sections-start-point';
/** 起点圆的数据源 id（与断面线 `sections-source` 分开，避免线/点混源）。 */
export const SECTION_START_SOURCE_ID = 'sections-start-source';

/**
 * 圆点半径（屏幕像素）随缩放的插值。
 *
 * 尺寸不是随手定的，是被三层遮挡关系逼出来的：
 *   * 断面线宽 5px，端点带 round 端帽（半径 2.5px）—— 圆点若与之相近，**看起来就是线头变粗**；
 *   * 岸段色带在缩放 14 时可到 10px 以上，而起点正落在色带覆盖范围内；
 *   * 所以直径必须明显大于两者，并靠白描边把「点」从同色的线和带里抠出来。
 * 低缩放给 2px（不是 0）：留一颗极小的点，「岸边有断面经过」这件事仍然成立。
 */
export function sectionStartRadiusExpr(): unknown[] {
  return ['interpolate', ['linear'], ['zoom'], 9, 2, 12, 3.5, 14, 5.5, 17, 7.5];
}

/** 白描边宽度：与半径同向放大，粗到足以在 10px 宽的色带上形成一圈看得见的白环。 */
function sectionStartStrokeExpr(): unknown[] {
  return ['interpolate', ['linear'], ['zoom'], 9, 0.6, 12, 1.4, 15, 2.2];
}

/** `sections-start-point` 的 paint。抽出来是为了「点长什么样」只有一处定义。 */
export function sectionStartPointPaint(): Record<string, unknown> {
  return {
    'circle-radius': sectionStartRadiusExpr(),
    'circle-color': ['get', 'color'],
    // 白描边是让圆点在卫星底图/深色岸线上都能被看见的唯一手段：
    // 只靠填充色，低风险绿压在绿色卫星影像上就消失了；同色压在色带上更是毫无信息量。
    'circle-stroke-width': sectionStartStrokeExpr(),
    'circle-stroke-color': '#ffffff',
    // 点必须不透明：白环一旦半透，叠在同色色带上就糊成一片。
    'circle-opacity': 1,
    'circle-stroke-opacity': 1,
  };
}

/**
 * 把起点圆提到所有图层最上层。
 *
 * 必需的，不是优化：起点落在岸线上，而岸段色带是沿整条岸线铺的**宽带**
 * （缩放 14 时 10px 以上），断面线与色带都在起点圆之后创建 ⇒ 圆点会被整片压住，
 * 图上等于没画。只调半径/描边解决不了这个问题，必须改图层顺序。
 *
 * 只在「当前不在顶层」时才动：`moveLayer` 会触发 `styledata`，每次轮询都无条件调用
 * 会让底图重建的监听反复触发（虽然有哨兵拦住，但没必要）。
 */
export function raiseSectionStartLayer(map: {
  getLayer?: (id: string) => unknown;
  getStyle?: () => { layers?: Array<{ id?: string }> } | undefined;
  moveLayer?: (id: string) => unknown;
} | null | undefined): boolean {
  if (!map || typeof map.getLayer !== 'function' || typeof map.moveLayer !== 'function') return false;
  if (!map.getLayer(SECTION_START_LAYER_ID)) return false;
  const layers = map.getStyle?.()?.layers ?? [];
  const topId = layers.length > 0 ? layers[layers.length - 1]?.id : null;
  if (!topId || topId === SECTION_START_LAYER_ID) return false;
  map.moveLayer(SECTION_START_LAYER_ID);
  return true;
}

/**
 * 单个坐标分量转数值。
 *
 * 只接受 number 与非空数字串。**不能直接 `Number(v)`** —— `Number(null) === 0`、
 * `Number(false) === 0`、`Number([]) === 0`，会把缺字段的断面画到几内亚湾 (0, 0) 附近，
 * 而且图上看起来"有数据"，比不画更误导。
 */
function toCoord(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * 从断面几何里取岸侧起点。
 *
 * 支持 `LineString` 与 `MultiLineString`（后者取第一段的首点 —— 断面的分段只可能来自
 * 几何被裁剪，方向仍然是从岸到江心）。其它类型、坐标不足 2 个点、经纬度非有限数
 * 一律返回 `null`：宁可少画一个点，也不要在地图上落一个 (0,0) 或 NaN 的幽灵。
 */
export function sectionStartCoordinate(geometry: unknown): [number, number] | null {
  if (!geometry || typeof geometry !== 'object') return null;
  const geo = geometry as { type?: string; coordinates?: unknown };
  const coords = geo.coordinates;
  if (!Array.isArray(coords) || coords.length === 0) return null;

  let first: unknown;
  if (geo.type === 'LineString') {
    if (coords.length < 2) return null;
    first = coords[0];
  } else if (geo.type === 'MultiLineString') {
    const firstLine = coords[0];
    if (!Array.isArray(firstLine) || firstLine.length < 2) return null;
    first = firstLine[0];
  } else {
    return null;
  }

  if (!Array.isArray(first) || first.length < 2) return null;
  const lng = toCoord(first[0]);
  const lat = toCoord(first[1]);
  if (lng === null || lat === null) return null;
  return [lng, lat];
}
