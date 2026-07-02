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
- Estimated dates show **TBD** in yellow (`--estimated`); the `Est.` badge is not used.

### Month ordering

Within each month group, cards are sorted by **date**, then alphabetically by state or country.

## Data layer (`title` field)

The `title` field in JSON describes the **contest**, never the location.

| Type | Pattern | Example |
|------|---------|---------|
| General | `{Office}` | `Governor` |
| Primary | `{Party} {Office} Primary` | `Democratic Senate Primary` |
| Runoff | `{Party} {Office} Primary Runoff` | `Republican Governor Primary Runoff` |
| Presidential | `Presidential — Round {n}` | `Presidential — Round 2` |
| Legislative | `{Body}` | `Riksdag` |
| Combined (aggregated) | Umbrella name | `Midterms`, `General`, `State` |

### Naming conventions

- Use **Governor**, not "Gubernatorial".
- Strip nationality adjectives that duplicate the country (`Latvian parliamentary` → `Parliamentary`).
- Strip `Next` prefixes from Wikidata labels.
- Do not embed state or country names in `title` (German state cards are formatted at display time).
- Combined same-day cards must use umbrella titles (`General`, `Midterms`, `State`), never joined contest names.

## Merging behaviour

| Scenario | Title | Labels / detail |
|----------|-------|-----------------|
| Single federal election | `Sweden` | `Riksdag` |
| Single federal election (generic) | `Latvia` | `Parliamentary` |
| Merged state primaries (one state) | `Kansas` | `Governor Primary` · `Senate Primary` |
| US multi-state primary day | `US State primaries` | sections: states + primary labels |
| US midterms (combined) | `United States` | sections: Federal + State |
| Brazil election day (combined) | `Brazil` | `National Congress` · `Presidential — Round 1` |
| Bosnia election day (combined) | `Bosnia and Herzegovina` | `Federation Parliament` · `House of Peoples` · … |
| German Landtag (standalone) | `Berlin` | `Landtag` |
| German multi-state day | `German State primaries` | sections: states + bodies |

## Validation

`scripts/build_elections.py` validates all records before writing `data/elections.json`:

- No `Next` prefixes in titles.
- No nationality adjectives that duplicate the country name.
- Combined records use umbrella titles only (`General`, `Midterms`, `State`).
- Combined titles must not contain ` · `.

Build fails if any rule is violated.

## Flags

- Subnational record (`state_code` set): state/Länder flag.
- National record: country flag.
