#!/usr/bin/env python3
"""Fetch daily Polymarket prices for tracked election markets and detect significant moves."""

from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

from market_registry import MIN_CANDIDATE_PCT, MIN_PARTY_PCT, TrackedMarket, collect_all_markets

ROOT = Path(__file__).resolve().parents[1]
PRICES_DIR = ROOT / "data" / "market_prices"
STATE_PATH = PRICES_DIR / "state.json"
SUGGESTIONS_PATH = ROOT / "data" / "market_suggestions.json"
ELECTIONS_PATH = ROOT / "data" / "elections.json"

GAMMA_API = "https://gamma-api.polymarket.com/events"
USER_AGENT = "ElectionsCalBot/1.0 (https://github.com/holgstr/elections-cal)"

CHANGE_THRESHOLD_PP = 5
PLACEHOLDER_RE = re.compile(r"^(Candidate|Option|Person) [A-Z]+$", re.I)


def load_json(path: Path) -> dict | list:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def save_json(path: Path, data: dict | list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


def parse_outcome_price(outcome_prices) -> float | None:
    if outcome_prices is None:
        return None
    try:
        parsed = json.loads(outcome_prices) if isinstance(outcome_prices, str) else outcome_prices
        return round(float(parsed[0]) * 100, 2)
    except (TypeError, ValueError, json.JSONDecodeError, IndexError):
        return None


def is_placeholder_name(name: str) -> bool:
    return not name or name == "Other" or bool(PLACEHOLDER_RE.match(name))


def fetch_slug_prices(slug: str) -> dict[str, float]:
    url = f"{GAMMA_API}?slug={urllib.parse.quote(slug)}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        data = json.load(response)

    markets = data[0].get("markets", []) if data else []
    prices: dict[str, float] = {}

    for market in markets:
        if market.get("active") is False:
            continue
        name = (market.get("groupItemTitle") or "").strip()
        if is_placeholder_name(name):
            continue
        pct = parse_outcome_price(market.get("outcomePrices"))
        if pct is None:
            continue
        prices[name] = pct

    return prices


def baseline_key(market_id: str, outcome: str) -> str:
    return f"{market_id}::{outcome}"


def load_state() -> dict:
    if not STATE_PATH.exists():
        return {"baselines": {}, "snapshots": []}
    return load_json(STATE_PATH)


MAX_SNAPSHOT_DAYS = 365


def prune_snapshots(snapshots: list[dict]) -> list[dict]:
    if len(snapshots) <= MAX_SNAPSHOT_DAYS:
        return snapshots
    return snapshots[-MAX_SNAPSHOT_DAYS:]


def snapshot_for_date(state: dict, day: str) -> dict | None:
    for snapshot in state.get("snapshots", []):
        if snapshot.get("date") == day:
            return snapshot
    return None


def filter_prices(prices: dict[str, float], min_pct: float) -> dict[str, float]:
    return {name: pct for name, pct in prices.items() if pct >= min_pct}


def detect_changes(
    market: TrackedMarket,
    prices: dict[str, float],
    baselines: dict,
    today: str,
) -> list[dict]:
    changes: list[dict] = []
    filtered = filter_prices(prices, market.min_pct)

    for name, current_pct in filtered.items():
        key = baseline_key(market.market_id, name)
        baseline = baselines.get(key)

        if baseline is None:
            baselines[key] = {"pct": current_pct, "since_date": today}
            continue

        baseline_pct = baseline["pct"]
        delta = round(current_pct - baseline_pct, 2)
        if abs(delta) < CHANGE_THRESHOLD_PP:
            continue

        direction = "up" if delta > 0 else "down"
        changes.append(
            {
                "name": name,
                "current_pct": current_pct,
                "change_pp": abs(delta),
                "direction": direction,
                "since_date": baseline["since_date"],
            }
        )
        baselines[key] = {"pct": current_pct, "since_date": today}

    return changes


def election_has_contest(election: dict, contest: str, market_label: str | None = None) -> bool:
    haystacks = [
        election.get("title", ""),
        *(election.get("offices") or []),
        *(election.get("labels") or []),
    ]
    for section in election.get("sections") or []:
        haystacks.append(section.get("label", ""))
        haystacks.extend(section.get("offices") or [])

    normalized = [value.lower() for value in haystacks if value]
    targets = [contest.lower()]
    if market_label:
        targets.append(market_label.lower())

    return any(
        target in haystack or haystack in target
        for target in targets
        for haystack in normalized
    )


def find_election_for_market(market: TrackedMarket, elections: list[dict]) -> dict | None:
    candidates = []

    for election in elections:
        if market.country_code and election.get("country_code") != market.country_code:
            continue

        if market.state_code and election.get("state_code") != market.state_code:
            continue

        if market.city_code and election.get("city_code") != market.city_code:
            continue

        if market.category == "presidential":
            if election.get("type") != "presidential" and not election_has_contest(
                election, "President"
            ):
                continue

        if market.category == "us_primary":
            if election.get("type") != "primary":
                continue
            offices = election.get("offices") or []
            office_match = any(office in (market.contest or "") for office in offices)
            if not office_match and market.party:
                office_match = any(
                    f"{market.party} {office}" in market.contest for office in offices
                )
            if not office_match:
                continue

        if market.category in {"us_governor", "us_senate"}:
            offices = election.get("offices") or []
            if market.contest not in offices and election.get("type") not in {
                "general",
                "legislative",
                "combined",
            }:
                if not election_has_contest(election, market.contest):
                    continue

        if market.category == "de_state":
            if election.get("country_code") != "DE" or not election.get("state_code"):
                continue

        if market.category == "national":
            if not election_has_contest(election, market.contest, market.market_label):
                continue

        if market.category == "mayoral":
            if election.get("type") != "mayoral" and not election_has_contest(
                election, "Mayor"
            ):
                continue

        candidates.append(election)

    if not candidates:
        return None

    candidates.sort(key=lambda item: item.get("date", ""))
    return candidates[0]


def build_suggestion_entry(
    market: TrackedMarket,
    changes: list[dict],
    prices: dict[str, float],
    election: dict | None,
) -> dict:
    display_prices = []
    filtered = filter_prices(prices, market.min_pct)
    change_by_name = {change["name"]: change for change in changes}

    for name, pct in sorted(filtered.items(), key=lambda item: -item[1]):
        entry = {"name": name, "current_pct": pct}
        if name in change_by_name:
            entry.update(change_by_name[name])
        display_prices.append(entry)

    return {
        "market_id": market.market_id,
        "slug": market.slug,
        "category": market.category,
        "country_code": market.country_code,
        "state_code": market.state_code,
        "city_code": market.city_code,
        "contest": market.contest,
        "market_label": market.market_label,
        "party": market.party,
        "election_date": election.get("date") if election else None,
        "election_title": election.get("title") if election else None,
        "changes": changes,
        "prices": display_prices,
    }


def main() -> None:
    today = date.today().isoformat()
    markets = collect_all_markets()
    elections = load_json(ELECTIONS_PATH)
    state = load_state()
    baselines = state.setdefault("baselines", {})
    snapshots = state.setdefault("snapshots", [])

    today_snapshot = snapshot_for_date(state, today)
    if today_snapshot is None:
        today_snapshot = {"date": today, "markets": {}}
        snapshots.append(today_snapshot)
        snapshots.sort(key=lambda item: item["date"])

    suggestions: list[dict] = []
    fetched = 0
    errors: list[str] = []

    for market in sorted(markets, key=lambda item: item.market_id):
        try:
            prices = fetch_slug_prices(market.slug)
            fetched += 1
        except Exception as exc:  # noqa: BLE001 - collect per-market failures
            errors.append(f"{market.slug}: {exc}")
            continue

        today_snapshot["markets"][market.market_id] = {
            "slug": market.slug,
            "prices": prices,
        }

        changes = detect_changes(market, prices, baselines, today)
        if not changes:
            continue

        election = find_election_for_market(market, elections)
        suggestions.append(build_suggestion_entry(market, changes, prices, election))

    suggestions.sort(
        key=lambda item: (
            item.get("election_date") or "9999",
            item.get("country_code") or "",
            item.get("state_code") or "",
            item.get("contest") or "",
        )
    )

    state["last_updated"] = today
    state["snapshots"] = prune_snapshots(state["snapshots"])
    save_json(STATE_PATH, state)

    output = {
        "_comment": (
            "Generated by scripts/fetch_market_prices.py. "
            f"Lists races with ≥{CHANGE_THRESHOLD_PP}pp moves since the last signaled price."
        ),
        "generated_at": today,
        "threshold_pp": CHANGE_THRESHOLD_PP,
        "markets_fetched": fetched,
        "suggestions": suggestions,
    }
    if errors:
        output["errors"] = errors[:20]

    save_json(SUGGESTIONS_PATH, output)

    print(f"Fetched {fetched}/{len(markets)} markets for {today}")
    print(f"Suggestions: {len(suggestions)}")
    if errors:
        print(f"Errors: {len(errors)}")
        for message in errors[:5]:
            print(f"  {message}")


if __name__ == "__main__":
    main()
