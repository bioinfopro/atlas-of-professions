# Atlas of Bioinformatics Professions: Claude Code guidelines

This repo is **public** (or will be at launch): assume anyone can read every
file and every commit ever pushed. It holds the site's code and its deploy
plumbing. It never holds the data.

## Directory Architecture
- `index.html`, `404.html`: the pages. Links to the site's own files are relative, so the site works under any base path.
- `assets/css`, `assets/js`: the widget. It draws `assets/data/dashboard-data.json` and does no analysis.
- `assets/vendor`: D3 7.9.0 and d3-sankey 0.12.3, unmodified.
- `assets/data/`: **gitignored**. Filled by `scripts/fetch-data.sh`; never commit it.
- `scripts/`: fetch the data, guard, install the hook, publish a release.
- `.github/workflows/`: `guard.yml` (every push), `deploy.yml` (manual, started by the publish script).
- Local only, gitignored: `.atlas-local` (where the export folder is), `.atlas-denylist` (names the guard refuses), `.claude/settings.local.json`.

## Security Rules
- Only the files the guard's allowlist names may be committed (`scripts/public-guard.py`, `COMMITTABLE`). Never commit data, notes, spreadsheets or local settings.
- Code comments, commit messages, issues and docs describe what the code does. They never name where the data comes from: no local paths, folder or drive names, other projects, run ids, internal file names or pipeline details.
- The only thing this repo reads from outside itself is the export folder named in `.atlas-local`, and only through `scripts/fetch-data.sh`. Never read, search or reference any other folder on this machine, and never print the contents of `.atlas-local` or `.atlas-denylist`.
- Never add a submodule, a remote other than `origin`, or a symlink to anything outside this repo.
- Open sessions in this folder only, never with a parent folder or another project added.
- The data is public once deployed, but it never enters git: it reaches Pages as a draft-release asset (`scripts/publish-release.sh`).
- Never print, request or store tokens or keys. The repo has no secrets.

## Git Rules
- `git commit`, `git push`, `gh release` and `gh workflow`, and anything else that publishes to a remote or rewrites shared history, require the user's explicit, in-the-moment approval. Never assume a prior approval carries forward. `permissions.ask` in `.claude/settings.json` enforces it.
- Subagents never run these commands.
- If a task can't be finished without a commit, push or deploy, say so and let the user decide.
- The pre-commit hook (`scripts/setup-hooks.sh`) runs the guard on staged files. Never bypass it (`--no-verify`).

## Commands
- Install the pre-commit hook (once per clone): `scripts/setup-hooks.sh`
- Fetch the latest data: `scripts/fetch-data.sh` (or `scripts/fetch-data.sh <release_id>`)
- Preview: serve the parent folder so the site sits at its real path, e.g.
  `mkdir -p /tmp/atlas-serve && ln -sfn "$PWD" /tmp/atlas-serve/atlas-of-professions && python3 -m http.server 8770 -d /tmp/atlas-serve`,
  then open http://127.0.0.1:8770/atlas-of-professions/
- Guard: `scripts/public-guard.py --tracked` (repo) or `--site <dir>` (a bundle)
- Check a release without uploading: `scripts/publish-release.sh <release_id> --dry-run`
- Publish: `scripts/publish-release.sh <release_id>` (needs approval)
