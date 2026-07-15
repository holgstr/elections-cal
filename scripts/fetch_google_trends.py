#!/usr/bin/env python3
"""Fetch Google Trends interest-over-time for configured races.

Uses Google Trends' undocumented but stable explore/widgetdata endpoints
via urllib + cookies (stdlib only). Suitable for periodic GitHub Actions
runs. Writes data/trends.json for the Trends tab.

Prefer Google Knowledge Graph *person/topic entities* (mids like
``/m/04g_1z``) when a confident political person match exists. Entities
disambiguate people (e.g. "John Hickenlooper" → United States Senator) and
aggregate related queries about that person.

Lookup policy (per race, all-or-nothing so scales stay comparable):

1. Curated ``mid`` in config wins when present.
2. Otherwise autocomplete resolves ``name`` / ``keyword``; keep the entity
   only if the top hit looks like a political person (office/type hints).
3. If any candidate cannot be resolved confidently, the whole race falls
   back to raw search-term comparison.

Inspect matches manually with:

    python3 scripts/fetch_google_trends.py --suggest "Julie Gonzales"
"""

from __future__ import annotations

import argparse
import http.cookiejar
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "data" / "config" / "trends_races.json"
OUTPUT_PATH = ROOT / "data" / "trends.json"

TRENDS_HOME = "https://trends.google.com/trends/?geo=US"
EXPLORE_API = "https://trends.google.com/trends/api/explore"
MULTILINE_API = "https://trends.google.com/trends/api/widgetdata/multiline"
AUTOCOMPLETE_API = "https://trends.google.com/trends/api/autocomplete/"
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)
REQUEST_DELAY_S = 1.5
MAX_RETRIES = 4
TZ_OFFSET_MINUTES = 360  # US Mountain (MST) as used for CO races
# Autocomplete must look like a political office/person to auto-adopt a mid.
ENTITY_SCORE_THRESHOLD = 10
POLITICAL_TYPE_HINTS = (
    "senator",
    "representative",
    "congressman",
    "congresswoman",
    "congressperson",
    "governor",
    "lieutenant governor",
    "mayor",
    "politician",
    "member of",
    "presidential",
    "vice president",
    "president of the united states",
    "speaker of",
    "assembly",
    "delegate",
    "secretary",
    "attorney general",
    "house of representatives",
    "state senator",
    "state representative",
    "u.s. representative",
    "united states representative",
    "united states senator",
    "member of parliament",
    "prime minister",
    "chancellor",
    "premier",
)


