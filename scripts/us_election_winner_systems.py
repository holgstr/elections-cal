#!/usr/bin/env python3
"""Resolve winner-determination notes for US state election popovers."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SYSTEMS_PATH = ROOT / "data" / "config" / "us_election_winner_systems.json"

COMBINED_BALLOT_FORMATS = frozenset({"top-two", "top-four"})
SD_MAJORITY_OFFICES = frozenset({"Governor", "Senate"})


def load_winner_systems(path: Path = SYSTEMS_PATH) -> dict:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def _resolve_key(mapping: dict, state_code: str) -> str:
    return mapping.get(state_code, mapping.get("default", "fptp"))


def _note(systems: dict, key: str) -> str:
    notes = systems.get("winner_notes", {})
    return notes.get(key, notes.get("fptp", ""))


def primary_winner_key(
    systems: dict,
    state_code: str,
    office: str,
    primary_format: str = "party",
) -> str:
    if primary_format == "top-two":
        return "top_two_advance"
    if primary_format == "top-four":
        return "top_four_advance"

    key = _resolve_key(systems.get("primary_party", {}), state_code)
    if key == "majority_35_runoff" and office not in SD_MAJORITY_OFFICES:
        return "fptp"
    return key


def primary_winner_note(
    systems: dict,
    state_code: str,
    office: str,
    primary_format: str = "party",
) -> str:
    return _note(systems, primary_winner_key(systems, state_code, office, primary_format))


def primary_runoff_winner_note(systems: dict) -> str:
    key = _resolve_key(systems.get("primary_runoff", {}), "default")
    return _note(systems, key)


def general_governor_winner_note(systems: dict, state_code: str) -> str:
    key = _resolve_key(systems.get("general_governor", {}), state_code)
    return _note(systems, key)


def general_senate_winner_note(systems: dict, state_code: str) -> str:
    key = _resolve_key(systems.get("general_senate", {}), state_code)
    return _note(systems, key)
