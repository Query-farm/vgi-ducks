import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Arguments, VgiClient } from "@query-farm/vgi";
import { subprocessConnect } from "@query-farm/vgi-rpc";
import {
  buildUrl,
  distanceKm,
  localDate,
  parseHotspots,
  parseSightings,
  type SightingArgs,
  validateSightings,
} from "../src/ebird.ts";
import { getJson, getText, retryDelay } from "../src/http.ts";
import { SPECIES, SPECIES_BY_CODE } from "../src/species.ts";
import { resolveToken } from "../src/table.ts";
import hotspots from "../test/fixtures/hotspots.json";
import sightings from "../test/fixtures/sightings.json";

const ARGS: SightingArgs = {
  latitude: 42.36,
  longitude: -71.06,
  radius_km: 25,
  days_back: 14n,
  species_code: "",
  hotspots_only: false,
  include_provisional: false,
};
test("taxonomy: unique codes, deliberate duck scope, extinction flags and 2026 Mallard", () => {
  expect(SPECIES.length).toBe(140);
  expect(SPECIES_BY_CODE.size).toBe(140);
  expect(SPECIES.filter((x) => x.extinct)).toHaveLength(9);
  expect(SPECIES_BY_CODE.get("mallar3")?.scientific_name).toBe("Anas platyrhynchos");
  expect(SPECIES_BY_CODE.has("copgoo1")).toBe(true); // pygmy-geese are within this worker's duck scope
  for (const code of ["cangoo", "mutswa", "egygoo", "mallar2"]) expect(SPECIES_BY_CODE.has(code)).toBe(false);
});
test("sightings: excludes non-ducks/domestic forms, preserves absent count and source flags", () => {
  const parsed = parseSightings(sightings, ARGS, 0n);
  expect(parsed.map((x) => x.species_code)).toEqual(["mallar3", "wooduc"]);
  expect(parsed[0]).toMatchObject({
    reported_count: 7,
    observation_valid: true,
    observation_reviewed: false,
    distance_km: 0,
    fetched_at: 0n,
    checklist_id: "S100",
  });
  expect(parsed[1]).toMatchObject({ reported_count: null, observed_at_local: "2026-11-11", location_private: true });
  expect(parseSightings([], ARGS)).toEqual([]);
});
test("sightings: explicit zero and unknown review flags are distinct", () => {
  expect(
    parseSightings([{ ...sightings[0], howMany: 0, obsReviewed: undefined, obsValid: undefined }], ARGS)[0],
  ).toMatchObject({ reported_count: 0, observation_reviewed: null, observation_valid: null });
});
test("sightings: malformed values and cap fail rather than emitting incomplete or invented data", () => {
  for (const howMany of [-1, 1.5, "7", NaN, 2147483648])
    expect(() => parseSightings([{ ...sightings[0], howMany }], ARGS)).toThrow();
  expect(() => parseSightings([{ ...sightings[0], obsValid: "true" }], ARGS)).toThrow();
  expect(() => parseSightings([{ ...sightings[0], lat: 91 }], ARGS)).toThrow();
  expect(() => parseSightings({}, ARGS)).toThrow(/array/);
  expect(() => parseSightings(Array(10000).fill(sightings[0]), ARGS)).toThrow(/limit/);
});
test("local dates: retain date/minute precision, reject rollover and fabricated offsets", () => {
  expect(localDate("2024-02-29")).toBe("2024-02-29");
  expect(localDate("2026-11-01 01:30")).toBe("2026-11-01 01:30");
  for (const value of ["2025-02-29", "2026-02-30", "2026-11-12 24:00", "2026-11-12T08:15Z", null])
    expect(() => localDate(value)).toThrow();
});
test("hotspots: optional metadata and zero species count preserved", () => {
  const rows = parseHotspots(hotspots, ARGS, 0n);
  expect(rows[0]).toMatchObject({ all_bird_species_count: 120, distance_km: 0 });
  expect(rows[1]).toMatchObject({
    all_bird_species_count: null,
    latest_observation_local: null,
    subnational2_code: null,
  });
  expect(rows[2]?.all_bird_species_count).toBe(0);
});
test("great-circle distances: same point, quarter earth, dateline and antipodes", () => {
  expect(distanceKm(0, 0, 0, 0)).toBe(0);
  expect(distanceKm(0, 0, 0, 90)).toBeCloseTo(10007.557, 2);
  expect(distanceKm(0, 179, 0, -179)).toBeCloseTo(222.39, 2);
  expect(distanceKm(0, 0, 0, 180)).toBeCloseTo(20015.114, 2);
});
test("URL uses specific endpoint and hotspot no-recency omits back", () => {
  const url = buildUrl({ ...ARGS, latitude: 42.364 }, "mallar3");
  expect(url.pathname).toBe("/v2/data/obs/geo/recent/mallar3");
  expect(url.searchParams.get("lat")).toBe("42.36");
  expect(buildUrl({ ...ARGS, days_back: 0n }).searchParams.has("back")).toBe(false);
});
test("validation rejects extinct/non-duck codes and nonfinite coordinates", () => {
  for (const species_code of ["cangoo", "labduc", "../evil"])
    expect(() => validateSightings({ ...ARGS, species_code })).toThrow();
  for (const latitude of [NaN, Infinity, 91]) expect(() => validateSightings({ ...ARGS, latitude })).toThrow();
  validateSightings({ ...ARGS, species_code: "wooduc" });
});
test("key resolution: DuckDB secret takes precedence over environment", () => {
  const saved = process.env.EBIRD_API_KEY;
  try {
    process.env.EBIRD_API_KEY = "env-token";
    expect(resolveToken({ key: { type: "ebird", token: "secret-token" } })).toBe("secret-token");
    expect(resolveToken({})).toBe("env-token");
    delete process.env.EBIRD_API_KEY;
    expect(() => resolveToken({})).toThrow(/API key required/);
  } finally {
    if (saved === undefined) delete process.env.EBIRD_API_KEY;
    else process.env.EBIRD_API_KEY = saved;
  }
});
test("HTTP retries 429/503, honors Retry-After, and supplies header without following redirects", async () => {
  const waits: number[] = [];
  let calls = 0;
  const payload = await getJson("https://api.ebird.org/v2/example", {
    token: "secret-token",
    sleep: async (ms) => {
      waits.push(ms);
    },
    fetcher: async (_url, options) => {
      expect(options.redirect).toBe("error");
      expect(new Headers(options.headers).get("X-eBirdApiToken")).toBe("secret-token");
      calls++;
      return calls === 1
        ? new Response("", { status: 429, headers: { "Retry-After": "0" } })
        : calls === 2
          ? new Response("", { status: 503, headers: { "Retry-After": "1" } })
          : Response.json([]);
    },
  });
  expect(payload).toEqual([]);
  expect(waits).toEqual([0, 1000]);
  expect(calls).toBe(3);
  expect(retryDelay("Thu, 01 Jan 1970 00:00:05 GMT", 0, 1000)).toBe(4000);
});
test("HTTP fails clearly for auth, malformed JSON, oversized payloads and long retry delays", async () => {
  await expect(
    getJson("https://example.com", { fetcher: async () => new Response("token=DO-NOT-LOG", { status: 401 }) }),
  ).rejects.toThrow(/HTTP 401/);
  await expect(getJson("https://example.com", { fetcher: async () => new Response("not json") })).rejects.toThrow(
    /invalid JSON/,
  );
  await expect(
    getText("https://example.com", { maxBytes: 2, fetcher: async () => new Response("123") }),
  ).rejects.toThrow(/exceeds/);
  await expect(
    getText("https://example.com", {
      fetcher: async () => new Response("", { status: 429, headers: { "Retry-After": "60" } }),
    }),
  ).rejects.toThrow(/retry after 60/);
});

