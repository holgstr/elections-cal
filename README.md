# Election Calendar

A mobile-friendly static site that lists upcoming elections over the next 12 months. It covers OECD and BRICS members, plus other major countries selected by a simple inclusion rule. Same-day elections within a country are grouped into one card (for example US midterms or concurrent German state elections).

## Features

- Rolling 12-month window, updated automatically
- Exact dates when known; estimated dates clearly marked
- Small country and state flags (US states, German Länder)
- Mobile-first layout with search and quick filters
- **Market moves** tab highlighting Polymarket races with ≥5pp probability shifts
- **Trends** tab with Google Trends search-interest charts for selected races
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

1. Runs `scripts/build_elections.py` and regenerates Polymarket info files (`us_primary_info.json`, `presidential_info.json`, `de_state_info.json`, `us_governor_info.json`, `mayoral_info.json`)
2. Commits updated `data/elections.json`, `data/meta.json`, and curated info JSON if changed
3. A push to `main` (including data refresh commits) triggers GitHub Pages deployment

A separate workflow runs daily at 07:00 UTC:

1. Regenerates Polymarket info files
2. Runs `scripts/fetch_market_prices.py` to pull odds from Polymarket and detect ≥5pp moves since the last signaled price
3. Commits `data/market_prices/state.json` and `data/market_suggestions.json` if changed

Another workflow refreshes Google Trends interest weekly (Mondays 08:30 UTC):

1. Runs `scripts/fetch_google_trends.py` for races listed in `data/config/trends_races.json`
2. Commits `data/trends.json` when the series change

Prefer Google Trends **person/topic entities** (Knowledge Graph mids like `/m/04g_1z`) when a confident political match exists. The weekly fetch pipeline:

1. Uses a curated `"mid"` from config when present (stable pin).
2. Otherwise calls Trends autocomplete on `"name"` / `"keyword"` and auto-adopts the top hit only if it looks like a political office/person.
3. Falls back to raw search terms for the **whole race** if any candidate can’t be resolved confidently (keeps scales comparable).

Inspect matches:

```bash
python3 scripts/fetch_google_trends.py --suggest "John Hickenlooper"
python3 scripts/fetch_google_trends.py --suggest "Julie Gonzales"
python3 scripts/fetch_google_trends.py
```

For a new race, either pin `mid` after `--suggest`, or omit `mid` and let the pipeline auto-resolve when confidence is high. Max 5 candidates per race. The Trends tab shows a race dropdown labeled by candidate names (e.g. `Hickenlooper - Gonzales (CO US Senate 26)`), each candidate’s Knowledge Graph type in parentheses in the legend (e.g. `Hickenlooper (United States Senator)`, or red `raw` for search-term fallback), a relative search-share summary (area under the displayed curves, rescaled to 100%), and day-level hover values.

Entity `title` / `type` come from Trends autocomplete (`--suggest`); curated rows store them as `topic_title` / `topic_type` in `data/config/trends_races.json`, and the weekly fetch writes them through to `data/trends.json`.

Daily 0–100 values can differ from a live Google Trends page even with the “same” window: the site uses a custom range ending on election day (not “Past 30 days” from today), Colorado geo, and Topics/mids when available. Google also re-samples over time.
