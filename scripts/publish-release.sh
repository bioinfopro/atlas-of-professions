#!/usr/bin/env bash
# Publish a data release to the live site.
#
#   scripts/publish-release.sh 2026-10a             upload the data and deploy
#   scripts/publish-release.sh 2026-10a --dry-run   every check, no upload or deploy
#
# The site's code is what is committed on main; the data is not in git. This:
#   1. checks the working tree is clean and main is pushed;
#   2. fetches the release's data (scripts/fetch-data.sh, manifest-checked);
#   3. assembles the site exactly as the deploy will, and runs the guard on it;
#   4. attaches the data file to a draft GitHub release "data-<id>", which the
#      public can't see and which never enters git (a draft of the same id is
#      replaced);
#   5. starts the deploy workflow, which checks the data's sha256 and the guard
#      again, then publishes main's site with that data to GitHub Pages.
#
# Rollback: run the deploy workflow again with an earlier release id. Keep the
# last three data drafts; delete older ones on GitHub.
set -euo pipefail

cd "$(dirname "$0")/.."
die() { echo "publish-release: $*" >&2; exit 1; }

RELEASE="${1:-}"
DRY=0
[ "${2:-}" = "--dry-run" ] && DRY=1
[[ "$RELEASE" =~ ^[0-9]{4}-[0-9]{2}[a-z]$ ]] || die "usage: scripts/publish-release.sh <release_id> [--dry-run]"
TAG="data-$RELEASE"

# 1. The deploy publishes main as it is on GitHub, so it must match what's here.
[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || die "check out main first"
[ -z "$(git status --porcelain)" ] || die "the working tree has uncommitted changes"
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || die "main differs from origin/main: push or pull first"

# 2.
scripts/fetch-data.sh "$RELEASE"
DATA=assets/data/dashboard-data.json
SHA="$(shasum -a 256 "$DATA" | cut -d ' ' -f 1)"

# 3. The same assembly as the deploy workflow.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/site"
cp index.html 404.html "$STAGE/site/"
rsync -a --exclude '.*' assets "$STAGE/site/"
python3 -I scripts/public-guard.py --site "$STAGE/site"

if [ "$DRY" = 1 ]; then
  echo "publish-release: dry run passed for $RELEASE (sha256 $SHA); nothing uploaded"
  exit 0
fi

# 4.
existing="$(gh release view "$TAG" --json isDraft --jq .isDraft 2>/dev/null || true)"
if [ "$existing" = "false" ]; then
  die "$TAG is a published release; data releases must stay drafts"
elif [ "$existing" = "true" ]; then
  gh release delete "$TAG" --yes
fi
gh release create "$TAG" --draft --title "Data $RELEASE" \
  --notes "Atlas data release $RELEASE. sha256 $SHA. Draft only: never published." "$DATA"

# 5.
gh workflow run deploy.yml --ref main -f release_id="$RELEASE" -f sha256="$SHA"
echo "publish-release: $RELEASE uploaded as draft $TAG; deploy started (gh run watch to follow it)"