def load_json(path: Path):
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def save_json(path: Path, data: dict | list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


def parse_iso_date(value: str) -> date:
    return date.fromisoformat(value)


def window_bounds(election_date: date, window_days: int) -> tuple[date, date]:
    """Inclusive window ending on election day: (election - days) .. election."""
    end = election_date
    start = election_date - timedelta(days=window_days)
    return start, end


def format_trends_time(start: date, end: date) -> str:
    return f"{start.isoformat()} {end.isoformat()}"


def is_entity_mid(value: str) -> bool:
    """True for Knowledge Graph / Trends topic ids (/m/... or /g/...)."""
    return bool(value) and (value.startswith("/m/") or value.startswith("/g/"))


def display_name_for_row(row: dict) -> str:
    """Human name used for autocomplete and search-term fallback."""
    for key in ("name", "keyword", "topic_title", "label"):
        value = (row.get(key) or "").strip()
        if value and not is_entity_mid(value):
            return value
    mid = (row.get("mid") or "").strip()
    if mid:
        return mid
    raise ValueError("keyword row needs name, keyword, or mid")


def score_topic_for_person(topic: dict, query: str) -> int:
    """Heuristic score for picking a political person entity from autocomplete."""
    title = (topic.get("title") or "").strip()
    topic_type = (topic.get("type") or "").strip()
    title_l = title.lower()
    type_l = topic_type.lower()
    query_l = query.strip().lower()
    score = 0
    if any(hint in type_l for hint in POLITICAL_TYPE_HINTS):
        score += 10
    if title_l == query_l:
        score += 5
    elif query_l and (query_l in title_l or title_l in query_l):
        score += 3
    mid = topic.get("mid") or ""
    if mid.startswith("/m/"):
        score += 1
    if type_l == "topic":
        score -= 2
    return score


def pick_political_entity(
    topics: list[dict], query: str, *, threshold: int = ENTITY_SCORE_THRESHOLD
) -> dict | None:
    """Return best confident political person topic, or None to fall back."""
    if not topics or not query.strip():
        return None
    ranked = sorted(
        ((score_topic_for_person(topic, query), topic) for topic in topics),
        key=lambda item: item[0],
        reverse=True,
    )
    best_score, best = ranked[0]
    if best_score < threshold:
        return None
    if not (best.get("mid") or "").strip():
        return None
    # Ambiguous: two strong political hits close together → don't guess.
    if len(ranked) > 1:
        second_score, second = ranked[1]
        if (
            second_score >= threshold
            and best_score - second_score <= 1
            and (second.get("mid") or "") != (best.get("mid") or "")
        ):
            best_title = (best.get("title") or "").strip().lower()
            second_title = (second.get("title") or "").strip().lower()
            query_l = query.strip().lower()
            if best_title != query_l or second_title == query_l:
                return None
    return {
        "mid": best["mid"],
        "topic_title": best.get("title") or query,
        "topic_type": best.get("type") or "",
        "score": best_score,
        "source": "autocomplete",
    }


class TrendsClient:
    def __init__(self) -> None:
        self._jar = http.cookiejar.CookieJar()
        self._opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self._jar)
        )
        self._warmed = False

    def _headers(self, referer: str | None = None) -> dict[str, str]:
        headers = {
            "User-Agent": USER_AGENT,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
        }
        if referer:
            headers["Referer"] = referer
        return headers

    def _get(self, url: str, *, referer: str | None = None) -> bytes:
        last_error: Exception | None = None
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                request = urllib.request.Request(url, headers=self._headers(referer))
                with self._opener.open(request, timeout=45) as response:
                    return response.read()
            except urllib.error.HTTPError as exc:
                last_error = exc
                # 429 / 5xx: back off; Google Trends is sensitive in CI.
                if exc.code in {429, 500, 502, 503, 504} and attempt < MAX_RETRIES:
                    sleep_s = REQUEST_DELAY_S * (2 ** (attempt - 1))
                    print(
                        f"  retry {attempt}/{MAX_RETRIES} after HTTP {exc.code} "
                        f"(sleep {sleep_s:.1f}s)",
                        file=sys.stderr,
                    )
                    time.sleep(sleep_s)
                    continue
                body = exc.read()[:300] if exc.fp else b""
                raise RuntimeError(
                    f"HTTP {exc.code} for {url}: {body.decode('utf-8', errors='replace')}"
                ) from exc
            except urllib.error.URLError as exc:
                last_error = exc
                if attempt < MAX_RETRIES:
                    sleep_s = REQUEST_DELAY_S * (2 ** (attempt - 1))
                    time.sleep(sleep_s)
                    continue
                raise
        raise RuntimeError(f"Request failed for {url}: {last_error}")

    @staticmethod
    def _strip_xssi(raw: bytes) -> dict:
        text = raw.decode("utf-8").strip()
        if not text:
            raise RuntimeError("Empty Google Trends response")
        if text.startswith("<!"):
            raise RuntimeError("Got HTML instead of JSON from Google Trends")
        # Responses use an XSSI prefix like )]}'\n or )]}',\n before JSON.
        if text.startswith(")]}'"):
            text = text[4:].lstrip(", \n\r\t")
        return json.loads(text)

    def warm(self) -> None:
        if self._warmed:
            return
        self._get(TRENDS_HOME)
        self._warmed = True
        time.sleep(REQUEST_DELAY_S)

    def suggest(self, term: str) -> list[dict]:
        """Return Trends autocomplete topics for a search string.

        Each item has mid, title, type — pick the person/office that matches
        the race and store ``mid`` in trends_races.json.
        """
        self.warm()
        url = (
            AUTOCOMPLETE_API
            + urllib.parse.quote(term)
            + "?"
            + urllib.parse.urlencode({"hl": "en-US"})
        )
        payload = self._strip_xssi(
            self._get(url, referer="https://trends.google.com/trends/explore")
        )
        topics = payload.get("default", {}).get("topics")
        if topics is None and isinstance(payload.get("topics"), list):
            topics = payload["topics"]
        return list(topics or [])

    def interest_over_time(
        self,
        keywords: list[str],
        *,
        geo: str,
        start: date,
        end: date,
    ) -> list[dict]:
        """Return daily [{date, values: {keyword: int|None}}] for the window.

        ``keywords`` may be raw search strings or entity mids (``/m/...``,
        ``/g/...``). Google's explore endpoint promotes mids to ENTITY type.
        """
        if not keywords:
            return []
        if len(keywords) > 5:
            raise ValueError("Google Trends compares at most 5 keywords at once")

        entity_flags = [is_entity_mid(k) for k in keywords]
        if any(entity_flags) and not all(entity_flags):
            print(
                "  warning: mixing entity mids and raw search terms in one "
                "comparison; prefer all entity or all keyword",
                file=sys.stderr,
            )

        self.warm()
        time_range = format_trends_time(start, end)
        explore_req = {
            "comparisonItem": [
                {"keyword": keyword, "geo": geo, "time": time_range}
                for keyword in keywords
            ],
            "category": 0,
            "property": "",
        }
        explore_url = (
            f"{EXPLORE_API}?"
            + urllib.parse.urlencode(
                {
                    "hl": "en-US",
                    "tz": str(TZ_OFFSET_MINUTES),
                    "req": json.dumps(explore_req, separators=(",", ":")),
                }
            )
        )
        explore = self._strip_xssi(
            self._get(explore_url, referer="https://trends.google.com/trends/explore")
        )
        widgets = explore.get("widgets") or []
        timeseries = next((w for w in widgets if w.get("id") == "TIMESERIES"), None)
        if not timeseries or not timeseries.get("token"):
            raise RuntimeError("No TIMESERIES widget/token from Google Trends explore")

        time.sleep(REQUEST_DELAY_S)
        multiline_url = (
            f"{MULTILINE_API}?"
            + urllib.parse.urlencode(
                {
                    "hl": "en-US",
                    "tz": str(TZ_OFFSET_MINUTES),
                    "req": json.dumps(timeseries["request"], separators=(",", ":")),
                    "token": timeseries["token"],
                }
            )
        )
        payload = self._strip_xssi(
            self._get(multiline_url, referer="https://trends.google.com/trends/explore")
        )
        timeline = payload.get("default", {}).get("timelineData") or []
        series: list[dict] = []
        for point in timeline:
            raw_time = point.get("formattedTime") or point.get("formattedAxisTime")
            point_date = _parse_trends_date(raw_time, point.get("time"))
            if point_date is None:
                continue
            values: dict[str, int | None] = {}
            raw_values = point.get("value") or []
            has_data = point.get("hasData") or [True] * len(keywords)
            for idx, keyword in enumerate(keywords):
                if idx >= len(raw_values):
                    values[keyword] = None
                    continue
                if idx < len(has_data) and not has_data[idx]:
                    values[keyword] = 0
                else:
                    values[keyword] = int(raw_values[idx])
            series.append({"date": point_date.isoformat(), "values": values})
        return series


