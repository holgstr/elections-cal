# Event display framework

Every election card uses three distinct layers. **Location**, **event title**, and **contest detail** must never overlap — each field has one job.

## Card layers

| Layer | DOM | Question | Example |
|-------|-----|----------|---------|
| **Location / title** | `.card-title` | Where is the election? | `Sweden` · `Kansas` · `Berlin` · `US State primaries` |
| **Contest detail** | `.card-labels` or `.card-sections` | What is being elected? | `Riksdag` · `Governor Primary · Senate Primary` |

Contest labels use the same blue pill styling as office tags (`.office-tag`).

### Title rules

The title is always **concise**. It names the place only — contest names belong in labels or sections.

| Case | Title pattern | Example |
|------|---------------|---------|
| National / federal (single or multi-contest day) | `{Country}` | `Sweden` · `Bosnia and Herzegovina` · `Brazil` |
| US state (single state on a date) | `{State}` | `Kansas` · `Arizona` |
| Local / mayoral | `{City}` | `Manchester` |
| US multi-state same day (state-level) | `US State primaries` | `US State primaries` |
| German state (standalone) | `{State}` | `Berlin` |
| German multi-state same day | `German State primaries` | `German State primaries` |
| US midterms | `US midterms` | state list: `Governor` · `State Legislature` · `Senate` (where applicable) |

**Never:**

- Repeat the country name with a nationality adjective (`Latvia` + `Latvian parliamentary`).
- Join multiple contest names in the title (`Federation Parliament · House of Peoples · …`).
- Use "election" or "elections" in the title.
- Prefix titles with `Next`.

### Contest detail rules

- **Labels** (`.card-labels`): blue pills listing specific races when several contests share one location and date (merged US primaries in a single state, Bosnia general election day, Brazil election day, standalone federal elections).
- **Sections** (`.card-sections`): structured breakdown when contests span levels or many states (US midterms, multi-state US primary day, German combined state election day).
- **Office tags** (`.card-meta`): fallback for simple standalone cards with a single contest when the title does not already name the body.

### Date display

- Exact dates show the day number in blue.
- Estimated dates show **TBD** in yellow (`--estimated`) at the same size as the day number; the `Est.` badge is not used.

### Election comments (TBD only)

When an estimated date needs context beyond a regular scheduled election with no fixed date yet, use a standardized `comment` key from `data/config/election_comments.json`.

| Key | Label | When to use |
|-----|-------|-------------|
| `snap_election` | Snap election | Parliament dissolved early; date is provisional |

**Do not** add a comment for regular elections that must happen by a constitutional deadline but have no announced date yet (for example a scheduled parliamentary term ending).

Display: `.card-comment` below contest detail.

### Month ordering

Within each month group, cards are sorted by **date**, then alphabetically by state or country.

## Data layer (`title` field)

The `title` field in JSON describes the **contest**, never the location.

| Type | Pattern | Example |
|------|---------|---------|
| General | `{Office}` | `Governor` |
| Primary | `{Party} {Office} Primary` | `Democratic Senate Primary` |
| Runoff | `{Party} {Office} Primary Runoff` | `Republican Governor Primary Runoff` |
| Presidential | `President — Round {n}` | `President — Round 2` |
| Legislative | `{Body}` | `Riksdag` |
| Combined (aggregated) | Umbrella name | `Midterms`, `General`, `State` |

### Naming conventions

- Use **Governor**, not "Gubernatorial".
- Strip nationality adjectives that duplicate the country (`Latvian parliamentary` → `Parliament`).
- Strip `Next` prefixes from Wikidata labels.
- Do not embed state or country names in `title` (German state cards are formatted at display time).
- Combined same-day cards must use umbrella titles (`General`, `Midterms`, `State`), never joined contest names.

## Merging behaviour

