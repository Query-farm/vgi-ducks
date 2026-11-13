/** Versioned Status and Trends file API; access keys never enter table state or diagnostics. */
import { field, type SecretTypeDescriptor, schema, secretsOfType, utf8 } from "@query-farm/vgi";
import { endpoint, getBytes, getJson } from "./http.ts";

export interface StatusArgs {
  species_code: string;
  data_year: bigint;
  resolution: string;
}
export const STATUS_SECRET_TYPE: SecretTypeDescriptor = {
  name: "ebirdst",
  description: "Separate eBird Status and Trends download access key.",
  schema: schema(
    [
      field(
        "token",
        utf8(),
        true,
        new Map([
          ["redact", "true"],
          ["vgi_doc", "Status and Trends access key; not the recent-sightings API key."],
        ]),
      ),
    ],
    new Map([["vgi_doc_url", "https://ebird.org/st/request"]]),
  ),
};
export const STATUS_AUTH = {
  type: "ebirdst",
  resolve: (args: StatusArgs, secrets: Record<string, Record<string, unknown>>): string | undefined => {
    if (args.species_code === "yebsap-example") return undefined;
    for (const secret of secretsOfType(secrets, "ebirdst")) {
      if (typeof secret.token === "string" && secret.token.trim()) return secret.token.trim();
    }
    const key = process.env.EBIRDST_KEY?.trim();
    if (!key)
      throw new Error(
        "Status and Trends access key required: CREATE SECRET (TYPE ebirdst, TOKEN 'your-key') or set EBIRDST_KEY; EBIRD_API_KEY is a different credential",
      );
    return key;
  },
};
export function validateStatus(args: StatusArgs): void {
  if (!/^[a-z0-9]{3,12}$/.test(args.species_code) && args.species_code !== "yebsap-example")
    throw new Error("species_code must be an eBird Status data-release code, or yebsap-example");
  if (args.species_code === "yebsap-example" && (Number(args.data_year) !== 2023 || args.resolution !== "27km"))
    throw new Error("The public sample supports data_year 2023 and resolution 27km only");
}
// Pin Cornell's public sample so example results remain reproducible.
const SAMPLE_BASE =
  "https://raw.githubusercontent.com/ebird/ebirdst_example-data/a3ab944f505ad6f583e0c830d5e951929446e9eb/example-data";
export async function productFiles(args: StatusArgs, key?: string): Promise<string[]> {
  if (args.species_code === "yebsap-example") return [];
  const url = endpoint(
    "DUCKS_STATUS_BASE_URL",
    "https://st-download.ebird.org/v1",
    `list-obj/${args.data_year}/${args.species_code}`,
  );
  if (url.search || url.hash) throw new Error("DUCKS_STATUS_BASE_URL must not contain query parameters or fragments");
  url.searchParams.set("key", key ?? "");
  const body = await getJson(url, { maxBytes: 4 * 1024 * 1024, followRedirects: true });
  const prefix = `${args.data_year}/${args.species_code}/`;
  if (
    !Array.isArray(body) ||
    body.some((x) => typeof x !== "string" || !x.startsWith(prefix) || x.includes("..") || x.includes("\\"))
  )
    throw new Error("Invalid Status and Trends file listing");
  return body as string[];
}
export function productPath(args: StatusArgs, kind: "ranges" | "weekly" | "dates"): string {
  const prefix = `${args.data_year}/${args.species_code}`;
  if (kind === "dates") return `${prefix}/weekly/band-dates.csv`;
  if (kind === "ranges")
    return `${prefix}/ranges/${args.species_code}_range_smooth_${args.resolution}_${args.data_year}.gpkg`;
  return `${prefix}/weekly/${args.species_code}_abundance_median_${args.resolution}_${args.data_year}.tif`;
}
export async function downloadProduct(
  args: StatusArgs,
  files: string[],
  kind: "ranges" | "weekly" | "dates",
  key?: string,
): Promise<Uint8Array> {
  const path = productPath(args, kind);
  let url: URL;
  if (args.species_code === "yebsap-example") {
    url = endpoint("DUCKS_STATUS_SAMPLE_BASE_URL", SAMPLE_BASE, path);
  } else {
    if (!files.includes(path))
      throw new Error(
        `Status and Trends product unavailable: ${kind}, ${args.species_code}, ${args.data_year}, ${args.resolution}. Check the model-release species code and available resolution.`,
      );
    url = endpoint("DUCKS_STATUS_BASE_URL", "https://st-download.ebird.org/v1", "fetch");
    if (url.search || url.hash) throw new Error("DUCKS_STATUS_BASE_URL must not contain query parameters or fragments");
    url.searchParams.set("objKey", path);
    url.searchParams.set("key", key ?? "");
  }
  return getBytes(url, {
    maxBytes: kind === "dates" ? 65536 : 128 * 1024 * 1024,
    timeoutMs: 60_000,
    followRedirects: true,
  });
}
