#!/usr/bin/env bash
# Install the pre-commit hook: every commit runs scripts/public-guard.py over
# the staged files and is refused if it finds anything. Run once per clone.
set -euo pipefail
cd "$(dirname "$0")/.."
hook="$(git rev-parse --git-path hooks)/pre-commit"
cat > "$hook" <<'EOF'
#!/usr/bin/env bash
# Installed by scripts/setup-hooks.sh.
exec python3 -I "$(git rev-parse --show-toplevel)/scripts/public-guard.py" --staged
EOF
chmod +x "$hook"
echo "setup-hooks: pre-commit hook installed ($hook)"
[ -f .atlas-denylist ] || echo "setup-hooks: note: no .atlas-denylist here, so the hook runs the generic checks only"
