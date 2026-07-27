#!/usr/bin/env bash
# Commit listed paths (if changed) and push with rebase retries.
# Handles the common Actions failure mode where main moved during a long fetch.
#
# Usage:
#   scripts/ci/commit_and_push.sh [--bump-site-rev] --message <msg> -- <path> [path...]
#
# --bump-site-rev writes data/site-rev.json pointing at the data commit SHA,
# then commits it separately (same pattern the workflows used inline).
#
# When GITHUB_OUTPUT is set (Actions), writes pushed=true|false for follow-up steps.
set -euo pipefail

usage() {
  echo "Usage: $0 [--bump-site-rev] --message <msg> -- <path> [path...]" >&2
  exit 2
}

emit_output() {
  local key="$1" value="$2"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "${key}=${value}" >> "$GITHUB_OUTPUT"
  fi
}

BUMP_SITE_REV=0
MESSAGE=""
PATHS=()
MAX_ATTEMPTS="${MAX_ATTEMPTS:-8}"
REMOTE_REF="${REMOTE_REF:-origin/main}"
SITE_REV_MSG="chore: bump site revision for cache busting"
DATA_UPDATED_PATH="data/data_updated.json"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bump-site-rev)
      BUMP_SITE_REV=1
      shift
      ;;
    --message)
      MESSAGE="${2:-}"
      shift 2
      ;;
    --)
      shift
      PATHS=("$@")
      break
      ;;
    -h|--help)
      usage
      ;;
    *)
      usage
      ;;
  esac
done

if [[ -z "$MESSAGE" || ${#PATHS[@]} -eq 0 ]]; then
  usage
fi

git config user.name "${GIT_AUTHOR_NAME:-github-actions[bot]}"
git config user.email "${GIT_AUTHOR_EMAIL:-github-actions[bot]@users.noreply.github.com}"

branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" == "HEAD" ]]; then
  echo "Refusing to commit on detached HEAD." >&2
  exit 1
fi

# Stage first so new untracked files (e.g. sidecars) count as changes.
git add -- "${PATHS[@]}"
if git diff --cached --quiet -- "${PATHS[@]}"; then
  echo "No changes."
  emit_output pushed false
  exit 0
fi

git commit -m "$MESSAGE"

write_site_rev_commit() {
  local rev
  rev="$(git rev-parse --short HEAD)"
  printf '{\n  "rev": "%s"\n}\n' "$rev" > data/site-rev.json
  git add data/site-rev.json
  if git diff --cached --quiet -- data/site-rev.json; then
    return 0
  fi
  git commit -m "$SITE_REV_MSG"
}

drop_trailing_site_rev_commit() {
  if [[ "$(git log -1 --pretty=%s)" == "$SITE_REV_MSG" ]]; then
    git reset --hard HEAD~1
  fi
}

# Merge data/data_updated.json when Trends and market bots both touch it.
# For *_at timestamps, keep the newest value from either side.
resolve_data_updated_conflict() {
  if [[ ! -f "$DATA_UPDATED_PATH" ]]; then
    return 1
  fi
  if ! git ls-files -u -- "$DATA_UPDATED_PATH" | grep -q .; then
    return 1
  fi
  python3 - "$DATA_UPDATED_PATH" <<'PY'
import json
import subprocess
import sys

path = sys.argv[1]

def stage_json(stage: int):
    raw = subprocess.check_output(
        ["git", "show", f":{stage}:{path}"],
        stderr=subprocess.DEVNULL,
    )
    return json.loads(raw.decode("utf-8"))

# During rebase: stage 2 = onto (upstream), stage 3 = commit being replayed.
ours = stage_json(2)
theirs = stage_json(3)
if not isinstance(ours, dict) or not isinstance(theirs, dict):
    raise SystemExit(f"{path} stages are not JSON objects")

merged = dict(ours)
for key, val in theirs.items():
    if key not in merged:
        merged[key] = val
        continue
    existing = merged[key]
    if (
        isinstance(val, str)
        and isinstance(existing, str)
        and key.endswith("_at")
    ):
        # ISO-8601 timestamps sort chronologically as plain strings.
        merged[key] = max(existing, val)
    else:
        merged[key] = val

with open(path, "w", encoding="utf-8") as fh:
    json.dump(merged, fh, indent=2, ensure_ascii=False)
    fh.write("\n")
print(
    f"Merged {path} conflict "
    f"(keys={', '.join(sorted(merged))})",
    file=sys.stderr,
)
PY
  git add -- "$DATA_UPDATED_PATH"
  return 0
}

rebase_onto_remote() {
  local rebase_out=""
  set +e
  rebase_out="$(git rebase "$REMOTE_REF" 2>&1)"
  local rc=$?
  set -e
  printf '%s\n' "$rebase_out"
  if [[ "$rc" -eq 0 ]]; then
    return 0
  fi
  if printf '%s\n' "$rebase_out" | grep -q "data/data_updated.json"; then
    if resolve_data_updated_conflict; then
      # Continue past the resolved data_updated conflict; abort if more conflicts.
      if GIT_EDITOR=true git rebase --continue; then
        return 0
      fi
    fi
  fi
  echo "Rebase failed; aborting." >&2
  git rebase --abort >/dev/null 2>&1 || true
  return "$rc"
}

if [[ "$BUMP_SITE_REV" -eq 1 ]]; then
  write_site_rev_commit
fi

remote="${REMOTE_REF%%/*}"
remote_branch="${REMOTE_REF#*/}"

for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  if git push "$remote" "HEAD:refs/heads/${remote_branch}"; then
    echo "Pushed successfully."
    emit_output pushed true
    exit 0
  fi

  if [[ "$attempt" -eq "$MAX_ATTEMPTS" ]]; then
    echo "Failed to push after ${MAX_ATTEMPTS} attempts." >&2
    exit 1
  fi

  echo "Push rejected; rebasing onto ${REMOTE_REF} (attempt ${attempt}/${MAX_ATTEMPTS})..."
  # When we own a trailing site-rev commit, drop it before rebase and rewrite
  # after so the cached rev matches the rebased data commit SHA.
  if [[ "$BUMP_SITE_REV" -eq 1 ]]; then
    drop_trailing_site_rev_commit
  fi
  git fetch "$remote" "$remote_branch"
  rebase_onto_remote
  if [[ "$BUMP_SITE_REV" -eq 1 ]]; then
    write_site_rev_commit
  fi
done
