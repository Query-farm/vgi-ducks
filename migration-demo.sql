-- Run from this project directory using stock DuckDB 2.0.0.
-- Requires network, no key. Cornell's sample is a non-duck species in Michigan.
SET allow_extension_repositories = 'allowed';
CREATE EXTENSION REPOSITORY IF NOT EXISTS query_farm
  WITH PREFIX 'https://duckdb-extensions.query.farm';
INSTALL vgi FROM query_farm;
LOAD vgi FROM query_farm;
INSTALL spatial FROM core;
LOAD spatial;
SET geometry_always_xy = true;
ATTACH 'ducks' (TYPE vgi, LOCATION './bin/vgi-ducks-worker');

CREATE TEMP TABLE ranges AS
SELECT * FROM ducks.main.seasonal_ranges('yebsap-example');

-- Illustrative polygon, not an official wetland boundary.
WITH wetlands AS (
  SELECT 'example Michigan site' AS name,
         ST_GeomFromText('POLYGON((-85.1 44.9,-84.9 44.9,-84.9 45.1,-85.1 45.1,-85.1 44.9))') AS geom
)
SELECT w.name, r.season, r.start_date, r.end_date, r.wraps_year
FROM ranges AS r
JOIN wetlands AS w ON ST_Intersects(ST_GeomFromWKB(r.geometry_wkb), w.geom)
ORDER BY w.name, r.season;

CREATE TEMP TABLE weekly AS
SELECT * FROM ducks.main.weekly_abundance(
  'yebsap-example', 'POLYGON((-90 41,-82 41,-82 49,-90 49,-90 41))'
);
SELECT week_date, mean_relative_abundance, modeled_cell_count,
       selected_cell_count, coverage_fraction
FROM weekly ORDER BY week_date;

-- Peak abundance is not an observed arrival date.
SELECT week_date, mean_relative_abundance, coverage_fraction
FROM ducks.main.migration_calendar(
  'yebsap-example', 'POLYGON((-90 41,-82 41,-82 49,-90 49,-90 41))'
)
ORDER BY week_date;
