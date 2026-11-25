# Changelog

## 0.2.0 (2026-11-25)

- VGI protocol 3.4: bump @query-farm/vgi to 0.52 and @query-farm/vgi-rpc to 0.30. **Requires the
  3.4 vgi extension**: DuckDB 2.0 (`INSTALL vgi FROM query_farm`) or Haybarn 2.0.1+; Haybarn 2.0.0
  still serves the 3.3 extension, which cannot attach this worker.
- The Docker image supports Orchard hosted mode (`VGI_ORCHARD_HOSTED=1`): HTTP only, Orchard Pass
  authentication, large values through the Orchard blob vendor; the HEALTHCHECK uses `HEAD /health`.
- CI and `make` run the SQL tests on haybarn-unittest 2.0.1rc3.

## 0.1.5 (2026-11-16)

- CI tooling (haybarn-unittest, lint helpers) runs on Python 3.14.

## 0.1.4 (2026-11-16)

- Bump @query-farm/vgi to 0.50.1.

## 0.1.3

- Docs give an overview, not a function list (vgi-lint VGI173): the catalog and schema docs now describe
  the two data families, how they fit together and their caveats instead of naming each function; the
  details only they carried (extinct codes are rejected, the public sample is Michigan-only and not duck
  data) moved onto the relevant function docs.
- Docs link to upstream sources: the catalog docs now link the eBird API 2.0 documentation, the
  eBird API key page, eBird Status and Trends and its data-access request page (vgi-lint VGI183).
- The `main` schema comment is now a one-line summary; its Markdown docs no longer repeat it
  (vgi-lint VGI102).

## 0.1.2

- The catalog comment is now one plain paragraph (vgi-lint VGI107) describing what the worker covers;
  the Markdown guide stays in the catalog's `vgi.doc_md` / `vgi.doc_llm` tags.

## 0.1.0 (unreleased)

Initial worker generated from the VGI starter template.

Targets: @query-farm/vgi 0.50 · VGI protocol 3.3 · Haybarn 2.0.1rc3 · vgi-lint-check 2.x (unpinned)
