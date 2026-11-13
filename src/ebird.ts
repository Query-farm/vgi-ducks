/** eBird v2: bounded snapshots, with local dates and unknown counts preserved. */
import { bool, float64, int64, utf8 } from "@query-farm/vgi";
import { endpoint, getJson } from "./http.ts";
import { SPECIES_BY_CODE } from "./species.ts";
import { type Column, oneShot, type Row } from "./table.ts";

export interface NearbyArgs {
  latitude: number;
  longitude: number;
  radius_km: number;
  days_back: bigint;
}
export interface SightingArgs extends NearbyArgs {
  species_code: string;
  hotspots_only: boolean;
  include_provisional: boolean;
}
const MAX_RESULTS = 10_000;
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid eBird record: expected an object");
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid eBird ${field}: expected nonempty text`);
  return value;
}
function optionalText(value: unknown, field: string): string | null {
  return value == null ? null : text(value, field);
}
function coordinate(value: unknown, field: string, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > maximum)
    throw new Error(`Invalid eBird ${field}`);
  return value;
}
function count(value: unknown, field: string): number | null {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 2147483647)
    throw new Error(`Invalid eBird ${field}: expected a nonnegative INTEGER`);
  return value;
}
function flag(value: unknown, field: string): boolean | null {
  if (value == null) return null;
  if (typeof value !== "boolean") throw new Error(`Invalid eBird ${field}: expected boolean`);
  return value;
}
/** Preserve date-only vs minute precision. eBird supplies local time without a UTC offset. */
export function localDate(value: unknown): string {
  const input = text(value, "local observation date");
  if (!/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(input)) throw new Error("Invalid eBird local observation date");
  const full = input.length === 10 ? `${input}T00:00:00` : `${input.replace(" ", "T")}:00`;
  const ms = Date.parse(`${full}Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 19) !== full)
    throw new Error("Invalid eBird local observation date");
  return input;
}
export function validateNearby(args: NearbyArgs): void {
  coordinate(args.latitude, "latitude", 90);
  coordinate(args.longitude, "longitude", 180);
  if (!Number.isFinite(args.radius_km) || args.radius_km < 0 || args.radius_km > 50)
    throw new Error("radius_km must be between 0 and 50");
}
export function validateSightings(args: SightingArgs): void {
  validateNearby(args);
  if (args.species_code) {
    const species = SPECIES_BY_CODE.get(args.species_code);
    if (!species) throw new Error("species_code must be a code in ducks.main.species (empty string selects all ducks)");
    if (species.extinct) throw new Error("Recent sightings cannot be requested for an extinct taxon");
  }
}
export function buildUrl(args: NearbyArgs, speciesCode?: string): URL {
  // The upstream documentation specifies geographic coordinates to two decimal places.
  const path =
    speciesCode === undefined
      ? "ref/hotspot/geo"
      : `data/obs/geo/recent${speciesCode ? `/${encodeURIComponent(speciesCode)}` : ""}`;
  const url = endpoint("DUCKS_EBIRD_BASE_URL", "https://api.ebird.org/v2", path);
  if (url.search || url.hash) throw new Error("DUCKS_EBIRD_BASE_URL must not contain query parameters or fragments");
  url.search = new URLSearchParams({
    lat: args.latitude.toFixed(2),
    lng: args.longitude.toFixed(2),
    dist: String(args.radius_km),
    fmt: "json",
  }).toString();
  if (args.days_back > 0n) url.searchParams.set("back", String(args.days_back));
  return url;
}
export function distanceKm(lat: number, lon: number, otherLat: number, otherLon: number): number {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((otherLat - lat) * rad) / 2) ** 2 +
    Math.cos(lat * rad) * Math.cos(otherLat * rad) * Math.sin(((otherLon - lon) * rad) / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, a))));
}
function rows(body: unknown): Record<string, unknown>[] {
  if (!Array.isArray(body)) throw new Error("Invalid eBird response: expected an array");
  if (body.length >= MAX_RESULTS)
    throw new Error(
      "eBird response reached the 10000-record limit; narrow the radius or date window to avoid incomplete results",
    );
  return body.map(object);
}
function location(record: Record<string, unknown>, args: NearbyArgs): Row {
  const latitude = coordinate(record.lat, "latitude", 90);
  const longitude = coordinate(record.lng, "longitude", 180);
  return {
    location_id: text(record.locId, "location ID"),
    location_name: text(record.locName, "location name"),
    latitude,
    longitude,
    distance_km: distanceKm(Number(args.latitude.toFixed(2)), Number(args.longitude.toFixed(2)), latitude, longitude),
  };
}
export function parseSightings(body: unknown, args: SightingArgs, fetchedAt = BigInt(Date.now()) * 1000n): Row[] {
  const result: Row[] = [];
  for (const record of rows(body)) {
    const code = text(record.speciesCode, "species code");
    const species = SPECIES_BY_CODE.get(code);
    if (!species || species.extinct || (args.species_code && code !== args.species_code)) continue;
    result.push({
      species_code: code,
      common_name: text(record.comName, "common name"),
      scientific_name: text(record.sciName, "scientific name"),
      ...location(record, args),
      observed_at_local: localDate(record.obsDt),
      reported_count: count(record.howMany, "reported count"),
      observation_valid: flag(record.obsValid, "obsValid"),
      observation_reviewed: flag(record.obsReviewed, "obsReviewed"),
      location_private: flag(record.locationPrivate, "locationPrivate"),
      checklist_id: optionalText(record.subId, "checklist ID"),
      fetched_at: fetchedAt,
    });
  }
  return result;
}
export function parseHotspots(body: unknown, args: NearbyArgs, fetchedAt = BigInt(Date.now()) * 1000n): Row[] {
  return rows(body).map((record) => ({
    ...location(record, args),
    country_code: optionalText(record.countryCode, "country code"),
    subnational1_code: optionalText(record.subnational1Code, "subnational1 code"),
    subnational2_code: optionalText(record.subnational2Code, "subnational2 code"),
    latest_observation_local: record.latestObsDt == null ? null : localDate(record.latestObsDt),
    all_bird_species_count: count(record.numSpeciesAllTime, "all-time species count"),
    fetched_at: fetchedAt,
  }));
}
const LOCATION_COLUMNS: Column[] = [
  ["location_id", "VARCHAR", "eBird location identifier (join sightings to hotspots on this column).", false],
  ["location_name", "VARCHAR", "eBird location display name; retain any access restrictions in the name.", false],
  ["latitude", "DOUBLE", "Location latitude in WGS84 decimal degrees.", false],
  ["longitude", "DOUBLE", "Location longitude in WGS84 decimal degrees.", false],
  [
    "distance_km",
    "DOUBLE",
    "Great-circle distance in km from the API search center, rounded to 2 decimal degrees.",
    false,
  ],
];
const SIGHTING_COLUMNS: Column[] = [
  ["species_code", "VARCHAR", "eBird code; joins to species.species_code.", false],
  ["common_name", "VARCHAR", "English common name returned by eBird.", false],
  ["scientific_name", "VARCHAR", "Scientific name returned by eBird.", false],
  ...LOCATION_COLUMNS,
  [
    "observed_at_local",
    "VARCHAR",
    "Local observation date/time as supplied: YYYY-MM-DD or YYYY-MM-DD HH:MM. No timezone is implied.",
    false,
  ],
  [
    "reported_count",
    "INTEGER",
    "Reported individuals; NULL means present but uncounted/missing. Never a population estimate.",
  ],
  ["observation_valid", "BOOLEAN", "eBird obsValid flag, preserved independently of manual review."],
  ["observation_reviewed", "BOOLEAN", "eBird obsReviewed flag; false does not necessarily mean invalid."],
  ["location_private", "BOOLEAN", "eBird locationPrivate flag; a shared location is not permission to enter."],
  ["checklist_id", "VARCHAR", "Source checklist identifier (subId), if supplied."],
  ["fetched_at", "TIMESTAMPTZ", "Time the worker retrieved this snapshot, UTC.", false],
];
const HOTSPOT_COLUMNS: Column[] = [
  ...LOCATION_COLUMNS,
  ["country_code", "VARCHAR", "eBird country code."],
  ["subnational1_code", "VARCHAR", "eBird state/province region code."],
  ["subnational2_code", "VARCHAR", "eBird county/district code."],
  ["latest_observation_local", "VARCHAR", "Latest reported local observation date/time for any bird, if supplied."],
  [
    "all_bird_species_count",
    "INTEGER",
    "All-time number of bird species at this hotspot, including non-ducks; NULL when absent.",
  ],
  ["fetched_at", "TIMESTAMPTZ", "Time the worker retrieved this snapshot, UTC.", false],
];
const GEO_DOCS = {
  latitude: "Search latitude in WGS84 decimal degrees (-90 to 90); sent rounded to two decimal places.",
  longitude: "Search longitude in WGS84 decimal degrees (-180 to 180); sent rounded to two decimal places.",
  radius_km: "Search radius from the rounded center in km, 0 to 50; default 25.",
};
const GEO_CONSTRAINTS = {
  latitude: { ge: -90, le: 90 },
  longitude: { ge: -180, le: 180 },
  radius_km: { ge: 0, le: 50 },
};
export const recentSightings = oneShot<SightingArgs>({
  name: "recent_sightings",
  title: "Recent Nearby Duck Sightings",
  description: "Read the latest nearby sighting per duck species, or per location for a selected species",
  columns: SIGHTING_COLUMNS,
  args: {
    latitude: float64(),
    longitude: float64(),
    radius_km: float64(),
    days_back: int64(),
    species_code: utf8(),
    hotspots_only: bool,
    include_provisional: bool,
  },
  argDefaults: { radius_km: 25, days_back: 14, species_code: "", hotspots_only: false, include_provisional: false },
  argDocs: {
    ...GEO_DOCS,
    days_back: "Lookback in days, 1 to 30; default 14.",
    species_code:
      "Empty string returns latest per duck species; an extant code from species returns latest per location for that duck.",
    hotspots_only: "Only return sightings at eBird hotspots; default false.",
    include_provisional:
      "Include provisional observations in the upstream search; default false. Inspect validity/review flags.",
  },
  argConstraints: { ...GEO_CONSTRAINTS, days_back: { ge: 1, le: 30 } },
  authenticated: true,
  validate: validateSightings,
  load: async (args, token) => {
    const url = buildUrl(args, args.species_code);
    for (const [name, value] of Object.entries({
      maxResults: MAX_RESULTS,
      hotspot: args.hotspots_only,
      includeProvisional: args.include_provisional,
      sppLocale: "en",
    }))
      url.searchParams.set(name, String(value));
    if (!args.species_code) {
      url.searchParams.set("cat", "species");
      url.searchParams.set("sort", "date");
    }
    return parseSightings(await getJson(url, { token }), args);
  },
  keywords: "ducks, ebird, sightings, nearby, birding, observations, mallard",
  docs: "recent_sightings(latitude, longitude, radius_km := 25, days_back := 14, species_code := '', hotspots_only := false, include_provisional := false) reads the eBird recent nearby API and keeps extant species in the bundled duck catalog. Empty species_code returns only the latest sighting per species across the search area. A species code selects the species-specific endpoint: latest sighting per location. Neither mode is an exhaustive checklist history. Observation times remain local strings with original date/minute precision; missing counts and flags are NULL. Coordinates are sent rounded to two decimal places; radius is 0–50 km, lookback 1–30 days. An ebird secret TOKEN or EBIRD_API_KEY is required. Responses reaching the 10000-record cap fail rather than claiming completeness. All explicit NULL arguments are rejected. Upstream 429/5xx responses are retried with bounded backoff; no invented pagination or zero observations on failure.",
  examples: [
    {
      sql: "SELECT common_name, observed_at_local FROM ducks.main.recent_sightings(42.36, -71.06) ORDER BY common_name",
      description: "Latest sighting per duck species near Boston (requires eBird key)",
    },
    {
      sql: "SELECT location_name, reported_count, observed_at_local FROM ducks.main.recent_sightings(42.36, -71.06, species_code := 'mallar3') ORDER BY observed_at_local DESC, location_name",
      description: "Latest Mallard sighting at each nearby location (requires eBird key)",
    },
  ],
});
export const nearbyHotspots = oneShot<NearbyArgs>({
  name: "nearby_hotspots",
  title: "Nearby Birding Hotspots",
  description: "Find nearby eBird birding locations for all birds, with distance and reporting history",
  columns: HOTSPOT_COLUMNS,
  args: { latitude: float64(), longitude: float64(), radius_km: float64(), days_back: int64() },
  argDefaults: { radius_km: 25, days_back: 0 },
  argDocs: {
    ...GEO_DOCS,
    days_back: "0 (default) omits recency filtering; 1 to 30 restricts to hotspots visited in that many days.",
  },
  argConstraints: { ...GEO_CONSTRAINTS, days_back: { ge: 0, le: 30 } },
  authenticated: true,
  validate: validateNearby,
  load: async (args, token) => parseHotspots(await getJson(buildUrl(args), { token }), args),
  keywords: "ebird, hotspots, birding, locations, nearby, distance, ducks",
  docs: "nearby_hotspots(latitude, longitude, radius_km := 25, days_back := 0) reads eBird's nearby birding hotspots. These are locations for all birds, not evidence that ducks were seen there. Join location_id to recent_sightings for that evidence. all_bird_species_count counts all-time bird species, not ducks or individuals. days_back 0 omits the recency filter; 1–30 filters visits. WGS84 search coordinates are rounded to two decimals and distance_km is measured from that rounded center. Radius is limited to 0–50 km for consistency with sightings. Local dates retain original precision without assigning UTC; optional missing values become NULL. An ebird secret TOKEN or EBIRD_API_KEY is required. Explicit NULL arguments and responses reaching the 10000-record bound fail clearly.",
  examples: [
    {
      sql: "SELECT location_name, distance_km FROM ducks.main.nearby_hotspots(42.36, -71.06) ORDER BY distance_km, location_name LIMIT 5",
      description: "Five nearest birding hotspots to Boston (requires eBird key)",
    },
  ],
});
