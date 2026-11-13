#!/usr/bin/env python3
"""Execute the public-data demo and save portable, static notebook outputs."""
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


def main():
    # Always use the real pinned public sample, even after fixture test runs.
    for key in ("DUCKS_EBIRD_BASE_URL", "DUCKS_STATUS_BASE_URL", "DUCKS_STATUS_SAMPLE_BASE_URL"):
        os.environ.pop(key, None)
    notebook = nbformat.read(NOTEBOOK, as_version=4)
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
            notebook, km=manager, timeout=300, record_timing=False,
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
    assert png_count == 3, f"Expected three embedded chart figures, got {png_count}"
    nbformat.write(notebook, NOTEBOOK)

    # A local HTML preview is useful for review; GitHub reads the .ipynb itself.
    preview, _ = HTMLExporter(template_name="lab").from_notebook_node(notebook)
    preview_dir = ROOT / "dist/notebooks"
    preview_dir.mkdir(parents=True, exist_ok=True)
    (preview_dir / "spatial-migration.html").write_text(preview)
    print(f"Executed {len(code)} code cells; saved {png_count} embedded PNG figures.")
    print(f"Notebook: {NOTEBOOK}")
    print(f"HTML preview: {preview_dir / 'spatial-migration.html'}")


if __name__ == "__main__":
    main()
