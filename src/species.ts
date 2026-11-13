import { constraintRecord, type TableDescriptor } from "@query-farm/vgi";
import speciesRows from "../data/species.json";
import { type Column, oneShot, outputSchema } from "./table.ts";

export const SPECIES = speciesRows;
export const SPECIES_BY_CODE = new Map(SPECIES.map((row) => [row.species_code, row]));
const COLUMNS: Column[] = [
  ["species_code", "VARCHAR", "Unique eBird 2026 species code, used in recent_sightings.", false],
  ["common_name", "VARCHAR", "English common name in the bundled taxonomy.", false],
  ["scientific_name", "VARCHAR", "Scientific binomial in the bundled taxonomy.", false],
  ["genus", "VARCHAR", "Scientific genus.", false],
  ["family_name", "VARCHAR", "Scientific family: Anatidae.", false],
  ["taxon_order", "DOUBLE", "Unitless eBird taxonomic sort index; not a bird count.", false],
  ["extinct", "BOOLEAN", "Whether eBird marks the taxon extinct; false is not a conservation assessment.", false],
  ["taxonomy_version", "VARCHAR", "Version of the bundled eBird taxonomy.", false],
  ["source_url", "VARCHAR", "eBird species page URL.", false],
];
const EXAMPLE = {
  sql: "SELECT species_code, scientific_name FROM ducks.main.species WHERE common_name = 'Mallard' ORDER BY species_code",
  description: "Find the current Mallard code for a species-specific sighting query",
};
const scan = oneShot<Record<string, never>>({
  name: "species_scan",
  title: "Duck Species Reference",
  description: "Read the bundled eBird 2026 duck species reference, including flagged extinct taxa",
  columns: COLUMNS,
  args: {},
  argDocs: {},
  load: async () => SPECIES,
  keywords: "ducks, taxonomy, species codes, teal, merganser, shelduck, whistling duck, reference",
  docs: "Offline reference of 140 duck species from the eBird 2026 taxonomy, including 9 flagged extinct taxa. Includes teals, eiders, mergansers, shelducks, whistling-ducks and Nettapus pygmy-geese. Excludes other geese and swans, hybrids, domestic forms and unidentified groups. Use species_code in recent_sightings; filter NOT extinct for living taxa. Taxonomy is versioned, not automatically refreshed. This is a worker scope convention, not a taxonomic clade. Names and identifiers are factual eBird reference data attributed to Cornell Lab of Ornithology; upstream terms apply separately from the code license.",
  examples: [EXAMPLE],
});
export const speciesTable: TableDescriptor = {
  name: "species",
  columns: outputSchema(COLUMNS),
  function: scan,
  comment:
    "Bundled eBird 2026 duck taxonomy: 140 species, including 9 flagged extinct taxa; no network or key required.",
  columnComments: Object.fromEntries(COLUMNS.map(([name, _type, description]) => [name, description])),
  constraints: [
    ...COLUMNS.map(([name]) =>
      constraintRecord({
        schemaPath: ["main"],
        table: "species",
        id: `${name}_not_null`,
        kind: "NOT_NULL",
        columns: [[name]],
        enforcement: "ENFORCED",
        validation: "ALL_ROWS",
      }),
    ),
    constraintRecord({
      schemaPath: ["main"],
      table: "species",
      id: "primary_key",
      kind: "PRIMARY_KEY",
      columns: [["species_code"]],
      enforcement: "ENFORCED",
      validation: "ALL_ROWS",
    }),
  ],
  tags: {
    domain: "ornithology",
    ...scan.meta.tags,
    "vgi.example_queries": JSON.stringify([EXAMPLE]),
    "vgi.executable_examples": JSON.stringify([{ ...EXAMPLE, expected_result: [["mallar3", "Anas platyrhynchos"]] }]),
  },
};
