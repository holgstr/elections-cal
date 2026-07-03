"""Shared helpers for national election market config (kinds, labels, companions)."""

from __future__ import annotations


def market_kinds(meta: dict) -> dict[str, dict]:
    return meta.get("market_kinds", {})


def coverage_rules(meta: dict) -> dict:
    return meta.get("coverage_rules", {})


def resolve_market(market: dict, kinds: dict[str, dict]) -> dict:
    """Merge kind defaults with per-market overrides."""
    kind_key = (market.get("kind") or "").strip()
    kind_cfg = kinds.get(kind_key, {}) if kind_key else {}

    resolved = {
        "polymarket_slug": market.get("polymarket_slug"),
        "label": market.get("label") or kind_cfg.get("label"),
        "odds_format": market.get("odds_format") or kind_cfg.get("odds_format"),
    }
    if kind_key:
        resolved["kind"] = kind_key
    return resolved


def resolve_contest_markets(contest_cfg: dict, meta: dict) -> list[dict]:
    kinds = market_kinds(meta)
    return [resolve_market(market, kinds) for market in contest_cfg.get("markets") or []]


def companion_kinds_for_contest(contest_cfg: dict, meta: dict) -> list[str]:
    explicit = contest_cfg.get("companion_kinds")
    if explicit is not None:
        return list(explicit)
    return []


def configured_market_kinds(contest_cfg: dict, meta: dict) -> set[str]:
    return {
        market["kind"]
        for market in resolve_contest_markets(contest_cfg, meta)
        if market.get("kind")
    }


def contest_market_labels(contest_cfg: dict, meta: dict) -> set[str]:
    labels: set[str] = set()
    for market in resolve_contest_markets(contest_cfg, meta):
        label = (market.get("label") or "").strip()
        if label:
            labels.add(label)
    legacy_label = (contest_cfg.get("label") or "").strip()
    if legacy_label:
        labels.add(legacy_label)
    return labels