def _parse_trends_date(formatted: str | None, unix_time: str | int | None) -> date | None:
    if unix_time is not None:
        try:
            return datetime.fromtimestamp(int(unix_time), tz=timezone.utc).date()
        except (TypeError, ValueError, OSError, OverflowError):
            pass
    if not formatted:
        return None
    for fmt in ("%b %d, %Y", "%B %d, %Y", "%b %d %Y"):
        try:
            return datetime.strptime(formatted, fmt).date()
        except ValueError:
            continue
    return None


def resolve_candidate_queries(
    client: TrendsClient, keyword_rows: list[dict]
) -> list[dict]:
    """Resolve each config row to a query plan.

    Per-race caller enforces all-or-nothing entity vs search-term mode.
    """
    resolved: list[dict] = []
    for idx, row in enumerate(keyword_rows):
        if idx:
            time.sleep(REQUEST_DELAY_S)
        name = display_name_for_row(row)
        label = row.get("label") or name
        curated_mid = (row.get("mid") or "").strip()

        plan = {
            "row": row,
            "name": name,
            "label": label,
            "query": name,
            "series_key": name,
            "query_mode": "search_term",
            "resolve_source": "search_term",
            "mid": None,
            "topic_title": row.get("topic_title"),
            "topic_type": row.get("topic_type"),
            "resolve_note": None,
        }

        if curated_mid and is_entity_mid(curated_mid):
            plan.update(
                {
                    "query": curated_mid,
                    "series_key": curated_mid,
                    "query_mode": "entity",
                    "resolve_source": "config",
                    "mid": curated_mid,
                    "topic_title": row.get("topic_title") or name,
                    "topic_type": row.get("topic_type") or "",
                }
            )
            resolved.append(plan)
            continue

        # Already configured as a mid string in keyword/name — treat as curated.
        if is_entity_mid(name):
            plan.update(
                {
                    "query": name,
                    "series_key": name,
                    "query_mode": "entity",
                    "resolve_source": "config",
                    "mid": name,
                }
            )
            resolved.append(plan)
            continue

        try:
            topics = client.suggest(name)
        except Exception as exc:  # noqa: BLE001
            plan["resolve_note"] = f"autocomplete failed: {exc}"
            resolved.append(plan)
            continue

        picked = pick_political_entity(topics, name)
        if picked:
            plan.update(
                {
                    "query": picked["mid"],
                    "series_key": picked["mid"],
                    "query_mode": "entity",
                    "resolve_source": "autocomplete",
                    "mid": picked["mid"],
                    "topic_title": picked["topic_title"],
                    "topic_type": picked["topic_type"],
                    "resolve_note": f"score={picked['score']}",
                }
            )
        else:
            top = topics[0] if topics else None
            if top:
                plan["resolve_note"] = (
                    f"no confident political entity "
                    f"(top={top.get('title')!r} / {top.get('type')!r})"
                )
            else:
                plan["resolve_note"] = "no autocomplete topics"
        resolved.append(plan)
    return resolved


