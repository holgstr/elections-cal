# Election Calendar

A mobile-friendly static site that lists upcoming elections over the next 12 months, focused on OECD and BRICS countries. US and German federal and state elections are tracked separately; other countries show presidential elections (where popularly elected) and parliamentary elections.

## Features

- Rolling 12-month window, updated automatically
- Exact dates when known; estimated dates clearly marked
- Small country and state flags (US states, German Länder)
- Mobile-first layout with search and quick filters
- No build step — plain HTML, CSS, and JavaScript

## Live site

Enable **GitHub Pages** (Settings → Pages → Source: GitHub Actions). The `update-elections` workflow deploys the site and refreshes data weekly.

## Run locally

```bash
python3 scripts/build_elections.py
python3 -m http.server 8080
```

Open [http://localhost:8080](http://localhost:8080).

Set `SKIP_WIKIDATA=1` for a fast curated-only build when Wikidata is slow.

## Data sources

| Source | What it covers |
|--------|----------------|
| `data/curated/us_elections.json` | US federal midterms + state gubernatorial elections |
| `data/curated/de_elections.json` | German Landtag elections |
| `data/curated/international.json` | Key OECD/BRICS federal elections |
| Wikidata SPARQL | Additional presidential and parliamentary elections |

Edit curated files to add or correct dates. The build script merges curated data with Wikidata (US and Germany always come from curated sources).

## Automation

The GitHub Actions workflow runs every Monday at 06:00 UTC:

1. Runs `scripts/build_elections.py`
2. Commits updated `data/elections.json` and `data/meta.json` if changed
3. Deploys the static site to GitHub Pages
