#!/usr/bin/env python3
"""Build elections.json from Wikidata + curated US/German state data."""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "data" / "config" / "countries.json"
CURATED_DIR = ROOT / "data" / "curated"
OUTPUT_PATH = ROOT / "data" / "elections.json"
META_PATH = ROOT / "data" / "meta.json"

WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql"
USER_AGENT = "ElectionsCalBot/1.0 (https://github.com/holgstr/elections-cal)"

EXCLUDE_LABEL_RE = re.compile(
    r"\b("
    r"primary|runoff|referendum|municipal|local|by-?election|"
    r"special election|recall|ballot measure|constitutional|"
    r"european parliament|eu election|regional election|"
    r"mayoral|gubernatorial|landtag|state election|"
    r"house of representatives election|abgeordnetenhaus|bürgerschaft"
    r")\b",
    re.I,
)

PRESIDENTIAL_RE = re.compile(r"\bpresidential\b", re.I)
LEGISLATIVE_RE = re.compile(
    r"\b("
    r"parliamentary|legislative|general election|national assembly|"
    r"riksdag|bundestag|chamber|congress|knesset|folketing|"
    r"sejm|dáil|storting|riigikogu|eduskunta|"
    r"house of commons|house of representatives|senate election|"
    r"national council|federal assembly|congressional"
    r")\b",
    re.I,
)


def load_json(path: Path):
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def save_json(path: Path, data) -> None:
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


def date_window(today: date | None = None) -> tuple[date, date]:
    today = today or date.today()
    end = today + timedelta(days=365)
    return today, end


def precision_to_mode(precision: int) -> str:
    return "exact" if precision >= 11 else "estimated"


def normalize_title(label: str) -> str:
    title = re.sub(r"^\d{4}\s+", "", label).strip()
    title = title.replace(" general election", " General Election")
    if title and title[0].islower():
        title = title[0].upper() + title[1:]
    return title


def infer_type(label: str) -> str:
    if PRESIDENTIAL_RE.search(label):
        return "presidential"
    if LEGISLATIVE_RE.search(label):
        return "legislative"
    return "general"


def election_key(item: dict) -> tuple:
    return (
        item["date"],
        item.get("country_code", ""),
        item.get("state_code") or "",
        item.get("title", "").lower(),
        item.get("level", ""),
    )


def should_include_wikidata_item(
    label: str,
    country_code: str,
    country_cfg: dict,
    state_code: str | None,
) -> bool:
    if country_code in {"US", "DE"}:
        return False

    if state_code:
        return False

    if EXCLUDE_LABEL_RE.search(label):
        return False

    is_presidential = bool(PRESIDENTIAL_RE.search(label))
    is_legislative = bool(LEGISLATIVE_RE.search(label))

    if is_presidential and not country_cfg.get("popular_president", False):
        return False

    if not is_presidential and not is_legislative:
        return False

    return True