def apply_race_query_mode(plans: list[dict]) -> list[dict]:
    """Force all-entity or all-search-term within a race for comparable scales."""
    entity_ok = all(plan["query_mode"] == "entity" for plan in plans)
    if entity_ok:
        return plans

    fell_back = []
    for plan in plans:
        if plan["query_mode"] == "entity":
            note = plan.get("resolve_note") or plan["resolve_source"]
            print(
                f"  fallback {plan['label']}: had entity {plan['mid']} "
                f"({note}) but race not unanimous → search term "
                f"{plan['name']!r}",
                file=sys.stderr,
            )
        new_plan = dict(plan)
        new_plan["query"] = plan["name"]
        new_plan["series_key"] = plan["name"]
        new_plan["query_mode"] = "search_term"
        if plan["resolve_source"] != "search_term":
            new_plan["resolve_source"] = "race_fallback"
        # Keep mid/topic_* as metadata about what we *would* have used.
        fell_back.append(new_plan)
    return fell_back


def fetch_race(client: TrendsClient, race: dict) -> dict:
    election_date = parse_iso_date(race["election_date"])
    window_days = int(race.get("window_days", 30))
    start, end = window_bounds(election_date, window_days)
    keyword_rows = race["keywords"]
    geo = race.get("geo") or ""

    print(f"Resolving topics for {race['id']}…")
    plans = apply_race_query_mode(resolve_candidate_queries(client, keyword_rows))
    queries = [plan["query"] for plan in plans]
    series_keys = [plan["series_key"] for plan in plans]

    display = []
    for plan in plans:
        extras = []
        if plan.get("topic_type"):
            extras.append(plan["topic_type"])
        extras.append(plan["resolve_source"])
        display.append(f"{plan['label']}[{plan['query_mode']}:{'/'.join(extras)}]")
        if plan.get("resolve_note") and plan["query_mode"] == "search_term":
            print(f"  note {plan['label']}: {plan['resolve_note']}", file=sys.stderr)

    print(
        f"Fetching {race['id']}: {', '.join(display)} "
        f"geo={geo or 'WORLD'} {start}→{end}"
    )
    series = client.interest_over_time(queries, geo=geo, start=start, end=end)
    if series_keys != queries:
        for point in series:
            remapped: dict[str, int | None] = {}
            for query, key in zip(queries, series_keys):
                remapped[key] = point["values"].get(query)
            point["values"] = remapped
    print(f"  {len(series)} daily points")

    candidates = []
    for plan in plans:
        candidate = {
            "keyword": plan["series_key"],
            "label": plan["label"],
            "query_mode": plan["query_mode"],
            "resolve_source": plan["resolve_source"],
            "name": plan["name"],
        }
        if plan.get("mid"):
            candidate["mid"] = plan["mid"]
        if plan.get("topic_title"):
            candidate["topic_title"] = plan["topic_title"]
        if plan.get("topic_type"):
            candidate["topic_type"] = plan["topic_type"]
        if plan.get("resolve_note"):
            candidate["resolve_note"] = plan["resolve_note"]
        candidates.append(candidate)

    return {
        "id": race["id"],
        "title": race["title"],
        "election_date": election_date.isoformat(),
        "country_code": race.get("country_code"),
        "state_code": race.get("state_code"),
        "geo": geo,
        "window_days": window_days,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "candidates": candidates,
        "series": series,
    }


