import * as turf from '@turf/turf';

/** 色带定位只关心这两项，其余字段（风险值、名称…）不参与计算。 */
export type BandSectionLike = {
  distance?: number | null;
  geometry?: { type?: string; coordinates?: unknown } | null;
};

/**
 * 一条断面在岸线上的归一化位置（0..1），由「断面几何中点投影到岸线」求得。
 *
 * 为什么不用 `cross_sections.distance`：它是断面在岸段上的**桩号**，只在创建断面时
 * 写入一次。拖动断面时后端只更新 geometry（PUT /sections/{id} 不动 distance），
 * 桩号不变，于是色带仍按旧桩号着色 —— 现象就是「断面已经移到别处，原地还留着一段颜色」。
 * 几何是唯一随拖动更新的真源，投影位置在拖动后立刻跟上。
 *
 * 取值口径：
 * - `bankLine` 是岸段 LineString 的 GeoJSON Feature，`totalDist` 是它按米计算的长度；
 * - 投影用断面**两端点的中点**而不是首点：两端点对断面被反向绘制不敏感；
 * - 投影算不出来（几何退化 / 岸段长度为 0）时回落桩号，宁可位置略偏也好过整段不着色。
 */
export function sectionProgressAlongBank(
  section: BandSectionLike | null | undefined,
  bankLine: unknown,
  totalDist: number,
): number | null {
  if (!Number.isFinite(totalDist) || totalDist <= 0) return null;
  const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

  const coordinates = section?.geometry?.coordinates;
  if (Array.isArray(coordinates) && coordinates.length >= 2) {
    const head = coordinates[0] as unknown;
    const tail = coordinates[coordinates.length - 1] as unknown;
    if (Array.isArray(head) && Array.isArray(tail)) {
      try {
        const midpoint = turf.point([
          (Number(head[0]) + Number(tail[0])) / 2,
          (Number(head[1]) + Number(tail[1])) / 2,
        ]);
        // 两端都用 meters 才可比：turf 的默认单位是 kilometers，必须显式指定。
        const snapped = turf.nearestPointOnLine(bankLine as never, midpoint, {
          units: 'meters',
        });
        const along = Number((snapped as { properties?: { location?: unknown } })?.properties?.location);
        if (Number.isFinite(along)) return clamp01(along / totalDist);
      } catch {
        // 落到下面的桩号兜底
      }
    }
  }

  const fallback = Number(section?.distance);
  return Number.isFinite(fallback) ? clamp01(fallback / totalDist) : null;
}
