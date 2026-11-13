# Test fixtures

The eBird JSON records and migration binaries are synthetic fixtures, not
downloaded observations or estimates. Fake credentials are checked by the local
mock API; no account key is included.

`migration.gpkg`, `migration.tif` and `band-dates.csv` are reproducible with
`bun scripts/make_migration_fixtures.ts`. The GeoPackage has polygon holes,
multipart geometry and a winter season crossing New Year. The three-band,
3-by-2 Equal Earth raster distinguishes zero from NoData and has a known peak.
Fixture Mallard code `mallar3` is chosen for testing; it does not assert that this
code exists in the real 2023 Status release.

`make test-migration-sample` separately reads Cornell's pinned public 2023
Yellow-bellied Sapsucker products and executes spatial SQL against their real
GeoPackage/GeoTIFF formats. Those files are not bundled in this repository.
