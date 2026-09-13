#!/bin/sh
# Assemble the static site Vercel serves (vercel.json → buildCommand):
#   dist/            ← site/  (homepage: Bench Shift + silhouette hero)
#   dist/demo/       ← game/  (the browser game, minus tests/tools/README/serve.py)
# Preview locally: sh scripts/build-site.sh && python3 -m http.server -d dist 8000
set -eu
cd "$(dirname "$0")/.."

rm -rf dist
mkdir -p dist/demo
cp -R site/. dist/
(cd game && tar cf - --exclude tests --exclude tools --exclude README.md --exclude serve.py --exclude .DS_Store .) | (cd dist/demo && tar xf -)
find dist -name .DS_Store -delete

echo "built dist/ ($(du -sh dist | cut -f1))"
