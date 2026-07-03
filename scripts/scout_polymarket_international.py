#!/usr/bin/env python3
"""Scout Polymarket for active international election markets with volume or liquidity.

Fetches events from the Polymarket Gamma API, filters to non-US national elections,
and writes results to data/scouted/polymarket_international.json with calendar gap analysis.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import UTC, date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COUNTRIES_PATH = ROOT / "data" / "config" / "countries.json"
ELECTIONS_PATH = ROOT / "data" / "elections.json"
CONFIG_DIR = ROOT / "data" / "config"
OUTPUT_PATH = ROOT / "data" / "scouted" / "polymarket_international.json"

GAMMA_API = "https://gamma-api.polymarket.com/events"
USER_AGENT = "ElectionsCalBot/1.0 (https://github.com/holgstr/elections-cal)"

DEFAULT_MIN_VOLUME = 5_000
DEFAULT_MIN_LIQUIDITY = 1_000
DEFAULT_MIN_VOLUME_24HR = 500
PAGE_SIZE = 100
MAX_PAGES = 20

ELECTION_TAG_SLUGS = (
    "global-elections",
    "world-elections",
    "elections",
    "main-election",
)

US_TAG_LABELS = {
    "united states",
    "us election",
    "primaries",
    "governor midterms",
    "california midterm",
    "house midterms",
    "senate midterms",
}

ELECTION_KIND_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("presidential", re.compile(r"\bpresident(?:ial)?\b", re.I)),
    ("legislative", re.compile(
        r"\b(parliament|parliamentary|legislative|national assembly|congress|"
        r"riksdag|knesset|eduskunta|riigikogu|chamber of deputies|"
        r"house of representatives|house of peoples|seats)\b",
        re.I,
    )),
    ("prime_minister", re.compile(r"\bprime minister\b", re.I)),
    ("mayoral", re.compile(r"\bmayor(?:al)?\b", re.I)),
    ("referendum", re.compile(r"\breferendum\b", re.I)),
)

NOISE_PATTERNS = re.compile(
    r"\b("
    r"margin of victory|brackets|2nd place|second place|first round: 2nd|"
    r"balance of power|which party will win the (?:senate|house)|"
    r"trump out as president|democratic presidential nominee|"
    r"republican presidential nominee|presidential election winner 2028|"
    r"which party wins 2028|democratic vp nominee|republican vp nominee|"
    r"primary winner|primary margin|primary runoff margin|"
    r"gubernatorial|governor election|senate election winner|"
    r"landtag|state election|abgeordnetenhaus|bürgerschaft|"
    r"greater manchester mayoral|"
    r"wealth tax|ballot measure|proposition \d+|"
    r"california election 2026|pardoned|invalidated\?|burnham cabinet|ann arbor"
    r")\b",
    re.I,
)

MAIN_ELECTION_RE = re.compile(
    r"\b("
    r"presidential election|parliamentary election|general election|"
    r"election winner|party winner|prime minister|national assembly|"
    r"parliamentary election winner|president — round|president - round"
    r")\b",
    re.I,
)


def load_json(path: Path) -> dict | list:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def save_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


def fetch_events(params: dict[str, str | int | bool]) -> list[dict]:
    query = urllib.parse.urlencode(params)
    url = f"{GAMMA_API}?{query}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def paginate_tagged_events(tag_slug: str) -> list[dict]:
    events: list[dict] = []
    seen: set[str] = set()

    for page in range(MAX_PAGES):
        batch = fetch_events(
            {
                "active": "true",
                "closed": "false",
                "tag_slug": tag_slug,
                "limit": PAGE_SIZE,
                "offset": page * PAGE_SIZE,
                "order": "volume",
                "ascending": "false",
            }
        )
        if not batch:
            break

        for event in batch:
            slug = event.get("slug") or event.get("id")
            if slug and slug not in seen:
                seen.add(str(slug))
                events.append(event)

        if len(batch) < PAGE_SIZE:
            break
        time.sleep(0.15)

    return events


def build_country_lookup() -> tuple[dict[str, str], list[tuple[str, str]]]:
    raw = load_json(COUNTRIES_PATH)
    code_to_name = {code: meta["name"] for code, meta in raw.items() if code != "_criteria"}
    name_to_code = {name.lower(): code for code, name in code_to_name.items()}

    aliases = {
        "cote d'ivoire": "CI",
        "côte d'ivoire": "CI",
        "czechia": "CZ",
        "czech republic": "CZ",
        "south korea": "KR",
        "bosnia": "BA",
        "uk": "GB",
        "united kingdom": "GB",
        "u.k.": "GB",
        "uae": "AE",
        "dr congo": "CD",
        "drc": "CD",
        "lebanon": "LB",
        "taiwan": "TW",
        "guinea-bissau": "GW",
        "guinea bissau": "GW",
        "central african republic": "CF",
        "latvia": "LV",
        "latvian": "LV",
        "andalusia": "ES",
    }
    name_to_code.update(aliases)

    search_names = sorted(name_to_code, key=len, reverse=True)
    return code_to_name, [(name, name_to_code[name]) for name in search_names]


def tag_labels(event: dict) -> list[str]:
    return [tag.get("label", "") for tag in event.get("tags") or [] if tag.get("label")]


def tag_slugs(event: dict) -> list[str]:
    return [tag.get("slug", "") for tag in event.get("tags") or [] if tag.get("slug")]


def numeric(value: object) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def passes_liquidity_threshold(
    event: dict,
    *,
    min_volume: float,
    min_liquidity: float,
    min_volume_24hr: float,
) -> bool:
    volume = numeric(event.get("volume"))
    liquidity = numeric(event.get("liquidity") or event.get("liquidityClob"))
    volume_24hr = numeric(event.get("volume24hr"))
    open_interest = numeric(event.get("openInterest"))

    if volume >= min_volume:
        return True
    if liquidity >= min_liquidity:
        return True
    if volume_24hr >= min_volume_24hr:
        return True
    if open_interest >= min_liquidity:
        return True
    return False


def is_us_domestic(event: dict) -> bool:
    labels = {label.lower() for label in tag_labels(event)}
    slugs = {slug.lower() for slug in tag_slugs(event)}
    haystack = " ".join(
        [
            event.get("title") or "",
            event.get("slug") or "",
            event.get("description") or "",
            " ".join(labels),
            " ".join(slugs),
        ]
    ).lower()

    if labels & US_TAG_LABELS or slugs & {"us-election", "united-states", "primaries"}:
        return True
    if re.search(r"\b(us|u\.s\.|american)\b", haystack) and re.search(
        r"\b(senate|governor|house|midterm|primary|congressional| electoral college)\b",
        haystack,
    ):
        return True
    if re.search(r"\b(california|texas|florida|new york)\b", haystack):
        if re.search(r"\b(senate|governor|house|midterm|primary|congressional|wealth tax|ballot)\b", haystack):
            return True
    if re.search(r"\b\d{4}\b", haystack) and re.search(
        r"\b(us|u\.s\.|united states)\b", haystack
    ):
        return True
    return False


def is_subnational(event: dict) -> bool:
    haystack = " ".join([event.get("title") or "", event.get("slug") or ""]).lower()
    if re.search(r"\b(landtag|state election|abgeordnetenhaus|bürgerschaft)\b", haystack):
        return True
    return bool(
        re.search(
            r"\b("
            r"quebec|vancouver|toronto|andalusia|taiwanese local|somaliland"
            r")\b",
            haystack,
        )
    )


def is_election_market(event: dict) -> bool:
    title = event.get("title") or ""
    slug = event.get("slug") or ""
    description = event.get("description") or ""
    labels = tag_labels(event)
    haystack = " ".join([title, slug, description, " ".join(labels)])

    if NOISE_PATTERNS.search(haystack):
        return False

    tag_text = " ".join(labels + tag_slugs(event)).lower()
    if any(token in tag_text for token in ("global elections", "world elections", "main election", "elections")):
        if MAIN_ELECTION_RE.search(haystack) or any(
            pattern.search(haystack) for _, pattern in ELECTION_KIND_PATTERNS
        ):
            return True

    return bool(MAIN_ELECTION_RE.search(haystack))


def detect_country(event: dict, name_to_code: list[tuple[str, str]]) -> tuple[str | None, str | None]:
    primary = " ".join([event.get("title") or "", event.get("slug") or ""]).lower()
    for name, code in name_to_code:
        if re.search(rf"\b{re.escape(name)}\b", primary):
            return code, name.title() if name not in {"uk", "uae", "drc"} else primary

    secondary = " ".join(tag_labels(event)).lower()
    for name, code in name_to_code:
        if re.search(rf"\b{re.escape(name)}\b", secondary):
            return code, name.title() if name not in {"uk", "uae", "drc"} else secondary

    return None, None


def detect_election_kind(event: dict) -> str | None:
    haystack = " ".join(
        [event.get("title") or "", event.get("slug") or "", event.get("description") or ""]
    )
    for kind, pattern in ELECTION_KIND_PATTERNS:
        if pattern.search(haystack):
            return kind
    if MAIN_ELECTION_RE.search(haystack):
        return "general"
    return None


def parse_end_date(event: dict) -> str | None:
    end = event.get("endDate") or event.get("endDateIso")
    if not end:
        return None
    return str(end)[:10]


def collect_configured_slugs() -> set[str]:
    slugs: set[str] = set()

    def walk(node: object) -> None:
        if isinstance(node, dict):
            if "polymarket_slug" in node and node["polymarket_slug"]:
                slugs.add(str(node["polymarket_slug"]))
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    for path in CONFIG_DIR.glob("*_markets.json"):
        walk(load_json(path))
    return slugs


def calendar_index() -> dict[str, list[dict]]:
    elections = load_json(ELECTIONS_PATH)
    by_country: dict[str, list[dict]] = {}
    for item in elections:
        code = item.get("country_code")
        if not code:
            continue
        by_country.setdefault(code, []).append(item)
    return by_country


def calendar_match(
    country_code: str | None,
    election_kind: str | None,
    end_date: str | None,
    by_country: dict[str, list[dict]],
) -> list[dict]:
    if not country_code:
        return []

    matches: list[dict] = []
    for item in by_country.get(country_code, []):
        item_type = item.get("type")
        if election_kind == "presidential" and item_type != "presidential":
            continue
        if election_kind in {"legislative", "general"} and item_type not in {
            "legislative",
            "general",
            "combined",
        }:
            continue
        if election_kind == "prime_minister" and item_type not in {"legislative", "general", "combined"}:
            continue

        if end_date:
            try:
                end = date.fromisoformat(end_date)
                election_date = date.fromisoformat(item["date"])
                if abs((end - election_date).days) > 120:
                    continue
            except ValueError:
                pass

        matches.append(
            {
                "date": item.get("date"),
                "title": item.get("title"),
                "type": item.get("type"),
                "country": item.get("country"),
            }
        )
    return matches


def normalize_event(
    event: dict,
    *,
    code_to_name: dict[str, str],
    name_to_code: list[tuple[str, str]],
    configured_slugs: set[str],
    by_country: dict[str, list[dict]],
) -> dict | None:
    if not passes_liquidity_threshold(
        event,
        min_volume=DEFAULT_MIN_VOLUME,
        min_liquidity=DEFAULT_MIN_LIQUIDITY,
        min_volume_24hr=DEFAULT_MIN_VOLUME_24HR,
    ):
        return None
    if is_us_domestic(event) or is_subnational(event):
        return None
    if not is_election_market(event):
        return None

    country_code, country_guess = detect_country(event, name_to_code)
    election_kind = detect_election_kind(event)
    slug = event.get("slug") or ""
    end_date = parse_end_date(event)
    matches = calendar_match(country_code, election_kind, end_date, by_country)

    country_name = code_to_name.get(country_code, country_guess) if country_code else country_guess
    return {
        "slug": slug,
        "title": event.get("title"),
        "url": f"https://polymarket.com/event/{slug}" if slug else None,
        "country_code": country_code,
        "country": country_name,
        "election_kind": election_kind,
        "volume": numeric(event.get("volume")),
        "volume_24hr": numeric(event.get("volume24hr")),
        "liquidity": numeric(event.get("liquidity") or event.get("liquidityClob")),
        "open_interest": numeric(event.get("openInterest")),
        "end_date": end_date,
        "tags": tag_labels(event),
        "linked_in_config": slug in configured_slugs,
        "in_calendar": bool(matches),
        "calendar_matches": matches,
    }


def scout(
    *,
    min_volume: float = DEFAULT_MIN_VOLUME,
    min_liquidity: float = DEFAULT_MIN_LIQUIDITY,
    min_volume_24hr: float = DEFAULT_MIN_VOLUME_24HR,
) -> dict:
    code_to_name, name_to_code = build_country_lookup()
    configured_slugs = collect_configured_slugs()
    by_country = calendar_index()

    raw_events: dict[str, dict] = {}
    for tag_slug in ELECTION_TAG_SLUGS:
        for event in paginate_tagged_events(tag_slug):
            slug = event.get("slug")
            if slug:
                raw_events[slug] = event

    normalized: list[dict] = []
    for event in raw_events.values():
        record = normalize_event(
            event,
            code_to_name=code_to_name,
            name_to_code=name_to_code,
            configured_slugs=configured_slugs,
            by_country=by_country,
        )
        if record is None:
            continue
        if not passes_liquidity_threshold(
            event,
            min_volume=min_volume,
            min_liquidity=min_liquidity,
            min_volume_24hr=min_volume_24hr,
        ):
            continue
        normalized.append(record)

    normalized.sort(key=lambda item: (-item["volume"], item["title"] or ""))

    not_in_calendar = [item for item in normalized if not item["in_calendar"]]
    in_calendar_unlinked = [
        item for item in normalized if item["in_calendar"] and not item["linked_in_config"]
    ]

    return {
        "_comment": (
            "Generated by scripts/scout_polymarket_international.py. "
            "International election markets on Polymarket above volume/liquidity thresholds."
        ),
        "_fetched_at": datetime.now(UTC).replace(microsecond=0).isoformat(),
        "_thresholds": {
            "min_volume": min_volume,
            "min_liquidity": min_liquidity,
            "min_volume_24hr": min_volume_24hr,
        },
        "_summary": {
            "total_markets": len(normalized),
            "not_in_calendar": len(not_in_calendar),
            "in_calendar_unlinked": len(in_calendar_unlinked),
            "linked_in_config": sum(1 for item in normalized if item["linked_in_config"]),
        },
        "events": normalized,
        "gaps": {
            "not_in_calendar": not_in_calendar,
            "in_calendar_unlinked": in_calendar_unlinked,
        },
    }


def print_gap_report(result: dict) -> None:
    print(
        f"Scouted {result['_summary']['total_markets']} international election markets "
        f"({result['_summary']['linked_in_config']} already linked in config)."
    )
    print()

    not_in_calendar = result["gaps"]["not_in_calendar"]
    if not_in_calendar:
        print("Markets not matched to any calendar election:")
        for item in not_in_calendar[:25]:
            country = item.get("country") or item.get("country_code") or "Unknown"
            print(
                f"  - [{country}] {item['title']} "
                f"(vol ${item['volume']:,.0f}, liq ${item['liquidity']:,.0f})"
            )
            print(f"    {item['url']}")
        if len(not_in_calendar) > 25:
            print(f"  ... and {len(not_in_calendar) - 25} more (see JSON output)")
        print()

    unlinked = result["gaps"]["in_calendar_unlinked"]
    if unlinked:
        print("Calendar elections with Polymarket markets not yet linked in config:")
        for item in unlinked[:15]:
            match = item["calendar_matches"][0]
            print(
                f"  - [{item.get('country_code')}] {match['date']} {match['title']} "
                f"→ {item['slug']}"
            )
        if len(unlinked) > 15:
            print(f"  ... and {len(unlinked) - 15} more")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=OUTPUT_PATH,
        help=f"Output JSON path (default: {OUTPUT_PATH.relative_to(ROOT)})",
    )
    parser.add_argument("--min-volume", type=float, default=DEFAULT_MIN_VOLUME)
    parser.add_argument("--min-liquidity", type=float, default=DEFAULT_MIN_LIQUIDITY)
    parser.add_argument("--min-volume-24hr", type=float, default=DEFAULT_MIN_VOLUME_24HR)
    parser.add_argument("--quiet", action="store_true", help="Suppress gap report on stdout")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    result = scout(
        min_volume=args.min_volume,
        min_liquidity=args.min_liquidity,
        min_volume_24hr=args.min_volume_24hr,
    )
    save_json(args.output, result)
    print(f"Wrote {len(result['events'])} markets to {args.output.relative_to(ROOT)}")
    if not args.quiet:
        print_gap_report(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
