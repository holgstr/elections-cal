#!/usr/bin/env bash
# Smoke-test commit_and_push.sh against a simulated divergent remote.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/scripts/ci/commit_and_push.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

remote_repo="$TMP/remote.git"
work_a="$TMP/work-a"
work_b="$TMP/work-b"

git init --bare "$remote_repo" >/dev/null
git -C "$remote_repo" symbolic-ref HEAD refs/heads/main
git clone "$remote_repo" "$work_a" >/dev/null
git -C "$work_a" checkout -B main >/dev/null

mkdir -p "$work_a/data"
echo '{"rev":"seed"}' > "$work_a/data/site-rev.json"
echo 'v1' > "$work_a/data/trends.json"
git -C "$work_a" add data/site-rev.json data/trends.json
git -C "$work_a" \
  -c user.name=test -c user.email=test@example.com \
  commit -m "seed" >/dev/null
git -C "$work_a" push -u origin main >/dev/null

git clone "$remote_repo" "$work_b" >/dev/null
git -C "$work_b" checkout main >/dev/null

# Remote moves ahead (simulates a merged PR while the bot was fetching).
echo 'from-main' > "$work_a/data/other.txt"
git -C "$work_a" add data/other.txt
git -C "$work_a" \
  -c user.name=test -c user.email=test@example.com \
  commit -m "main moved" >/dev/null
git -C "$work_a" push origin main >/dev/null

# Stale checkout prepares a trends refresh and must rebase before push.
echo 'v2-bot' > "$work_b/data/trends.json"
(
  cd "$work_b"
  GIT_AUTHOR_NAME=bot GIT_AUTHOR_EMAIL=bot@example.com \
    MAX_ATTEMPTS=4 REMOTE_REF=origin/main \
    bash "$SCRIPT" --bump-site-rev --message "chore: refresh Google Trends race interest" -- \
      data/trends.json
)

# Remote should contain both the intervening commit and the bot refresh.
git -C "$work_a" pull --ff-only origin main >/dev/null
log="$(git -C "$work_a" log --oneline -5)"
echo "$log" | grep -q "refresh Google Trends" || {
  echo "missing trends commit: $log" >&2
  exit 1
}
echo "$log" | grep -q "main moved" || {
  echo "missing intervening commit: $log" >&2
  exit 1
}
grep -q 'v2-bot' "$work_a/data/trends.json"
grep -q 'from-main' "$work_a/data/other.txt"
test -f "$work_a/data/site-rev.json"

echo "OK: commit_and_push rebased over a moved main and pushed."

# --- Second scenario: data_updated.json key merge on rebase ---
TMP2="$(mktemp -d)"
trap 'rm -rf "$TMP" "$TMP2"' EXIT

remote_repo2="$TMP2/remote.git"
work_c="$TMP2/work-c"
work_d="$TMP2/work-d"

git init --bare "$remote_repo2" >/dev/null
git -C "$remote_repo2" symbolic-ref HEAD refs/heads/main
git clone "$remote_repo2" "$work_c" >/dev/null
git -C "$work_c" checkout -B main >/dev/null

mkdir -p "$work_c/data"
echo '{"rev":"seed"}' > "$work_c/data/site-rev.json"
printf '{\n  "odds_generated_at": "2026-07-27T10:00:00Z",\n  "trends_generated_at": "2026-07-27T09:00:00Z"\n}\n' \
  > "$work_c/data/data_updated.json"
echo 'trends-v1' > "$work_c/data/trends.json"
git -C "$work_c" add data/site-rev.json data/data_updated.json data/trends.json
git -C "$work_c" \
  -c user.name=test -c user.email=test@example.com \
  commit -m "seed" >/dev/null
git -C "$work_c" push -u origin main >/dev/null

git clone "$remote_repo2" "$work_d" >/dev/null
git -C "$work_d" checkout main >/dev/null

# Markets bot updates odds timestamp on main while Trends is mid-fetch.
printf '{\n  "odds_generated_at": "2026-07-27T11:00:00Z",\n  "trends_generated_at": "2026-07-27T09:00:00Z"\n}\n' \
  > "$work_c/data/data_updated.json"
git -C "$work_c" add data/data_updated.json
git -C "$work_c" \
  -c user.name=test -c user.email=test@example.com \
  commit -m "chore: refresh Polymarket market prices" >/dev/null
git -C "$work_c" push origin main >/dev/null

# Trends bot updates trends timestamp + payload from a stale checkout.
printf '{\n  "odds_generated_at": "2026-07-27T10:00:00Z",\n  "trends_generated_at": "2026-07-27T11:30:00Z"\n}\n' \
  > "$work_d/data/data_updated.json"
echo 'trends-v2' > "$work_d/data/trends.json"
(
  cd "$work_d"
  GIT_AUTHOR_NAME=bot GIT_AUTHOR_EMAIL=bot@example.com \
    MAX_ATTEMPTS=4 REMOTE_REF=origin/main \
    bash "$SCRIPT" --bump-site-rev --message "chore: refresh Google Trends race interest" -- \
      data/trends.json data/data_updated.json
)

git -C "$work_c" pull --ff-only origin main >/dev/null
grep -q 'trends-v2' "$work_c/data/trends.json"
python3 - "$work_c/data/data_updated.json" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["odds_generated_at"] == "2026-07-27T11:00:00Z", payload
assert payload["trends_generated_at"] == "2026-07-27T11:30:00Z", payload
print("OK: data_updated.json conflict merged both timestamps.")
PY
