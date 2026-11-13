/**
 * Discovery metadata: the one file to edit when you rename or extend the worker.
 *
 * DuckDB, coding agents and the `vgi-lint` metadata checker all read these
 * tags. Keep every object documented and `make lint-explain` stays at 100.
 *
 * - Catalog-level tags (title, license, author, links, long description) live in
 *   `CATALOG_TAGS` below.
 * - Every function carries `objectTags(...)`: a title, a category from
 *   `SCHEMA_CATEGORIES`, search keywords, and LLM- and human-facing docs.
 */

import { field, type VgiDataType, type VgiField } from "@query-farm/vgi";

export const CATALOG_NAME = "ducks";
export const VERSION = "0.1.1";

export const SOURCE_URL = "https://github.com/Query-farm/vgi-ducks";

/**
 * Categories group functions in docs and agent tools. Every object's
 * `vgi.category` must name one of these.
 */
export const SCHEMA_CATEGORIES = [
  { name: "api", title: "Duck observations", description: "eBird sightings, hotspots and duck reference data." },
  {
    name: "migration",
    title: "Spatial migration patterns",
    description: "Modeled seasonal ranges and weekly regional abundance.",
  },
] as const;

export type Category = (typeof SCHEMA_CATEGORIES)[number]["name"];

/** Turn `"a, b, c"` into the JSON array string `vgi.keywords` requires. */
export function keywordsArray(keywords: string): string {
  return JSON.stringify(
    keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
  );
}

/** Build the standard per-object discovery tags. */
export function objectTags(opts: {
  title: string;
  category: Category;
  keywords: string;
  docLlm: string;
  docMd: string;
}): Record<string, string> {
  return {
    "vgi.title": opts.title,
    "vgi.category": opts.category,
    "vgi.keywords": keywordsArray(opts.keywords),
    "vgi.doc_llm": opts.docLlm,
    "vgi.doc_md": opts.docMd,
  };
}

/** Build an Arrow field whose `comment` shows up in DuckDB's `DESCRIBE` and agent tools. */
export function column(name: string, type: VgiDataType, comment: string, nullable = true): VgiField {
  return field(name, type, nullable, new Map([["comment", comment]]));
}

export const CATALOG_DOC_LLM =
  "Duck species reference data and recent eBird sightings for birders and analysts. The species table " +
  "is a bundled eBird 2026 taxonomy subset, available offline. recent_sightings(latitude, longitude) " +
  "returns the most recent observation per duck species nearby; pass species_code to obtain the most " +
  "recent observation at each location for that species. nearby_hotspots returns birding locations for " +
  "all birds, not confirmed duck sites. These two API functions require an ebird DuckDB secret or EBIRD_API_KEY. " +
  "Observation times are local wall-clock strings, not UTC; counts are reported individuals, not population estimates. " +
  "seasonal_ranges supplies WGS84 WKB polygons for DuckDB Spatial. weekly_abundance summarizes modeled relative " +
  "abundance within a WGS84 polygon; migration_calendar returns its positive peak weeks. These Status and Trends " +
  "functions need a separate ebirdst secret or EBIRDST_KEY, except the public yebsap-example sample. " +
  "The default model year is 2023; model-release species codes can differ from the current taxonomy. " +
  "These patterns are not individual tracks or live migration forecasts. Always inspect coverage_fraction.";
export const CATALOG_DOC_MD =
  "# VGI Ducks\n\n" +
  CATALOG_DOC_LLM +
  "\n\nData are supplied by the Cornell Lab of Ornithology's [eBird](https://ebird.org). " +
  "The worker preserves source identifiers and review flags. A missing count is SQL NULL. " +
  "Species-level records only: hybrids, domestic forms and unidentified groups are excluded. " +
  "Use SQL joins with weather and tide workers to explore conditions at sighting locations.";
