# Verification record

Verified locally on 2026-11-13, macOS ARM64, Bun 1.3.14.

The worker, including GeoPackage/GeoTIFF parsing and coordinate transforms, is
TypeScript. Python is used only for fixtures, taxonomy maintenance and SQL
verification tooling. GDAL/PROJ/Shapely were used as independent development
references, not worker dependencies.

## Provenance and versions

- Starter: https://github.com/Query-farm/vgi-starter-typescript
- Starter version: 1.3.0; source commit `145aedcb87ed8fadde6dfb8a26197d0d68112369`.
- Initialized with `make init NAME=ducks`; baseline `make check` passed before adaptation.
- SDK: `@query-farm/vgi` 0.50.0; transport `@query-farm/vgi-rpc` 0.29.7;
  Arrow `@query-farm/apache-arrow` 21.1.1. Starter SDK pins preserved; new
  migration dependencies are recorded in `bun.lock`.
- SQL suite: Haybarn 2.0.0rc11 (`haybarn-unittest`).
- Additional engine: stock DuckDB 2.0.0, signed VGI extension `e75482339d`
  from the Query Farm extension repository. Signature verification remained enabled.

## Completed checks

| Command/check | Result |
| --- | --- |
| `make check` | Passed formatting, lint, TypeScript, unit tests, SQL transports and metadata |
| Bun unit/subprocess tests | 27 passed, 126 assertions |
| Haybarn stdio SQL | 183 assertions, 3 test files, no skips; includes starter recipes |
| Haybarn Unix launch SQL | 183 assertions, 3 test files, no skips; includes starter recipes |
| Haybarn HTTP SQL | 147 assertions, 2 test files, no skips |
| Metadata | 100/100, zero findings, L2 behavioral; offline species example executed |
| Optional `make lint-ai` via fixture wrapper | Passed L3 semantic, zero findings; static 100, agent 100, doc-quality 62, combined score 92/100 |
| `make verify-stock` | 26 result checks, 22 expected-error checks, precedence checks for both secret types passed |
| `make test-migration-sample` | 5 checks against real public GeoPackage/GeoTIFF data through stock DuckDB + Spatial |
| `make verify-taxonomy` | All 140 rows matched the live public eBird taxonomy version 2026 |
| Compiled artifact | Full fixture contract and all 5 public-sample checks passed from an extracted temporary directory |
| `git diff --check` | Passed |
| Hosted GitHub CI | Passed Linux and Windows SQL lanes, unit/type checks, vgi-lint, stock DuckDB and Docker smoke test |

Stock engine reports are saved in [verification-stock.json](verification-stock.json)
and [verification-package.json](verification-package.json). Public sample reports
are [verification-sample.json](verification-sample.json) and
[verification-package-sample.json](verification-package-sample.json).

The compiled artifact was built with:

```sh
bun build src/worker.ts --compile --outfile dist/vgi-ducks-worker
```

It was archived with README, LICENSE and migration-demo.sql, extracted to a temporary directory, and
launched with that directory as its working directory. No checkout data files or
node_modules were present there. This verified embedded taxonomy and API behavior
with the fixture server. The same extracted executable also read the real
compressed public raster and GeoPackage, verifying the bundled TIFF decoder and
SQLite support. Repeat the contract against an extracted executable with:

```sh
python3 scripts/with_fixtures.py \
  uv run --no-project --with duckdb==2.0.0 python scripts/verify_stock.py \
  --worker /absolute/path/to/extracted/vgi-ducks-worker \
  --output /absolute/path/to/report.json
```

The SQL tests cover source identifiers, the species-specific endpoint, date-only
observations, nullable and zero counts, independent validity/review flags,
coordinate rounding/distances, hotspot joins, empty arrays, NULL/range errors,
unknown/extinct codes, invalid upstream values, the response cap, HTTP 401/403/503,
429 retries, secret lookup and environment-key precedence. HTTP tests also check
bounded payloads, malformed JSON and Retry-After handling. The mock checks actual
request headers and API parameters.

