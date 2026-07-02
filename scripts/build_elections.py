#!/usr/bin/env python3
"""Build elections.json from Wikidata + curated US/German state data."""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "data" / "config" / "countries.json"
COMMENTS_PATH = ROOT / "data" / "config" / "election_comments.json"
CURATED_DIR = ROOT / "data" / "curated"
OUTPUT_PATH = ROOT / "data" / "elections.json"
META_PATH = ROOT / "data" / "meta.json"

WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql"
USER_AGENT = "ElectionsCalBot/1.0 (https://github.com/holgstr/elections-cal)"
WIKIDATA_RETRIES = 3
WIKIDATA_TIMEOUT = 60

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


def load_election_comments() -> dict[str, str]:
    raw = load_json(COMMENTS_PATH)
    return {key: label for key, label in raw.items() if not key.startswith("_")}


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
    "algeria": ["algerian"],
    "angola": ["angolan"],
    "bosnia and herzegovina": ["bosnian"],
    "czech republic": ["czech"],
    "czechia": ["czech"],
    "el salvador": ["salvadoran"],
    "france": ["french"],
    "haiti": ["haitian"],
    "kazakhstan": ["kazakh", "kazakhstani"],
    "kenya": ["kenyan"],
    "latvia": ["latvian"],
    "morocco": ["moroccan"],
    "nicaragua": ["nicaraguan"],
    "nigeria": ["nigerian"],
    "russia": ["russian"],
    "slovakia": ["slovak"],
    "sri lanka": ["sri lankan", "lankan"],
    "tajikistan": ["tajik", "tajikistani"],
}

COMBINED_UMBRELLA_TITLES = {"Midterms", "General", "State"}

CANONICAL_CONTEST_TITLES = {
    "presidential": "President",
    "parliamentary": "Parliament",
    "legislative": "Parliament",
}

VAGUE_STANDALONE_TITLES = {"general"}

PRESIDENTIAL_ROUND_RE = re.compile(r"^Presidential(\s+—\s+Round\s+\d+)$", re.I)
ROUND_TITLE_RE = re.compile(r"\bround\s+\d+\b", re.I)


def country_adjectives(country: str) -> list[str]:
    lower = country.lower()
    if lower in COUNTRY_ADJECTIVES:
        return COUNTRY_ADJECTIVES[lower]

    adjectives: list[str] = []
    words = lower.split()
    root = words[0]
    adjectives.extend([root, f"{root}ian", f"{root}ish", f"{root}ese"])

    if root.endswith("o"):
        adjectives.append(f"{root[:-1]}an")
    if root.endswith("a"):
        adjectives.append(f"{root[:-1]}ian")
    if root.endswith("i"):
        adjectives.append(f"{root}an")

    if len(words) > 1:
        last = words[-1]
        adjectives.append(f"{last}an")
        adjectives.append(f"{last}ian")
        adjectives.append(" ".join(words[:-1] + [f"{last}an"]))

    return list(dict.fromkeys(adjectives))


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


def canonicalize_contest_title(title: str, election_type: str) -> str:
    round_match = PRESIDENTIAL_ROUND_RE.match(title.strip())
    if round_match:
        return f"President{round_match.group(1)}"

    lower = title.lower().strip()
    if lower in CANONICAL_CONTEST_TITLES:
        return CANONICAL_CONTEST_TITLES[lower]

    if lower == "general":
        if election_type == "presidential":
            return "President"
        if election_type in {"legislative", "general"}:
            return "Parliament"

    return title


def polish_contest_title(
    title: str,
    country: str,
    country_code: str | None = None,
    election_type: str = "general",
) -> str:
    polished = re.sub(r"^\d{4}\s+", "", title).strip()
    polished = strip_election_from_title(polished)
    if polished and polished[0].islower():
        polished = polished[0].upper() + polished[1:]

    if country_code == "BA":
        override = BA_TITLE_OVERRIDES.get(polished.lower())
        if override:
            polished = override

    polished = strip_nationality_prefix(polished, country)
    return canonicalize_contest_title(polished, election_type)


def normalize_title(
    label: str,
    country_code: str | None = None,
    country_name: str | None = None,
    election_type: str = "general",
) -> str:
    return polish_contest_title(
        label,
        country_name or "",
        country_code,
        election_type,
    )


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
        item.get("state_code") or item.get("city_code") or "",
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

    last_exc: Exception | None = None
    for attempt in range(WIKIDATA_RETRIES):
        try:
            with urllib.request.urlopen(request, timeout=WIKIDATA_TIMEOUT) as response:
                payload = json.load(response)
            break
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if attempt + 1 < WIKIDATA_RETRIES:
                time.sleep(2**attempt)
    else:
        raise last_exc  # type: ignore[misc]

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
                    infer_type(label),
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
        data = load_json(path)
        if not isinstance(data, list):
            continue
        for item in data:
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
        key=lambda e: (e["date"], e.get("country", ""), e.get("state") or e.get("city") or ""),
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


def has_curated_round_same_day(item: dict, curated: list[dict]) -> bool:
    for other in curated:
        if other.get("country_code") != item.get("country_code"):
            continue
        if other["date"] != item["date"]:
            continue
        if ROUND_TITLE_RE.search(other.get("title", "")):
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

        if has_curated_round_same_day(item, curated):
            continue

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
        notes = [entry.get("comment") for entry in items if entry.get("comment")]
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
                **({"comment": notes[0]} if len(notes) == 1 else {}),
            }
        )

    return sorted(
        aggregated + standalone,
        key=lambda e: (e["date"], e.get("country", ""), e.get("state") or ""),
    )


