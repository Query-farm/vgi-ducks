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
export const VERSION = "0.1.3";

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
  "Duck data for birders and analysts from the Cornell Lab of Ornithology, in two families. Observation data " +
  "comes from the eBird API 2.0: recent reported sightings of duck species near a point and the birding hotspots " +
  "around it, which need an ebird DuckDB secret or EBIRD_API_KEY. Migration data comes from eBird Status and " +
  "Trends: modeled seasonal range polygons and weekly relative abundance summarized over a WGS84 region, which " +
  "need a separate ebirdst secret or EBIRDST_KEY, except Cornell's public yebsap-example sample. An offline " +
  "species reference table (a bundled eBird 2026 taxonomy subset) supplies the species codes both families take. " +
  "Observations are bounded recent snapshots with local wall-clock times and reported counts, not population " +
  "estimates or a historical archive. Status and Trends values are modeled distributions for a model year " +
  "(default 2023) whose species codes can differ from the current taxonomy; they are not individual tracks or " +
  "live forecasts, so read coverage alongside abundance.";
/** One plain paragraph shown as the worker's directory description (VGI107); the guide lives in doc_md/doc_llm. */
export const CATALOG_COMMENT =
  "Duck species reference data, recent eBird sightings and nearby birding hotspots, plus eBird Status and " +
  "Trends seasonal ranges, weekly regional abundance and migration calendars, all from the Cornell Lab of " +
  "Ornithology. Sightings and hotspots need an eBird API key.";
export const CATALOG_DOC_MD =
  "# VGI Ducks\n\n" +
  CATALOG_DOC_LLM +
  "\n\n## How the parts fit\n\n" +
  "Look a duck up in the species table to get its eBird code, then pass that code to the observation or " +
  "migration functions. Sightings and hotspots share eBird location identifiers, so a join shows which " +
  "birding sites have reported ducks. Range polygons are WKB for DuckDB Spatial, and regional abundance takes " +
  "a longitude/latitude polygon, so the two compose with any geometry you already have. Join with weather and " +
  "tide workers to explore conditions at sighting locations.\n\n" +
  "## Caveats\n\n" +
  "Data are supplied by the Cornell Lab of Ornithology's [eBird](https://ebird.org) and its terms apply. " +
  "The worker preserves source identifiers and review flags; a missing count is SQL NULL. Only species-level " +
  "records are kept: hybrids, domestic forms and unidentified groups are excluded.\n\n" +
  "## Sources and references\n\n" +
  "- [eBird API 2.0 documentation](https://documenter.getpostman.com/view/664302/S1ENwy59): the " +
  "API behind the sightings and hotspots functions; [request an eBird API key](https://ebird.org/api/keygen).\n" +
  "- [eBird Status and Trends](https://science.ebird.org/en/status-and-trends): the modeled " +
  "ranges, abundance and migration data; [request Status and Trends data access](https://ebird.org/st/request) " +
  "for the ebirdst key.";
/** The schema's one-line comment; the richer Markdown lives in `SCHEMA_DOC_MD` (VGI102). */
export const SCHEMA_COMMENT =
  "Duck species reference table, eBird sightings and hotspots, and Status and Trends ranges and abundance.";
export const SCHEMA_DOC_LLM =
  "The one schema of the ducks worker. Start from the offline species table: it maps common and scientific " +
  "names to the eBird species codes every other object takes, and flags extinct taxa, which observation " +
  "requests reject. Observation functions read the live eBird API around a latitude/longitude within a small " +
  "radius and a short lookback; migration functions read Cornell's modeled Status and Trends products for a " +
  "species and model year. Explicit NULL arguments are rejected everywhere, and every result is bounded rather " +
  "than an exhaustive archive.";
export const SCHEMA_DOC_MD =
  "## main\n\n" +
  "Everything the worker exposes lives here. Use the offline species table to find current eBird codes and " +
  "scientific names, then pass a code to the live observation functions (eBird API key) or the modeled " +
  "migration functions (Status and Trends key, or the public sample).\n\nObservation results keep local times and " +
  "unknown counts and cover only a recent lookback window; migration results are modeled seasonal patterns " +
  "whose coverage should be checked before comparing weeks. Load DuckDB Spatial to work with the range " +
  "geometry and region polygons.";
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
