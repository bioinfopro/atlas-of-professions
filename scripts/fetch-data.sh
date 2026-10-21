#!/usr/bin/env bash
# Fetch the Atlas data from the export folder into assets/data/ (gitignored).
#
#   scripts/fetch-data.sh              the latest release
#   scripts/fetch-data.sh 2026-10a     a given release
#
# This repo is the only home of the site (page, widget, vendored D3). The
# export folder holds the data releases: <id>/ with dashboard-data.json and
# manifest.json. The page draws whatever data file is in assets/data/, so a
# new release needs no code change. The data is never committed.
#
# The export folder's location is read from .atlas-local (gitignored, never
# committed), one line:
#
#   ATLAS_EXPORT_DIR=/path/to/the/export/folder
set -euo pipefail

cd "$(dirname "$0")/.."
REPO="$(pwd -P)"
DATA="dashboard-data.json"

die() { echo "fetch-data: $*" >&2; exit 1; }

[ -f .atlas-local ] || die "no .atlas-local file (see the top of this script)"
EXPORT_DIR="$(sed -n 's/^ATLAS_EXPORT_DIR=//p' .atlas-local | head -n 1)"
[ -n "$EXPORT_DIR" ] || die ".atlas-local has no ATLAS_EXPORT_DIR= line"
[ -d "$EXPORT_DIR" ] || die "the export folder in .atlas-local is not reachable"
EXPORT_DIR="$(cd "$EXPORT_DIR" && pwd -P)"

# The export folder holds release folders and nothing else. Refuse anything
# that looks like a wider folder: one inside a git repository, or one holding
# anything that isn't a release.
case "$EXPORT_DIR/" in "$REPO"/*) die "the export folder is inside this repo";; esac
d="$EXPORT_DIR"
while [ "$d" != "/" ]; do
  [ -e "$d/.git" ] && die "the export folder is inside a git repository; point .atlas-local at the export folder itself"
  d="$(dirname "$d")"
done
for entry in "$EXPORT_DIR"/*; do
  [ -e "$entry" ] || continue
  name="$(basename "$entry")"
  [[ -d "$entry" && ! -L "$entry" && "$name" =~ ^[0-9]{4}-[0-9]{2}[a-z]$ ]] \
    || die "the export folder holds something that isn't a release folder: $name"
done

if [ $# -ge 1 ]; then
  RELEASE="$1"
  [[ "$RELEASE" =~ ^[0-9]{4}-[0-9]{2}[a-z]$ ]] || die "not a release id: $RELEASE"
else
  RELEASE="$(ls "$EXPORT_DIR" | sort | tail -n 1)"
  [ -n "$RELEASE" ] || die "the export folder has no releases"
fi
SRC="$EXPORT_DIR/$RELEASE"
[ -f "$SRC/manifest.json" ] || die "release $RELEASE has no manifest.json"
[ -f "$SRC/$DATA" ] || die "release $RELEASE has no $DATA"

# The manifest's record of the data file: "<bytes> <sha256>".
expected="$(python3 -I - "$SRC/manifest.json" "$DATA" <<'EOF'
import json, sys
manifest, path = sys.argv[1], sys.argv[2]
entry = {f["path"]: f for f in json.load(open(manifest))["files"]}.get(path)
if entry:
    print(entry["bytes"], entry["sha256"])
EOF
)"
[ -n "$expected" ] || die "release $RELEASE's manifest does not list $DATA"

# Copy to a temp file, check the copy, then move it into place.
mkdir -p assets/data
tmp="$(mktemp assets/data/.fetch.XXXXXX)"
trap 'rm -f "$tmp"' EXIT
cp "$SRC/$DATA" "$tmp"
actual="$(wc -c < "$tmp" | tr -d ' ') $(shasum -a 256 "$tmp" | cut -d ' ' -f 1)"
[ "$actual" = "$expected" ] || die "release $RELEASE's data file does not match its manifest"
mv "$tmp" "assets/data/$DATA"
trap - EXIT
echo "fetch-data: release $RELEASE -> assets/data/$DATA ($(echo "$actual" | cut -d ' ' -f 1) bytes, sha256 checked)"
