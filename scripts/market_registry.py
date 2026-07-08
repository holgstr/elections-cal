#!/usr/bin/env python3
"""Enumerate tracked Polymarket markets from generated info files."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CURATED = ROOT / "data" / "curated"

MIN_CANDIDATE_PCT = 3
MIN_PARTY_PCT = 10


@dataclass(frozen=True)
class TrackedMarket:
    market_id: str
    slug: str
    odds_format: str
    category: str
    country_code: str
    contest: str
    state_code: str | None = None
    city_code: str | None = None
    party: str | None = None
    min_pct: float = MIN_CANDIDATE_PCT
    market_label: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def _skip_meta_keys(data: dict) -> dict:
    return {k: v for k, v in data.items() if not k.startswith("_")}


def _add_market(markets: list[TrackedMarket], **kwargs) -> None:
    markets.append(TrackedMarket(**kwargs))


def _collect_slug_markets(
    markets: list[TrackedMarket],
    *,
    slug: str,
    market_id: str,
    category: str,
    country_code: str,
    contest: str,
    odds_format: str = "candidates",
    state_code: str | None = None,
    city_code: str | None = None,
    party: str | None = None,
    min_pct: float = MIN_CANDIDATE_PCT,
    market_label: str | None = None,
) -> None:
    if not slug:
        return
    _add_market(
        markets,
        market_id=market_id,
        slug=slug,
        odds_format=odds_format,
        category=category,
        country_code=country_code,
        contest=contest,
        state_code=state_code,
        city_code=city_code,
        party=party,
        min_pct=min_pct,
        market_label=market_label,
    )


def collect_presidential(markets: list[TrackedMarket]) -> None:
    data = _skip_meta_keys(load_json(CURATED / "presidential_info.json"))
    for country_code, info in data.items():
        _collect_slug_markets(
            markets,
            slug=info.get("polymarket_slug", ""),
            market_id=f"presidential:{country_code}",
            category="presidential",
            country_code=country_code,
            contest="President",
            odds_format="candidates",
            market_label=info.get("label"),
        )


def collect_us_primary(markets: list[TrackedMarket]) -> None:
    data = _skip_meta_keys(load_json(CURATED / "us_primary_info.json"))
    for state_code, offices in data.items():
        for office, info in offices.items():
            if info.get("polymarket_slug"):
                label = f"{office} Primary"
                _collect_slug_markets(
                    markets,
                    slug=info["polymarket_slug"],
                    market_id=f"us-primary:{state_code}:{office}",
                    category="us_primary",
                    country_code="US",
                    contest=label,
                    state_code=state_code,
                    odds_format="candidates",
                    market_label=label,
                )
                continue

            for party, party_info in (info.get("parties") or {}).items():
                slug = party_info.get("polymarket_slug")
                if not slug:
                    continue
                label = f"{party} {office} Primary"
                _collect_slug_markets(
                    markets,
                    slug=slug,
                    market_id=f"us-primary:{state_code}:{office}:{party}",
                    category="us_primary",
                    country_code="US",
                    contest=label,
                    state_code=state_code,
                    party=party,
                    odds_format="candidates",
                    market_label=label,
                )


def collect_us_governor(markets: list[TrackedMarket]) -> None:
    data = _skip_meta_keys(load_json(CURATED / "us_governor_info.json"))
    for state_code, info in data.items():
        _collect_slug_markets(
            markets,
            slug=info.get("polymarket_slug", ""),
            market_id=f"us-governor:{state_code}",
            category="us_governor",
            country_code="US",
            contest="Governor",
            state_code=state_code,
            odds_format=info.get("odds_format", "party"),
        )


def collect_us_senate(markets: list[TrackedMarket]) -> None:
    data = _skip_meta_keys(load_json(CURATED / "us_senate_info.json"))
    for state_code, info in data.items():
        _collect_slug_markets(
            markets,
            slug=info.get("polymarket_slug", ""),
            market_id=f"us-senate:{state_code}",
            category="us_senate",
            country_code="US",
            contest="Senate",
            state_code=state_code,
            odds_format=info.get("odds_format", "party"),
        )


def collect_de_state(markets: list[TrackedMarket]) -> None:
    data = _skip_meta_keys(load_json(CURATED / "de_state_info.json"))
    for state_code, info in data.items():
        label = info.get("label", "Landtag")
        if info.get("polymarket_slug"):
            _collect_slug_markets(
                markets,
                slug=info["polymarket_slug"],
                market_id=f"de-state:{state_code}",
                category="de_state",
                country_code="DE",
                contest=label,
                state_code=state_code,
                odds_format="party",
                min_pct=MIN_PARTY_PCT,
                market_label=label,
            )

        for market in info.get("markets") or []:
            slug = market.get("polymarket_slug")
            if not slug:
                continue
            odds_format = market.get("odds_format", "party")
            min_pct = MIN_PARTY_PCT if odds_format in {"party", "binary"} else MIN_CANDIDATE_PCT
            market_label = market.get("label", label)
            _collect_slug_markets(
                markets,
                slug=slug,
                market_id=f"de-state:{state_code}:{market_label}",
                category="de_state",
                country_code="DE",
                contest=label,
                state_code=state_code,
                odds_format=odds_format,
                min_pct=min_pct,
                market_label=market_label,
            )


def collect_national(markets: list[TrackedMarket]) -> None:
    data = _skip_meta_keys(load_json(CURATED / "national_election_info.json"))
    for country_code, contests in data.items():
        for contest_label, info in contests.items():
            for market in info.get("markets") or []:
                slug = market.get("polymarket_slug")
                if not slug:
                    continue
                odds_format = market.get("odds_format", "candidates")
                min_pct = MIN_PARTY_PCT if odds_format == "party" else MIN_CANDIDATE_PCT
                market_label = market.get("label", contest_label)
                _collect_slug_markets(
                    markets,
                    slug=slug,
                    market_id=f"national:{country_code}:{contest_label}:{market.get('kind', market_label)}",
                    category="national",
                    country_code=country_code,
                    contest=contest_label,
                    odds_format=odds_format,
                    min_pct=min_pct,
                    market_label=market_label,
                )


def collect_mayoral(markets: list[TrackedMarket]) -> None:
    elections = load_json(ROOT / "data" / "elections.json")
    data = _skip_meta_keys(load_json(CURATED / "mayoral_info.json"))
    for code, info in data.items():
        city = info.get("city")
        city_code = code if city else None
        country_code = None

        if city:
            for election in elections:
                if election.get("city") == city or election.get("city_code") == city_code:
                    country_code = election.get("country_code")
                    city_code = election.get("city_code") or city_code
                    break
            if not country_code:
                country_code = "GB"
        else:
            country_code = code

        _collect_slug_markets(
            markets,
            slug=info.get("polymarket_slug", ""),
            market_id=f"mayoral:{code}",
            category="mayoral",
            country_code=country_code,
            contest=info.get("label", "Mayor"),
            city_code=city_code,
            odds_format="candidates",
            market_label=info.get("label"),
        )


def collect_all_markets() -> list[TrackedMarket]:
    markets: list[TrackedMarket] = []
    collect_presidential(markets)
    collect_us_primary(markets)
    collect_us_governor(markets)
    collect_us_senate(markets)
    collect_de_state(markets)
    collect_national(markets)
    collect_mayoral(markets)

    by_slug: dict[str, TrackedMarket] = {}
    for market in markets:
        by_slug.setdefault(market.slug, market)
    return list(by_slug.values())


def main() -> None:
    markets = collect_all_markets()
    print(f"Tracked markets: {len(markets)}")
    for market in sorted(markets, key=lambda item: item.market_id):
        print(f"  {market.market_id}: {market.slug}")


if __name__ == "__main__":
    main()
