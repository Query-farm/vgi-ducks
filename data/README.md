# Bundled duck taxonomy

`species.json` contains factual names, identifiers, ordering and extinction flags
from the Cornell Lab of Ornithology's **eBird taxonomy, version 2026**.
Retrieved and checked on 2026-11-13. Source:

https://api.ebird.org/v2/ref/taxonomy/ebird?fmt=json&cat=species&locale=en&version=2026

This worker selects species in Anatidae, excluding the genera Anser, Branta,
Cereopsis, Cyanochen, Oressochen, Chloephaga, Cygnus, Coscoroba and Plectropterus,
and excluding Egyptian Goose (`egygoo`). It retains Nettapus pygmy-geese,
whistling-ducks, shelducks, teals, mergansers and other ducks. This explicit scope
is a product convention, not a claim that “ducks” form a single taxonomic clade.

There are 140 species, including 9 marked extinct. The reference retains extinct
species for historical identification; the recent-sighting reader rejects them.
Taxonomic categories other than `species` (hybrids, domestic forms, unidentified
groups, etc.) are not bundled. Extinct=false means “not marked extinct by eBird,”
not a statement about conservation status or expected sightings.

Reproduce the bundle with `python3 scripts/refresh_taxonomy.py`, or compare it
without writing with `make verify-taxonomy`. The script pins version 2026. Review
codes, scope, counts, documentation and tests together before moving versions.
The source's English names may differ from other naming authorities.

Attribution: eBird, Cornell Lab of Ornithology, Ithaca, New York.
[eBird data use and citation](https://science.ebird.org/en/use-ebird-data/citation)
and [API terms](https://www.birds.cornell.edu/home/ebird-api-terms-of-use/) apply
separately from the worker's code license. No photos or audio are redistributed.
