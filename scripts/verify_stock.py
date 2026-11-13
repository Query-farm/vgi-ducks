#!/usr/bin/env python3
"""Verify the public SQL contract using signed VGI in stock DuckDB 2.0.0."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shlex
import sys
import tempfile

import duckdb

ROOT = Path(__file__).resolve().parents[1]


def quote(value):
    return "'" + value.replace("'", "''") + "'"


def main():
    parser = argparse.ArgumentParser()
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--live", action="store_true")
    modes.add_argument("--sample", action="store_true", help="Real public Status and Trends sample, no key required")
    parser.add_argument("--worker", help="Override the executable, for testing a compiled artifact")
    parser.add_argument("--output")
    args = parser.parse_args()
    if args.live and not os.environ.get("EBIRD_API_KEY"):
        parser.error("EBIRD_API_KEY is required for live eBird checks; no live check was run")
    fixture_mode = not args.live and not args.sample
    if fixture_mode and not os.environ.get("DUCKS_EBIRD_BASE_URL", "").startswith("http://127.0.0.1:"):
        parser.error("Run fixture checks via scripts/with_fixtures.py")
    manifest = json.loads((ROOT / "vgi-worker.json").read_text())
    if duckdb.__version__ != "2.0.0":
        raise RuntimeError(f"Expected stock DuckDB 2.0.0, got {duckdb.__version__}")
    check_file = "test/live-checks.json" if args.live else "test/sample-checks.json"
    checks = manifest["checks"] if fixture_mode else json.loads((ROOT / check_file).read_text())
    errors = json.loads((ROOT / "test/error-checks.json").read_text()) if fixture_mode else []
    catalog = manifest["catalog"]
    command = [args.worker] if args.worker else [str(ROOT / manifest["worker"][0]), *manifest["worker"][1:]]
    if args.worker:
        # Launch extracted artifacts from their own directory, without checkout files.
        command = [str(Path(args.worker).resolve())]
        os.chdir(Path(command[0]).parent)
    if not fixture_mode:
        # A live check must not accidentally use a leftover fixture endpoint.
        for key in ["DUCKS_EBIRD_BASE_URL", "DUCKS_STATUS_BASE_URL", "DUCKS_STATUS_SAMPLE_BASE_URL"]:
            os.environ.pop(key, None)
    attach = f"ATTACH {quote(catalog)} (TYPE vgi, LOCATION {quote(shlex.join(command))})"
    report = {"engine": "stock DuckDB", "engine_version": duckdb.__version__, "catalog": catalog,
              "mode": "live eBird" if args.live else "public Status sample" if args.sample else "offline fixtures", "attach_sql": attach,
              "verified_at": datetime.now(timezone.utc).isoformat(), "checks": []}
    with tempfile.TemporaryDirectory(prefix=f"vgi-{catalog}-duckdb-") as temporary:
        con = duckdb.connect(config={"extension_repository_directory": str(Path(temporary) / "repositories")})
        try:
            con.execute(f"SET extension_directory={quote(temporary)}")
            con.execute("SET allow_extension_repositories='allowed'")
            con.execute("CREATE EXTENSION REPOSITORY query_farm WITH PREFIX 'https://duckdb-extensions.query.farm'")
            con.execute("INSTALL vgi FROM query_farm")
            con.execute("LOAD vgi FROM query_farm")
            con.execute("INSTALL icu FROM core")
            con.execute("LOAD icu")
            con.execute("SET TimeZone='UTC'")
            con.execute("INSTALL spatial FROM core")
            con.execute("LOAD spatial")
            con.execute("SET geometry_always_xy=true")
            report["extension_version"] = con.execute("SELECT extension_version FROM duckdb_extensions() WHERE extension_name='vgi'").fetchone()[0]
            con.execute(attach)
            for check in checks:
                rows = [list(row) for row in con.execute(check["sql"]).fetchall()]
                if rows != check["rows"]:
                    raise AssertionError(f"{check['name']}: expected {check['rows']!r}, got {rows!r}")
                report["checks"].append({"name": check["name"], "passed": True, "rows": rows})
                print(f"PASS {check['name']}", flush=True)
            for check in errors:
                try:
                    con.execute(check["sql"]).fetchall()
                except duckdb.Error as error:
                    if not re.search(check["error"], str(error), re.DOTALL):
                        raise AssertionError(f"Unexpected error for {check['sql']}: {error}") from error
                else:
                    raise AssertionError(f"Expected an error for {check['sql']}")
            if fixture_mode:
                # A DuckDB secret must override the valid fixture environment key.
                con.execute("CREATE SECRET ducks_wrong (TYPE ebird, TOKEN 'wrong-fixture-key')")
                try:
                    con.execute("SELECT * FROM ducks.main.nearby_hotspots(42.36,-71.06)").fetchall()
                except duckdb.Error as error:
                    if "HTTP 401" not in str(error): raise
                else:
                    raise AssertionError("Secret did not override environment key")
                con.execute("DROP SECRET ducks_wrong")
                report["secret_precedence_passed"] = True
                con.execute("CREATE SECRET status_wrong (TYPE ebirdst, TOKEN 'wrong-fixture-key')")
                try:
                    con.execute("SELECT * FROM ducks.main.seasonal_ranges('mallar3')").fetchall()
                except duckdb.Error as error:
                    if "HTTP 401" not in str(error): raise
                else:
                    raise AssertionError("Status secret did not override environment key")
                con.execute("DROP SECRET status_wrong")
                report["status_secret_precedence_passed"] = True
            report["expected_error_checks"] = len(errors)
        finally:
            con.close()
    if args.output:
        Path(args.output).write_text(json.dumps(report, indent=2) + "\n")
    print(f"{catalog}: {len(checks)} result checks and {len(errors)} error checks passed; DuckDB {duckdb.__version__}, VGI {report['extension_version']}")


if __name__ == "__main__":
    main()