def fetch_wikidata_batch(
    country_codes: list[str],
    start: date,
    end: date,
    countries: dict,
) -> list[dict]:
    codes = " ".join(f'"{code}"' for code in country_codes)
    query = f"""
SELECT ?election ?electionLabel ?date ?precision ?countryCode ?countryLabel WHERE {{
  VALUES ?countryCode {{ {codes} }}
  ?country wdt:P297 ?countryCode.
  ?election wdt:P31/wdt:P279* wd:Q40231;
           p:P585 ?dateNode;
           wdt:P17 ?country.
  ?dateNode psv:P585 ?dateValue.
  ?dateValue wikibase:timeValue ?date.
  ?dateValue wikibase:timePrecision ?precision.
  FILTER(?date >= "{start.isoformat()}T00:00:00Z"^^xsd:dateTime &&
         ?date <= "{end.isoformat()}T23:59:59Z"^^xsd:dateTime)
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}}
ORDER BY ?date
"""

    request = urllib.request.Request(
        WIKIDATA_ENDPOINT,
        data=urllib.parse.urlencode({"query": query}).encode("utf-8"),
        headers={
            "Accept": "application/sparql-results+json",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=45) as response:
        payload = json.load(response)

    results: list[dict] = []
    for row in payload.get("results", {}).get("bindings", []):
        country_code = row["countryCode"]["value"]
        country_cfg = countries.get(country_code)
        if not country_cfg:
            continue

        label = row["electionLabel"]["value"]
        if not should_include_wikidata_item(label, country_code, country_cfg, None):
            continue

        precision = int(row["precision"]["value"])
        election_date = row["date"]["value"][:10]

        results.append(
            {
                "date": election_date,
                "date_precision": precision_to_mode(precision),
                "country": country_cfg["name"],
                "country_code": country_code,
                "state": None,
                "state_code": None,
                "title": normalize_title(label),
                "type": infer_type(label),
                "level": "federal",
                "groups": country_cfg["groups"],
                "offices": infer_offices(label),
                "source": "wikidata",
            }
        )

    return results


def fetch_wikidata(
    country_codes: list[str],
    start: date,
    end: date,
    countries: dict,
) -> list[dict]:
    batch_size = 4
    results: list[dict] = []
    for index in range(0, len(country_codes), batch_size):
        batch = country_codes[index : index + batch_size]
        try:
            results.extend(fetch_wikidata_batch(batch, start, end, countries))
        except Exception as exc:  # noqa: BLE001
            print(f"Wikidata batch {batch[0]}… failed: {exc}", file=sys.stderr)
    return results


def infer_offices(label: str) -> list[str]:
    offices: list[str] = []
    lower = label.lower()
    if "presidential" in lower:
        offices.append("President")
    if any(
        token in lower
        for token in (
            "parliament",
            "legislative",
            "riksdag",
            "bundestag",
            "knesset",
            "congress",
            "assembly",
            "house of commons",
            "chamber",
        )
    ):
        offices.append("Parliament")
    return offices or ["Parliament"]


def load_curated(start: date, end: date) -> list[dict]:
    curated: list[dict] = []
    for path in sorted(CURATED_DIR.glob("*.json")):
        for item in load_json(path):
            item = dict(item)
            item.setdefault("source", "curated")
            election_date = date.fromisoformat(item["date"])
            if start <= election_date <= end:
                curated.append(item)
    return curated


def merge_elections(*sources: list[dict]) -> list[dict]:
    merged: dict[tuple, dict] = {}
    for source in sources:
        for item in source:
            key = election_key(item)
            if key not in merged or item.get("source") == "curated":
                merged[key] = item
    return sorted(merged.values(), key=lambda e: (e["date"], e.get("country", ""), e.get("state") or ""))


def build(today: date | None = None) -> dict:
    start, end = date_window(today)
    countries = load_json(CONFIG_PATH)
    country_codes = sorted(countries.keys())

    try:
        if os.environ.get("SKIP_WIKIDATA") == "1":
            wikidata = []
        else:
            wikidata = fetch_wikidata(country_codes, start, end, countries)
    except Exception as exc:  # noqa: BLE001 - keep curated data if Wikidata is down
        print(f"Wikidata fetch failed, using curated data only: {exc}", file=sys.stderr)
        wikidata = []

    curated = load_curated(start, end)
    elections = merge_elections(wikidata, curated)

    meta = {
        "generated_at": date.today().isoformat(),
        "window_start": start.isoformat(),
        "window_end": end.isoformat(),
        "count": len(elections),
        "sources": {
            "wikidata": len(wikidata),
            "curated": len(curated),
        },
    }

    return {"meta": meta, "elections": elections}


def main() -> int:
    try:
        result = build()
    except Exception as exc:  # noqa: BLE001 - surface build failures in CI
        print(f"Build failed: {exc}", file=sys.stderr)
        return 1

    save_json(OUTPUT_PATH, result["elections"])
    save_json(META_PATH, result["meta"])

    print(
        f"Wrote {result['meta']['count']} elections "
        f"({result['meta']['window_start']} → {result['meta']['window_end']})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
