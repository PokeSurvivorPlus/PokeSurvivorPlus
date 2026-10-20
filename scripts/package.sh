#!/bin/sh
# Builds the release zip from extension/ (the files are copied as they are).
# Also copies it as dist/<name>.xpi (byte-identical; same zip loads in Firefox).
# Usage: scripts/package.sh            -> dist/pokesurvivor-plus-<version>.zip + dist/...-<version>.xpi + SHA256SUMS.txt
set -eu
cd "$(dirname "$0")/.."
VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' extension/manifest.json | head -n 1)
NAME="pokesurvivor-plus-$VERSION"
rm -rf dist && mkdir -p "dist/$NAME"
cp extension/manifest.json extension/inject.js extension/background.js extension/keepalive.js extension/README.md extension/LICENSE "dist/$NAME/"
(cd dist && zip -qrX "$NAME.zip" "$NAME" && rm -rf "$NAME")
cp "dist/$NAME.zip" "dist/$NAME.xpi"  # Firefox (signed or temporary load) accepts the same zip as .xpi
(cd dist && sha256sum "$NAME.zip" > SHA256SUMS.txt)
echo "Built dist/$NAME.zip (and $NAME.xpi for Firefox)"
cat dist/SHA256SUMS.txt
