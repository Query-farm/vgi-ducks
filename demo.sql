-- Run from the vgi-ducks project directory with stock DuckDB 2.0.0.
-- API queries require EBIRD_API_KEY set before starting DuckDB, or an ebird secret.
SET allow_extension_repositories = 'allowed';
CREATE EXTENSION REPOSITORY IF NOT EXISTS query_farm
  WITH PREFIX 'https://duckdb-extensions.query.farm';
INSTALL vgi FROM query_farm;
LOAD vgi FROM query_farm;
ATTACH 'ducks' (TYPE vgi, LOCATION './bin/vgi-ducks-worker');

SELECT species_code, common_name, scientific_name
FROM ducks.main.species
WHERE genus = 'Aix' AND NOT extinct
ORDER BY common_name;

SELECT common_name, observed_at_local, reported_count, location_name
FROM ducks.main.recent_sightings(42.36, -71.06)
ORDER BY common_name;

SELECT location_name, reported_count, observed_at_local, distance_km
FROM ducks.main.recent_sightings(42.36, -71.06, species_code := 'mallar3')
ORDER BY distance_km, location_name;

SELECT location_name, distance_km, all_bird_species_count
FROM ducks.main.nearby_hotspots(42.36, -71.06)
ORDER BY distance_km, location_name LIMIT 5;
