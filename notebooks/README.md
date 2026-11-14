# VGI ducks notebooks

| Example | Data and requirements | Execution |
| --- | --- | --- |
| [Public sample: region and coverage](01_public_sample_region_and_coverage.ipynb) | Cornell's public **Yellow-bellied Sapsucker in Michigan** sample; 2023 model, 27 km grid; no key | Portable Haybarn notebook; commands below |
| [Ducks in Virginia — reader](spatial-migration.ipynb), [complete source](virginia-ducks.source.ipynb) | Existing three-duck analysis, observation records, Overture maps and credited photographs | Viewing saved outputs needs no key. Regeneration requires your own `EBIRDST_KEY`, the original root `make notebook` workflow and its Overture checkout. Its analysis and saved reader outputs are preserved; its source now isolates SQL secret storage as described below. |

The public sample is a distinct supported example, not a substitute for the Virginia duck results. It asks when a selected region's modeled abundance peaks and how its grid coverage affects the denominator. One chart maps seasonal ranges and the selected window; the other compares the valid modeled-cell mean with an explicitly incorrect NoData-to-zero shortcut, alongside coverage. Changing the western boundary from −90 to −86 degrees is the focused experiment.

## Run the portable public sample

Install [uv](https://docs.astral.sh/uv/). Copy this `notebooks/` directory, including `assets/`, helpers and `uv.lock`, to any folder; no worker checkout or Bun installation is needed. Internet access is required for dependencies, the published worker/SQL extensions and Cornell's public products.

From the copied folder:

```sh
uv sync --frozen
uv run --frozen python execute.py
uv run --frozen python execute.py \
  --parameters '{"WEST_LONGITUDE":-86}' --output-dir validation/eastern-window
```

`execute.py` runs only numbered notebooks by default, so it does not rerun the credential-dependent Virginia analysis. It creates a fresh temporary kernel and saves only after every cell succeeds. Overrides require a separate destination, and a failed run preserves the saved default. Generated charts, logs and experiment copies stay in ignored `validation/`.

For an interactive notebook editor, register and select the public-sample environment:

```sh
uv run --frozen python -m ipykernel install --user \
  --name ducks-examples --display-name 'Python (vgi-ducks public sample)'
```

Restart and run all after changing the visible parameter. The independent environment pins published Haybarn `2.0.0rc11`; the visible ATTACH uses `github-auto://Query-farm/vgi-ducks@v0.1.1`. Python is provisioned by uv. The release launch and detached-folder execution were verified on macOS arm64; other platforms were not tested.

To upgrade the worker, edit the literal release tag after checking its platform asset and SDK compatibility. Rerun the default, boundary experiment and invariant checks. Worker source and root dependency locks are independent of this environment.

## Provenance and interpretation

The real worker downloads the sample from Cornell's [ebirdst example repository at revision `a3ab944f505ad6f583e0c830d5e951929446e9eb`](https://github.com/ebird/ebirdst_example-data/tree/a3ab944f505ad6f583e0c830d5e951929446e9eb). The pinned public products are the 2023, 27 km seasonal range GeoPackage, weekly relative-abundance GeoTIFF and band-date CSV. Raw products are not bundled. The notebook clears endpoint overrides and does not silently switch to fixtures or cached substitutes. A retrieval failure stops execution.

Source: Cornell Lab of Ornithology, eBird Status and Trends. The [official product guide](https://ebird.github.io/ebirdst/articles/status.html) describes this credential-free Michigan sample and the standardized checklist interpretation. Follow the source's access and attribution terms for further use.

The worker selects native grid-cell centers strictly within the WGS84 region and raster extent. Coverage is modeled centers divided by selected centers, not exact geographic area coverage. Finite zero predictions remain zero; NoData remains unavailable. The returned mean is conditional on modeled cells, with equal weighting on the native Equal Earth grid. Seasonal range polygons are neither abundance rasters nor coverage masks.

Positive peak weeks are validated as a set, retaining ties. The `migration_calendar` comparison uses the same underlying product, so it verifies reconstruction rather than independently validating the model. Changing the region changes the population of cells being summarized; it is not a causal experiment, a population census or a migration arrival estimate.

The existing Virginia notebook, helper, requirements and photographs retain their original workflow and licenses. See [STANDARD.md](STANDARD.md) for the new public example's presentation rules.

## SQL credential isolation

Each public notebook creates Haybarn with a fresh temporary `secret_directory`
and `allow_persistent_secrets=False` before attaching workers. It fully drains
and verifies an empty SQL secret inventory before retrieval and again at cleanup.
These public examples create no SQL credentials. Cleanup closes the connection
and removes its temporary directory. Existing saved SQL secrets are neither
read, modified nor deleted; anonymous/source configuration remains explicit.

The legacy `virginia-ducks.source.ipynb` keeps its existing pinned DuckDB/SQLAlchemy
workflow and explicit `EBIRDST_KEY` / optional `EBIRD_API_KEY` requirements. Its
connection also uses fresh temporary secret storage with persistent secrets disabled
and asserts an empty initial inventory, so saved SQL secrets cannot override those
explicit environment inputs. The connection configuration was smoke-tested without
credentials or worker calls; the credential-dependent full source was not rerun.
The saved reader `spatial-migration.ipynb` and its analytical outputs remain unchanged.
