#!/usr/bin/env python3
"""Checks for US election winner-system note resolution."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from us_election_winner_systems import (  # noqa: E402
    general_governor_winner_note,
    general_senate_winner_note,
    load_winner_systems,
    primary_winner_note,
)


def test_primary_party_fptp_default() -> None:
    systems = load_winner_systems()
    assert primary_winner_note(systems, "NY", "Governor") == "Winner: FPTP (most votes wins)."


def test_primary_majority_runoff_state() -> None:
    systems = load_winner_systems()
    note = primary_winner_note(systems, "GA", "Senate")
    assert "50%+1" in note
    assert "runoff" in note


def test_primary_top_two_advance() -> None:
    systems = load_winner_systems()
    note = primary_winner_note(systems, "CA", "Governor", "top-two")
    assert "FPTP" in note
    assert "top two" in note.lower()


def test_primary_top_four_advance() -> None:
    systems = load_winner_systems()
    note = primary_winner_note(systems, "AK", "Senate", "top-four")
    assert "RCV" in note
    assert "top four" in note.lower()


def test_general_senate_rcv_only_in_maine() -> None:
    systems = load_winner_systems()
    assert "RCV" in general_senate_winner_note(systems, "ME")
    assert "RCV" not in general_governor_winner_note(systems, "ME")


def test_general_vermont_governor_majority() -> None:
    systems = load_winner_systems()
    note = general_governor_winner_note(systems, "VT")
    assert "50%+1" in note
    assert "legislature" in note


def test_general_senate_matches_governor_in_georgia() -> None:
    systems = load_winner_systems()
    gov = general_governor_winner_note(systems, "GA")
    sen = general_senate_winner_note(systems, "GA")
    assert gov == sen
    assert "runoff" in gov


def main() -> None:
    test_primary_party_fptp_default()
    test_primary_majority_runoff_state()
    test_primary_top_two_advance()
    test_primary_top_four_advance()
    test_general_senate_rcv_only_in_maine()
    test_general_vermont_governor_majority()
    test_general_senate_matches_governor_in_georgia()
    print("All winner-system checks passed.")


if __name__ == "__main__":
    main()
