import * as turf from '@turf/turf';
import { coordsToVerticalFootPoint } from './verticalFootPoint';

export function generatePerpendicularLines(
  line: GeoJSON.Feature<GeoJSON.LineString>,
  startDist: number,
  endDist: number,
  interval: number,
  crossLength: number
) {
  const perpendicularLines: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  const endpointData: { distance: number; left: number[]; right: number[] }[] = [];

  const actualStart = Math.min(startDist, endDist);
  const actualEnd = Math.max(startDist, endDist);
  const lineLength = turf.length(line, { units: 'meters' });
  const segmentLen = actualEnd - actualStart;

  console.log(
    `--- 生成垂线数据 (范围: ${actualStart.toFixed(2)}m - ${actualEnd.toFixed(2)}m, 段长: ${segmentLen.toFixed(
      2,
    )}m, 母线总长: ${lineLength.toFixed(2)}m) ---`,
  );

  for (let d = actualStart; d <= actualEnd; d += interval) {
    const p1 = turf.along(line, d, { units: 'meters' });
    const p2Offset = Math.min(d + 0.1, lineLength);
    const p2 = turf.along(line, p2Offset, { units: 'meters' });

    const anchorCoords = (p1.geometry.coordinates as number[]) || [];
    const verticalFootPoint = coordsToVerticalFootPoint(anchorCoords);

    const relPos = segmentLen > 0 ? (d - actualStart) / segmentLen : 0;
    console.log(
      `垂线位置: ${d.toFixed(2)}m, 整线归一化: ${(d / lineLength).toFixed(4)}, 区段内归一化: ${relPos.toFixed(4)}`,
    );

    let bearing = 0;
    if (d >= lineLength - 0.1) {
      const pPrev = turf.along(line, Math.max(0, d - 0.1), { units: 'meters' });
      bearing = turf.bearing(pPrev, p1);
    } else {
      bearing = turf.bearing(p1, p2);
    }

    const leftEnd = turf.destination(p1, crossLength / 2, bearing - 90, { units: 'meters' });
    const rightEnd = turf.destination(p1, crossLength / 2, bearing + 90, { units: 'meters' });

    const leftCoords = leftEnd.geometry.coordinates;
    const rightCoords = rightEnd.geometry.coordinates;

    endpointData.push({
      distance: d,
      left: leftCoords,
      right: rightCoords,
    });

    perpendicularLines.push({
      type: 'Feature',
      properties: {
        distance: d,
        ...(verticalFootPoint ? { vertical_foot_point: verticalFootPoint } : {}),
        leftPoint: leftCoords,
        rightPoint: rightCoords,
      },
      geometry: {
        type: 'LineString',
        coordinates: [leftCoords, rightCoords],
      },
    });
  }

  return {
    featureCollection: turf.featureCollection(perpendicularLines),
    endpointData,
  };
}
