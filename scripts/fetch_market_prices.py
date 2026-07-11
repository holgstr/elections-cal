#!/usr/bin/env python3
"""Fetch daily Polymarket prices for tracked election markets and detect significant moves."""

from __future__ import annotations

import json
import re
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from market_registry import MIN_CANDIDATE_PCT, MIN_PARTY_PCT, TrackedMarket, collect_all_markets

ROOT = Path(__file__).resolve().parents[1]
PRICES_DIR = ROOT / "data" / "market_prices"
STATE_PATH = PRICES_DIR / "state.json"
SUGGESTIONS_PATH = ROOT / "data" / "market_suggestions.json"
ODDS_CHANGES_PATH = ROOT / "data" / "market_odds_changes.json"
ELECTIONS_PATH = ROOT / "data" / "elections.json"

GAMMA_API = "https://gamma-api.polymarket.com/events"
CLOB_HISTORY_API = "https://clob.polymarket.com/prices-history"
USER_AGENT = "ElectionsCalBot/1.0 (https://github.com/holgstr/elections-cal)"

CHANGE_THRESHOLD_PP = 5
ODDS_CHANGE_THRESHOLD_PP = 4
CHANGE_WINDOW_DAYS = 2
CHANGE_WINDOW_LABEL = "2d"
BACKFILL_DAYS = 5
CLOB_REQUEST_DELAY_S = 0.12
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


def fetch_gamma_event(slug: str) -> list[dict]:
    url = f"{GAMMA_API}?slug={urllib.parse.quote(slug)}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        data = json.load(response)
    return data[0].get("markets", []) if data else []


def parse_clob_token_ids(raw) -> list[str]:
    if raw is None:
        return []
    try:
        parsed = json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, json.JSONDecodeError):
        return []
    if not isinstance(parsed, list):
        return []
    return [str(token) for token in parsed if token]


def markets_to_prices(markets: list[dict]) -> dict[str, float]:
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


def markets_to_token_map(markets: list[dict]) -> dict[str, str]:
    """Map outcome name to CLOB token id (Yes outcome, index 0)."""
    tokens: dict[str, str] = {}
    for market in markets:
        if market.get("active") is False:
            continue
        name = (market.get("groupItemTitle") or "").strip()
        if is_placeholder_name(name):
            continue
        token_ids = parse_clob_token_ids(market.get("clobTokenIds"))
        if not token_ids:
            continue
        tokens[name] = token_ids[0]
    return tokens


def binary_market_to_prices(markets: list[dict]) -> dict[str, float]:
    """Parse a single binary market's outcomes array, matching the calendar popover."""
    market = next((item for item in markets if item.get("active") is not False), None)
    if not market:
        return {}

    outcomes = market.get("outcomes")
    outcome_prices = market.get("outcomePrices")
    try:
        outcomes = json.loads(outcomes) if isinstance(outcomes, str) else outcomes
        outcome_prices = (
            json.loads(outcome_prices) if isinstance(outcome_prices, str) else outcome_prices
        )
    except (TypeError, ValueError, json.JSONDecodeError):
        return {}

    prices: dict[str, float] = {}
    for name, raw_price in zip(outcomes or [], outcome_prices or []):
        label = (name or "").strip()
        if not label:
            continue
        try:
            pct = round(float(raw_price) * 100, 2)
        except (TypeError, ValueError):
            continue
        prices[label] = pct
    return prices


def fetch_market_prices(market: TrackedMarket) -> dict[str, float]:
    markets = fetch_gamma_event(market.slug)
    if market.odds_format == "binary":
        return binary_market_to_prices(markets)
    return markets_to_prices(markets)


def fetch_slug_prices(slug: str) -> dict[str, float]:
    return markets_to_prices(fetch_gamma_event(slug))


def day_start_ts(day: str) -> int:
    dt = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return int(dt.timestamp())


def day_end_ts(day: str) -> int:
    dt = datetime.strptime(day, "%Y-%m-%d").replace(
        hour=23, minute=59, second=59, tzinfo=timezone.utc
    )
    return int(dt.timestamp())


def fetch_token_price_history(token_id: str, start_ts: int, end_ts: int) -> list[dict]:
    params = urllib.parse.urlencode(
        {
            "market": token_id,
            "startTs": start_ts,
            "endTs": end_ts,
            "fidelity": 1440,
        }
    )
    url = f"{CLOB_HISTORY_API}?{params}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.load(response)
    history = payload.get("history") if isinstance(payload, dict) else None
    return history if isinstance(history, list) else []


