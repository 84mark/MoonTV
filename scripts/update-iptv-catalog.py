#!/usr/bin/env python3
"""Refresh the public fallback playlist; reject truncated/error responses."""
import pathlib
import urllib.request

URL = 'https://iptv-org.github.io/iptv/index.m3u'
TARGET = pathlib.Path(__file__).resolve().parents[1] / 'public/live/iptv.m3u'
request = urllib.request.Request(URL, headers={'User-Agent': 'MoonTV catalog updater'})
with urllib.request.urlopen(request, timeout=45) as response:
    raw = response.read(10 * 1024 * 1024 + 1)
if len(raw) > 10 * 1024 * 1024:
    raise SystemExit('Playlist exceeds size limit; retaining previous snapshot')
text = raw.decode('utf-8-sig')
if not text.lstrip().startswith('#EXTM3U') or text.count('#EXTINF:') < 1000:
    raise SystemExit('Invalid or unexpectedly incomplete playlist; retaining previous snapshot')
TARGET.parent.mkdir(parents=True, exist_ok=True)
TARGET.write_text(text, encoding='utf-8')
print(f'Updated {text.count("#EXTINF:")} playlist entries')
