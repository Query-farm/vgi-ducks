#!/usr/bin/env python3
"""Offline eBird contract fixture. Requires the public fake key fixture-token.
Validates the actual request path, header and parameters; never proxies to eBird.
"""
import argparse
import copy
import json
import os
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
import threading

FIXTURES = Path(__file__).resolve().parents[1] / 'fixtures'
SIGHTINGS = json.loads((FIXTURES / 'sightings.json').read_text())
HOTSPOTS = json.loads((FIXTURES / 'hotspots.json').read_text())
SEEN = set()
LOCK = threading.Lock()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def send(self, status, body, headers=None):
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        for k,v in (headers or {}).items(): self.send_header(k,v)
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == '/health':
            self.send(200, {'status':'ok'}); return
        if url.path.startswith('/status/'):
            self.status_get(url); return
        if self.headers.get('X-eBirdApiToken') != 'fixture-token':
            self.send(401, {'error':'invalid key'}); return
        q = {k:v[0] for k,v in parse_qs(url.query).items()}
        try:
            lat = float(q['lat']); lon = float(q['lng']); dist = float(q['dist'])
            assert -90 <= lat <= 90 and -180 <= lon <= 180 and 0 <= dist <= 50
            assert q.get('fmt') == 'json'
            if 'back' in q: assert 1 <= int(q['back']) <= 30
            if url.path.startswith('/v2/data/obs/geo/recent'):
                assert q['maxResults'] == '10000' and q['sppLocale'] == 'en'
                assert q['hotspot'] in ('true','false') and q['includeProvisional'] in ('true','false')
                assert 'back' in q
                if url.path == '/v2/data/obs/geo/recent': assert q['cat'] == 'species' and q['sort'] == 'date'
                else: assert 'cat' not in q and 'sort' not in q
            else: assert url.path == '/v2/ref/hotspot/geo'
        except (AssertionError, KeyError, ValueError):
            self.send(400, {'error':'invalid request parameters'}); return
        if lat == -87: self.send(403, {'error':'forbidden'}); return
        if lat == -88: self.send(503, {'error':'unavailable'}, {'Retry-After':'0'}); return
        if os.environ.get('MOCK_API_FLAKY') == '1':
            with LOCK:
                if self.path not in SEEN:
                    SEEN.add(self.path)
                    self.send(429, {'error':'rate limit'}, {'Retry-After':'0'}); return
        if lat == -90: self.send(200, []); return
        if lat == -89: self.send(200, {'unexpected':'not an array'}); return
        if lat == -86: self.send(200, [SIGHTINGS[0]] * 10000); return
        if url.path == '/v2/ref/hotspot/geo':
            result = copy.deepcopy(HOTSPOTS)
            if 'back' in q: result = [x for x in result if 'latestObsDt' in x]
        elif url.path == '/v2/data/obs/geo/recent':
            result = copy.deepcopy(SIGHTINGS)
        else:
            code = url.path.rsplit('/',1)[-1]
            result = [copy.deepcopy(x) for x in SIGHTINGS if x['speciesCode'] == code]
            if code == 'mallar3':
                second = {**result[0], 'locId':'L102','locName':'Fixture Marsh (Restricted Access)', 'howMany':0, 'obsDt':'2026-11-12 09:00', 'lat':42.38,'lng':-71.08}
                for k in ['obsValid','obsReviewed','locationPrivate','subId']: second.pop(k)
                result.append(second)
        if q.get('hotspot') == 'true': result = [x for x in result if not x.get('locationPrivate')]
        if lat == -85 and result: result[0]['howMany'] = 'many'
        self.send(200, result)

    def status_get(self, url):
        q = {k:v[0] for k,v in parse_qs(url.query).items()}
        if q.get('key') != 'status-fixture-token':
            self.send(401, {'error':'invalid Status key'}); return
        if os.environ.get('MOCK_API_FLAKY') == '1':
            with LOCK:
                if self.path not in SEEN:
                    SEEN.add(self.path)
                    self.send(429, {'error':'rate limit'}, {'Retry-After':'0'}); return
        root = '2023/mallar3/'
        objects = {
            root+'ranges/mallar3_range_smooth_27km_2023.gpkg':'migration.gpkg',
            root+'weekly/mallar3_abundance_median_27km_2023.tif':'migration.tif',
            root+'weekly/band-dates.csv':'band-dates.csv',
        }
        if url.path == '/status/list-obj/2023/mallar3':
            self.send(200,list(objects)); return
        if url.path == '/status/list-obj/2023/wooduc':
            self.send(200,[]); return
        if url.path == '/status/fetch' and q.get('objKey') in objects:
            payload = (FIXTURES/objects[q['objKey']]).read_bytes()
            self.send_response(200)
            self.send_header('Content-Type','application/octet-stream')
            self.send_header('Content-Length',str(len(payload)))
            self.end_headers(); self.wfile.write(payload); return
        self.send(404, {'error':'unavailable fixture product'})

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',type=int,default=0)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    print(f'PORT:{server.server_address[1]}',flush=True)
    server.serve_forever()