Migration tests cover WKB transport and real `ST_Intersects`, `ST_Contains` and
`ST_IsValid` queries through DuckDB Spatial. Synthetic fixtures exercise polygon
holes, multipart geometry, cross-year seasons, byte order and GeoPackage
envelopes, true zero versus NoData, no geographic coverage, positive tied peaks,
invalid projections/dates/geometry, unavailable products, auth failures and key
redaction. Detached/nested holes and overlapping multipart regions are rejected.

## Public migration data

Cornell's `ebird/ebirdst_example-data` repository is pinned at
`a3ab944f505ad6f583e0c830d5e951929446e9eb`. The sample contains 2023
Yellow-bellied Sapsucker data restricted to Michigan, at 27 km resolution.
It is explicitly labeled as a non-duck sample in SQL metadata and documentation.

Real downloads were queried without an access key. All endpoint overrides were
cleared. Four valid WGS84 seasonal geometries were decoded; three intersected
`ST_Point(-85,45)`. The nonbreeding dates wrap from November 22 to March 8.
For `POLYGON((-90 41,-82 41,-82 49,-90 49,-90 41))`:

- 52 weekly rows, January 4 through December 27, 2023.
- Peak week: April 19, 2023.
- Mean relative abundance: `0.6447039050788048`.
- Maximum relative abundance: `1.890009880065918`.
- 779 selected native cell centers, 289 modeled cells at the peak.
- Peak coverage: `0.37098844672657255`.

An independent Rasterio/GDAL read, pyproj/PROJ transform from EPSG:8857 to
EPSG:4326, and Shapely/GEOS point-in-polygon mask produced the same selected and
modeled counts, peak week, maximum and float64 mean. Shapely independently
validated all four GeoPackage geometries and the point intersections. Neither
this comparison nor the sample establishes authenticated duck-product access.

## Live limitations

No personal `EBIRD_API_KEY` was configured. **Live recent-sightings and hotspot
queries were not run**; those paths were verified through deterministic fixtures
over all three VGI transports and stock DuckDB. `make test-live` is provided for
an account holder and refuses to run without the key.

A separate Status and Trends key was supplied for the Virginia notebook below.
Authenticated 2023 seasonal ranges and weekly abundance were successfully read
for Wood Duck (`wooduc`), Bufflehead (`buffle`), and Blue-winged Teal (`buwtea`)
at 27 km. The key was passed only through the process environment and was not
written to notebook cells, outputs, or the repository. Other authenticated
species, resolutions, and model releases remain unverified. The default model
year remains explicitly 2023. All fixture endpoint overrides were cleared.

The metadata checker executes only the credential-free species example; its L2
score does not establish live eBird API behavior. The optional L3 agent check and
documentation review also passed, run with the deterministic fixture wrapper for
authenticated functions and the public Status sample for migration tasks. The
agent score was 100/100; the combined semantic score was 92/100 with zero findings.
These metadata checks do not themselves establish live authenticated access. Hosted CI built the Docker
image and compiled/tested the Windows executable; local execution used macOS ARM64.

