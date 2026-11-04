#!/usr/bin/env bash
# Commits whatever changed in the data worktree to the data branch.
set -euo pipefail
cd data
git config user.name "pulse-collector"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add -A
if git diff --cached --quiet; then
  echo "Nothing new."
else
  git commit -q -m "$1 $(date -u +%Y-%m-%dT%H:%MZ)"
  git push -q origin data
fi
