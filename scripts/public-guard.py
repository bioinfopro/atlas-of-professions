#!/usr/bin/env python3
"""
public-guard: refuse anything that would publish what shouldn't be public.

Everything in this repo, and everything it deploys, is public. Three modes:

  scripts/public-guard.py --staged      the files staged for commit (the pre-commit hook)
  scripts/public-guard.py --tracked     every tracked file (CI)
  scripts/public-guard.py --site DIR    a site bundle about to be deployed

Checks:
  - repo files: only the paths in COMMITTABLE may be committed; the data
    (assets/data/) and local settings never are;
  - a site bundle: exactly index.html, 404.html and assets/ (css, js,
    vendor, data, diagrams, fonts), web files only, no hidden files or links,
    and the data file present;
  - every text file: no local paths, run ids, email addresses other than
    info@bioinfopro.org, job-board or ATS domains, model ids or API keys;
  - every text file, when .atlas-denylist exists: none of its patterns.
    That file is gitignored and never committed (it names what it
    protects); one regular expression per line, # for comments. CI runs
    without it.
"""
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SELF = "scripts/public-guard.py"

NAME = r"[a-z0-9][a-z0-9.-]*"
COMMITTABLE = re.compile(
    r"^(?:\.gitignore|CLAUDE\.md|README\.md|\.claude/settings\.json|"
    r"\.github/(?:CODEOWNERS|dependabot\.yml|workflows/[a-z0-9-]+\.yml)|"
    r"scripts/[a-z0-9-]+\.(?:sh|py)|index\.html|404\.html|"
    rf"assets/(?:css/{NAME}\.css|js/{NAME}\.js|vendor/{NAME}\.js|"
    rf"diagrams/{NAME}\.(?:svg|png|webp)|fonts/{NAME}\.woff2))$")
SITE = re.compile(
    r"^(?:index\.html|404\.html|"
    rf"assets/(?:css/{NAME}\.css|js/{NAME}\.js|vendor/{NAME}\.js|data/{NAME}\.json|"
    rf"diagrams/{NAME}\.(?:svg|png|webp)|fonts/{NAME}\.woff2))$")
SITE_REQUIRED = ["index.html", "404.html", "assets/data/dashboard-data.json"]
TEXT_EXT = {".html", ".css", ".js", ".json", ".svg", ".md", ".yml", ".sh", ".py", ""}
PUBLIC_EMAILS = {"info@bioinfopro.org", "noreply@anthropic.com"}

GENERIC = [
    ("local path", r"/Users/|/home/|[A-Za-z]:\\\\|CloudStorage|GoogleDrive-|Shared drives|My Drive"),
    ("run id", r"\b\d{8}T\d{6}Z\b"),
    ("job board / ATS", r"(?i)greenhouse\.io|lever\.co|myworkdayjobs|workday\.com|ashbyhq|bamboohr|"
                        r"smartrecruiters|icims\.com|jobvite|taleo\.net|linkedin\.com/jobs|indeed\.com|glassdoor"),
    ("model id or key", r"claude-(?:opus|sonnet|haiku|fable)|ANTHROPIC_API_KEY|sk-ant-|gh[pousr]_[A-Za-z0-9]{20,}|"
                        r"AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY"),
]
GENERIC = [(label, re.compile(p)) for label, p in GENERIC]
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


def local_denylist():
    path = os.path.join(ROOT, ".atlas-denylist")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        lines = [l.strip() for l in f if l.strip() and not l.lstrip().startswith("#")]
    return [re.compile(l) for l in lines]


def scan_text(rel, text, denylist):
    found = []
    # this file holds the generic patterns themselves, so only the local list applies to it
    if rel != SELF:
        for label, rx in GENERIC:
            for m in sorted(set(rx.findall(text)))[:3]:
                found.append(f"{rel}: {label}: {m!r}")
        for m in sorted(set(EMAIL.findall(text)) - PUBLIC_EMAILS)[:3]:
            found.append(f"{rel}: email: {m!r}")
    for rx in denylist or []:
        if rx.search(text):
            found.append(f"{rel}: matches a local denylist pattern")   # never echo it: CI logs are public
    return found


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout


def check_repo(staged):
    denylist = local_denylist()
    found = []
    if staged:
        paths = [p for p in git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z").split("\0") if p]
        read = lambda p: git("show", f":{p}")
    else:
        paths = [p for p in git("ls-files", "-z").split("\0") if p]
        read = lambda p: open(os.path.join(ROOT, p), encoding="utf-8", errors="replace").read()
    for p in paths:
        if not COMMITTABLE.match(p):
            found.append(f"{p}: may not be committed (not in the repo's file allowlist)")
            continue
        if os.path.splitext(p)[1].lower() in TEXT_EXT:
            found += scan_text(p, read(p), denylist)
    return found, denylist is not None


def check_site(folder):
    denylist = local_denylist()
    found = []
    files = []
    for dirpath, dirnames, filenames in os.walk(folder, followlinks=False):
        for name in dirnames + filenames:
            path = os.path.join(dirpath, name)
            rel = os.path.relpath(path, folder).replace(os.sep, "/")
            if os.path.islink(path):
                found.append(f"{rel}: symlink")
            elif name.startswith("."):
                found.append(f"{rel}: hidden file")
            elif os.path.isfile(path):
                files.append(rel)
                if not SITE.match(rel):
                    found.append(f"{rel}: not in the site layout")
                elif os.path.splitext(rel)[1].lower() in TEXT_EXT:
                    with open(path, encoding="utf-8", errors="replace") as f:
                        found += scan_text(rel, f.read(), denylist)
    found += [f"{p}: missing" for p in SITE_REQUIRED if p not in files]
    return found, denylist is not None


def main():
    args = sys.argv[1:]
    if args == ["--staged"]:
        found, local = check_repo(staged=True)
    elif args == ["--tracked"]:
        found, local = check_repo(staged=False)
    elif len(args) == 2 and args[0] == "--site" and os.path.isdir(args[1]):
        found, local = check_site(args[1])
    else:
        raise SystemExit(__doc__)
    for line in found:
        print(line)
    note = "" if local else " (generic checks only: no .atlas-denylist here)"
    print(f"public-guard: {len(found)} problem(s){note}")
    sys.exit(1 if found else 0)


if __name__ == "__main__":
    main()
