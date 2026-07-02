#!/usr/bin/env python3
"""Build elections.json from Wikidata + curated US/German state data."""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "data" / "config" / "countries.json"
CURATED_DIR = ROOT / "data" / "curated"
OUTPUT_PATH = ROOT / "data" / "elections.json"
META_PATH = ROOT / "data" / "meta.json"

WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql"
USER_AGENT = "ElectionsCalBot/1.0 (https://github.com/holgstr/elections-cal)"

EXCLUDE_LABEL_RE = re.compile(
    r"\b("
    r"primary|runoff|referendum|municipal|local|by-?election|"
    r"special election|recall|ballot measure|constitutional|"
    r"european parliament|eu election|regional election|"
    r"mayoral|gubernatorial|landtag|state election|"
    r"house of representatives election|abgeordnetenhaus|bürgerschaft"
    r")\b",
    re.I,
)

VAGUE_GENERAL_RE = re.compile(r"\bgeneral election\b", re.I)
PRESIDENTIAL_RE = re.compile(r"\bpresidential\b", re.I)
LEGISLATIVE_RE = re.compile(
    r"\b("
    r"parliamentary|legislative|general election|national assembly|"
    r"riksdag|bundestag|chamber|congress|knesset|folketing|"
    r"sejm|dáil|storting|riigikogu|eduskunta|"
    r"house of commons|house of representatives|senate election|"
    r"national council|federal assembly|congressional"
    r")\b",
    re.I,
)

AGGREGATE_TYPES = {"general", "legislative", "presidential", "combined"}
CURATED_NEARBY_DAYS = 14


def load_json(path: Path):
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def save_json(path: Path, data) -> None:
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


def load_countries() -> dict:
    raw = load_json(CONFIG_PATH)
    return {code: cfg for code, cfg in raw.items() if not code.startswith("_")}


def date_window(today: date | None = None) -> tuple[date, date]:
    today = today or date.today()
    end = today + timedelta(days=365)
    return today, end


def precision_to_mode(precision: int) -> str:
    return "exact" if precision >= 11 else "estimated"


UMBRELLA_TITLES = {
    "midterm": "Midterms",
    "general": "General",
    "state": "State",
}


def strip_election_from_title(title: str) -> str:
    round_match = re.match(r"^(.+?)\s+Election(\s+—\s+Round\s+\d+)$", title, re.I)
    if round_match:
        return f"{round_match.group(1)}{round_match.group(2)}"

    stripped = re.sub(r"\s+Elections$", "", title, flags=re.I)
    stripped = re.sub(r"\s+Election$", "", stripped, flags=re.I)
    return UMBRELLA_TITLES.get(stripped.lower(), stripped)


BA_TITLE_OVERRIDES = {
    "bosnian general": "House of Peoples",
    "bosnian parliamentary": "House of Representatives",
    "federation of bosnia and herzegovina general": "Federation Parliament",
    "republika srpska general": "Republika Srpska National Assembly",
}

COUNTRY_ADJECTIVES = {
    "albania": ["albanian"],
    "bosnia and herzegovina": ["bosnian"],
    "czech republic": ["czech"],
    "czechia": ["czech"],
    "el salvador": ["salvadoran"],
    "france": ["french"],
    "latvia": ["latvian"],
    "nicaragua": ["nicaraguan"],
    "nigeria": ["nigerian"],
    "russia": ["russian"],
    "slovakia": ["slovak"],
}

COMBINED_UMBRELLA_TITLES = {"Midterms", "General", "State"}


def country_adjectives(country: str) -> list[str]:
    lower = country.lower()
    if lower in COUNTRY_ADJECTIVES:
        return COUNTRY_ADJECTIVES[lower]

    root = lower.split()[0]
    return [root, f"{root}ian", f"{root}ish", f"{root}ese"]


def strip_nationality_prefix(title: str, country: str) -> str:
    cleaned = re.sub(r"^next\s+", "", title, flags=re.I).strip()
    if not cleaned:
        return cleaned

    for adjective in country_adjectives(country):
        if cleaned.lower().startswith(f"{adjective} "):
            cleaned = cleaned[len(adjective) :].strip()
            break

    if cleaned and cleaned[0].islower():
        cleaned = cleaned[0].upper() + cleaned[1:]

    return cleaned


