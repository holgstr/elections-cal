# Elections Cal

A simple static web app listing upcoming global elections relevant for prediction markets — US competitive state primaries (Senate/Governor), the 2026 midterms, and meaningful races in Europe and beyond.

## Features

- Chronological timeline grouped by month
- Filter by region (US primaries, US general, Europe, etc.) and stakes level
- Search by country, state, office, or keyword
- Curated notes on market relevance

## Run locally

Any static file server works. Python:

```bash
cd elections-cal
python3 -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080).

## Data

Election dates live in `data/elections.json`. Edit this file to add or update races. The app automatically hides past elections based on the current date.

## Stack

Plain HTML, CSS, and JavaScript — no build step required.
