#!/usr/bin/env python3
"""Build national_election_info.json for national legislative elections within the calendar window."""

from __future__ import annotations

import json
import re
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from national_market_helpers import resolve_contest_markets  # noqa: E402

ELECTIONS_PATH = ROOT / "data" / "elections.json"
MARKETS_PATH = ROOT / "data" / "config" / "national_election_markets.json"
OUTPUT_PATH = ROOT / "data" / "curated" / "national_election_info.json"

WINDOW_MONTHS = 12

UMBRELLA_TITLES = {"General", "Midterms", "State"}
PRESIDENTIAL_ROUND_RE = re.compile(r"^President(?:\s+—\s+Round\s+\d+)?$", re.I)


def load_json(path: Path) -> dict | list:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def save_json(path: Path, data: dict) -> None:
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


def window_end(today: date) -> date:
    return today + timedelta(days=WINDOW_MONTHS * 30)


def strip_election_from_title(title: str) -> str:
    return re.sub(r"\s+elections?$", "", title, flags=re.I).strip()


def strip_nationality_prefix(title: str, country: str | None) -> str:
    if not country:
        return title
    prefix = country.split()[-1]
    if title.lower().startswith(prefix.lower()):
        return title[len(prefix) :].strip()
    return title


def canonicalize_contest_title(title: str, election_type: str) -> str:
    lower = title.lower().strip()
    mapping = {
        "presidential": "President",
        "parliamentary": "Parliament",
        "legislative": "Parliament",
    }
    if lower in mapping:
        return mapping[lower]
    if lower == "general":
        if election_type == "presidential":
            return "President"
        if election_type in {"legislative", "general"}:
            return "Parliament"
    return title


def contest_name_from_section(section: dict, country: str | None, election_type: str) -> str | None:
    label = strip_election_from_title(section.get("label") or "")
    if label and label not in {"Federal", "State"}:
        section_type = (
            "presidential"
            if "President" in (section.get("offices") or [])
            or re.search(r"presidential", label, re.I)
            else election_type
        )
        return canonicalize_contest_title(strip_nationality_prefix(label, country), section_type)
    offices = section.get("offices") or []
    return offices[0] if offices else label or None


def contest_label_from_title(election: dict) -> str | None:
    raw = strip_election_from_title(election.get("title") or "")
    if not raw or raw in UMBRELLA_TITLES:
        return None
    return canonicalize_contest_title(
        strip_nationality_prefix(raw, election.get("country")),
        election.get("type") or "general",
    )


def should_show_sections(election: dict, sections: list[dict]) -> bool:
    if not sections:
        return False
    if election.get("title") == "Midterms":
        return True
    levels = {section.get("level") for section in sections}
    if "federal" in levels and "state" in levels:
        return True
    if any(section.get("states") for section in sections):
        return True
    return False


def card_labels(election: dict) -> list[str]:
    sections = election.get("sections") or []
    has_sections = should_show_sections(election, sections)

    if has_sections:
        return []

    if election.get("labels"):
        return list(election["labels"])

    if sections:
        return [
            label
            for section in sections
            if (label := contest_name_from_section(section, election.get("country"), election.get("type") or "general"))
        ]

    label = contest_label_from_title(election)
    labels: list[str] = []
    if label:
        labels.append(label)
    for office in election.get("offices") or []:
        if office not in labels:
            labels.append(office)
    return labels


def federal_elections_in_window(today: date | None = None) -> list[dict]:
    today = today or date.today()
    end = window_end(today)
    results: list[dict] = []

    for item in load_json(ELECTIONS_PATH):
        if item.get("state_code"):
            continue
        election_date = date.fromisoformat(item["date"])
        if election_date < today or election_date > end:
            continue
        country_code = item.get("country_code")
        if not country_code:
            continue
        results.append(item)

    return results


def main() -> None:
    meta = load_json(MARKETS_PATH)
    contests = meta.get("contests", {})
    elections = federal_elections_in_window()

    needed: dict[str, dict[str, dict]] = {}
    for election in elections:
        country_code = election["country_code"]
        if country_code not in contests:
            continue
        for label in card_labels(election):
            if label in contests[country_code]:
                contest_cfg = contests[country_code][label]
                needed.setdefault(country_code, {})[label] = {
                    "markets": resolve_contest_markets(contest_cfg, meta),
                }

    output: dict = {
        "_comment": (
            "Generated by scripts/generate_national_election_info.py for national legislative "
            f"elections within the next {WINDOW_MONTHS} months. "
            "Display rules: docs/events.md#national-election-info-popover"
        ),
        "_window_months": WINDOW_MONTHS,
    }

    for country_code in sorted(needed):
        output[country_code] = dict(sorted(needed[country_code].items()))

    save_json(OUTPUT_PATH, output)
    entry_count = sum(len(v) for v in needed.values())
    print(
        f"Wrote {entry_count} contest entries across {len(needed)} countries "
        f"to {OUTPUT_PATH.relative_to(ROOT)}"
    )


if __name__ == "__main__":
    main()
