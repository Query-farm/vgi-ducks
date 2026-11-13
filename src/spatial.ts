import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { booleanValid } from "@turf/boolean-valid";
import { kinks } from "@turf/kinks";
import type { MultiPolygon, Polygon } from "geojson";
import * as wkx from "wkx";

export type Region = { geometry: Polygon | MultiPolygon; wkb: Uint8Array; bounds: [number, number, number, number] };
export function parseRegion(wkt: string): Region {
  if (wkt.length > 200_000) throw new Error("region_wkt exceeds 200000 characters; simplify the region first");
  let parsed: wkx.Geometry;
  try {
    parsed = wkx.Geometry.parse(wkt);
  } catch {
    throw new Error("region_wkt must be a valid WGS84 POLYGON or MULTIPOLYGON");
  }
  if (parsed.hasZ || parsed.hasM || (parsed.srid !== undefined && parsed.srid !== 4326))
    throw new Error("region_wkt must be two-dimensional WGS84 longitude/latitude");
  if (!(parsed instanceof wkx.Polygon) && !(parsed instanceof wkx.MultiPolygon))
    throw new Error("region_wkt must be POLYGON or MULTIPOLYGON");
  const geometry = parsed.toGeoJSON() as Polygon | MultiPolygon;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const points = polygons.flat(2);
  if (points.length < 4 || points.length > 2000)
    throw new Error("region_wkt must contain 4 to 2000 vertices; simplify larger regions");
  const xs: number[] = [],
    ys: number[] = [];
  for (const p of points) {
    if (
      p.length !== 2 ||
      !Number.isFinite(p[0]) ||
      !Number.isFinite(p[1]) ||
      Math.abs(p[0] ?? Infinity) > 180 ||
      Math.abs(p[1] ?? Infinity) > 90
    )
      throw new Error("region_wkt coordinates must be finite WGS84 longitude/latitude");
    xs.push(p[0] as number);
    ys.push(p[1] as number);
  }
  const bounds: [number, number, number, number] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  if (bounds[2] - bounds[0] > 180)
    throw new Error("Regions spanning the antimeridian or more than 180 degrees must be split into separate queries");
  if (bounds[0] === bounds[2] || bounds[1] === bounds[3] || !booleanValid(geometry) || kinks(geometry).features.length)
    throw new Error("region_wkt must be a valid, non-self-intersecting polygon with nonzero area");
  // Turf's basic validity check does not reject detached/nested holes or
  // fully contained MultiPolygon members. Validate these containment cases.
  for (const rings of polygons) {
    const outer = rings[0];
    if (!outer) throw new Error("region_wkt has an empty polygon");
    for (const ring of rings) {
      let twiceArea = 0;
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1],
          b = ring[i];
        if (a && b) twiceArea += (a[0] ?? 0) * (b[1] ?? 0) - (b[0] ?? 0) * (a[1] ?? 0);
      }
      if (twiceArea === 0) throw new Error("region_wkt rings must have nonzero area");
    }
    const holes = rings.slice(1);
    for (const hole of holes) {
      if (
        !hole.every((p) =>
          booleanPointInPolygon(p, { type: "Polygon", coordinates: [outer] }, { ignoreBoundary: true }),
        )
      )
        throw new Error("region_wkt holes must lie strictly inside their outer ring");
      for (const other of holes) {
        if (other !== hole && hole.some((p) => booleanPointInPolygon(p, { type: "Polygon", coordinates: [other] })))
          throw new Error("region_wkt holes must not overlap or contain one another");
      }
    }
    for (const other of polygons) {
      if (
        other !== rings &&
        outer.some((p) => booleanPointInPolygon(p, { type: "Polygon", coordinates: other }, { ignoreBoundary: true }))
      )
        throw new Error("region_wkt MultiPolygon members must not overlap");
    }
  }
  return { geometry, wkb: parsed.toWkb(), bounds };
}
export function containsCenter(region: Region, longitude: number, latitude: number): boolean {
  return booleanPointInPolygon([longitude, latitude], region.geometry, { ignoreBoundary: true });
}
/** GeoPackage binary header includes SRS/envelope before ordinary WKB (OGC 12-128r19). */
export function unpackGeoPackage(bytes: Uint8Array, expectedSrs: number): Uint8Array {
  if (bytes.length < 13 || bytes[0] !== 71 || bytes[1] !== 80 || bytes[2] !== 0)
    throw new Error("Invalid GeoPackage geometry header");
  const flags = bytes[3] ?? 0;
  if (flags & 0xe0) throw new Error("Unsupported extended/reserved GeoPackage geometry flags");
  const srs = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(4, (flags & 1) !== 0);
  if (srs !== expectedSrs) throw new Error("GeoPackage geometry SRS disagrees with layer metadata");
  const envelope = (flags >> 1) & 7;
  const sizes = [0, 32, 48, 48, 64];
  const envelopeBytes = sizes[envelope];
  if (envelopeBytes === undefined || bytes.length < 8 + envelopeBytes + 5)
    throw new Error("Invalid GeoPackage geometry envelope");
  if (flags & 16) throw new Error("Empty seasonal range geometry is not supported");
  const wkb = bytes.slice(8 + envelopeBytes);
  try {
    const geometry = wkx.Geometry.parse(Buffer.from(wkb));
    if (!(geometry instanceof wkx.Polygon) && !(geometry instanceof wkx.MultiPolygon)) throw new Error("not polygon");
    if (geometry.hasZ || geometry.hasM) throw new Error("not 2D");
  } catch {
    throw new Error("Seasonal range must contain valid two-dimensional polygon WKB");
  }
  return wkb;
}