def run_suggest(terms: list[str]) -> int:
    client = TrendsClient()
    for idx, term in enumerate(terms):
        if idx:
            time.sleep(REQUEST_DELAY_S)
        print(f"Suggestions for {term!r}:")
        try:
            topics = client.suggest(term)
        except Exception as exc:  # noqa: BLE001
            print(f"  ERROR: {exc}", file=sys.stderr)
            return 1
        if not topics:
            print("  (none)")
            continue
        picked = pick_political_entity(topics, term)
        for topic in topics:
            mid = topic.get("mid", "")
            title = topic.get("title", "")
            topic_type = topic.get("type", "")
            score = score_topic_for_person(topic, term)
            marker = "  <-- auto" if picked and mid == picked["mid"] else ""
            print(f"  [{score:3d}] {mid}\t{title}\t({topic_type}){marker}")
        if not picked:
            print("  (no confident political auto-pick; would use search term)")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--suggest",
        metavar="TERM",
        action="append",
        default=[],
        help="Print Trends autocomplete topics (person/entity mids) and exit. "
        "Repeatable.",
    )
    args = parser.parse_args(argv)

    if args.suggest:
        return run_suggest(args.suggest)

    races_config = load_json(CONFIG_PATH)
    if not isinstance(races_config, list) or not races_config:
        print(f"No races configured in {CONFIG_PATH}", file=sys.stderr)
        return 1

    client = TrendsClient()
    races: list[dict] = []
    errors: list[str] = []

    for idx, race in enumerate(races_config):
        if idx:
            time.sleep(REQUEST_DELAY_S)
        try:
            races.append(fetch_race(client, race))
        except Exception as exc:  # noqa: BLE001 — keep other races if one fails
            message = f"{race.get('id', '?')}: {exc}"
            print(f"ERROR {message}", file=sys.stderr)
            errors.append(message)

    if not races:
        print("No Trends data fetched.", file=sys.stderr)
        return 1

    payload = {
        "generated_at": datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
        "source": "google_trends",
        "races": races,
    }
    if errors:
        payload["errors"] = errors

    save_json(OUTPUT_PATH, payload)
    print(f"Wrote {OUTPUT_PATH} ({len(races)} race(s))")
    return 0 if not errors else 0  # still succeed if at least one race landed


if __name__ == "__main__":
    raise SystemExit(main())
