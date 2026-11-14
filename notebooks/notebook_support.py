"""Presentation helpers for the public Michigan model example."""

from pathlib import Path

import matplotlib.pyplot as plt
import seaborn as sns
from IPython.display import Markdown, display
from shapely import from_geojson
from shapely.plotting import plot_polygon

COLORS = {"modeled": "#26755e", "shortcut": "#b16e45", "coverage": "#4d729d"}


def theme() -> None:
    """Set shared type, colors and chart defaults."""
    sns.set_theme(style="whitegrid", context="notebook", font="DejaVu Sans")
    plt.rcParams.update(
        {"figure.dpi": 130, "text.parse_math": False, "axes.spines.top": False, "axes.spines.right": False}
    )


def prose(text: str) -> None:
    """Display result-derived Markdown."""
    display(Markdown(text))


def polygon(ax, geojson: str, **kwargs) -> None:
    """Draw Polygon or MultiPolygon output returned by spatial SQL, retaining holes."""
    geometry = from_geojson(geojson)
    if geometry.is_empty:
        return
    parts = geometry.geoms if hasattr(geometry, "geoms") else [geometry]
    for part in parts:
        plot_polygon(part, ax=ax, add_points=False, **kwargs)


def finish(fig: plt.Figure, title: str, subtitle: str, filename: str) -> None:
    """Save and display a chart with source and model context."""
    fig.suptitle(title, x=0.07, y=0.98, ha="left", fontsize=18, weight="bold", color="#253d31")
    fig.text(0.07, 0.925, subtitle, fontsize=10.5, color="#52675a")
    fig.text(
        0.07,
        0.025,
        "Source: Cornell Lab of Ornithology / eBird Status and Trends · public Michigan example · 2023, 27 km\n"
        "Pinned source a3ab944… · real vgi-ducks v0.1.1 through Haybarn / VGI; SQL calculations",
        fontsize=9,
        color="#52675a",
    )
    directory = Path("validation/charts")
    directory.mkdir(parents=True, exist_ok=True)
    fig.savefig(directory / filename, dpi=150)
    plt.show()
