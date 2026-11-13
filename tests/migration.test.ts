import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { writeArrayBuffer } from "geotiff";
import proj4 from "proj4";
import * as wkx from "wkx";
import { getBytes } from "../src/http.ts";
import { type AbundanceArgs, modelDate, parseRanges, peakWeeks, summarizeWeekly } from "../src/migration.ts";
import { containsCenter, parseRegion, unpackGeoPackage } from "../src/spatial.ts";
import { STATUS_AUTH, validateStatus } from "../src/status-api.ts";

const region = "POLYGON((-1 -1,2 -1,2 2,-1 2,-1 -1))";
const args: AbundanceArgs = { species_code: "mallar3", data_year: 2023n, resolution: "27km", region_wkt: region };
const fixture = async (name: string) =>
  new Uint8Array(await Bun.file(new URL(`../test/fixtures/${name}`, import.meta.url)).arrayBuffer());

test("region holes, multipart polygons and boundary exclusion", () => {
  const hole = parseRegion("POLYGON((0 0,4 0,4 4,0 4,0 0),(1 1,1 2,2 2,2 1,1 1))");
  expect(containsCenter(hole, 0.5, 0.5)).toBe(true);
  expect(containsCenter(hole, 1.5, 1.5)).toBe(false);
  expect(containsCenter(hole, 0, 2)).toBe(false);
  expect(containsCenter(hole, 1, 1.5)).toBe(false);
  const multi = parseRegion("MULTIPOLYGON(((0 0,1 0,1 1,0 1,0 0)),((2 2,3 2,3 3,2 3,2 2)))");
  expect(containsCenter(multi, 0.5, 0.5)).toBe(true);
  expect(containsCenter(multi, 2.5, 2.5)).toBe(true);
  expect(containsCenter(multi, 1.5, 1.5)).toBe(false);
});
test("invalid geometry, wrong CRS, self-intersections and antimeridian are rejected", () => {
  for (const value of [
    "POINT(0 0)",
    "POLYGON EMPTY",
    "POLYGON((0 0,2 2,0 2,2 0,0 0))",
    "SRID=3857;POLYGON((0 0,1 0,1 1,0 0))",
    "POLYGON Z((0 0 0,1 0 0,1 1 0,0 0 0))",
    "POLYGON((-179 0,179 0,179 1,-179 1,-179 0))",
    "POLYGON((0 0,2 0,2 2,0 2,0 0),(3 3,4 3,4 4,3 4,3 3))",
    "POLYGON((0 0,9 0,9 9,0 9,0 0),(1 1,8 1,8 8,1 8,1 1),(2 2,3 2,3 3,2 3,2 2))",
    "MULTIPOLYGON(((0 0,4 0,4 4,0 4,0 0)),((1 1,2 1,2 2,1 2,1 1)))",
    "POLYGON((0 0,1 1,2 2,0 0))",
  ])
    expect(() => parseRegion(value)).toThrow();
});
test("GeoPackage extraction preserves ordinary WKB, holes and cross-year seasons", async () => {
  const rows = parseRanges(await fixture("migration.gpkg"), { ...args, season: "" });
  expect(rows.map((r) => [r.season, r.wraps_year])).toEqual([
    ["breeding", false],
    ["nonbreeding", true],
  ]);
  expect(rows[0]?.geometry_crs).toBe("EPSG:4326");
  const geometry = wkx.Geometry.parse(Buffer.from(rows[0]?.geometry_wkb as Uint8Array));
  expect((geometry as wkx.Polygon).interiorRings).toHaveLength(1);
  expect(parseRanges(await fixture("migration.gpkg"), { ...args, season: "resident" })).toEqual([]);
});
test("GeoPackage validates SRS, product identity, headers and envelope offsets", async () => {
  const bytes = await fixture("migration.gpkg");
  const db = Database.deserialize(bytes);
  db.exec("UPDATE gpkg_geometry_columns SET srs_id=3857");
  expect(() => parseRanges(db.serialize(), { ...args, season: "" })).toThrow(/EPSG:4326/);
  db.close();
  expect(() => parseRanges(bytes, { ...args, species_code: "wooduc", season: "" })).toThrow(/mismatch/);
  expect(() => unpackGeoPackage(new Uint8Array(8), 4326)).toThrow(/header/);
  const wkb = wkx.Geometry.parse("POLYGON((0 0,1 0,1 1,0 0))").toWkb();
  for (const little of [true, false]) {
    const header = Buffer.alloc(40);
    header.write("GP");
    header[3] = 2 + (little ? 1 : 0);
    if (little) header.writeInt32LE(4326, 4);
    else header.writeInt32BE(4326, 4);
    expect(unpackGeoPackage(Buffer.concat([header, wkb]), 4326)).toEqual(new Uint8Array(wkb));
    expect(() => unpackGeoPackage(Buffer.concat([header, wkb]), 3857)).toThrow(/SRS/);
  }
});
test("weekly raster: true zero, NoData, coverage, model dates and peak week", async () => {
  const rows = await summarizeWeekly(await fixture("migration.tif"), await fixture("band-dates.csv"), args);
  expect(
    rows.map((r) => [
      r.week_date,
      r.mean_relative_abundance,
      r.max_relative_abundance,
      r.modeled_cell_count,
      r.coverage_fraction,
    ]),
  ).toEqual([
    ["2023-01-04", 3, 6, 4, 4 / 6],
    ["2023-01-11", 6, 11, 6, 1],
    ["2023-01-18", null, null, 0, 0],
  ]);
  expect(peakWeeks(rows).map((r) => r.week_date)).toEqual(["2023-01-11"]);
  expect(peakWeeks([{ mean_relative_abundance: null }, { mean_relative_abundance: 0 }])).toEqual([]);
  expect(peakWeeks([{ mean_relative_abundance: 1 }, { mean_relative_abundance: 1 }])).toHaveLength(2);
});
test("polygon holes remove native cell centers from the abundance mean", async () => {
  const [lon, lat] = proj4("+proj=eqearth +lon_0=0 +datum=WGS84 +units=m +no_defs", "EPSG:4326", [13500, 40500]);
  if (lon === undefined || lat === undefined) throw new Error("projection failed");
  const hole = `(${lon - 0.01} ${lat - 0.01},${lon - 0.01} ${lat + 0.01},${lon + 0.01} ${lat + 0.01},${lon + 0.01} ${lat - 0.01},${lon - 0.01} ${lat - 0.01})`;
  const result = await summarizeWeekly(await fixture("migration.tif"), await fixture("band-dates.csv"), {
    ...args,
    region_wkt: `POLYGON((-1 -1,2 -1,2 2,-1 2,-1 -1),${hole})`,
  });
  expect(result[0]).toMatchObject({ selected_cell_count: 5, modeled_cell_count: 3, mean_relative_abundance: 4 });
});
test("region with no cell centers yields NULL abundance and NULL coverage", async () => {
  const rows = await summarizeWeekly(await fixture("migration.tif"), await fixture("band-dates.csv"), {
    ...args,
    region_wkt: "POLYGON((40 40,41 40,41 41,40 41,40 40))",
  });
  expect(rows).toHaveLength(3);
  expect(rows[0]).toMatchObject({
    selected_cell_count: 0,
    modeled_cell_count: 0,
    mean_relative_abundance: null,
    coverage_fraction: null,
  });
});
test("weekly raster rejects mismatched projection, resolution and model dates", async () => {
  const bad = new Uint8Array(
    writeArrayBuffer(new Float32Array([1]), {
      width: 1,
      height: 1,
      ModelPixelScale: [1, 1, 0],
      ModelTiepoint: [0, 0, 0, 0, 0, 0],
      GeographicTypeGeoKey: 4326,
    }),
  );
  await expect(summarizeWeekly(bad, await fixture("band-dates.csv"), args)).rejects.toThrow(/EPSG:8857/);
  await expect(
    summarizeWeekly(await fixture("migration.tif"), await fixture("band-dates.csv"), { ...args, resolution: "9km" }),
  ).rejects.toThrow(/resolution/);
  await expect(
    summarizeWeekly(await fixture("migration.tif"), new TextEncoder().encode("band,date\n1,2023-02-30\n"), args),
  ).rejects.toThrow(/date/);
  expect(() => modelDate("2024-01-04", 2023)).toThrow(/year/);
});
test("sample has separate identity, restrictions and no access-key requirement", () => {
  expect(STATUS_AUTH.resolve({ ...args, species_code: "yebsap-example" }, {})).toBeUndefined();
  expect(STATUS_AUTH.resolve(args, { key: { type: "ebirdst", token: "secret-key" } })).toBe("secret-key");
  for (const code of ["../mallar3", "mallar3?key=x"])
    expect(() => validateStatus({ ...args, species_code: code })).toThrow();
  expect(() => validateStatus({ ...args, species_code: "yebsap-example", data_year: 2024n })).toThrow(/sample/);
});
test("binary redirects are bounded and errors never echo access keys", async () => {
  let calls = 0;
  const bytes = await getBytes("https://api.example/fetch?key=secret", {
    followRedirects: true,
    fetcher: async (url) => {
      calls++;
      if (calls === 1) return new Response(null, { status: 302, headers: { location: "https://files.example/data" } });
      expect(String(url)).toBe("https://files.example/data");
      return new Response(new Uint8Array([1, 2, 3]));
    },
  });
  expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
  await expect(
    getBytes("https://api.example/?key=secret", {
      followRedirects: true,
      fetcher: async () => new Response(null, { status: 302, headers: { location: "http://files.example/data" } }),
    }),
  ).rejects.toThrow(/unsafe redirect/);
  try {
    await getBytes("https://api.example/?key=DO_NOT_ECHO", {
      fetcher: async () => new Response("DO_NOT_ECHO", { status: 403 }),
    });
  } catch (error) {
    expect(String(error)).not.toContain("DO_NOT_ECHO");
  }
});
