#!/usr/bin/env python3
"""Fetch Google Trends interest-over-time for configured races.

Uses Google Trends' undocumented but stable explore/widgetdata endpoints
via urllib + cookies (stdlib only). Suitable for periodic GitHub Actions
runs. Writes data/trends.json for the Trends tab.
"""

from __future__ import annotations

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
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)
REQUEST_DELAY_S = 1.5
MAX_RETRIES = 4
TZ_OFFSET_MINUTES = 360  # US Mountain (MST) as used for CO races


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

    def interest_over_time(
        self,
        keywords: list[str],
        *,
        geo: str,
        start: date,
        end: date,
    ) -> list[dict]:
        """Return daily [{date, values: {keyword: int|None}}] for the window."""
        if not keywords:
            return []
        if len(keywords) > 5:
            raise ValueError("Google Trends compares at most 5 keywords at once")

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


def fetch_race(client: TrendsClient, race: dict) -> dict:
    election_date = parse_iso_date(race["election_date"])
    window_days = int(race.get("window_days", 30))
    start, end = window_bounds(election_date, window_days)
    keyword_rows = race["keywords"]
    keywords = [row["keyword"] for row in keyword_rows]
    geo = race.get("geo") or ""

    print(
        f"Fetching {race['id']}: {', '.join(keywords)} "
        f"geo={geo or 'WORLD'} {start}→{end}"
    )
    series = client.interest_over_time(keywords, geo=geo, start=start, end=end)
    print(f"  {len(series)} daily points")

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
        "candidates": [
            {
                "keyword": row["keyword"],
                "label": row.get("label") or row["keyword"],
            }
            for row in keyword_rows
        ],
        "series": series,
    }


def main() -> int:
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