def infer_section_type(section: dict) -> str:
    label = section.get("label", "")
    offices = section.get("offices", [])
    if "President" in offices or PRESIDENTIAL_RE.search(label):
        return "presidential"
    if LEGISLATIVE_RE.search(label) or "Parliament" in offices:
        return "legislative"
    return "general"


def polish_election(item: dict) -> dict:
    polished = dict(item)
    country = polished.get("country", "")
    country_code = polished.get("country_code")
    election_type = polished.get("type", "general")

    if polished.get("title"):
        polished["title"] = polish_contest_title(
            polished["title"],
            country,
            country_code,
            election_type,
        )

    if polished.get("sections"):
        sections = []
        for section in polished["sections"]:
            section = dict(section)
            label = section.get("label")
            if label and label not in {"Federal", "State"}:
                section["label"] = polish_contest_title(
                    label,
                    country,
                    country_code,
                    infer_section_type(section),
                )
            sections.append(section)
        polished["sections"] = sections

    return polished


def polish_elections(elections: list[dict]) -> list[dict]:
    return [polish_election(item) for item in elections]


def title_has_nationality_adjective(title: str, country: str) -> bool:
    return any(title.lower().startswith(f"{adjective} ") for adjective in country_adjectives(country))


def validate_contest_label(
    label: str,
    country: str,
    election_type: str,
    *,
    allow_umbrella: bool = False,
) -> list[str]:
    errors: list[str] = []
    if not label:
        return errors

    if title_has_nationality_adjective(label, country):
        errors.append(f"redundant nationality adjective in contest label: {label!r}")

    lower = label.lower()
    if lower in VAGUE_STANDALONE_TITLES and not allow_umbrella:
        errors.append(f"vague contest label must be Parliament or President, not {label!r}")

    if lower in CANONICAL_CONTEST_TITLES and label != CANONICAL_CONTEST_TITLES[lower]:
        errors.append(
            f"contest label must use canonical office noun "
            f"({CANONICAL_CONTEST_TITLES[lower]!r}): {label!r}"
        )

    if label in {"Parliamentary", "Presidential", "Legislative"}:
        errors.append(f"contest label must use office noun, not adjective: {label!r}")

    if PRESIDENTIAL_ROUND_RE.match(label):
        errors.append(f"contest label must use President, not Presidential: {label!r}")

    if (
        election_type != "combined"
        and not allow_umbrella
        and lower in {"presidential", "parliamentary", "legislative", "general"}
        and label not in set(CANONICAL_CONTEST_TITLES.values())
    ):
        errors.append(f"contest label is not canonical: {label!r}")

    return errors


def validate_elections(elections: list[dict], comments: dict[str, str]) -> list[str]:
    errors: list[str] = []
    allowed_comments = set(comments)

    for election in elections:
        title = election.get("title", "")
        country = election.get("country", "")
        country_code = election.get("country_code", "")

        if election.get("notes"):
            errors.append(f"{country}: use 'comment' instead of deprecated 'notes' field")

        comment = election.get("comment")
        if comment:
            if comment not in allowed_comments:
                errors.append(
                    f"{country}: unknown election comment {comment!r}; "
                    f"allowed: {sorted(allowed_comments)}"
                )
            if election.get("date_precision") != "estimated":
                errors.append(
                    f"{country}: comment is only allowed on estimated-date elections: {title!r}"
                )

        if title.lower().startswith("next "):
            errors.append(f"{country}: title must not start with 'Next': {title!r}")

        if title_has_nationality_adjective(title, country):
            errors.append(
                f"{country}: title has redundant nationality adjective: {title!r}"
            )

        election_type = election.get("type", "general")
        allow_umbrella = election_type == "combined"
        errors.extend(
            f"{country}: {message}"
            for message in validate_contest_label(
                title,
                country,
                election_type,
                allow_umbrella=allow_umbrella,
            )
        )

        for section in election.get("sections") or []:
            label = section.get("label")
            if not label or label in {"Federal", "State"}:
                continue
            errors.extend(
                f"{country}: {message}"
                for message in validate_contest_label(
                    label,
                    country,
                    infer_section_type(section),
                )
            )

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
    comments = load_election_comments()
    country_codes = sorted(countries.keys())

    try:
        if os.environ.get("SKIP_WIKIDATA") == "1":
            wikidata = []
        else:
            wikidata = fetch_wikidata(country_codes, start, end, countries)
            if not wikidata:
                print("Wikidata returned no results; retrying once…", file=sys.stderr)
                time.sleep(5)
                wikidata = fetch_wikidata(country_codes, start, end, countries)
    except Exception as exc:  # noqa: BLE001 - keep curated data if Wikidata is down
        print(f"Wikidata fetch failed, using curated data only: {exc}", file=sys.stderr)
        wikidata = []

    curated = load_curated(start, end)
    merged = merge_elections(wikidata, curated)
    polished = polish_elections(merged)
    deduped = remove_redundant_wikidata(polished)
    elections = polish_elections(aggregate_same_day_elections(deduped))
    validation_errors = validate_elections(elections, comments)
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
