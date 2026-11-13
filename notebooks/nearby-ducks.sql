-- Optional live example. Set demo_species, live_latitude and live_longitude first.
-- The species-specific endpoint returns the latest report at each location.
WITH sightings AS MATERIALIZED (
  SELECT * FROM ducks.main.recent_sightings(
    getvariable('live_latitude'), getvariable('live_longitude'),
    species_code := getvariable('demo_species'),
    radius_km := 25, days_back := 14, hotspots_only := true)
), hotspots AS MATERIALIZED (
  SELECT * FROM ducks.main.nearby_hotspots(
    getvariable('live_latitude'), getvariable('live_longitude'), radius_km := 25)
)
SELECT s.common_name, h.location_name, s.observed_at_local,
       s.reported_count, round(h.distance_km, 1) AS distance_km,
       timezone('UTC', s.fetched_at) AS sightings_fetched_at_utc
FROM sightings s JOIN hotspots h USING (location_id)
ORDER BY distance_km, h.location_name;
