#!/usr/bin/env python3
"""Execute the Virginia analysis and build a GitHub reader with setup omitted."""
from copy import deepcopy
import json
import os
from pathlib import Path
import sys
import tempfile

import nbformat
from jupyter_client import KernelManager
from jupyter_client.kernelspec import KernelSpecManager
from nbclient import NotebookClient
from nbconvert import HTMLExporter

ROOT = Path(__file__).resolve().parents[1]
NOTEBOOK = ROOT / "notebooks/spatial-migration.ipynb"
SOURCE = ROOT / "notebooks/virginia-ducks.source.ipynb"


def reader_edition(notebook, provenance):
    reader = deepcopy(notebook)
    cells = []
    for cell in reader.cells:
        tags = cell.metadata.get("tags", [])
        if "setup" in tags or cell.id == "source-instructions":
            continue
        if "hide-input" in tags:
            figures = [output.data["image/png"] for output in cell.outputs
                       if "image/png" in output.get("data", {})]
            assert len(figures) == 1, f"Expected one figure in {cell.id}"
            name = f"{cell.id}.png"
            caption = cell.metadata["figure_title"]
            cell = nbformat.v4.new_markdown_cell(
                f"![{caption}](attachment:{name})", id=cell.id,
                attachments={name: {"image/png": figures[0]}},
            )
        cells.append(cell)
        if cell.id == "intro":
            cells.append(nbformat.v4.new_markdown_cell(
                "**Reader edition:** setup and plotting code are omitted so GitHub displays "
                "the analysis and figures. To rerun, open the "
                "[complete executable notebook](virginia-ducks.source.ipynb). "
                "Viewing needs no key; regenerating requires your own `EBIRDST_KEY`.",
                id="reader-instructions",
            ))
    cells.append(nbformat.v4.new_markdown_cell(
        f"**Execution snapshot:** {provenance['executed_at']}. "
        f"GBIF retrieved {provenance['retrieved_at']}: "
        f"{provenance['eligible_family_records']} eligible Anatidae records, "
        f"{provenance['duck_records_inside_virginia']} duck records inside Virginia, "
        f"{provenance['duck_species']} species. Overture release "
        f"`{provenance['overture_release']}`, worker commit "
        f"`{provenance['overture_worker_commit']}`. "
        "eBird model: 2023, 27 km, 52 weeks each for three species. "
        "Duck worker: `v0.1.0`; DuckDB: `2.0.0`.\n\n"
        f"Observation-cache SHA256: `{provenance['sha256']}`.",
        id="execution-snapshot",
    ))
    reader.cells = cells
    return reader


def main():
    if not os.environ.get("EBIRDST_KEY", "").strip():
        raise SystemExit("Set EBIRDST_KEY in the environment to regenerate the Virginia models.")
    # Always use real sources, even after fixture test runs.
    for key in ("DUCKS_EBIRD_BASE_URL", "DUCKS_STATUS_BASE_URL", "DUCKS_STATUS_SAMPLE_BASE_URL"):
        os.environ.pop(key, None)
    notebook = nbformat.read(SOURCE, as_version=4)
    with tempfile.TemporaryDirectory(prefix="vgi-ducks-notebook-") as temporary:
        kernels = Path(temporary) / "kernels"
        kernel = kernels / "vgi-ducks-demo"
        kernel.mkdir(parents=True)
        (kernel / "kernel.json").write_text(json.dumps({
            "argv": [sys.executable, "-m", "ipykernel_launcher", "-f", "{connection_file}"],
            "display_name": "VGI Ducks demo", "language": "python",
        }))
        # Bind this execution to the pinned uv environment, without installing a
        # persistent kernel into the developer's Jupyter configuration.
        manager = KernelManager(
            kernel_name="vgi-ducks-demo",
            kernel_spec_manager=KernelSpecManager(kernel_dirs=[str(kernels)]),
        )
        client = NotebookClient(
            notebook, km=manager, timeout=600, record_timing=False,
            resources={"metadata": {"path": str(NOTEBOOK.parent)}},
            on_cell_start=lambda cell, cell_index: print(
                f"Cell {cell_index + 1}: {cell.id}", flush=True
            ),
        )
        try:
            client.execute()
        finally:
            if manager.has_kernel:
                manager.shutdown_kernel(now=True)

    nbformat.validate(notebook)
    code = [cell for cell in notebook.cells if cell.cell_type == "code"]
    outputs = [output for cell in code for output in cell.outputs]
    assert all(cell.execution_count is not None for cell in code), "Some cells did not execute"
    assert not any(output.output_type == "error" for output in outputs), "Notebook contains an error"
    png_count = sum("image/png" in output.get("data", {}) for output in outputs)
    assert png_count == 5, f"Expected five embedded chart figures, got {png_count}"
    provenance = json.loads((ROOT / ".cache/virginia-ducks/verification.json").read_text())
    reader = reader_edition(notebook, provenance)
    nbformat.validate(reader)
    assert sum(bool(cell.get("attachments")) for cell in reader.cells) == 5
    assert all("setup" not in cell.metadata.get("tags", []) for cell in reader.cells)
    for document in (notebook, reader):
        serialized = nbformat.writes(document)
        for name in ("EBIRDST_KEY", "EBIRD_API_KEY"):
            secret = os.environ.get(name, "").strip()
            assert not secret or secret not in serialized, "Credential found in notebook; refusing to save"
    nbformat.write(notebook, SOURCE)
    nbformat.write(reader, NOTEBOOK)

    # A local HTML preview is useful for review; GitHub reads the .ipynb itself.
    preview, _ = HTMLExporter(template_name="lab").from_notebook_node(reader)
    preview_dir = ROOT / "dist/notebooks"
    preview_dir.mkdir(parents=True, exist_ok=True)
    (preview_dir / "spatial-migration.html").write_text(preview)
    print(f"Executed {len(code)} code cells; saved {png_count} embedded PNG figures.")
    print(f"Notebook: {NOTEBOOK}")
    print(f"HTML preview: {preview_dir / 'spatial-migration.html'}")


if __name__ == "__main__":
    main()
