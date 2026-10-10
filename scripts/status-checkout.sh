#!/usr/bin/env bash
# Run in the initialized feed checkout. Keep the published branch history.
set -euo pipefail

if git ls-remote --exit-code --heads origin refs/heads/status > /dev/null; then
  git fetch -q --depth 1 origin status
  git checkout -q -b status FETCH_HEAD
else
  result=$?
  # ls-remote returns 2 only when the remote is reachable but has no matching ref.
  # Authentication or network failure must not create a replacement history.
  if [ "$result" -ne 2 ]; then exit "$result"; fi
  git checkout -q --orphan status
fi
