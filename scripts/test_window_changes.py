#!/usr/bin/env python3
"""Lightweight checks for 48h window change calculations."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fetch_market_prices import (  # noqa: E402
    CHANGE_WINDOW_DAYS,
    ODDS_CHANGE_THRESHOLD_PP,
    build_market_odds,
    compute_window_changes,
)
from market_registry import TrackedMarket  # noqa: E402


def test_compute_window_changes_uses_reference_price() -> None:
    market = TrackedMarket(
        market_id="test:market",
        slug="test-market",
        category="us_governor",
        odds_format="candidates",
        min_pct=3,
        country_code="US",
        state_code="AK",
        city_code=None,
        contest="Governor",
        market_label=None,
        party=None,
    )
    snapshots = [
        {
            "date": "2026-07-08",
            "markets": {
                "test:market": {
                    "slug": "test-market",
                    "prices": {"Candidate A": 30.5, "Candidate B": 10.0},
                }
            },
        },
        {
            "date": "2026-07-10",
            "markets": {
                "test:market": {
                    "slug": "test-market",
                    "prices": {"Candidate A": 43.0, "Candidate B": 10.0},
                }
            },
        },
    ]
    current_prices = {"Candidate A": 43.0, "Candidate B": 10.0}

    changes = compute_window_changes(market, current_prices, snapshots, "2026-07-10")

    assert "Candidate A" in changes
    assert changes["Candidate A"]["change_pp"] == 12.5
    assert changes["Candidate A"]["direction"] == "up"
    assert changes["Candidate A"]["reference_pct"] == 30.5
    assert changes["Candidate A"]["reference_date"] == "2026-07-08"
    assert "Candidate B" not in changes


def test_live_price_recalculation_math() -> None:
    """Document the frontend invariant: movement must use the 48h reference price."""
    reference_pct = 30.5
    live_pct = 10.0
    delta = round(live_pct - reference_pct, 2)
    assert delta == -20.5
    assert abs(delta) >= ODDS_CHANGE_THRESHOLD_PP
    assert CHANGE_WINDOW_DAYS == 2


def test_build_market_odds_from_snapshot() -> None:
    market = TrackedMarket(
        market_id="test:market",
        slug="test-market",
        category="de_state",
        odds_format="party",
        min_pct=10,
        country_code="DE",
        state_code="BE",
        city_code=None,
        contest="Abgeordnetenhaus",
        market_label=None,
        party=None,
    )
    snapshot = {
        "date": "2026-07-17",
        "markets": {
            "test:market": {
                "slug": "test-market",
                "prices": {"CDU": 28.0, "AfD": 13.9},
            }
        },
    }
    errors: list[str] = []
    output = build_market_odds(
        [market],
        snapshot,
        "2026-07-17",
        errors,
        nominee_slugs=set(),
        fetch_missing_nominees=False,
    )

    assert output["generated_at"] == "2026-07-17"
    assert output["markets"] == 1
    assert output["by_slug"]["test-market"]["odds_format"] == "party"
    assert output["by_slug"]["test-market"]["prices"]["CDU"] == 28.0
    assert errors == []


if __name__ == "__main__":
    test_compute_window_changes_uses_reference_price()
    test_live_price_recalculation_math()
    test_build_market_odds_from_snapshot()
    print("ok")
