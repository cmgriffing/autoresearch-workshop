#!/bin/bash
# pi-autoresearch benchmark wrapper: emits METRIC lines on stdout.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node bench.js
