#!/usr/bin/env bash
# Session check script for the autoresearch demo suite.
#
# Usage:
#   bash checks.sh                # dependency-freeze guard only
#   bash checks.sh <demo-name>    # run that demo's correctness suite as well
#
# The dependency freeze is part of the contract: dependency manifests and
# pnpm-lock.yaml are frozen for a session. See demo-projects/README.md.
set -euo pipefail
cd "$(dirname "$0")"

changed="$(git status --porcelain -- pnpm-lock.yaml package.json demo-projects/*/package.json)"
if [[ -n "$changed" ]]; then
  echo "OUT OF CONTRACT: a dependency manifest or pnpm-lock.yaml changed during this session" >&2
  echo "$changed" >&2
  exit 1
fi

demo="${1:-}"
if [[ -z "$demo" ]]; then
  echo "dependency freeze: ok"
  exit 0
fi

if [[ ! -d "demo-projects/$demo" ]]; then
  echo "unknown demo: $demo" >&2
  exit 1
fi

cd "demo-projects/$demo"
pnpm test
