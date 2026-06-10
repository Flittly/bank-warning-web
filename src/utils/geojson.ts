type AnyGeoJSON = GeoJSON.GeoJSON;

function stripZFromCoords(coords: any): any {
  if (!Array.isArray(coords)) return coords;
  if (coords.length === 0) return coords;

  // Position: [x, y] or [x, y, z, ...]
  if (typeof coords[0] === 'number') {
    if (coords.length <= 2) return coords;
    return [coords[0], coords[1]];
  }

  // Nested coordinates
  return coords.map(stripZFromCoords);
}

function stripZFromGeometry(geometry: any): any {
  if (!geometry || typeof geometry !== 'object') return geometry;

  if (geometry.type === 'GeometryCollection') {
    const geometries = Array.isArray(geometry.geometries) ? geometry.geometries : [];
    return {
      ...geometry,
      geometries: geometries.map(stripZFromGeometry),
    };
  }

  if ('coordinates' in geometry) {
    return {
      ...geometry,
      coordinates: stripZFromCoords((geometry as any).coordinates),
    };
  }

  return geometry;
}

function stripZFromGeoJSONInner(input: any): any {
  if (!input || typeof input !== 'object') return input;

  if (input.type === 'FeatureCollection') {
    const features = Array.isArray(input.features) ? input.features : [];
    return {
      ...input,
      features: features.map(stripZFromGeoJSONInner),
    };
  }

  if (input.type === 'Feature') {
    return {
      ...input,
      geometry: stripZFromGeometry(input.geometry),
      // properties 保持浅拷贝，避免外部引用被意外修改
      properties: input.properties ? { ...(input.properties as any) } : input.properties,
    };
  }

  // Geometry
  if (typeof input.type === 'string') {
    return stripZFromGeometry(input);
  }

  return input;
}

/**
 * 将 GeoJSON 中的坐标从 [x, y, z] 归一为 [x, y]。
 * 解决后端 PostGIS 列为 2D 时写入 3D Geometry 报错的问题。
 */
export function stripZFromGeoJSON<T extends AnyGeoJSON>(input: T): T {
  return stripZFromGeoJSONInner(input) as T;
}
