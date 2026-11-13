/** Seasonal range geometry and weekly polygon summaries from eBird Status and Trends. */
import { Database } from "bun:sqlite";
import { int64, utf8 } from "@query-farm/vgi";
import { parse } from "csv-parse/sync";
import { fromArrayBuffer } from "geotiff";
import proj4 from "proj4";
import { containsCenter, parseRegion, type Region, unpackGeoPackage } from "./spatial.ts";
import {
  downloadProduct,
  productFiles,
  productPath,
  STATUS_AUTH,
  type StatusArgs,
  validateStatus,
} from "./status-api.ts";
import { type Column, oneShot, type Row } from "./table.ts";

const EQUAL_EARTH = "+proj=eqearth +lon_0=0 +datum=WGS84 +units=m +no_defs";
const SEASONS = ["breeding", "nonbreeding", "prebreeding_migration", "postbreeding_migration", "resident"];
export interface RangeArgs extends StatusArgs {
  season: string;
}
export interface AbundanceArgs extends StatusArgs {
  region_wkt: string;
}
function text(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid Status data ${name}`);
  return value;
}
export function modelDate(value: unknown, year: number): string {
  const date = text(value, "date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number(date.slice(0, 4)) !== year)
    throw new Error("Invalid Status model date/year");
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== date)
    throw new Error("Invalid Status model date");
  return date;
}
export function parseRanges(bytes: Uint8Array, args: RangeArgs): Row[] {
  let db: Database;
  try {
    db = Database.deserialize(bytes, { readonly: true });
  } catch {
    throw new Error("Invalid Status GeoPackage database");
  }
  try {
    db.exec("PRAGMA trusted_schema=OFF");
    const metadata = db
      .query<{ column_name: string; geometry_type_name: string; srs_id: number }, []>(
        "SELECT column_name,geometry_type_name,srs_id FROM gpkg_geometry_columns WHERE table_name='range'",
      )
      .all();
    if (
      metadata.length !== 1 ||
      metadata[0]?.column_name !== "geom" ||
      metadata[0]?.srs_id !== 4326 ||
      !["POLYGON", "MULTIPOLYGON"].includes(metadata[0]?.geometry_type_name ?? "")
    )
      throw new Error("Seasonal range GeoPackage must have the range.geom polygon layer in EPSG:4326");
    const records = db
      .query<Record<string, unknown>, []>(
        `SELECT geom,species_code,scientific_name,common_name,prediction_year,type,season,start_date,end_date FROM "range" LIMIT 11`,
      )
      .all();
    if (records.length > 10) throw new Error("Unexpected number of seasonal range features");
    const seen = new Set<string>();
    return records
      .map((r): Row => {
        const season = text(r.season, "season");
        if (!SEASONS.includes(season) || seen.has(season))
          throw new Error("Invalid or duplicate seasonal range season");
        seen.add(season);
        const sourceCode = text(r.species_code, "species code");
        const expected = args.species_code === "yebsap-example" ? "yebsap" : args.species_code;
        if (sourceCode !== expected || r.prediction_year !== Number(args.data_year) || r.type !== "range")
          throw new Error("Seasonal range product identity/year mismatch");
        const start = modelDate(r.start_date, Number(args.data_year)),
          end = modelDate(r.end_date, Number(args.data_year));
        if (!(r.geom instanceof Uint8Array)) throw new Error("Missing seasonal range geometry");
        return {
          species_code: sourceCode,
          product_species_code: args.species_code,
          common_name: text(r.common_name, "common name"),
          scientific_name: text(r.scientific_name, "scientific name"),
          prediction_year: Number(args.data_year),
          season,
          start_date: start,
          end_date: end,
          wraps_year: end < start,
          resolution_km: parseInt(args.resolution, 10),
          geometry_wkb: unpackGeoPackage(r.geom, 4326),
          geometry_crs: "EPSG:4326",
          source_product: productPath(args, "ranges"),
        };
      })
      .filter((row) => !args.season || row.season === args.season);
  } catch (error) {
    // Errors never include SQL parameters, download URLs or access keys.
    if (error instanceof Error && /GeoPackage|season|Status|range|identity/.test(error.message)) throw error;
    throw new Error("Cannot read the expected seasonal range GeoPackage schema");
  } finally {
    db.close();
  }
}
function parseBandDates(csv: Uint8Array, year: number): Map<number, string> {
  let records: Record<string, string>[];
  try {
    records = parse(csv, { columns: true, bom: true, skip_empty_lines: true, max_record_size: 1024 }) as Record<
      string,
      string
    >[];
  } catch {
    throw new Error("Invalid Status band-dates CSV");
  }
  if (records.length < 1 || records.length > 52) throw new Error("Status band-dates CSV must have 1 to 52 rows");
  const result = new Map<number, string>();
  const dates = new Set<string>();
  for (const row of records) {
    const band = Number(row.band);
    const date = modelDate(row.date, year);
    if (!Number.isInteger(band) || band < 1 || band > 52 || result.has(band) || dates.has(date))
      throw new Error("Invalid or duplicate Status band/date");
    result.set(band, date);
    dates.add(date);
  }
  return result;
}
/** Parse the real TIFF and summarize cells whose WGS84 centers are strictly inside the region. */
export async function summarizeWeekly(
  bytes: Uint8Array,
  dateBytes: Uint8Array,
  args: AbundanceArgs,
  region: Region = parseRegion(args.region_wkt),
): Promise<Row[]> {
  const dates = parseBandDates(dateBytes, Number(args.data_year));
  const tiff = await fromArrayBuffer(bytes.slice().buffer as ArrayBuffer);
  try {
    const image = await tiff.getImage();
    const keys = image.getGeoKeys();
    if (keys?.ProjectedCSTypeGeoKey !== 8857 || keys.GTRasterTypeGeoKey !== 1 || keys.ProjLinearUnitsGeoKey !== 9001)
      throw new Error("Weekly abundance requires an EPSG:8857 Equal Earth, metre, pixel-area GeoTIFF");
    if (image.fileDirectory.hasTag("ModelTransformation")) throw new Error("Rotated abundance grids are not supported");
    const [ox, oy] = image.getOrigin();
    const [sx, sy] = image.getResolution();
    if (
      ox === undefined ||
      oy === undefined ||
      sx === undefined ||
      sy === undefined ||
      ![ox, oy, sx, sy].every(Number.isFinite) ||
      sx <= 0 ||
      sy >= 0 ||
      Math.abs(sx + sy) > 1e-6 ||
      Math.abs(sx - parseInt(args.resolution, 10) * 1000) > 1e-3
    )
      throw new Error("Weekly abundance grid resolution disagrees with the requested product");
    const samples = image.getSamplesPerPixel();
    if (samples < 1 || samples > 52) throw new Error("Expected 1 to 52 weekly abundance bands");
    const weeks: string[] = [];
    for (let band = 0; band < samples; band++) {
      const metadata = await image.getGDALMetadata(band);
      const date = modelDate(metadata?.DESCRIPTION ?? dates.get(band + 1), Number(args.data_year));
      if (!new Set(dates.values()).has(date) || weeks.includes(date))
        throw new Error("TIFF band dates do not match the product's unique model weeks");
      weeks.push(date);
    }
    const transform = proj4("EPSG:4326", EQUAL_EARTH);
    // Equal Earth's extrema over a lon/lat rectangle occur at its longitude edges
    // and latitude edges, or the equator (where the horizontal scale is greatest).
    const [west, south, east, north] = region.bounds;
    const latitudes = [south, north, ...(south < 0 && north > 0 ? [0] : [])];
    const corners = [west, east].flatMap((lon) => latitudes.map((lat) => transform.forward([lon, lat])));
    const xs = corners.map((p) => p[0] as number),
      ys = corners.map((p) => p[1] as number);
    const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
    const x0 = clamp(Math.floor((Math.min(...xs) - ox) / sx) - 1, image.getWidth());
    const x1 = clamp(Math.ceil((Math.max(...xs) - ox) / sx) + 1, image.getWidth());
    const y0 = clamp(Math.floor((Math.max(...ys) - oy) / sy) - 1, image.getHeight());
    const y1 = clamp(Math.ceil((Math.min(...ys) - oy) / sy) + 1, image.getHeight());
    const width = x1 - x0,
      height = y1 - y0,
      cells = width * height;
    if (cells > 50_000 || cells * samples > 2_600_000)
      throw new Error("Region exceeds the 50000-cell decode window; use a smaller region or coarser resolution");
    const selected: number[] = [];
    for (let row = 0; row < height; row++)
      for (let col = 0; col < width; col++) {
        const [lon, lat] = transform.inverse([ox + (x0 + col + 0.5) * sx, oy + (y0 + row + 0.5) * sy]);
        if (
          lon !== undefined &&
          lat !== undefined &&
          Number.isFinite(lon) &&
          Number.isFinite(lat) &&
          containsCenter(region, lon, lat)
        )
          selected.push(row * width + col);
      }
    const nodata = image.getGDALNoData();
    const rasters =
      cells > 0 && selected.length > 0
        ? await image.readRasters({
            window: [x0, y0, x1, y1],
            samples: Array.from({ length: samples }, (_, i) => i),
            interleave: false,
          })
        : null;
    return weeks.map((week, band): Row => {
      let total = 0,
        maximum = 0,
        modeled = 0;
      const values = rasters?.[band];
      if (values && typeof values !== "number" && typeof values !== "bigint") {
        for (const index of selected) {
          const value = Number(values[index]);
          if (Number.isNaN(value) || (nodata !== null && value === nodata)) continue;
          if (!Number.isFinite(value) || value < 0)
            throw new Error("Invalid negative/nonfinite relative abundance in modeled cell");
          total += value;
          maximum = Math.max(maximum, value);
          modeled++;
        }
      }
      return {
        species_code: args.species_code === "yebsap-example" ? "yebsap" : args.species_code,
        product_species_code: args.species_code,
        prediction_year: Number(args.data_year),
        week_date: week,
        mean_relative_abundance: modeled ? total / modeled : null,
        max_relative_abundance: modeled ? maximum : null,
        selected_cell_count: selected.length,
        modeled_cell_count: modeled,
        coverage_fraction: selected.length ? modeled / selected.length : null,
        resolution_km: parseInt(args.resolution, 10),
        region_wkb: region.wkb,
        geometry_crs: "EPSG:4326",
        source_product: productPath(args, "weekly"),
      };
    });
  } finally {
    await tiff.close();
  }
}
export function peakWeeks(rows: Row[]): Row[] {
  const finite = rows
    .map((r) => r.mean_relative_abundance)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const peak = Math.max(0, ...finite);
  return peak > 0 ? rows.filter((r) => r.mean_relative_abundance === peak) : [];
}
export async function loadWeekly(args: AbundanceArgs, key?: string): Promise<Row[]> {
  const region = parseRegion(args.region_wkt);
  const files = await productFiles(args, key);
  const bytes = await downloadProduct(args, files, "weekly", key);
  const dates = await downloadProduct(args, files, "dates", key);
  return summarizeWeekly(bytes, dates, args, region);
}
const STATUS_ARGS = { species_code: utf8(), data_year: int64(), resolution: utf8() };
const STATUS_DEFAULTS = { data_year: 2023, resolution: "27km" };
const STATUS_DOCS = {
  species_code:
    "Species code in the selected model release, not necessarily the current taxonomy code. yebsap-example is a public non-duck sample.",
  data_year:
    "Explicit Status data version/prediction year; default 2023 (verified format). Not a current-year migration forecast.",
  resolution:
    "Native product resolution: 27km (default), 9km or, for weekly grids, 3km. Downloads are bounded to 128 MiB.",
};
const STATUS_CONSTRAINTS = { data_year: { ge: 2022, le: 2100 }, resolution: { choices: ["27km", "9km", "3km"] } };
const SHARED_DOCS =
  "Uses the eBird Status and Trends file API with a separate ebirdst TOKEN secret or EBIRDST_KEY. yebsap-example reads Cornell's public Yellow-bellied Sapsucker sample without credentials, only for 2023/27km. Model-release species codes are not silently mapped to the offline 2026 taxonomy. data_year is explicit and defaults to 2023; unavailable products fail clearly. Responses are bounded to 128 MiB and all NULL arguments are rejected. These are modeled seasonal distributions, not individual migration tracks or live forecasts. Access/data terms apply. No key, signed URL or downloaded file is retained in table state.";
const RANGE_COLUMNS: Column[] = [
  ["species_code", "VARCHAR", "Species identifier recorded in the model product.", false],
  [
    "product_species_code",
    "VARCHAR",
    "Requested product identifier; yebsap-example identifies the public sample.",
    false,
  ],
  ["common_name", "VARCHAR", "English common name recorded in the model product.", false],
  ["scientific_name", "VARCHAR", "Scientific name recorded in the model product.", false],
  ["prediction_year", "INTEGER", "Model prediction year, not the retrieval year.", false],
  ["season", "VARCHAR", "breeding, nonbreeding, prebreeding_migration, postbreeding_migration or resident.", false],
  ["start_date", "VARCHAR", "Model-season start date in YYYY-MM-DD format.", false],
  [
    "end_date",
    "VARCHAR",
    "Model-season end date; an earlier date than start_date wraps into the next annual cycle.",
    false,
  ],
  ["wraps_year", "BOOLEAN", "True when the season crosses New Year; preserves upstream date labels.", false],
  ["resolution_km", "INTEGER", "Native grid spacing in km used to derive the smoothed range.", false],
  ["geometry_wkb", "BLOB", "Smoothed Polygon/MultiPolygon WKB in WGS84 longitude/latitude; use ST_GeomFromWKB.", false],
  [
    "geometry_crs",
    "VARCHAR",
    "Geometry coordinate reference system, always EPSG:4326; coordinates are longitude/latitude.",
    false,
  ],
  ["source_product", "VARCHAR", "Upstream object path, without credentials or signed download URL.", false],
];
export const seasonalRanges = oneShot<RangeArgs>({
  name: "seasonal_ranges",
  category: "migration",
  title: "Seasonal Duck Range Polygons",
  description: "Read modeled seasonal range polygons as WGS84 WKB for DuckDB Spatial joins",
  columns: RANGE_COLUMNS,
  args: { ...STATUS_ARGS, season: utf8() },
  argDefaults: { ...STATUS_DEFAULTS, season: "" },
  argDocs: { ...STATUS_DOCS, season: "Optional season filter; empty string returns all available seasons." },
  argConstraints: {
    ...STATUS_CONSTRAINTS,
    resolution: { choices: ["27km", "9km"] },
    season: { choices: ["", ...SEASONS] },
  },
  auth: STATUS_AUTH,
  validate: validateStatus,
  load: async (args, key) =>
    parseRanges(await downloadProduct(args, await productFiles(args, key), "ranges", key), args),
  keywords: "migration, seasonal range, polygons, geometry, spatial, ebird status, waterfowl",
  docs: `seasonal_ranges(species_code, data_year := 2023, resolution := '27km', season := '') returns one smoothed range polygon per available season. geometry_wkb is ordinary WKB after removing the GeoPackage envelope; geometry_crs is EPSG:4326, x=longitude and y=latitude. Convert with ST_GeomFromWKB and use ST_Intersects against wetlands or protected areas. Set geometry_always_xy=true for DuckDB 2 spatial work. start_date/end_date preserve model dates and wraps_year identifies winter seasons crossing New Year. Range boundaries summarize nonzero modeled abundance and do not establish individual travel corridors. ${SHARED_DOCS}`,
  examples: [
    {
      sql: "SELECT season, start_date, end_date, wraps_year FROM ducks.main.seasonal_ranges('yebsap-example') ORDER BY season",
      description: "Inspect season dates in Cornell's public sample (requires network, not a key)",
    },
    {
      sql: "SELECT season FROM ducks.main.seasonal_ranges('yebsap-example') WHERE ST_Intersects(ST_GeomFromWKB(geometry_wkb), ST_Point(-85,45)) ORDER BY season",
      description: "Find seasonal ranges intersecting a point using DuckDB Spatial",
    },
  ],
});
const WEEKLY_COLUMNS: Column[] = [
  ["species_code", "VARCHAR", "Species identifier from the selected model release.", false],
  [
    "product_species_code",
    "VARCHAR",
    "Requested product identifier; yebsap-example identifies the public sample.",
    false,
  ],
  ["prediction_year", "INTEGER", "Model prediction year, not the current year.", false],
  ["week_date", "VARCHAR", "Model week's date label in YYYY-MM-DD format; not an observed arrival date.", false],
  [
    "mean_relative_abundance",
    "DOUBLE",
    "Mean expected birds per standardized 1-hour, 2-km checklist across modeled cells inside the region; NULL without modeled cells.",
  ],
  [
    "max_relative_abundance",
    "DOUBLE",
    "Maximum expected birds per standardized checklist among modeled cells inside the region; NULL without modeled cells.",
  ],
  [
    "selected_cell_count",
    "INTEGER",
    "Count of native grid cell centers strictly inside the polygon and raster extent, including unmodeled cells.",
    false,
  ],
  [
    "modeled_cell_count",
    "INTEGER",
    "Count of selected cells with a finite prediction, including true zero abundance.",
    false,
  ],
  [
    "coverage_fraction",
    "DOUBLE",
    "Modeled cell count / selected cell count (0–1); NULL when the region contains no raster cell centers.",
  ],
  ["resolution_km", "INTEGER", "Native Equal Earth grid spacing in km; no interpolation or upsampling.", false],
  ["region_wkb", "BLOB", "Requested region as WGS84 polygon WKB; use ST_GeomFromWKB to map or join it.", false],
  ["geometry_crs", "VARCHAR", "Region coordinate reference system: EPSG:4326, x=longitude and y=latitude.", false],
  ["source_product", "VARCHAR", "Upstream weekly raster object path, without credentials.", false],
];
const REGION_EXAMPLE = "POLYGON((-90 41,-82 41,-82 49,-90 49,-90 41))";
const WEEKLY_DOCS = `weekly_abundance(species_code, region_wkt, data_year := 2023, resolution := '27km') summarizes every available weekly median relative-abundance band inside a WGS84 POLYGON or MULTIPOLYGON in longitude/latitude order. Polygon holes and multipart regions are respected; centers on boundaries are excluded. Equal Earth EPSG:8857 grid cells have equal area, so the mean weights selected modeled cell centers equally; it is not an exact area-clipped polygon mean or a bird population total. Zero predictions remain zero. NoData is excluded and reported through modeled_cell_count and coverage_fraction; no modeled cells gives NULL abundance. Changing coverage can affect week-to-week comparisons. Original band dates are preserved; no 52-week completeness is assumed. At most 2000 region vertices and 50000 cells in the bounding decode window are allowed. Regions spanning the antimeridian must be split into separate queries. ${SHARED_DOCS}`;
const weeklyConfig = {
  args: { species_code: utf8(), region_wkt: utf8(), data_year: int64(), resolution: utf8() },
  argDefaults: STATUS_DEFAULTS,
  argDocs: {
    ...STATUS_DOCS,
    region_wkt:
      "Valid 2D WGS84 Polygon/MultiPolygon WKT, x=longitude, y=latitude. Use ST_AsText on a region geometry; holes are honored.",
  },
  argConstraints: STATUS_CONSTRAINTS,
  auth: STATUS_AUTH,
  validate: (args: AbundanceArgs) => {
    validateStatus(args);
    parseRegion(args.region_wkt);
  },
};
export const weeklyAbundance = oneShot<AbundanceArgs>({
  ...weeklyConfig,
  name: "weekly_abundance",
  category: "migration",
  title: "Weekly Regional Duck Abundance",
  description: "Summarize weekly modeled relative abundance inside a geographic polygon with coverage counts",
  columns: WEEKLY_COLUMNS,
  load: loadWeekly,
  keywords: "migration, weekly abundance, region, polygon, raster, geotiff, seasonality",
  docs: WEEKLY_DOCS,
  examples: [
    {
      sql: `SELECT week_date, mean_relative_abundance, coverage_fraction FROM ducks.main.weekly_abundance('yebsap-example', '${REGION_EXAMPLE}') ORDER BY week_date`,
      description: "Weekly seasonal pattern for the public sample in a Michigan bounding region",
    },
  ],
});
export const migrationCalendar = oneShot<AbundanceArgs>({
  ...weeklyConfig,
  name: "migration_calendar",
  category: "migration",
  title: "Peak Weeks of Regional Duck Abundance",
  description: "Find all positive peak weeks in a region's modeled annual abundance curve",
  columns: WEEKLY_COLUMNS,
  load: async (args, key) => peakWeeks(await loadWeekly(args, key)),
  keywords: "migration, peak week, calendar, seasonality, region, coverage",
  docs: `migration_calendar has the same arguments, units, geometry rules and coverage semantics as weekly_abundance. It returns all tied weeks with the highest positive mean relative abundance in the region. A series with only zero or NULL values returns no peak rows. Peak abundance does not establish arrival/departure dates or a migration event; breeding or winter residence can cause the peak. Compare coverage_fraction and modeled_cell_count before interpreting changes. ${WEEKLY_DOCS}`,
  examples: [
    {
      sql: `SELECT week_date, mean_relative_abundance, modeled_cell_count, coverage_fraction FROM ducks.main.migration_calendar('yebsap-example', '${REGION_EXAMPLE}') ORDER BY week_date`,
      description: "Locate positive peak weeks in the public sample, retaining coverage for interpretation",
    },
  ],
});
