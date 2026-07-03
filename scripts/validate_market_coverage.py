#!/usr/bin/env python3
"""Validate that calendar elections within market windows have Polymarket slugs configured.

Catches gaps like a top-four primary office missing its _slug (e.g. Alaska Senate) or
companion national markets (e.g. Sweden Riksdag PM + largest party) not being linked.
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Reuse window logic from the generate scripts so validation stays in sync.
sys.path.insert(0, str(ROOT / "scripts"))

from generate_national_election_info import (  # noqa: E402
    card_labels,
    federal_elections_in_window,
)
from generate_us_primary_info import (  # noqa: E402
    COMBINED_BALLOT_FORMATS,
    primaries_in_window,
)

PRIMARY_MARKETS_PATH = ROOT / "data" / "config" / "us_primary_markets.json"
NATIONAL_MARKETS_PATH = ROOT / "data" / "config" / "national_election_markets.json"


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def office_has_primary_market(
    state_code: str,
    office: str,
    meta: dict,
) -> tuple[bool, str]:
    """Return (covered, reason) for a state/office primary market config."""
    type_cfg = meta.get("primary_types", {}).get(state_code)
    if not type_cfg:
        return False, "missing primary_types entry"

    slugs = meta.get("polymarket_slugs", {}).get(state_code, {}).get(office, {})
    primary_format = type_cfg.get("format", "party")

    if primary_format in COMBINED_BALLOT_FORMATS:
        if slugs.get("_slug"):
            return True, ""
        return False, f"top-two/top-four primary requires _slug for {state_code} {office}"

    party_slugs = [party for party in ("Republican", "Democratic") if party in slugs]
    if party_slugs:
        return True, ""
    return False, f"no Polymarket slug configured for {state_code} {office} primary"


def validate_us_primaries(meta: dict, today: date | None = None) -> list[str]:
    errors: list[str] = []
    needed = primaries_in_window(today)
    primary_types = meta.get("primary_types", {})

    for state_code, office in sorted(needed):
        type_cfg = primary_types.get(state_code)
        if not type_cfg:
            continue

        primary_format = type_cfg.get("format", "party")
        if primary_format not in COMBINED_BALLOT_FORMATS:
            continue

        covered, reason = office_has_primary_market(state_code, office, meta)
        if not covered:
            errors.append(f"US primary market gap: {reason}")

    return errors


def contest_market_labels(contest_cfg: dict) -> set[str]:
    labels: set[str] = set()
    for market in contest_cfg.get("markets") or []:
        label = (market.get("label") or "").strip()
        if label:
            labels.add(label)
    legacy_label = (contest_cfg.get("label") or "").strip()
    if legacy_label:
        labels.add(legacy_label)
    return labels


def validate_national_elections(meta: dict, today: date | None = None) -> list[str]:
    errors: list[str] = []
    contests = meta.get("contests", {})
    companion_rules = meta.get("companion_markets", {})
    elections = federal_elections_in_window(today)

    seen_contests: set[tuple[str, str]] = set()
    for election in elections:
        country_code = election["country_code"]
        if country_code not in contests:
            continue

        for label in card_labels(election):
            if label not in contests[country_code]:
                continue
            seen_contests.add((country_code, label))

    for key, rule in companion_rules.items():
        country_code, contest_label = key.split(":", 1)
        if (country_code, contest_label) not in seen_contests:
            continue
        contest_cfg = contests.get(country_code, {}).get(contest_label, {})
        configured = contest_market_labels(contest_cfg)
        for required in rule.get("required_labels") or []:
            if required not in configured:
                errors.append(
                    f"Companion market gap: {country_code} {contest_label!r} "
                    f"missing required market label {required!r} "
                    f"(configured: {sorted(configured) or 'none'})"
                )

    return errors


def main() -> int:
    primary_meta = load_json(PRIMARY_MARKETS_PATH)
    national_meta = load_json(NATIONAL_MARKETS_PATH)

    errors = validate_us_primaries(primary_meta)
    errors.extend(validate_national_elections(national_meta))

    if errors:
        for message in errors:
            print(f"Market coverage error: {message}", file=sys.stderr)
        print(f"{len(errors)} market coverage error(s)", file=sys.stderr)
        return 1

    print("Market coverage validation passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
