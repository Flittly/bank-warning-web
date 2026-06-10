export type VerticalFootPoint = {
  type: 'Point';
  coordinates: [number, number];
};

const isFiniteNumber = (v: any) => typeof v === 'number' && Number.isFinite(v);

export function coordsToVerticalFootPoint(coords: any): VerticalFootPoint | null {
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const x = Number(coords[0]);
  const y = Number(coords[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { type: 'Point', coordinates: [x, y] };
}

export function normalizeVerticalFootPoint(input: any): VerticalFootPoint | null {
  if (!input) return null;

  // Already GeoJSON Point-like
  if (typeof input === 'object' && input.type === 'Point' && Array.isArray((input as any).coordinates)) {
    return coordsToVerticalFootPoint((input as any).coordinates);
  }

  // Legacy: [lng, lat]
  if (Array.isArray(input)) {
    return coordsToVerticalFootPoint(input);
  }

  return null;
}

export function getVerticalFootPointFromAny(source: any): VerticalFootPoint | null {
  if (!source) return null;

  // Common naming variants
  const candidates = [
    (source as any).vertical_foot_point,
    (source as any).verticalFootPoint,
    // legacy
    (source as any).anchorPoint,
    (source as any).anchor_point,
    (source as any).anchor,
  ];

  for (const c of candidates) {
    const n = normalizeVerticalFootPoint(c);
    if (n) return n;
  }

  return null;
}

export function getVerticalFootCoordsFromAny(source: any): [number, number] | null {
  const p = getVerticalFootPointFromAny(source);
  return p ? p.coordinates : null;
}

export function setVerticalFootPointOnProps(props: any, coords: any): void {
  if (!props) return;
  const p = coordsToVerticalFootPoint(coords);
  if (!p) return;
  (props as any).vertical_foot_point = p;

  // Keep legacy removed intentionally; consumers should migrate.
  // If some older part of the UI still relies on anchorPoint,
  // it should use getVerticalFootCoordsFromAny() instead.
}

export function isValidVerticalFootPoint(p: any): p is VerticalFootPoint {
  return (
    !!p &&
    typeof p === 'object' &&
    p.type === 'Point' &&
    Array.isArray((p as any).coordinates) &&
    (p as any).coordinates.length >= 2 &&
    isFiniteNumber((p as any).coordinates[0]) &&
    isFiniteNumber((p as any).coordinates[1])
  );
}