def history_to_daily_prices(history: list[dict]) -> dict[str, float]:
    """Bucket CLOB history points by UTC date, keeping the last price each day."""
    by_day: dict[str, list[tuple[int, float]]] = {}
    for point in history:
        try:
            ts = int(point["t"])
            price = float(point["p"])
        except (KeyError, TypeError, ValueError):
            continue
        day = datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat()
        by_day.setdefault(day, []).append((ts, price))

    daily: dict[str, float] = {}
    for day, points in by_day.items():
        _, price = max(points, key=lambda item: item[0])
        daily[day] = round(price * 100, 2)
    return daily


def fetch_slug_historical_prices(
    slug: str,
    start_day: str,
    end_day: str,
) -> dict[str, dict[str, float]]:
    """Return per-day outcome prices for a slug between start_day and end_day (inclusive)."""
    markets = fetch_gamma_event(slug)
    token_map = markets_to_token_map(markets)
    if not token_map:
        return {}

    start_ts = day_start_ts(start_day)
    end_ts = day_end_ts(end_day)
    daily_by_outcome: dict[str, dict[str, float]] = {}

    for outcome, token_id in token_map.items():
        try:
            history = fetch_token_price_history(token_id, start_ts, end_ts)
        except Exception:  # noqa: BLE001 - skip failed tokens
            continue
        finally:
            time.sleep(CLOB_REQUEST_DELAY_S)

        for day, pct in history_to_daily_prices(history).items():
            if start_day <= day <= end_day:
                daily_by_outcome.setdefault(day, {})[outcome] = pct

    return daily_by_outcome


def recent_snapshot_dates(today: str, days: int) -> list[str]:
    today_dt = date.fromisoformat(today)
    return [(today_dt - timedelta(days=offset)).isoformat() for offset in range(days - 1, -1, -1)]


def missing_snapshot_dates(state: dict, today: str, days: int) -> list[str]:
    existing = {snapshot.get("date") for snapshot in state.get("snapshots", [])}
    return [day for day in recent_snapshot_dates(today, days) if day not in existing]


def backfill_historical_snapshots(
    state: dict,
    markets: list[TrackedMarket],
    today: str,
    days: int = BACKFILL_DAYS,
) -> tuple[int, list[str]]:
    """Fill missing daily snapshots using Polymarket CLOB price history."""
    missing = missing_snapshot_dates(state, today, days)
    if not missing:
        return 0, []

    snapshots = state.setdefault("snapshots", [])
    snapshot_index = {snapshot["date"]: snapshot for snapshot in snapshots}
    start_day = missing[0]
    end_day = missing[-1]
    filled_days = 0
    errors: list[str] = []

    for market in sorted(markets, key=lambda item: item.market_id):
        try:
            daily_prices = fetch_slug_historical_prices(market.slug, start_day, end_day)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"backfill {market.slug}: {exc}")
            continue

        for day, prices in daily_prices.items():
            if day not in missing or not prices:
                continue
            snapshot = snapshot_index.get(day)
            if snapshot is None:
                snapshot = {"date": day, "markets": {}}
                snapshots.append(snapshot)
                snapshot_index[day] = snapshot
            snapshot["markets"][market.market_id] = {
                "slug": market.slug,
                "prices": prices,
            }

    snapshots.sort(key=lambda item: item["date"])
    filled_days = len({day for day in missing if snapshot_index.get(day, {}).get("markets")})
    return filled_days, errors


def seed_baselines_from_snapshots(
    baselines: dict,
    market: TrackedMarket,
    snapshots: list[dict],
    today: str,
    lookback_days: int = BACKFILL_DAYS,
) -> None:
    """Set comparison baselines from the oldest snapshot in the lookback window."""
    cutoff = (date.fromisoformat(today) - timedelta(days=lookback_days - 1)).isoformat()
    relevant = sorted(
        (snapshot for snapshot in snapshots if cutoff <= snapshot.get("date", "") <= today),
        key=lambda item: item["date"],
    )
    if not relevant:
        return

    oldest = relevant[0]
    market_data = oldest.get("markets", {}).get(market.market_id)
    if not market_data:
        return

    for name, pct in market_data.get("prices", {}).items():
        key = baseline_key(market.market_id, name)
        existing = baselines.get(key)
        if existing is None or existing.get("since_date") == today:
            baselines[key] = {"pct": pct, "since_date": oldest["date"]}


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
    return {name: pct for name, pct in prices.items() if pct > min_pct}


def outcome_price_history(
    snapshots: list[dict],
    market_id: str,
    outcome: str,
    through_day: str,
) -> list[tuple[str, float]]:
    history: list[tuple[str, float]] = []
    for snapshot in sorted(snapshots, key=lambda item: item["date"]):
        day = snapshot.get("date")
        if not day or day > through_day:
            continue
        market_data = snapshot.get("markets", {}).get(market_id)
        if not market_data:
            continue
        pct = market_data.get("prices", {}).get(outcome)
        if pct is not None:
            history.append((day, pct))
    return history


