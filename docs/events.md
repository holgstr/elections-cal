# Event display framework

Every election card uses three distinct layers. **Location**, **event title**, and **contest detail** must never overlap — each field has one job.

## Card layers

| Layer | DOM | Question | Example |
|-------|-----|----------|---------|
| **Location** | `.card-location` | Where? | `Kansas, United States` · `Brazil` |
| **Event title** | `.card-title` | What kind of election day? | `Primary Elections` · `Presidential Election — Round 2` |
| **Contest detail** | `.card-labels` or `.card-sections` | Which specific races? | `Governor Primary · Senate Primary` |

### Location rules

- Always shown on every card.
- Subnational: `{State}, {Country}` (e.g. `Kansas, United States`, `Berlin, Germany`).
- National/federal: `{Country}` only.
- Never appears in the event title.

### Event title rules

- Names the **election event**, not the geography.
- Standalone card: use the record's `title` field (e.g. `Riksdag Election`, `Governor Election`).
- Same-day contests at one location (merged US primaries): `Primary Elections`.
- Same-day national multi-contest cards (`type: combined`): umbrella name such as `Midterm Elections`, `General Elections`, or `State Elections`.
- Optional round suffix: ` — Round 1`, ` — Round 2`.

### Contest detail rules

- **Labels** (`.card-labels`): list specific races when several contests share one location and date (merged primaries).
- **Sections** (`.card-sections`): list contests when several elections share one country and date at different levels or in different places (US midterms, Brazil general election day).
- **Office tags** (`.card-meta`): shown only on simple standalone cards with a single contest; hidden when labels or sections carry the detail.

## Data layer (`title` field)

The `title` field in JSON describes the **contest**, never the location.

| Type | Pattern | Example |
|------|---------|---------|
| General | `{Office} Election` | `Governor Election` |
| Primary | `{Party} {Office} Primary` | `Democratic Senate Primary` |
| Runoff | `{Party} {Office} Primary Runoff` | `Republican Governor Primary Runoff` |
| Presidential | `Presidential Election — Round {n}` | `Presidential Election — Round 2` |
| Legislative | `{Body} Election` | `Riksdag Election` |
| Combined (aggregated) | Umbrella name | `Midterm Elections`, `General Elections` |

### Naming conventions

- Use **Governor**, not "Gubernatorial".
- Use **Senate**, **President**, etc. as office names.
- Do not embed state or country names in `title`.
- Party name appears in `title` only for single-party primaries and confirmed runoffs; when both major parties vote on the same date the UI compacts to `{Office} Primary` in labels.

## Merging behaviour

| Scenario | Event title | Location | Detail |
|----------|-------------|----------|--------|
| Single federal election | `Riksdag Election` | `Sweden` | office tags |
| Single state primary (one contest) | `Democratic Governor Primary` | `Arizona, United States` | office tags |
| Merged state primaries | `Primary Elections` | `Kansas, United States` | `Governor Primary · Senate Primary` |
| US midterms (combined) | `Midterm Elections` | `United States` | sections: Federal + State |
| Brazil election day (combined) | `General Elections` | `Brazil` | sections per contest |
| Primary runoff (confirmed) | `Primary Elections` | `{State}, United States` | `{Party} {Office} Primary Runoff` |

## Flags

- Subnational record (`state_code` set): state/Länder flag.
- National record: country flag.
