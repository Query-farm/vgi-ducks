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


def seasonal_range_chart(rows, land, territory, common_name, color):
    """Compare four seasons using the same extent and the SQL-clipped geometries."""
    from matplotlib.lines import Line2D
    from matplotlib.patches import Patch
    import numpy as np
    import pandas as pd

    seasons = [
        ("nonbreeding", "Nonbreeding"),
        ("prebreeding_migration", "Spring migration"),
        ("breeding", "Breeding"),
        ("postbreeding_migration", "Fall migration"),
    ]
    selected = rows.loc[rows.common_name == common_name].set_index("season")
    assert set(selected.index) == {season for season, _ in seasons}
    fig, axes = plt.subplots(2, 2, figsize=(14, 9), layout="constrained", sharex=True, sharey=True)
    for ax, (season, label) in zip(axes.flat, seasons):
        row = selected.loc[season]
        ax.set_facecolor("#f5f7fa")
        draw_geometry(ax, territory, "white", "none")
        draw_geometry(ax, row.context_geometry_json, color, "none", alpha=0.18)
        draw_geometry(ax, row.virginia_geometry_json, color, "none", alpha=0.72)
        draw_geometry(ax, land, "none", "#94a3b8", linewidth=0.35)
        draw_geometry(ax, territory, "none", "#172b3a", linewidth=1.1)
        for city, lon, lat, dx, dy in [
            ("Roanoke", -79.9414, 37.2709, 0.08, 0.12),
            ("Richmond", -77.4360, 37.5407, -0.70, 0.19),
            ("Norfolk", -76.2859, 36.8508, 0.13, -0.25),
        ]:
            ax.plot(lon, lat, "o", color="#172b3a", markersize=2.5, zorder=5)
            ax.text(lon + dx, lat + dy, city, fontsize=8, color="#172b3a", zorder=6,
                    bbox={"facecolor": "white", "edgecolor": "none", "alpha": 0.8, "pad": 1})
        start = pd.Timestamp(row.start_date).strftime("%b %d")
        end = pd.Timestamp(row.end_date).strftime("%b %d")
        wrap = " · wraps New Year" if row.wraps_year else ""
        ax.set_title(f"{label}\n{start} – {end}{wrap}", loc="left", fontsize=11, weight="bold", pad=8)
        ax.text(0.025, 0.035, f"{row.virginia_territory_percent:.1f}% of Virginia's territory",
                transform=ax.transAxes, fontsize=10, weight="bold", color="#172b3a",
                bbox={"facecolor": "white", "edgecolor": "none", "alpha": 0.95, "pad": 4})
        if shape(json.loads(row.virginia_geometry_json)).is_empty:
            ax.text(0.65, 0.63, "No modeled range overlap", transform=ax.transAxes,
                    ha="center", fontsize=10, color="#475569")
        ax.set_xlim(-84.1, -74.7)
        ax.set_ylim(36.15, 39.9)
        ax.set_aspect(1 / np.cos(np.deg2rad(38)))
        ax.set_xticks([-83, -81, -79, -77, -75])
        ax.set_yticks([37, 38, 39])
        ax.tick_params(labelsize=9)
        ax.grid(alpha=0.25, linewidth=0.4)
    for ax in axes[1]:
        ax.set_xlabel("Longitude")
    for ax in axes[:, 0]:
        ax.set_ylabel("Latitude")
    fig.suptitle(f"{common_name}: where the seasonal ranges meet Virginia\n"
                 "2023 model · 27 km smoothed range polygons", x=0.02, ha="left", fontsize=17, weight="bold")
    fig.legend(handles=[
        Patch(facecolor=color, alpha=0.18, label="Modeled range around Virginia"),
        Patch(facecolor=color, alpha=0.72, label="Modeled range inside Virginia"),
        Line2D([0], [0], color="#172b3a", linewidth=1.3, label="Virginia territorial boundary"),
    ], loc="lower center", bbox_to_anchor=(0.5, -0.065), ncol=3, frameon=False, fontsize=10)
    fig.text(0.01, -0.12,
             "Ranges: Fink et al. (2024), eBird Status and Trends, data version 2023 · doi:10.2173/WZTW8903\n"
             "Boundary: Overture Maps Foundation / © OpenStreetMap contributors, 2026-10-21.0. "
             "Season dates are species-wide; shading shows range, not abundance or sightings.",
             fontsize=9, color="#334155", linespacing=1.6)
    return fig