def find_move_anchor(
    history: list[tuple[str, float]],
    threshold_pp: float = CHANGE_THRESHOLD_PP,
) -> tuple[float, int, str, str] | None:
    """Find the last snapshot at least threshold_pp away from the current price."""
    if not history:
        return None

    current_date, current_pct = history[-1]
    anchor: tuple[str, float] | None = None

    for day, pct in reversed(history[:-1]):
        if abs(pct - current_pct) >= threshold_pp:
            anchor = (day, pct)
            break

    if anchor is None:
        return None

    anchor_date, anchor_pct = anchor
    change_pp = round(abs(current_pct - anchor_pct), 2)
    change_days = (date.fromisoformat(current_date) - date.fromisoformat(anchor_date)).days
    direction = "up" if current_pct > anchor_pct else "down"
    return change_pp, change_days, anchor_date, direction


def enrich_change_from_history(
    change: dict,
    snapshots: list[dict],
    market_id: str,
    today: str,
) -> dict:
    history = outcome_price_history(snapshots, market_id, change["name"], today)
    anchor = find_move_anchor(history)
    if anchor is not None:
        change_pp, change_days, since_date, direction = anchor
        change["change_pp"] = change_pp
        change["change_days"] = change_days
        change["since_date"] = since_date
        change["direction"] = direction
        return change

    since_date = change.get("since_date")
    if since_date:
        change["change_days"] = (date.fromisoformat(today) - date.fromisoformat(since_date)).days
    return change


def compute_window_changes(
    market: TrackedMarket,
    current_prices: dict[str, float],
    snapshots: list[dict],
    today: str,
    window_days: int = CHANGE_WINDOW_DAYS,
) -> dict[str, dict]:
    """Return per-outcome moves over the last window_days (48h with daily snapshots)."""
    reference_day = (date.fromisoformat(today) - timedelta(days=window_days)).isoformat()
    reference_snapshot = snapshot_for_date({"snapshots": snapshots}, reference_day)
    if not reference_snapshot:
        return {}

    market_data = reference_snapshot.get("markets", {}).get(market.market_id)
    if not market_data:
        return {}

    reference_prices = market_data.get("prices", {})
    changes: dict[str, dict] = {}

    for name, current_pct in current_prices.items():
        reference_pct = reference_prices.get(name)
        if reference_pct is None:
            continue

        delta = round(current_pct - reference_pct, 2)
        if abs(delta) < ODDS_CHANGE_THRESHOLD_PP:
            continue

        changes[name] = {
            "change_pp": abs(delta),
            "direction": "up" if delta > 0 else "down",
            "reference_date": reference_day,
            "reference_pct": reference_pct,
            "window": CHANGE_WINDOW_LABEL,
        }

    return changes


def detect_window_changes(
    market: TrackedMarket,
    prices: dict[str, float],
    snapshots: list[dict],
    today: str,
) -> list[dict]:
    """Return listed outcomes with ≥4pp moves over the last 48h window."""
    filtered = filter_prices(prices, market.min_pct)
    window_changes = compute_window_changes(market, filtered, snapshots, today)
    changes: list[dict] = []

    for name, change in window_changes.items():
        changes.append(
            {
                "name": name,
                "current_pct": filtered[name],
                "change_pp": change["change_pp"],
                "direction": change["direction"],
                "since_date": change["reference_date"],
                "reference_pct": change["reference_pct"],
                "change_days": CHANGE_WINDOW_DAYS,
                "window": change["window"],
            }
        )

    return changes


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


def election_state_codes(election: dict) -> set[str]:
    codes: set[str] = set()
    if election.get("state_code"):
        codes.add(election["state_code"])
    for section in election.get("sections") or []:
        for state in section.get("states") or []:
            if state.get("code"):
                codes.add(state["code"])
    return codes


def election_matches_location(market: TrackedMarket, election: dict) -> bool:
    if market.country_code and election.get("country_code") != market.country_code:
        return False
    if market.state_code and market.state_code not in election_state_codes(election):
        return False
    if market.city_code and election.get("city_code") != market.city_code:
        return False
    return True


