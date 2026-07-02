# Election Calendar

A mobile-friendly static site that lists upcoming elections over the next 12 months. It covers OECD and BRICS members, plus other major countries selected by a simple inclusion rule. Same-day elections within a country are grouped into one card (for example US midterms or concurrent German state elections).

## Features

- Rolling 12-month window, updated automatically
- Exact dates when known; estimated dates clearly marked
- Small country and state flags (US states, German Länder)
- Mobile-first layout with search and quick filters
- No build step — plain HTML, CSS, and JavaScript

## Live site

Enable **GitHub Pages** (Settings → Pages → Source: GitHub Actions). Pushes to `main` deploy the site; the `update-elections` workflow refreshes election data weekly (and on each push).

## Run locally

```bash
python3 scripts/build_elections.py
python3 -m http.server 8080
```

Open [http://localhost:8080](http://localhost:8080).

Set `SKIP_WIKIDATA=1` for a fast curated-only build when Wikidata is slow.

## Country inclusion

A country is tracked if it meets **any** of these rules (documented in `data/config/countries.json`):

1. OECD member
2. BRICS member
3. G20 sovereign member
4. Population ≥ 50 million
5. Nominal GDP in the global top 35
6. European sovereign state (excluding microstates: Andorra, Liechtenstein, Malta, Monaco, San Marino, Vatican City)
7. Latin American mainland sovereign state with population ≥ 3 million (Caribbean island nations excluded)
8. Population ≥ 10 million (presidential or parliamentary elections)
9. Sub-Saharan African sovereign state with population ≥ 20 million

Countries added via rules 3–9 are tagged `major` in the UI filter.

## Event display

Cards separate **location**, **event title**, and **contest detail** consistently. See [docs/events.md](docs/events.md) for the full framework and naming conventions.

## Data sources

| Source | What it covers |
|--------|----------------|
| `data/curated/us_elections.json` | US midterms (federal + state offices on the same day) |
| `data/curated/us_primaries.json` | US Senate and Governor primaries (both major parties) |
| `data/curated/us_primary_runoffs.json` | Confirmed US primary runoffs (add only after the first round) |
| `data/curated/de_elections.json` | German Landtag elections |
| `data/curated/international.json` | Key federal elections with specific office labels |
| Wikidata SPARQL | Additional presidential and parliamentary elections |

Edit curated files to add or correct dates. The build script merges curated data with Wikidata, removes duplicates, and groups same-day elections into combined cards (US and Germany always come from curated sources).

**Snap and early elections:** When a government calls an early parliamentary vote before Wikidata lists it (or when Wikidata is unavailable), add an entry to `data/curated/international.json` with `date_precision: "estimated"`, a provisional date in the announced window, and `comment: "snap_election"`. Curated records always take precedence over Wikidata, so these elections stay visible even when the automated fetch fails.

## Automation

The GitHub Actions workflow runs every Monday at 06:00 UTC:

1. Runs `scripts/build_elections.py` and regenerates Polymarket info files (`us_primary_info.json`, `presidential_info.json`, `de_state_info.json`, `us_governor_info.json`)
2. Commits updated `data/elections.json`, `data/meta.json`, and curated info JSON if changed
3. A push to `main` (including data refresh commits) triggers GitHub Pages deployment