| Scenario | Title | Labels / detail |
|----------|-------|-----------------|
| Single federal election | `Sweden` | `Riksdag` |
| Single federal election (generic) | `Latvia` | `Parliament` |
| Merged state primaries (one state) | `Kansas` | `Governor Primary` · `Senate Primary` |
| US multi-state primary day | `US State primaries` | sections: states + primary labels |
| US midterms (combined) | `US midterms` | sections: states with `Governor`, `State Legislature`, and `Senate` (where applicable) |
| Brazil election day (combined) | `Brazil` | `National Congress` · `President — Round 1` |
| Bosnia election day (combined) | `Bosnia and Herzegovina` | `Federation Parliament` · `House of Peoples` · … |
| German Landtag (standalone) | `Berlin` | `Landtag` |
| German multi-state day | `German State primaries` | sections: states + bodies |

## Validation

`scripts/build_elections.py` validates all records before writing `data/elections.json`:

- No `Next` prefixes in titles.
- No nationality adjectives that duplicate the country name (titles and combined-card section labels).
- Standalone contest titles must use canonical office nouns (`President`, `Parliament`) — not vague Wikidata labels like `general` or adjective forms like `presidential` / `parliamentary`.
- Combined records use umbrella titles only (`General`, `Midterms`, `State`).
- Combined titles must not contain ` · `.

Wikidata and curated records are normalized on every build (`polish_contest_title`): nationality prefixes are stripped, vague labels are mapped to canonical contest names, and section labels in aggregated cards are cleaned the same way. Build fails if any record still violates the rules after normalization.

The frontend mirrors the same nationality stripping and canonical contest titles as a display-time safeguard.

## Flags

- Subnational record (`state_code` set): state/Länder flag.
- National record: country flag.

## Primary info popover

Interactive primary labels (`.office-tag--interactive`) show a popover on hover (desktop) or tap (mobile). Metadata is generated into `data/curated/us_primary_info.json` for US primaries within the **next 3 months** (`scripts/generate_us_primary_info.py`). Polymarket odds are fetched live when a `polymarket_slug` is set.

Regenerate after updating `data/config/us_primary_markets.json` (slugs, incumbents, primary types):

```bash
python3 scripts/generate_us_primary_info.py
```

### Display rules

| Rule | Detail |
|------|--------|
| Party labels | **Republican** in red, **Democratic** in blue |
| Candidate names | Surname only |
| Polymarket odds | Show only candidates above **3%**; display rounded percentage |
| No market | If no `polymarket_slug`, list the party `incumbent` surname only (no percentage) when the incumbent is running |
| Empty party | Omit a party block when there are no candidates to show and no load error |
| Combined-ballot primaries | Top-two (California) and top-four (Alaska) use a single candidate list (no party headers) from one Polymarket market when linked |
| Rolling window | Popovers only appear for primaries whose date falls within the next 3 months |

## Presidential info popover

Interactive presidential labels use the same `.office-tag--interactive` popover as US primaries. Metadata is generated into `data/curated/presidential_info.json` for presidential elections within the **next 12 months** (`scripts/generate_presidential_info.py`). Polymarket odds are fetched live when a `polymarket_slug` is set in `data/config/presidential_markets.json`.

Regenerate after updating presidential market slugs:

```bash
python3 scripts/generate_presidential_info.py
```

### Display rules

| Rule | Detail |
|------|--------|
| Candidate names | Surname only |
| Polymarket odds | Show only candidates above **3%**; display rounded percentage |
| No market | Label stays non-interactive (no popover) |
| Rolling window | Popovers only appear for presidential elections whose date falls within the next 12 months |

## German state info popover

Interactive German state labels (`.office-tag--interactive`) show a popover on hover (desktop) or tap (mobile). Metadata is generated into `data/curated/de_state_info.json` for German state elections within the **next 12 months** (`scripts/generate_de_state_info.py`). Polymarket odds are fetched live when a `polymarket_slug` is set in `data/config/de_state_markets.json`.

Regenerate after updating German state market slugs:

```bash
python3 scripts/generate_de_state_info.py
```

### Display rules

| Rule | Detail |
|------|--------|
| Party names | Use Polymarket party abbreviations (e.g. CDU, AfD, Grüne) |
| Polymarket odds | Show only parties above **10%**; display rounded percentage |
| No market | Label stays non-interactive (no popover) |
| Rolling window | Popovers only appear for elections whose date falls within the next 12 months |

