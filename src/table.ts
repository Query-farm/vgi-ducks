import {
  type Arguments,
  batchFromColumns,
  binary,
  bool,
  defineTableFunction,
  field,
  float64,
  int32,
  type SecretTypeDescriptor,
  schema,
  secretsOfType,
  type TableFunctionConfig,
  timestampMicros,
  utf8,
  type VgiDataType,
  type VgiSchema,
} from "@query-farm/vgi";
import { type Category, column, objectTags } from "./meta.ts";

export type Cell = string | number | bigint | boolean | Uint8Array | null;
export type Row = Record<string, Cell>;
export type SqlType = "VARCHAR" | "DOUBLE" | "INTEGER" | "BOOLEAN" | "TIMESTAMPTZ" | "BLOB";
export type Column = readonly [name: string, type: SqlType, description: string, nullable?: boolean];
const TYPES: Record<SqlType, () => VgiDataType> = {
  BLOB: binary,
  VARCHAR: utf8,
  DOUBLE: float64,
  INTEGER: () => int32,
  BOOLEAN: () => bool,
  TIMESTAMPTZ: () => timestampMicros("UTC"),
};

export function outputSchema(columns: readonly Column[]): VgiSchema {
  return schema(
    columns.map(([name, type, description, nullable = true]) => column(name, TYPES[type](), description, nullable)),
  );
}

export function rowsBatch(rows: Row[], output: VgiSchema) {
  if (rows.length > 50_000) throw new Error("eBird response exceeds 50,000 rows per batch");
  return batchFromColumns(
    Object.fromEntries(output.fields.map((f) => [f.name, rows.map((r) => r[f.name] ?? null)])),
    output,
  );
}

export interface TableDocs {
  name: string;
  category?: Category;
  title: string;
  description: string;
  columns: readonly Column[];
  docs: string;
  keywords: string;
  examples: { sql: string; description: string }[];
}

export function tableMeta(spec: TableDocs) {
  return {
    name: spec.name,
    description: spec.description,
    examples: spec.examples,
    tags: {
      ...objectTags({
        title: spec.title,
        category: spec.category ?? "api",
        keywords: spec.keywords,
        docLlm: spec.docs,
        docMd:
          `## ${spec.title}\n\n${spec.docs}\n\n### Result columns\n\n` +
          "| Column | Meaning |\n| --- | --- |\n" +
          spec.columns.map(([name, _type, description]) => `| ${name} | ${description} |`).join("\n"),
      }),
      "vgi.result_columns_schema": JSON.stringify(
        spec.columns.map(([name, type, description]) => ({ name, type, description })),
      ),
    },
  };
}

type OneShotConfig<A> = TableDocs &
  Pick<TableFunctionConfig<A>, "args" | "argDocs" | "argDefaults" | "argConstraints"> & {
    validate?: (args: A) => void;
    authenticated?: boolean;
    auth?: { type: string; resolve: (args: A, secrets: Record<string, Record<string, unknown>>) => string | undefined };
    load: (args: A, token?: string) => Promise<Row[]>;
  };

export function oneShot<A>(spec: OneShotConfig<A>) {
  const output = outputSchema(spec.columns);
  return defineTableFunction<A, { done: boolean }>({
    ...tableMeta(spec),
    args: spec.args,
    argDocs: spec.argDocs,
    argDefaults: spec.argDefaults,
    argConstraints: spec.argConstraints,
    onBind: ({ args, bindCall, resolvedSecretsProvided }) => {
      rejectNullArguments(bindCall.arguments);
      spec.validate?.(args);
      return {
        outputSchema: output,
        ...((spec.authenticated || spec.auth) && !resolvedSecretsProvided
          ? { lookupSecretTypes: [spec.auth?.type ?? SECRET_TYPE] }
          : {}),
      };
    },
    initialState: () => ({ done: false }),
    process: async (params, state, out) => {
      if (state.done) {
        out.finish();
        return;
      }
      out.emit(
        rowsBatch(
          await spec.load(
            params.args,
            spec.auth
              ? spec.auth.resolve(params.args, params.secrets)
              : spec.authenticated
                ? resolveToken(params.secrets)
                : undefined,
          ),
          params.outputSchema,
        ),
      );
      state.done = true;
    },
  });
}

export function rejectNullArguments(args: Arguments): void {
  if (args.positional.some((v) => v === null) || [...args.named.values()].some((v) => v === null)) {
    throw new Error("NULL arguments are not supported; omit optional arguments to use their defaults");
  }
}

export const SECRET_TYPE = "ebird";
export const API_SECRET_TYPE: SecretTypeDescriptor = {
  name: SECRET_TYPE,
  description: "Personal eBird API key, transmitted in the X-eBirdApiToken header.",
  schema: schema(
    [
      field(
        "token",
        utf8(),
        true,
        new Map([
          ["redact", "true"],
          ["vgi_doc", "Your personal eBird API key."],
        ]),
      ),
    ],
    new Map([["vgi_doc_url", "https://ebird.org/api/keygen"]]),
  ),
};
export function resolveToken(secrets: Record<string, Record<string, unknown>>): string {
  for (const secret of secretsOfType(secrets, SECRET_TYPE)) {
    if (typeof secret.token === "string" && secret.token.trim()) return secret.token.trim();
  }
  const token = process.env.EBIRD_API_KEY?.trim();
  if (!token)
    throw new Error(
      "eBird API key required: CREATE SECRET (TYPE ebird, TOKEN 'your-key') or set EBIRD_API_KEY before starting DuckDB/worker",
    );
  return token;
}
