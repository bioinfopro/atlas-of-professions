#!/usr/bin/env bash
# Fetch the Atlas site from the export folder into this repo.
#
#   scripts/fetch-data.sh              the latest release
#   scripts/fetch-data.sh 2026-10a     a given release
#
# The export folder is the master copy of the whole site, widget included.
# Each release there is <id>/ with manifest.json and site/. This replaces the
# repo's site files (index.html, 404.html, assets/) with the release's site/,
# after checking every file against the manifest. Edit the widget in the
# export folder, never here: a fetch overwrites local edits. The data
# (assets/data/) is gitignored and never committed; the rest is committed so
# the repo shows which widget is deployed.
#
# The export folder's location is read from .atlas-local (gitignored, never
# committed), one line:
#
#   ATLAS_EXPORT_DIR=/path/to/the/export/folder
set -euo pipefail

cd "$(dirname "$0")/.."
REPO="$(pwd -P)"

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
[ -d "$SRC/site" ] || die "release $RELEASE has no site/"

# Copy the release's site/ to a staging folder, then check the copy itself:
# exactly the manifest's site files, each with its size and sha256, and only
# files the site layout allows.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$SRC/site" "$STAGE/site"
cp "$SRC/manifest.json" "$STAGE/manifest.json"
python3 -I - "$STAGE" <<'EOF' || die "release $RELEASE failed its checks (nothing changed here)"
import hashlib, json, os, re, sys
stage = sys.argv[1]
name = r"[a-z0-9][a-z0-9.-]*"
layout = re.compile(r"^site/(?:(?:index|404)\.html|assets/(?:"
                    rf"css/{name}\.css|js/{name}\.js|vendor/{name}\.js|data/{name}\.json|"
                    rf"diagrams/{name}\.(?:svg|png|webp)|fonts/{name}\.woff2))$")
listed = {f["path"]: f for f in json.load(open(os.path.join(stage, "manifest.json")))["files"]
          if f["path"].startswith("site/")}
present = set()
for dirpath, _, names in os.walk(os.path.join(stage, "site")):
    for n in names:
        present.add(os.path.relpath(os.path.join(dirpath, n), stage).replace(os.sep, "/"))
problems = [f"{p}: not in the site layout" for p in sorted(present) if not layout.match(p)]
problems += [f"{p}: not in the manifest" for p in sorted(present - set(listed))]
problems += [f"{p}: in the manifest but missing" for p in sorted(set(listed) - present)]
for p in sorted(present & set(listed)):
    full = os.path.join(stage, p)
    data = open(full, "rb").read()
    if len(data) != listed[p]["bytes"] or hashlib.sha256(data).hexdigest() != listed[p]["sha256"]:
        problems.append(f"{p}: does not match the manifest")
for p in ("site/index.html", "site/404.html", "site/assets/data/dashboard-data.json"):
    if p not in present:
        problems.append(f"{p}: missing")
for line in problems:
    print("fetch-data: " + line, file=sys.stderr)
sys.exit(1 if problems else 0)
EOF

# Replace the repo's site files with the checked copy. Only index.html,
# 404.html and assets/ are touched; a file the release dropped is removed.
cp "$STAGE/site/index.html" "$STAGE/site/404.html" .
mkdir -p assets
rsync -a --delete "$STAGE/site/assets/" assets/
echo "fetch-data: release $RELEASE -> index.html, 404.html, assets/ (every file checked against its manifest)"
if git rev-parse --git-dir >/dev/null 2>&1; then
  changed="$(git status --porcelain -- index.html 404.html assets)"
  if [ -n "$changed" ]; then
    echo "fetch-data: site files changed by this fetch (commit them with the deploy):"
    echo "$changed"
  else
    echo "fetch-data: site files unchanged"
  fi
fi
