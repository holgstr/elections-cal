#!/usr/bin/env bash
# Trigger Deploy site to GitHub Pages via workflow_dispatch.
# Needed because pushes made with GITHUB_TOKEN do not start other workflows.
set -euo pipefail

REF="${1:-main}"
WORKFLOW="${WORKFLOW:-deploy-pages.yml}"

if [[ -z "${GH_TOKEN:-}${GITHUB_TOKEN:-}" ]]; then
  echo "GH_TOKEN or GITHUB_TOKEN is required." >&2
  exit 1
fi

export GH_TOKEN="${GH_TOKEN:-$GITHUB_TOKEN}"
gh workflow run "$WORKFLOW" --ref "$REF"
echo "Triggered $WORKFLOW on $REF."