def find_election_for_market(market: TrackedMarket, elections: list[dict]) -> dict | None:
    candidates = []

    for election in elections:
        if not election_matches_location(market, election):
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
            if election.get("country_code") != "DE":
                continue
            if market.state_code and market.state_code not in election_state_codes(election):
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
    snapshots: list[dict],
    today: str,
) -> dict:
    display_prices = []
    filtered = filter_prices(prices, market.min_pct)
    change_by_name: dict[str, dict] = {}
    for change in changes:
        if change.get("window"):
            change_by_name[change["name"]] = change
        else:
            change_by_name[change["name"]] = enrich_change_from_history(
                change, snapshots, market.market_id, today
            )

    for name, pct in sorted(filtered.items(), key=lambda item: -item[1]):
        entry = {"name": name, "current_pct": pct}
        if name in change_by_name:
            entry.update(change_by_name[name])
        display_prices.append(entry)

    return {
        "market_id": market.market_id,
        "slug": market.slug,
        "category": market.category,
        "odds_format": market.odds_format,
        "min_pct": market.min_pct,
        "country_code": market.country_code,
        "state_code": market.state_code,
        "city_code": market.city_code,
        "contest": market.contest,
        "market_label": market.market_label,
        "party": market.party,
        "election_date": election.get("date") if election else None,
        "election_title": election.get("title") if election else None,
        "max_change_pp": max((change["change_pp"] for change in changes), default=0),
        "changes": [change_by_name[change["name"]] for change in changes],
        "prices": display_prices,
    }


def main() -> None:
    today = date.today().isoformat()
    markets = collect_all_markets()
    elections = load_json(ELECTIONS_PATH)
    state = load_state()
    baselines = state.setdefault("baselines", {})
    snapshots = state.setdefault("snapshots", [])

    backfilled_days, backfill_errors = backfill_historical_snapshots(
        state, markets, today, BACKFILL_DAYS
    )
    if backfilled_days:
        print(f"Backfilled historical snapshots for {backfilled_days} day(s)")

    today_snapshot = snapshot_for_date(state, today)
    if today_snapshot is None:
        today_snapshot = {"date": today, "markets": {}}
        snapshots.append(today_snapshot)
        snapshots.sort(key=lambda item: item["date"])

    suggestions: list[dict] = []
    odds_changes_by_slug: dict[str, dict] = {}
    odds_changes_by_market_id: dict[str, dict] = {}
    fetched = 0
    errors: list[str] = list(backfill_errors)

    for market in sorted(markets, key=lambda item: item.market_id):
        seed_baselines_from_snapshots(baselines, market, snapshots, today, BACKFILL_DAYS)

        try:
            prices = fetch_market_prices(market)
            fetched += 1
        except Exception as exc:  # noqa: BLE001 - collect per-market failures
            errors.append(f"{market.slug}: {exc}")
            continue

        today_snapshot["markets"][market.market_id] = {
            "slug": market.slug,
            "prices": prices,
        }

        window_changes = compute_window_changes(market, prices, snapshots, today)
        if window_changes:
            odds_changes_by_slug[market.slug] = window_changes
            odds_changes_by_market_id[market.market_id] = window_changes

        changes = detect_window_changes(market, prices, snapshots, today)
        if not changes:
            continue

        election = find_election_for_market(market, elections)
        suggestions.append(
            build_suggestion_entry(market, changes, prices, election, snapshots, today)
        )

    suggestions.sort(key=lambda item: -item.get("max_change_pp", 0))

    state["last_updated"] = today
    state["snapshots"] = prune_snapshots(state["snapshots"])
    save_json(STATE_PATH, state)

    output = {
        "_comment": (
            "Generated by scripts/fetch_market_prices.py. "
            f"Lists races with ≥{ODDS_CHANGE_THRESHOLD_PP}pp moves over the last "
            f"{CHANGE_WINDOW_DAYS} day(s) (≈48h), sorted by largest single-outcome move."
        ),
        "generated_at": today,
        "threshold_pp": ODDS_CHANGE_THRESHOLD_PP,
        "window_days": CHANGE_WINDOW_DAYS,
        "window_label": CHANGE_WINDOW_LABEL,
        "markets_fetched": fetched,
        "suggestions": suggestions,
    }
    if errors:
        output["errors"] = errors[:20]

    save_json(SUGGESTIONS_PATH, output)

    odds_changes_output = {
        "_comment": (
            "Generated by scripts/fetch_market_prices.py. "
            f"Per-outcome moves over the last {CHANGE_WINDOW_DAYS} day(s) (≈48h), "
            f"shown only when ≥{ODDS_CHANGE_THRESHOLD_PP}pp."
        ),
        "generated_at": today,
        "window_days": CHANGE_WINDOW_DAYS,
        "window_label": CHANGE_WINDOW_LABEL,
        "threshold_pp": ODDS_CHANGE_THRESHOLD_PP,
        "by_slug": odds_changes_by_slug,
        "by_market_id": odds_changes_by_market_id,
    }
    save_json(ODDS_CHANGES_PATH, odds_changes_output)

    print(f"Fetched {fetched}/{len(markets)} markets for {today}")
    print(f"Suggestions: {len(suggestions)}")
    if errors:
        print(f"Errors: {len(errors)}")
        for message in errors[:5]:
            print(f"  {message}")


if __name__ == "__main__":
    main()
