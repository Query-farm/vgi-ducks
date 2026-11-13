"""Bounded public-data retrieval and plotting helpers for the Virginia notebook."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request

import matplotlib.pyplot as plt
from shapely import orient_polygons
from shapely.geometry import shape
from shapely.plotting import plot_polygon

DATASET = "50c9509d-22c7-4a22-a47d-8c48425ef4a7"
PARAMETERS = {
    "taxonKey": "2986",  # GBIF's exact accepted family match for Anatidae.
    "datasetKey": DATASET,
    "country": "US", "stateProvince": "Virginia", "year": "2024,2025",
    "basisOfRecord": "HUMAN_OBSERVATION", "occurrenceStatus": "PRESENT",
    "hasCoordinate": "true", "hasGeospatialIssue": "false",
    "coordinateUncertaintyInMeters": "0,250",
    "license": ["CC0_1_0", "CC_BY_4_0"],
}


def fetch_json(url):
    for attempt in range(4):
        try:
            request = urllib.request.Request(url, headers={
                "User-Agent": "QueryFarm-vgi-ducks-notebook/0.1.0",
                "Accept": "application/json",
            })
            with urllib.request.urlopen(request, timeout=60) as response:
                raw = response.read(8 * 1024 * 1024 + 1)
                if len(raw) > 8 * 1024 * 1024:
                    raise RuntimeError("Public-data response exceeds 8 MiB")
                return json.loads(raw)
        except urllib.error.HTTPError as error:
            if error.code != 429 and error.code < 500:
                raise
            if attempt == 3:
                raise
            retry = error.headers.get("Retry-After", "")
            delay = float(retry) if retry.isdigit() else 2 ** attempt
            if delay > 30:
                raise RuntimeError("Public API requested a retry delay over 30 seconds") from error
            time.sleep(delay)
        except (urllib.error.URLError, TimeoutError):
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def observation_snapshot(cache_dir):
    """Fetch all matching pages, never silently truncate or invent records."""
    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    fingerprint = hashlib.sha256(json.dumps(PARAMETERS, sort_keys=True).encode()).hexdigest()[:16]
    records_path = cache_dir / f"observations-{fingerprint}.json"
    manifest_path = cache_dir / f"observations-{fingerprint}.metadata.json"
    if records_path.exists() and manifest_path.exists() and os.environ.get("VGI_NOTEBOOK_REFRESH") != "1":
        manifest = json.loads(manifest_path.read_text())
        if hashlib.sha256(records_path.read_bytes()).hexdigest() == manifest["sha256"]:
            return records_path, manifest

    rows = []
    total = None
    for offset in range(0, 5000, 300):
        query = {**PARAMETERS, "limit": 300, "offset": offset}
        url = "https://api.gbif.org/v1/occurrence/search?" + urllib.parse.urlencode(query, doseq=True)
        result = fetch_json(url)
        if total is None:
            total = result["count"]
            if total > 5000:
                raise RuntimeError("More than 5000 eligible records; narrow the period before downloading")
        elif result["count"] != total:
            raise RuntimeError("GBIF results changed during pagination; rerun for a consistent snapshot")
        for record in result["results"]:
            row = {
                "gbif_id": str(record["key"]),
                "scientific_name": record.get("species"),
                "observation_date": record["eventDate"][:10],
                "observation_year": record["year"],
                "observation_month": record["month"],
                "longitude": record["decimalLongitude"],
                "latitude": record["decimalLatitude"],
                "uncertainty_m": record["coordinateUncertaintyInMeters"],
                "record_url": record.get("references") or f"https://www.gbif.org/occurrence/{record['key']}",
                "license": record["license"],
                "dataset_key": record["datasetKey"],
            }
            if row["observation_year"] not in (2024, 2025) or not 0 <= row["uncertainty_m"] <= 250:
                raise RuntimeError("GBIF returned a record outside the requested date/uncertainty filters")
            if row["dataset_key"] != DATASET or not any(
                item in row["license"] for item in ("/publicdomain/zero/1.0", "/licenses/by/4.0")
            ):
                raise RuntimeError("GBIF returned an unexpected source or record license")
            rows.append(row)
        if result["endOfRecords"]:
            break
    if not rows or len(rows) != total or len({row["gbif_id"] for row in rows}) != total:
        raise RuntimeError("Incomplete or duplicate GBIF pagination; no partial dataset was saved")
    rows.sort(key=lambda row: row["gbif_id"])
    raw = (json.dumps(rows, indent=2) + "\n").encode()
    manifest = {
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "source": "iNaturalist Research-grade Observations via GBIF",
        "dataset_doi": "https://doi.org/10.15468/ab3s5x",
        "parameters": PARAMETERS, "eligible_family_records": total,
        "sha256": hashlib.sha256(raw).hexdigest(),
    }
    records_path.write_bytes(raw)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    return records_path, manifest


def configure_plots():
    plt.rcParams.update({
        "figure.facecolor": "white", "axes.facecolor": "white", "figure.dpi": 110,
        "font.family": "DejaVu Sans", "font.size": 11, "axes.titlesize": 14,
        "axes.labelcolor": "#334155", "text.color": "#0f172a",
        "xtick.color": "#475569", "ytick.color": "#475569",
        "axes.spines.top": False, "axes.spines.right": False,
        "axes.edgecolor": "#cbd5e1", "grid.color": "#e2e8f0",
    })


def draw_geometry(ax, geometry, facecolor, edgecolor, linewidth=0.5, alpha=1.0):
    if isinstance(geometry, str):
        geometry = shape(json.loads(geometry))
    if geometry.is_empty:
        return
    if geometry.geom_type == "Polygon":
        plot_polygon(orient_polygons(geometry), ax=ax, add_points=False,
                     facecolor=facecolor, edgecolor=edgecolor, linewidth=linewidth, alpha=alpha)
    elif hasattr(geometry, "geoms"):
        for part in geometry.geoms:
            draw_geometry(ax, part, facecolor, edgecolor, linewidth, alpha)


def save_chart(fig, name, notebook_dir):
    output = Path(notebook_dir) / "images"
    output.mkdir(parents=True, exist_ok=True)
    fig.savefig(output / name, dpi=150, bbox_inches="tight", facecolor="white")
    plt.show()
