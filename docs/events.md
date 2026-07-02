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
| US multi-state same day (state-level) | `US State primaries` | `US State primaries` |
| German state (standalone) | `{State}` | `Berlin` |
| German multi-state same day | `German State primaries` | `German State primaries` |
| US midterms | `{Country}` | `United States` |

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
| US midterms (combined) | `United States` | sections: Federal + State |
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

Interactive primary labels (`.office-tag--interactive`) show a popover on hover (desktop) or tap (mobile). Metadata lives in `data/curated/us_primary_info.json`; Polymarket odds are fetched live when a `polymarket_slug` is set.

### Display rules

| Rule | Detail |
|------|--------|
| Party labels | **Republican** in red, **Democratic** in blue |
| Candidate names | Surname only |
| Polymarket odds | Show only candidates above **3%**; display rounded percentage |
| No market | If no `polymarket_slug`, list the party `incumbent` surname only (no percentage) when the incumbent is running |
| Empty party | Omit a party block when there are no candidates to show and no load error |

### Curated fields per party

- `polymarket_slug` — live odds source (takes precedence when present)
- `incumbent` — surname fallback when no market is linked and the incumbent is competing

### Edge cases (not yet handled automatically)

- **Open / top-two primaries** — single ballot, not separate party sections; needs `primary_format: "open"` handling when added
- **Runoffs** — same display rules apply; link a runoff market slug if one exists
- **Open seat** — no incumbent to fall back to; party block is omitted without a market
- **Retiring incumbent** — do not set `incumbent`; omit the party block if there is no market
- **Market exists, nobody above 3%** — party block omitted (no fallback to incumbent)
- **Market fetch fails** — show a short error for that party only
- **Same surname** — rare; may need a disambiguator (initial) if it becomes a problem
- **Third parties / independents** — not shown unless explicitly added later
