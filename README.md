# Atlas of Bioinformatics Professions

What life-science data jobs ask for: an interactive map of job postings,
grouped by the duties and skills they ask for. Published by the
[Association of Bioinformatics Professionals](https://bioinfopro.org/).

The site is a single static page. The widget in `assets/` draws one data
file, `assets/data/dashboard-data.json`, with D3. The data is published with
the site but is not kept in this repository.

## Layout

```text
index.html  404.html
assets/css/      styles
assets/js/       the widget
assets/vendor/   D3 7.9.0 and d3-sankey 0.12.3, unmodified
assets/data/     the data (not in git)
scripts/         fetch the data, guard, hooks, publish
```

## Working on the site

```bash
scripts/setup-hooks.sh          # once: the pre-commit guard
scripts/fetch-data.sh           # needs a local .atlas-local (maintainers only)
```

Then serve the folder over HTTP (not `file://`), for example with
`python3 -m http.server`, and open `index.html`.

## Publishing

`scripts/publish-release.sh <release_id>` checks the data and the site,
attaches the data to a draft release and starts the `Deploy` workflow,
which publishes `main` with that data to GitHub Pages. Re-running the
workflow with an earlier release id rolls the site back.

## Contact

info@bioinfopro.org
