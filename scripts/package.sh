#!/bin/sh
# Builds the release zip from extension/ (the files are copied as they are).
# Usage: scripts/package.sh            -> dist/pokesurvivor-plus-<version>.zip + SHA256SUMS.txt
set -eu
cd "$(dirname "$0")/.."
VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' extension/manifest.json | head -n 1)
NAME="pokesurvivor-plus-$VERSION"
rm -rf dist && mkdir -p "dist/$NAME"
cp extension/manifest.json extension/inject.js extension/background.js extension/keepalive.js extension/README.md extension/LICENSE "dist/$NAME/"
(cd dist && zip -qrX "$NAME.zip" "$NAME" && rm -rf "$NAME")
(cd dist && sha256sum "$NAME.zip" > SHA256SUMS.txt)
echo "Built dist/$NAME.zip"
cat dist/SHA256SUMS.txt
