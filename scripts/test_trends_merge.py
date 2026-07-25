#!/usr/bin/env python3
"""Tests for Trends fetch merge / preserve-on-failure behavior."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fetch_google_trends import (  # noqa: E402
    is_watchlist_race,
    merge_trends_races,
    select_races_to_fetch,
)


def _race(race_id: str, *, tag: str, stale: dict | None = None) -> dict:
    out = {"id": race_id, "title": f"{race_id}:{tag}"}
    if stale is not None:
        out["stale"] = stale
    return out


def test_full_refresh_preserves_failed_prior_races() -> None:
    prior = [_race("a", tag="old"), _race("b", tag="old"), _race("c", tag="old")]
    fetched = [_race("a", tag="new"), _race("c", tag="new")]
    merged, preserved = merge_trends_races(
        prior_races=prior,
        fetched_races=fetched,
        failed_ids={"b"},
        requested_ids=["a", "b", "c"],
        partial_update=False,
        prior_generated_at="2026-07-24T20:45:22Z",
    )
    assert [r["id"] for r in merged] == ["a", "b", "c"]
    assert merged[0]["title"] == "a:new"
    assert "stale" not in merged[0]
    assert merged[1]["title"] == "b:old"
    assert merged[1]["stale"] == {
        "reason": "fetch_failed",
        "data_as_of": "2026-07-24T20:45:22Z",
    }
    assert merged[2]["title"] == "c:new"
    assert "stale" not in merged[2]
    assert preserved == ["b"]


def test_full_refresh_keeps_earlier_stale_timestamp() -> None:
    prior = [
        _race(
            "b",
            tag="old",
            stale={"reason": "fetch_failed", "data_as_of": "2026-07-20T12:00:00Z"},
        )
    ]
    merged, preserved = merge_trends_races(
        prior_races=prior,
        fetched_races=[],
        failed_ids={"b"},
        requested_ids=["b"],
        partial_update=False,
        prior_generated_at="2026-07-24T20:45:22Z",
    )
    assert preserved == ["b"]
    assert merged[0]["stale"]["data_as_of"] == "2026-07-20T12:00:00Z"


def test_full_refresh_drops_unconfigured_prior_races() -> None:
    prior = [_race("gone", tag="old"), _race("keep", tag="old")]
    fetched = [_race("keep", tag="new")]
    merged, preserved = merge_trends_races(
        prior_races=prior,
        fetched_races=fetched,
        failed_ids=set(),
        requested_ids=["keep"],
        partial_update=False,
    )
    assert [r["id"] for r in merged] == ["keep"]
    assert preserved == []


def test_full_refresh_omits_failed_race_without_prior() -> None:
    merged, preserved = merge_trends_races(
        prior_races=[],
        fetched_races=[_race("ok", tag="new")],
        failed_ids={"missing"},
        requested_ids=["ok", "missing"],
        partial_update=False,
    )
    assert [r["id"] for r in merged] == ["ok"]
    assert preserved == []


def test_partial_update_overlays_and_keeps_others() -> None:
    prior = [_race("a", tag="old"), _race("b", tag="old"), _race("c", tag="old")]
    fetched = [_race("b", tag="new"), _race("d", tag="new")]
    merged, preserved = merge_trends_races(
        prior_races=prior,
        fetched_races=fetched,
        failed_ids={"a"},
        requested_ids=["a", "b", "d"],
        partial_update=True,
        prior_generated_at="2026-07-24T20:45:22Z",
    )
    assert [r["id"] for r in merged] == ["a", "b", "c", "d"]
    assert merged[0]["title"] == "a:old"
    assert merged[0]["stale"]["data_as_of"] == "2026-07-24T20:45:22Z"
    assert merged[1]["title"] == "b:new"
    assert "stale" not in merged[1]
    assert "stale" not in merged[2]  # unrequested: left as-is
    assert merged[3]["title"] == "d:new"
    assert preserved == ["a"]


def test_fresh_fetch_clears_prior_stale_marker() -> None:
    prior = [
        _race(
            "a",
            tag="old",
            stale={"reason": "fetch_failed", "data_as_of": "2026-07-20T12:00:00Z"},
        )
    ]
    fetched = [_race("a", tag="new")]
    merged, preserved = merge_trends_races(
        prior_races=prior,
        fetched_races=fetched,
        failed_ids=set(),
        requested_ids=["a"],
        partial_update=False,
        prior_generated_at="2026-07-24T20:45:22Z",
    )
    assert preserved == []
    assert "stale" not in merged[0]


def test_watchlist_only_partial_update_keeps_historical() -> None:
    """Scheduled runs fetch watchlist races but must not drop historical series."""
    prior = [
        _race("hist-a", tag="old"),
        _race("current", tag="old"),
        _race("hist-b", tag="old"),
    ]
    fetched = [_race("current", tag="new")]
    merged, preserved = merge_trends_races(
        prior_races=prior,
        fetched_races=fetched,
        failed_ids=set(),
        requested_ids=["current"],
        partial_update=True,
        prior_generated_at="2026-07-24T20:45:22Z",
    )
    assert [r["id"] for r in merged] == ["hist-a", "current", "hist-b"]
    assert merged[0]["title"] == "hist-a:old"
    assert "stale" not in merged[0]
    assert merged[1]["title"] == "current:new"
    assert "stale" not in merged[1]
    assert merged[2]["title"] == "hist-b:old"
    assert preserved == []


def test_select_races_to_fetch_default_is_watchlist_only() -> None:
    config = [
        {"id": "hist", "title": "Old"},
        {"id": "cur", "title": "Now", "watchlist": True},
        {"id": "also", "title": "Also", "watchlist": True},
    ]
    assert [r["id"] for r in select_races_to_fetch(config)] == ["cur", "also"]
    assert [r["id"] for r in select_races_to_fetch(config, include_historical=True)] == [
        "hist",
        "cur",
        "also",
    ]
    assert [
        r["id"] for r in select_races_to_fetch(config, only_ids={"hist", "also"})
    ] == ["hist", "also"]
    assert is_watchlist_race(config[1])
    assert not is_watchlist_race(config[0])


def main() -> int:
    test_full_refresh_preserves_failed_prior_races()
    test_full_refresh_keeps_earlier_stale_timestamp()
    test_full_refresh_drops_unconfigured_prior_races()
    test_full_refresh_omits_failed_race_without_prior()
    test_partial_update_overlays_and_keeps_others()
    test_fresh_fetch_clears_prior_stale_marker()
    test_watchlist_only_partial_update_keeps_historical()
    test_select_races_to_fetch_default_is_watchlist_only()
    print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