def normalize_title(
    label: str,
    country_code: str | None = None,
    country_name: str | None = None,
) -> str:
    title = re.sub(r"^\d{4}\s+", "", label).strip()
    title = strip_election_from_title(title)
    if title and title[0].islower():
        title = title[0].upper() + title[1:]

    if country_code == "BA":
        override = BA_TITLE_OVERRIDES.get(title.lower())
        if override:
            return override

    if country_name:
        title = strip_nationality_prefix(title, country_name)

    return title


def infer_type(label: str) -> str:
    if PRESIDENTIAL_RE.search(label):
        return "presidential"
    if LEGISLATIVE_RE.search(label):
        return "legislative"
    return "general"


def election_key(item: dict) -> tuple:
    return (
        item["date"],
        item.get("country_code", ""),
        item.get("state_code") or "",
        item.get("title", "").lower(),
        item.get("level", ""),
    )


def should_include_wikidata_item(
    label: str,
    country_code: str,
    country_cfg: dict,
    state_code: str | None,
) -> bool:
    if country_code in {"US", "DE"}:
        return False

    if state_code:
        return False

    if EXCLUDE_LABEL_RE.search(label):
        return False

    is_presidential = bool(PRESIDENTIAL_RE.search(label))
    is_legislative = bool(LEGISLATIVE_RE.search(label))

    if is_presidential and not country_cfg.get("popular_president", False):
        return False

    if not is_presidential and not is_legislative:
        return False

    return True


