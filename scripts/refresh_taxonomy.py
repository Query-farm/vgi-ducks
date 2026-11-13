#!/usr/bin/env python3
"""Reproduce or check the bundled species table from a pinned eBird taxonomy version.

No account/key is needed for the public taxonomy endpoint at verification time.
Changing the version requires reviewing codes, counts, docs and tests together.
"""
import argparse
import json
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
VERSION = '2026'
URL = f'https://api.ebird.org/v2/ref/taxonomy/ebird?fmt=json&cat=species&locale=en&version={VERSION}'
# Scope convention: ducks including Nettapus pygmy-geese; other geese/swans excluded.
NON_DUCK_GENERA = {'Anser', 'Branta', 'Cereopsis', 'Cyanochen', 'Oressochen', 'Chloephaga',
                   'Cygnus', 'Coscoroba', 'Plectropterus'}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Compare upstream with the bundle without modifying it')
    args = parser.parse_args()
    with urlopen(Request(URL, headers={'User-Agent':'QueryFarm-vgi-ducks/0.1.0'}), timeout=30) as response:
        payload = response.read(8*1024*1024+1)
    if len(payload) > 8*1024*1024: raise ValueError('Taxonomy response exceeds 8 MiB')
    taxa = json.loads(payload)
    rows = []
    for taxon in taxa:
        if taxon.get('familySciName') != 'Anatidae' or taxon.get('category') != 'species': continue
        genus = taxon['sciName'].split()[0]
        if genus in NON_DUCK_GENERA or taxon['speciesCode'] == 'egygoo': continue
        rows.append(dict(species_code=taxon['speciesCode'], common_name=taxon['comName'],
                         scientific_name=taxon['sciName'], genus=genus, family_name=taxon['familySciName'],
                         taxon_order=taxon['taxonOrder'], extinct=taxon.get('extinct',False),
                         taxonomy_version=VERSION, source_url='https://ebird.org/species/'+taxon['speciesCode']))
    if len(rows) != 140 or len({r['species_code'] for r in rows}) != len(rows):
        raise ValueError('Unexpected taxonomy size/duplicates; inspect upstream before updating the bundle')
    path = ROOT/'data/species.json'
    if args.check:
        if json.loads(path.read_text()) != rows: raise ValueError('Bundled species differ from upstream pinned taxonomy')
        print(f'PASS: {len(rows)} bundled duck taxa match eBird {VERSION}')
    else:
        path.write_text(json.dumps(rows,indent=2)+'\n')
        print(f'Wrote {path} from eBird {VERSION}')

if __name__ == '__main__': main()
