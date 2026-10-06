#!/bin/bash
# pi-autoresearch correctness gate: a non-zero exit blocks a `keep`.
set -euo pipefail
cd "$(dirname "$0")/.."
node --test --test-reporter=dot 2>&1 | tail -50