The pre-release hosted run is [GitHub CI 43461372220](https://github.com/Query-farm/vgi-ducks/actions/runs/43461372220).

## Tested attach and query

After installing/loading VGI from `query_farm` as shown in README:

```sql
ATTACH 'ducks' (
  TYPE vgi,
  LOCATION '/Users/rusty/Development/vgi-ducks/bin/vgi-ducks-worker'
);
SELECT species_code, scientific_name, taxonomy_version
FROM ducks.main.species
WHERE common_name = 'Mallard'
ORDER BY species_code;
-- mallar3 | Anas platyrhynchos | 2026
```

This additional query was verified against the authenticated fixture, and uses the
same interface for live data after setting `EBIRD_API_KEY` or an `ebird` secret:

```sql
SELECT common_name, observed_at_local, reported_count,
       observation_valid::INTEGER, observation_reviewed::INTEGER
FROM ducks.main.recent_sightings(42.36, -71.06)
ORDER BY common_name;
```

This complete spatial query was verified against the real public sample:

```sql
INSTALL spatial FROM core;
LOAD spatial;
SET geometry_always_xy = true;
SELECT season
FROM ducks.main.seasonal_ranges('yebsap-example')
WHERE ST_Intersects(ST_GeomFromWKB(geometry_wkb), ST_Point(-85,45))
ORDER BY season;
-- breeding, postbreeding_migration, prebreeding_migration
```

See [migration-demo.sql](migration-demo.sql) for a polygon join, weekly summaries
and the peak calendar using the same public sample.

## Executed Virginia notebook

[Reader notebook](notebooks/spatial-migration.ipynb) and
[executable source](notebooks/virginia-ducks.source.ipynb) were regenerated using
`make notebook`. All 26 source code cells executed through stock DuckDB 2.0.0.
The duck worker was the published `v0.1.0` executable, attached through
`github-auto://Query-farm/vgi-ducks@v0.1.0`. The second catalog was the local
TypeScript Overture worker at commit
`d23d65e422d2b93a7faa264c718691520a05bd23`, using release `2026-10-21.0`.
Its native Parquet scans include all four required bounding-box predicates.

The run retrieved all 800 eligible family-level records from the GBIF occurrence
API, restricted to iNaturalist Research-grade Observations, Virginia, 2024–2025,
human observations marked present, coordinates without flagged geospatial issues,
known coordinate uncertainty of 0–250 meters, and record-level CC0/CC BY licenses.
Pagination counts and unique record identifiers were validated before caching.
Exact scientific-name matching against extant ducks retained 582 records;
`ST_Covers` against Overture's territorial Virginia geometry retained 580 records
across 29 species. The local cache includes source links, licenses, query filters,
retrieval time and SHA256; raw observations are not committed.

Overture supplied both territorial and land boundary variants. A simplified
territorial polygon with 181 vertices selected 149 native 27 km cell centers for
each eBird model. Authenticated downloads produced 156 weekly rows and 12 valid
seasonal range geometries. Every selected center had a modeled value in every
week for these three products. Model review configuration was checked separately:
all four seasons passed review with quality 3 for each selected species.

| 2023 model | Highest modeled week | Mean relative abundance |
| --- | --- | --- |
| Wood Duck | March 22 | 0.3407222494520497 |
| Bufflehead | December 27 | 1.5731030255540481 |
| Blue-winged Teal | April 5 | 0.022746213539909795 |

These are regional modeled relative-abundance peaks, not arrival dates or total
populations. The notebook separately intersects the seasonal range polygons with
Virginia and reports territorial area overlap. Its model-year labels, grid-center
selection, simplification tolerance, coverage definition, and limits are explicit.

The three local water windows retained 206 records in Northern Virginia, 29 near
Richmond, and 64 in Hampton Roads. After projection to EPSG:26918, `ST_DWithin`
found 183, 28, and 62 records respectively within 500 m of the selected mapped
water polygons. Pools, drainage basins, and wastewater features are excluded.
This proximity calculation uses recorded coordinates and does not establish
habitat suitability or public access.

Five figures were visually inspected: the state observation map, top-species
counts, monthly reporting heatmap, three-species annual model curves with
coverage, and three local water maps. SQL performs the joins, spatial predicates,
aggregates, and VGI function calls. Python handles public GBIF retrieval and
plotting. JupySQL uses one SQLAlchemy connection so temporary tables and session
variables persist.

The renderer validates both notebook files, checks that every source cell ran,
requires five embedded PNGs, and rejects outputs containing configured credentials.
It generates the reader by removing setup cells and turning plotted figures into
Markdown image attachments. Analytical SQL and result tables remain visible;
the complete source preserves all setup code with Jupyter collapse metadata.
A standalone HTML preview is written to ignored `dist/notebooks/`.

The notebook's final checks cover observation uniqueness, species/month totals,
Virginia containment, all three water windows, 52 unique weeks per model,
nonnegative abundance, coverage bounds, and valid seasonal geometries.
`make check` was rerun after the notebook work: all unit and SQL transport checks
passed, and vgi-lint remained 100/100 with zero findings at L2.
