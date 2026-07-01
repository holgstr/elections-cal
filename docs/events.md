# Event display framework

Every election card uses three distinct layers. **Location**, **event title**, and **contest detail** must never overlap — each field has one job.

## Card layers

| Layer | DOM | Question | Example |
|-------|-----|----------|---------|
| **Location** | `.card-location` | Where? | `Kansas, United States` · `Brazil` |
| **Event title** | `.card-title` | What kind of election day? | `Senate/Gov primaries` · `Presidential — Round 2` |
| **Contest detail** | `.card-labels` or `.card-sections` | Which specific races? | `Governor Primary · Senate Primary` |

### Location rules

- Always shown on every card.
- Subnational: `{State}, {Country}` (e.g. `Kansas, United States`, `Berlin, Germany`).
- National/federal: `{Country}` only.
- Never appears in the event title (except German state elections, where the title uses `{State} {Body}`).

### Event title rules

- Names the **election event**, not the geography (US primaries are the exception: location carries the state).
- **Never use "election" or "elections"** in the event title.
- Standalone card: derive from the record's `title` field, stripping any "Election" suffix (e.g. `Riksdag`, `Governor`).
- Same-day contests at one location (merged US primaries): `{Office}/{Office} primaries` (e.g. `Senate/Gov primaries`).
- Same-day national multi-contest cards (`type: combined`): umbrella name such as `Midterms`, `General`, or `State`.
- German state elections: `{State} {Body}` (e.g. `Berlin Landtag`, `Berlin Abgeordnetenhaus`).
- Optional round suffix: ` — Round 1`, ` — Round 2`.

### Contest detail rules

- **Labels** (`.card-labels`): list specific races when several contests share one location and date (merged primaries).
- **Sections** (`.card-sections`): list contests when several elections share one country and date at different levels or in different places (US midterms, Brazil general election day).
- **Office tags** (`.card-meta`): shown only on simple standalone cards with a single contest; hidden when labels or sections carry the detail.

## Data layer (`title` field)

The `title` field in JSON describes the **contest**, never the location.

| Type | Pattern | Example |
|------|---------|---------|
| General | `{Office}` | `Governor` |
| Primary | `{Party} {Office} Primary` | `Democratic Senate Primary` |
| Runoff | `{Party} {Office} Primary Runoff` | `Republican Governor Primary Runoff` |
| Presidential | `Presidential — Round {n}` | `Presidential — Round 2` |
| Legislative | `{Body}` | `Riksdag` |
| Combined (aggregated) | Umbrella name | `Midterms`, `General` |

### Naming conventions

- Use **Governor**, not "Gubernatorial".
- Use **Senate**, **President**, etc. as office names.
- Do not embed state or country names in `title` (German state cards are formatted at display time).
- Party name appears in `title` only for single-party primaries and confirmed runoffs; when both major parties vote on the same date the UI compacts to `{Office} Primary` in labels.

## Merging behaviour

| Scenario | Event title | Location | Detail |
|----------|-------------|----------|--------|
| Single federal election | `Riksdag` | `Sweden` | office tags |
| Single state primary (one contest) | `Democratic Governor Primary` | `Arizona, United States` | office tags |
| Merged state primaries | `Senate/Gov primaries` | `Kansas, United States` | `Governor Primary · Senate Primary` |
| US midterms (combined) | `Midterms` | `United States` | sections: Federal + State |
| Brazil election day (combined) | `General` | `Brazil` | sections per contest |
| German Landtag | `Berlin Landtag` | `Berlin, Germany` | office tags |
| Primary runoff (confirmed) | `Senate/Gov primaries` | `{State}, United States` | `{Party} {Office} Primary Runoff` |

## Flags

- Subnational record (`state_code` set): state/Länder flag.
- National record: country flag.