## US governor info popover

Interactive `Governor` labels in US midterm state sections show a popover on hover (desktop) or tap (mobile). Metadata is generated into `data/curated/us_governor_info.json` for gubernatorial general elections within the **next 12 months** (`scripts/generate_us_governor_info.py`). Polymarket odds are fetched live when a `polymarket_slug` is set in `data/config/us_governor_markets.json`.

Regenerate after updating governor market slugs:

```bash
python3 scripts/generate_us_governor_info.py
```

### Display rules

| Rule | Detail |
|------|--------|
| Party odds labels | Show nominee **surname** in place of the party name, styled **Republican** in red and **Democratic** in blue |
| Nominee names | Resolved from linked primary-winner Polymarket markets (`nominee_slugs`); fall back to configured incumbent surname when no market is available |
| Incumbent | Append `(Inc.)` to the surname when the configured incumbent is running |
| Polymarket odds (party format) | Always show Republican and Democratic win odds when available; display rounded percentage |
| Candidate odds | For races without a simple Republican vs. Democratic market (`odds_format: "candidates"`), show individual candidates with the same rules as primaries: surname only, above **3%**, rounded percentage |
| Auto-detect | When a party-format market has no Republican/Democratic outcomes, fall back to individual candidate odds |
| No market | Label stays non-interactive (no popover) |
| Rolling window | Popovers only appear for elections whose date falls within the next 12 months |

### Curated fields

- `polymarket_slug` — live odds source (required for interactivity)
- `odds_format` — `party` (default) or `candidates` for individual-candidate markets
- `nominee_slugs` — optional Polymarket slugs for Republican/Democrat primary-winner markets (generated automatically)
- `incumbents` — optional per-party incumbent surnames for party-format markets
- `incumbent` — optional surname for incumbent tagging in candidate-format markets

### Edge cases (not yet handled automatically)

- **Combined-ballot primaries** — top-two (California) and top-four (Alaska) use a single candidate list instead of party subcategories
- **Runoffs** — same display rules apply; link a runoff market slug if one exists
- **Open seat** — no incumbent to fall back to; party block is omitted without a market
- **Retiring incumbent** — do not set `incumbent`; omit the party block if there is no market
- **Market exists, nobody above 3%** — party block omitted (no fallback to incumbent)
- **Market fetch fails** — show a short error for that party only
- **Same surname** — rare; may need a disambiguator (initial) if it becomes a problem
- **Third parties / independents** — not shown unless explicitly added later

## US Senate info popover

Interactive `Senate` labels in US midterm state sections show a popover on hover (desktop) or tap (mobile). Metadata is generated into `data/curated/us_senate_info.json` for Senate general elections within the **next 12 months** (`scripts/generate_us_senate_info.py`). Polymarket odds are fetched live when a `polymarket_slug` is set in `data/config/us_senate_markets.json`.

Regenerate after updating Senate market slugs:

```bash
python3 scripts/generate_us_senate_info.py
```

Display rules match the US governor popover (party odds with nominee surnames, candidate-format fallback, 3% minimum for individuals).

## Mayoral info popover

Interactive `Mayor` labels show a popover on hover (desktop) or tap (mobile). Metadata is generated into `data/curated/mayoral_info.json` for mayoral elections within the **next 12 months** (`scripts/generate_mayoral_info.py`). Polymarket odds are fetched live when a `polymarket_slug` is set in `data/config/mayoral_markets.json`.

Regenerate after updating mayoral market slugs:

```bash
python3 scripts/generate_mayoral_info.py
```

### Display rules

| Rule | Detail |
|------|--------|
| Candidate names | Surname only |
| Polymarket odds | Show only candidates above **3%**; display rounded percentage |
| Incumbent | Append `(Inc.)` when configured |
| No market | Label stays non-interactive (no popover) |
| Rolling window | Popovers only appear for elections whose date falls within the next 12 months |

Card titles use the **city** name (for example `Manchester`); the country flag is shown. The city is stored in election data for market lookup and search.