export const SCHEMA_DOC_LLM =
  CATALOG_DOC_LLM +
  " Query ducks.main.species to find codes and common/scientific names. The table includes extinct " +
  "taxa flagged extinct; sighting requests reject extinct codes. Radius is 0–50 km and days_back is " +
  "1–30 for sightings. A hotspot days_back value of 0 means no recency filter. Explicit NULL arguments " +
  "are rejected. API results are bounded snapshots, not a complete historical observation archive.";
export const SCHEMA_DOC_MD = `## main\n\n${CATALOG_DOC_LLM}\n\nUse the offline species table to find current eBird codes and scientific names. Join sightings and hotspots on location_id to identify birding sites with reported ducks. Observations retain local times and unknown counts; the 1–30 day lookback does not provide a historical archive.\n\nLoad DuckDB Spatial and convert seasonal geometry_wkb with ST_GeomFromWKB for spatial joins. Weekly region_wkt is a longitude/latitude Polygon or MultiPolygon; holes are honored. Modeled zeros remain zero; missing predictions yield NULL abundance. The public sample is Yellow-bellied Sapsucker data restricted to Michigan, not duck data.`;
export const AGENT_TEST_TASKS = [
  {
    name: "mallard_code",
    prompt: "Find the eBird species code and scientific name of Mallard in the ducks species table.",
  },
  {
    name: "nearby_ducks",
    prompt:
      "With an eBird key configured, list the common name and local observation time for the latest sighting of each duck species within 25 km of Boston (42.36, -71.06), ordered by common name.",
  },
  {
    name: "birding_hotspots",
    prompt:
      "With an eBird key configured, find the five nearest birding hotspots within 25 km of Boston (42.36, -71.06); return location name and distance in km, ordered by distance and name.",
  },
  {
    name: "seasonal_ranges",
    prompt:
      "Using the public yebsap-example sample, list each seasonal range's season, start_date, end_date and wraps_year, ordered by season.",
  },
  {
    name: "weekly_abundance",
    prompt:
      "Using the public yebsap-example sample, return week_date, mean_relative_abundance and coverage_fraction for the WGS84 rectangle from longitude -90 to -82 and latitude 41 to 49, ordered by week_date.",
  },
  {
    name: "migration_calendar",
    prompt:
      "Using the public yebsap-example sample, find all positive peak weeks for the WGS84 rectangle from longitude -90 to -82 and latitude 41 to 49. Return week_date, mean_relative_abundance and coverage_fraction, ordered by week_date.",
  },
];
export const CATALOG_TAGS: Record<string, string> = {
  "vgi.title": "VGI Ducks",
  "vgi.subtitle":
    "Query duck species, sightings, seasonal range polygons and weekly regional abundance using Cornell Lab of Ornithology data.",
  "vgi.doc_llm": CATALOG_DOC_LLM,
  "vgi.doc_md": CATALOG_DOC_MD,
  "vgi.source_url": SOURCE_URL,
  "vgi.icon_url": "https://query.farm/media-kit/products/vgi/vgi-logo.png",
  "vgi.license": "0BSD",
  "vgi.author": "Query.Farm",
  "vgi.copyright": "Copyright 2026 Query.Farm LLC",
  "vgi.keywords": keywordsArray(
    "ducks, ebird, ornithology, sightings, hotspots, waterfowl, taxonomy, migration, spatial, abundance",
  ),
  "vgi.support_contact": `${SOURCE_URL}/issues`,
  "vgi.support_policy_url": `${SOURCE_URL}#support`,
  "vgi.agent_test_tasks": JSON.stringify(AGENT_TEST_TASKS),
};
export const SCHEMA_TAGS: Record<string, string> = {
  "vgi.title": "Ducks and Birding",
  domain: "ornithology",
  "vgi.keywords": keywordsArray(
    "duck, species, birding, recent sightings, nearby hotspots, seasonal range, spatial, migration",
  ),
  "vgi.doc_llm": SCHEMA_DOC_LLM,
  "vgi.doc_md": SCHEMA_DOC_MD,
  "vgi.categories": JSON.stringify(SCHEMA_CATEGORIES),
};
