#!/usr/bin/env python3
"""Assess Polymarket market competitiveness to help pick main national election markets.

Compares candidate (PM/presidential) vs party/seats markets for calendar elections and
recommends which to link based on the rules in docs/events.md#national-election-info-popover.
"""

from __future__ import annotations

import argparse
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCOUTED_PATH = ROOT / "data" / "scouted" / "polymarket_international.json"

GAMMA_API = "https://gamma-api.polymarket.com/events"
USER_AGENT = "ElectionsCalBot/1.0 (https://github.com/holgstr/elections-cal)"

CANDIDATE_MIN_PCT = 3
PARTY_MIN_PCT = 10
GAP_TIE_THRESHOLD = 10
COUNT_TIE_THRESHOLD = 1

MARKET_KIND_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("prime_minister", re.compile(r"\bprime minister\b", re.I)),
    ("party", re.compile(r"\b(party|parliamentary|legislative).*(winner|election winner)\b", re.I)),
    ("seats", re.compile(r"\bmost seats\b", re.I)),
    ("presidential", re.compile(r"\bpresident(?:ial)?\b", re.I)),
)


def load_json(path: Path) -> dict | list:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def classify_market(title: str, election_kind: str | None) -> str:
    for kind, pattern in MARKET_KIND_PATTERNS:
        if pattern.search(title):
            return kind
    return election_kind or "other"


def fetch_prices(slug: str) -> list[tuple[str, float]]:
    url = f"{GAMMA_API}?slug={urllib.parse.quote(slug)}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        data = json.load(response)

    markets = data[0].get("markets", []) if data else []
    prices: list[tuple[str, float]] = []

    for market in markets:
        if market.get("active") is False:
            continue
        name = market.get("groupItemTitle") or ""
        if not name or name == "Other" or re.match(r"^Candidate [A-Z]+$", name, re.I):
            continue
        try:
            raw = market.get("outcomePrices")
            parsed = json.loads(raw) if isinstance(raw, str) else raw
            pct = float(parsed[0]) * 100
        except (TypeError, ValueError, json.JSONDecodeError, IndexError):
            continue
        prices.append((name, pct))

    prices.sort(key=lambda item: -item[1])
    return prices


def competitiveness(prices: list[tuple[str, float]], *, min_pct: float) -> dict | None:
    if len(prices) < 1:
        return None
    top = prices[0][1]
    second = prices[1][1] if len(prices) > 1 else 0.0
    viable = [price for _, price in prices if price > min_pct]
    return {
        "gap": top - second,
        "viable_count": len(viable),
        "top": top,
        "second": second,
    }


def min_pct_for_kind(kind: str) -> float:
    if kind in {"party", "seats"}:
        return PARTY_MIN_PCT
    return CANDIDATE_MIN_PCT


def recommend(markets: list[dict]) -> list[dict]:
    assessed: list[dict] = []
    for market in markets:
        kind = classify_market(market["title"], market.get("election_kind"))
        prices = fetch_prices(market["slug"])
        stats = competitiveness(prices, min_pct=min_pct_for_kind(kind))
        if not stats:
            continue
        assessed.append({**market, "kind": kind, **stats})

    if not assessed:
        return []

    assessed.sort(key=lambda item: (item["gap"], -item["viable_count"]))
    best = assessed[0]
    picks = [best]

    for candidate in assessed[1:]:
        if (
            abs(candidate["gap"] - best["gap"]) <= GAP_TIE_THRESHOLD
            and abs(candidate["viable_count"] - best["viable_count"]) <= COUNT_TIE_THRESHOLD
        ):
            picks.append(candidate)

    return picks


def group_unlinked_by_contest(unlinked: list[dict]) -> dict[tuple[str, str], list[dict]]:
    groups: dict[tuple[str, str], list[dict]] = {}
    for market in unlinked:
        if market.get("election_kind") not in {"legislative", "prime_minister", "presidential", "general"}:
            continue
        for match in market.get("calendar_matches") or []:
            if match.get("type") not in {"legislative", "presidential", "combined"}:
                continue
            key = (market.get("country_code") or "", match.get("title") or "")
            groups.setdefault(key, []).append(market)
    return groups


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--country",
        help="Only assess markets for this ISO country code (e.g. SE)",
    )
    args = parser.parse_args()

    if not SCOUTED_PATH.exists():
        raise SystemExit(f"Missing scout output: {SCOUTED_PATH}. Run scout_polymarket_international.py first.")

    scouted = load_json(SCOUTED_PATH)
    unlinked = scouted.get("gaps", {}).get("in_calendar_unlinked", [])
    groups = group_unlinked_by_contest(unlinked)

    for (country_code, contest), markets in sorted(groups.items()):
        if args.country and country_code != args.country.upper():
            continue
        if len(markets) < 2:
            continue

        picks = recommend(markets)
        if not picks:
            continue

        print(f"\n{country_code} — {contest}")
        for market in markets:
            kind = classify_market(market["title"], market.get("election_kind"))
            prices = fetch_prices(market["slug"])
            stats = competitiveness(prices, min_pct=min_pct_for_kind(kind))
            if not stats:
                print(f"  - [{kind}] {market['slug']}: no odds")
                continue
            selected = market["slug"] in {pick["slug"] for pick in picks}
            marker = "→" if selected else " "
            print(
                f"  {marker} [{kind}] gap={stats['gap']:.1f}% viable={stats['viable_count']} "
                f"top={stats['top']:.1f}% — {market['slug']}"
            )


if __name__ == "__main__":
    main()