def fetch_wikidata_batch(
    country_codes: list[str],
    start: date,
    end: date,
    countries: dict,
) -> list[dict]:
    codes = " ".join(f'"{code}"' for code in country_codes)
    query = f"""
SELECT ?election ?electionLabel ?date ?precision ?countryCode ?countryLabel WHERE {{
  VALUES ?countryCode {{ {codes} }}
  ?country wdt:P297 ?countryCode.
  ?election wdt:P31/wdt:P279* wd:Q40231;
           p:P585 ?dateNode;
           wdt:P17 ?country.
  ?dateNode psv:P585 ?dateValue.
  ?dateValue wikibase:timeValue ?date.
  ?dateValue wikibase:timePrecision ?precision.
  FILTER(?date >= "{start.isoformat()}T00:00:00Z"^^xsd:dateTime &&
         ?date <= "{end.isoformat()}T23:59:59Z"^^xsd:dateTime)
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}}
ORDER BY ?date
"""

    request = urllib.request.Request(
        WIKIDATA_ENDPOINT,
        data=urllib.parse.urlencode({"query": query}).encode("utf-8"),
        headers={
            "Accept": "application/sparql-results+json",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=45) as response:
        payload = json.load(response)

    results: list[dict] = []
    for row in payload.get("results", {}).get("bindings", []):
        country_code = row["countryCode"]["value"]
        country_cfg = countries.get(country_code)
        if not country_cfg:
            continue

        label = row["electionLabel"]["value"]
        if not should_include_wikidata_item(label, country_code, country_cfg, None):
            continue

        precision = int(row["precision"]["value"])
        election_date = row["date"]["value"][:10]

        results.append(
            {
                "date": election_date,
                "date_precision": precision_to_mode(precision),
                "country": country_cfg["name"],
                "country_code": country_code,
                "state": None,
                "state_code": None,
                "title": normalize_title(
                    label,
                    country_code,
                    country_cfg["name"],
                ),
                "type": infer_type(label),
                "level": "federal",
                "groups": country_cfg["groups"],
                "offices": infer_offices(label),
                "source": "wikidata",
            }
        )

    return results


def fetch_wikidata(
    country_codes: list[str],
    start: date,
    end: date,
    countries: dict,
) -> list[dict]:
    batch_size = 4
    results: list[dict] = []
    for index in range(0, len(country_codes), batch_size):
        batch = country_codes[index : index + batch_size]
        try:
            results.extend(fetch_wikidata_batch(batch, start, end, countries))
        except Exception as exc:  # noqa: BLE001
            print(f"Wikidata batch {batch[0]}… failed: {exc}", file=sys.stderr)
    return results


def infer_offices(label: str) -> list[str]:
    offices: list[str] = []
    lower = label.lower()
    if "presidential" in lower:
        offices.append("President")
    if any(
        token in lower
        for token in (
            "parliament",
            "legislative",
            "riksdag",
            "bundestag",
            "knesset",
            "congress",
            "assembly",
            "house of commons",
            "chamber",
        )
    ):
        offices.append("Parliament")
    return offices or ["Parliament"]


def load_curated(start: date, end: date) -> list[dict]:
    curated: list[dict] = []
    for path in sorted(CURATED_DIR.glob("*.json")):
        for item in load_json(path):
            item = dict(item)
            item.setdefault("source", "curated")
            election_date = date.fromisoformat(item["date"])
            if start <= election_date <= end:
                curated.append(item)
    return curated


def merge_elections(*sources: list[dict]) -> list[dict]:
    merged: dict[tuple, dict] = {}
    for source in sources:
        for item in source:
            key = election_key(item)
            if key not in merged or item.get("source") == "curated":
                merged[key] = item
    return sorted(
        merged.values(),
        key=lambda e: (e["date"], e.get("country", ""), e.get("state") or ""),
    )


def days_apart(left: str, right: str) -> int:
    return abs((date.fromisoformat(left) - date.fromisoformat(right)).days)


def has_curated_legislative_nearby(item: dict, curated: list[dict]) -> bool:
    if item.get("type") != "legislative":
        return False
    for other in curated:
        if other.get("type") != "legislative":
            continue
        if other.get("country_code") != item.get("country_code"):
            continue
        if days_apart(other["date"], item["date"]) <= CURATED_NEARBY_DAYS:
            return True
    return False


def has_curated_any_nearby(item: dict, curated: list[dict]) -> bool:
    for other in curated:
        if other.get("country_code") != item.get("country_code"):
            continue
        if days_apart(other["date"], item["date"]) <= CURATED_NEARBY_DAYS:
            return True
    return False


def is_vague_wikidata_title(title: str) -> bool:
    lower = title.lower()
    if VAGUE_GENERAL_RE.search(title):
        return True
    return lower.endswith(" general")


def remove_redundant_wikidata(elections: list[dict]) -> list[dict]:
    curated = [e for e in elections if e.get("source") == "curated"]
    curated_day_country = {
        (e["date"], e["country_code"]) for e in curated
    }
    curated_types_by_day = defaultdict(set)
    for entry in curated:
        curated_types_by_day[(entry["date"], entry["country_code"])].add(entry["type"])

    kept: list[dict] = []
    for item in elections:
        if item.get("source") != "wikidata":
            kept.append(item)
            continue

        day_country = (item["date"], item["country_code"])

        if has_curated_legislative_nearby(item, curated):
            continue

        if is_vague_wikidata_title(item["title"]):
            if day_country in curated_day_country:
                continue
            if has_curated_any_nearby(item, curated):
                continue
            other_same_day = [
                e
                for e in elections
                if e is not item
                and e["date"] == item["date"]
                and e["country_code"] == item["country_code"]
            ]
            if any(not is_vague_wikidata_title(e["title"]) for e in other_same_day):
                continue

        if item["type"] in curated_types_by_day.get(day_country, set()):
            continue

        kept.append(item)

    return kept


def combined_title(country_code: str, federal: list[dict], states: list[dict]) -> str:
    if country_code == "US" and federal:
        return "Midterms"
    if country_code == "DE" and states and not federal:
        return "State"
    if len(federal) + len(states) > 1:
        return "General"
    if federal:
        return federal[0]["title"]
    return states[0].get("state") or states[0]["country"]


def aggregate_same_day_elections(elections: list[dict]) -> list[dict]:
    aggregateable = [e for e in elections if e.get("type") in AGGREGATE_TYPES]
    standalone = [e for e in elections if e.get("type") not in AGGREGATE_TYPES]

    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for item in aggregateable:
        groups[(item["date"], item["country_code"])].append(item)

    aggregated: list[dict] = []
    for (election_date, country_code), items in sorted(groups.items()):
        if len(items) == 1:
            aggregated.append(items[0])
            continue

        federal = [i for i in items if i.get("level") == "federal"]
        states = [i for i in items if i.get("level") == "state"]

        sections: list[dict] = []
        if federal:
            if len(federal) == 1:
                sections.append(
                    {
                        "label": "Federal",
                        "level": "federal",
                        "offices": federal[0].get("offices", []),
                    }
                )
            else:
                for entry in sorted(federal, key=lambda e: e["title"]):
                    sections.append(
                        {
                            "label": entry["title"],
                            "level": "federal",
                            "offices": entry.get("offices", []),
                        }
                    )

        if states:
            sections.append(
                {
                    "label": "State",
                    "level": "state",
                    "states": [
                        {
                            "name": entry["state"],
                            "code": entry["state_code"],
                            "offices": entry.get("offices", []),
                        }
                        for entry in sorted(states, key=lambda e: e.get("state", ""))
                    ],
                }
            )

        base = federal[0] if federal else states[0]
        notes = [entry.get("notes") for entry in items if entry.get("notes")]
        aggregated.append(
            {
                "date": election_date,
                "date_precision": (
                    "estimated"
                    if any(entry.get("date_precision") == "estimated" for entry in items)
                    else "exact"
                ),
                "country": base["country"],
                "country_code": country_code,
                "state": None,
                "state_code": None,
                "title": combined_title(country_code, federal, states),
                "type": "combined",
                "level": "federal" if federal else "state",
                "groups": base.get("groups", []),
                "sections": sections,
                "source": "aggregated",
                **({"notes": " · ".join(dict.fromkeys(notes))} if notes else {}),
            }
        )

    return sorted(
        aggregated + standalone,
        key=lambda e: (e["date"], e.get("country", ""), e.get("state") or ""),
    )


def validate_elections(elections: list[dict]) -> list[str]:
    errors: list[str] = []

    for election in elections:
        title = election.get("title", "")
        country = election.get("country", "")
        country_code = election.get("country_code", "")

        if title.lower().startswith("next "):
            errors.append(f"{country}: title must not start with 'Next': {title!r}")

        for adjective in country_adjectives(country):
            if title.lower().startswith(f"{adjective} "):
                errors.append(
                    f"{country}: title has redundant nationality adjective: {title!r}"
                )
                break

        if election.get("type") == "combined":
            if " · " in title:
                errors.append(
                    f"{country}: combined title must be an umbrella name, not joined contests: {title!r}"
                )
            if title not in COMBINED_UMBRELLA_TITLES:
                errors.append(
                    f"{country}: combined title must be one of {sorted(COMBINED_UMBRELLA_TITLES)}: {title!r}"
                )

        if (
            election.get("type") != "combined"
            and not election.get("state")
            and country_code not in {"US", "DE"}
            and title.lower() in {country.lower(), country.split()[0].lower()}
        ):
            errors.append(
                f"{country}: standalone title must name the contest, not repeat the country: {title!r}"
            )

    return errors


def build(today: date | None = None) -> dict:
    start, end = date_window(today)
    countries = load_countries()
    country_codes = sorted(countries.keys())

    try:
        if os.environ.get("SKIP_WIKIDATA") == "1":
            wikidata = []
        else:
            wikidata = fetch_wikidata(country_codes, start, end, countries)
    except Exception as exc:  # noqa: BLE001 - keep curated data if Wikidata is down
        print(f"Wikidata fetch failed, using curated data only: {exc}", file=sys.stderr)
        wikidata = []

    curated = load_curated(start, end)
    merged = merge_elections(wikidata, curated)
    deduped = remove_redundant_wikidata(merged)
    elections = aggregate_same_day_elections(deduped)
    validation_errors = validate_elections(elections)
    if validation_errors:
        for message in validation_errors:
            print(f"Validation error: {message}", file=sys.stderr)
        raise ValueError(f"{len(validation_errors)} election data validation error(s)")

    meta = {
        "generated_at": date.today().isoformat(),
        "window_start": start.isoformat(),
        "window_end": end.isoformat(),
        "count": len(elections),
        "sources": {
            "wikidata": len(wikidata),
            "curated": len(curated),
        },
    }

    return {"meta": meta, "elections": elections}


def main() -> int:
    try:
        result = build()
    except Exception as exc:  # noqa: BLE001 - surface build failures in CI
        print(f"Build failed: {exc}", file=sys.stderr)
        return 1

    save_json(OUTPUT_PATH, result["elections"])
    save_json(META_PATH, result["meta"])

    print(
        f"Wrote {result['meta']['count']} elections "
        f"({result['meta']['window_start']} → {result['meta']['window_end']})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
