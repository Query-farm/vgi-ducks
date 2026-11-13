#!/usr/bin/env python3
"""Run a command with the project's local eBird fixture server, always cleaning up."""
import os
from pathlib import Path
import select
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def run(command):
    server = subprocess.Popen(
        [sys.executable, str(ROOT / "test/mock_api/server.py")],
        stdout=subprocess.PIPE,
        text=True,
        env={**os.environ, "MOCK_API_FLAKY": "1", "MOCK_API_PORT": "0"},
    )
    try:
        if not select.select([server.stdout], [], [], 10)[0]:
            raise RuntimeError("Fixture server did not start within 10 seconds")
        line = server.stdout.readline().strip()
        if not line.startswith("PORT:"):
            raise RuntimeError(f"Fixture server did not report its port: {line}")
        base = f"http://127.0.0.1:{int(line[5:])}"
        env = dict(os.environ)
        env.update(DUCKS_EBIRD_BASE_URL=base+'/v2', EBIRD_API_KEY='fixture-token', DUCKS_STATUS_BASE_URL=base+'/status', EBIRDST_KEY='status-fixture-token')
        return subprocess.run(command, cwd=ROOT, env=env).returncode
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait()


if __name__ == "__main__":
    command = sys.argv[1:]
    if command[:1] == ["--"]:
        command = command[1:]
    if not command:
        raise SystemExit("usage: with_fixtures.py [--] command [arguments...]")
    raise SystemExit(run(command))
