#!/usr/bin/env python3
"""Generate US Senate and Governor primary entries for both major parties."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
US_ELECTIONS = ROOT / "data" / "curated" / "us_elections.json"
OUTPUT = ROOT / "data" / "curated" / "us_primaries.json"

# 2026 statewide primary dates (NCSL / FEC / 270toWin, subject to change).
PRIMARY_DATES: dict[str, str] = {
    "AL": "2026-05-19",
    "AK": "2026-08-18",
    "AZ": "2026-07-21",
    "AR": "2026-03-03",
    "CA": "2026-06-02",
    "CO": "2026-06-30",
    "CT": "2026-08-11",
    "DE": "2026-09-15",
    "FL": "2026-08-18",
    "GA": "2026-05-19",
    "HI": "2026-08-08",
    "IA": "2026-06-02",
    "ID": "2026-05-19",
    "IL": "2026-03-17",
    "KS": "2026-08-04",
    "KY": "2026-05-19",
    "LA": "2026-05-16",
    "ME": "2026-06-09",
    "MA": "2026-09-01",
    "MI": "2026-08-04",
    "MN": "2026-08-11",
    "MS": "2026-03-10",
    "MO": "2026-08-04",
    "MT": "2026-06-02",
    "NE": "2026-05-12",
    "NV": "2026-06-09",
    "NH": "2026-09-08",
    "NJ": "2026-06-02",
    "NM": "2026-06-02",
    "NY": "2026-06-23",
    "NC": "2026-03-03",
    "OH": "2026-05-05",
    "OK": "2026-06-16",
    "OR": "2026-05-19",
    "PA": "2026-05-19",
    "RI": "2026-09-09",
    "SC": "2026-06-09",
    "SD": "2026-06-02",
    "TN": "2026-08-06",
    "TX": "2026-03-03",
    "VT": "2026-08-11",
    "VA": "2026-08-04",
    "WA": "2026-08-04",
    "WI": "2026-08-11",
    "WV": "2026-05-12",
    "WY": "2026-08-18",
}

# Class II Senate seats up in 2026.
SENATE_2026 = {
    "AL", "AK", "AR", "CO", "DE", "GA", "IA", "ID", "IL", "KS", "KY", "LA",
    "MA", "ME", "MI", "MN", "MS", "MT", "NC", "NE", "NH", "NJ", "NM", "OK",
    "OR", "RI", "SC", "SD", "TN", "TX", "VA", "WV", "WY",
}

PARTIES = ("Democratic", "Republican")

# Notable House district primaries tracked on the calendar (with Polymarket odds).
HOUSE_DISTRICT_PRIMARIES: list[dict[str, str]] = [
    {
        "state_code": "AZ",
        "state": "Arizona",
        "office": "AZ-04",
        "party": "Democratic",
        "date": "2026-07-21",
    },
    {
        "state_code": "AZ",
        "state": "Arizona",
        "office": "AZ-05",
        "party": "Republican",
        "date": "2026-07-21",
    },
    {
        "state_code": "MO",
        "state": "Missouri",
        "office": "MO-01",
        "party": "Democratic",
        "date": "2026-08-04",
    },
]

# Special / replacement primaries beyond the regular statewide calendar.
# Labels match a normal party primary ({Party} {Office} Primary).
SPECIAL_PRIMARIES: list[dict[str, str]] = [
    {
        "state_code": "SC",
        "state": "South Carolina",
        "office": "Senate",
        "party": "Republican",
        "date": "2026-08-11",
    },
]


def load_governor_states() -> dict[str, str]:
    states: dict[str, str] = {}
    for item in json.loads(US_ELECTIONS.read_text(encoding="utf-8")):
        code = item.get("state_code")
        if code and "Governor" in (item.get("offices") or []):
            states[code] = item["state"]
    return states


def primary_entry(
    *,
    date: str,
    state: str,
    state_code: str,
    party: str,
    office: str,
) -> dict:
  office_label = "Governor" if office == "Governor" else office
  return {
      "date": date,
      "date_precision": "exact",
      "country": "United States",
      "country_code": "US",
      "state": state,
      "state_code": state_code,
      "title": f"{party} {office_label} Primary",
      "type": "primary",
      "level": "state",
      "groups": ["oecd"],
      "offices": [office],
      "party": party,
  }


def runoff_entry(
    *,
    date: str,
    state: str,
    state_code: str,
    party: str,
    office: str,
) -> dict:
  """Scheduled primary runoff after the first round has already been held."""
  office_label = "Governor" if office == "Governor" else office
  return {
      "date": date,
      "date_precision": "exact",
      "country": "United States",
      "country_code": "US",
      "state": state,
      "state_code": state_code,
      "title": f"{party} {office_label} Primary Runoff",
      "type": "runoff",
      "level": "state",
      "groups": ["oecd"],
      "offices": [office],
      "party": party,
  }


def main() -> None:
    governor_states = load_governor_states()
    state_names = {code: name for code, name in governor_states.items()}
    for code in SENATE_2026:
        if code not in state_names and code in PRIMARY_DATES:
            state_names[code] = {
                "AL": "Alabama", "AK": "Alaska", "AR": "Arkansas", "CO": "Colorado",
                "DE": "Delaware", "GA": "Georgia", "IA": "Iowa", "ID": "Idaho",
                "IL": "Illinois", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
                "MA": "Massachusetts", "ME": "Maine", "MI": "Michigan", "MN": "Minnesota",
                "MS": "Mississippi", "MT": "Montana", "NC": "North Carolina", "NE": "Nebraska",
                "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "OK": "Oklahoma",
                "OR": "Oregon", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
                "TN": "Tennessee", "TX": "Texas", "VA": "Virginia", "WV": "West Virginia",
                "WY": "Wyoming",
            }[code]

    entries: list[dict] = []
    for code, state in sorted(state_names.items(), key=lambda item: item[1]):
        date = PRIMARY_DATES.get(code)
        if not date:
            continue

        if code in SENATE_2026:
            for party in PARTIES:
                entries.append(
                    primary_entry(
                        date=date,
                        state=state,
                        state_code=code,
                        party=party,
                        office="Senate",
                    )
                )

        if code in governor_states:
            for party in PARTIES:
                entries.append(
                    primary_entry(
                        date=date,
                        state=state,
                        state_code=code,
                        party=party,
                        office="Governor",
                    )
                )

    for race in HOUSE_DISTRICT_PRIMARIES:
        entries.append(
            primary_entry(
                date=race["date"],
                state=race["state"],
                state_code=race["state_code"],
                party=race["party"],
                office=race["office"],
            )
        )

    for race in SPECIAL_PRIMARIES:
        entries.append(
            primary_entry(
                date=race["date"],
                state=race["state"],
                state_code=race["state_code"],
                party=race["party"],
                office=race["office"],
            )
        )

    entries.sort(key=lambda item: (item["date"], item["state"], item["title"]))
    OUTPUT.write_text(json.dumps(entries, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(entries)} primary entries to {OUTPUT}")


if __name__ == "__main__":
    main()