describe("real worker subprocess against offline eBird fixture", () => {
  let server: ReturnType<typeof Bun.spawn>;
  let client: VgiClient;
  beforeAll(async () => {
    server = Bun.spawn([process.env.PYTHON ?? "python3", join(import.meta.dir, "../test/mock_api/server.py")], {
      stdout: "pipe",
      stderr: "inherit",
      env: { ...process.env, MOCK_API_FLAKY: "1" },
    });
    const reader = (server.stdout as ReadableStream<Uint8Array>).getReader();
    let line = "";
    while (!line.includes("\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      line += new TextDecoder().decode(value);
    }
    reader.releaseLock();
    const port = line.match(/^PORT:(\d+)/)?.[1];
    if (!port) throw new Error("fixture failed to start");
    client = new VgiClient(
      subprocessConnect([process.execPath, "run", join(import.meta.dir, "../src/worker.ts")], {
        env: { DUCKS_EBIRD_BASE_URL: `http://127.0.0.1:${port}/v2`, EBIRD_API_KEY: "fixture-token" },
      }),
    );
  });
  afterAll(() => {
    client?.close();
    server?.kill();
  });
  async function query(name: string, positional: unknown[] = [42, -71], named: Record<string, unknown> = {}) {
    const result: Record<string, unknown>[] = [];
    for await (const batch of client.tableFunctionRows({
      functionName: name,
      arguments: new Arguments(positional, new Map(Object.entries(named))),
      int64: "bigint",
    }))
      result.push(...batch);
    return result;
  }
  test("sightings: auth header, filters, retries and typed nullable values", async () => {
    const result = await query("recent_sightings");
    expect(result).toHaveLength(2);
    expect(result[1]?.reported_count).toBeNull();
    expect(await query("recent_sightings", undefined, { hotspots_only: true })).toHaveLength(1);
  });
  test("species-specific endpoint yields multiple locations and zero count", async () => {
    const result = await query("recent_sightings", undefined, { species_code: "mallar3" });
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ reported_count: 0, observation_reviewed: null });
  });
  test("hotspots and optional recency filter", async () => {
    expect(await query("nearby_hotspots")).toHaveLength(3);
    expect(await query("nearby_hotspots", undefined, { days_back: 7n })).toHaveLength(2);
  });
  test("empty API response yields zero rows with the declared schema", async () => {
    expect(await query("recent_sightings", [-90, 0])).toEqual([]);
    expect(await query("nearby_hotspots", [-90, 0])).toEqual([]);
  });
  test("NULL, invalid named args and upstream failures reach the caller", async () => {
    await expect(query("recent_sightings", [null, 0])).rejects.toThrow(/NULL/);
    await expect(query("recent_sightings", undefined, { days_back: 31n })).rejects.toThrow();
    await expect(query("nearby_hotspots", undefined, { radius_km: null })).rejects.toThrow(/NULL/);
    await expect(query("recent_sightings", [-89, 0])).rejects.toThrow(/array/);
    await expect(query("recent_sightings", [-87, 0])).rejects.toThrow(/HTTP 403/);
    await expect(query("recent_sightings", [-88, 0])).rejects.toThrow(/HTTP 503/);
  });
});
