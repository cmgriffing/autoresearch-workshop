# Autoresearch: optimize the checksum hot loop

## Objective

Make `checksum()` in `src/index.js` faster on a fixed workload: one timed call
per 16 MiB `Uint8Array`, median of 5 runs over 5 distinct buffers. This is a
pure hot-loop optimization problem — the result contract is frozen and
enforced by tests.

## Metrics

- **Primary**: `checksum_ms` (ms, lower is better) — median per-call time
- **Secondary**: `mbps` (higher is better), `spread_pct` (noise indicator),
  `bytes` and `runs` (workload self-report)

## How to Run

- `./.auto/measure.sh` — runs `bench.js`, prints `METRIC` lines
- `./.auto/checks.sh` — runs the correctness suite; failure blocks `keep`

If `spread_pct` climbs above ~5%, re-run before trusting a small win, or raise
the sample count with `BENCH_RUNS=9 ./.auto/measure.sh` (defaults:
`BENCH_MB=16`, `BENCH_RUNS=5`).

## The Contract (must not change)

```
lane_k = sum of bytes at indices k, k+4, k+8, …   (mod 2^32)
result = (lane3 + (lane2 << 8) + (lane1 << 16) + (lane0 << 24)) mod 2^32
```

Inputs are byte values: `Uint8Array`, `Buffer`, or `number[]` with values
0..255. The suite pins this with golden vectors, a spec reference
implementation, a 16 MiB all-0xff vector (`0xffc00000`), and a mutation test
that defeats caching tricks.

## Files in Scope

- `src/index.js` (and new files under `src/` that it imports)
- Keep the public API: named export `checksum(arr)` returning a uint32

## Off Limits

- `bench.js`, `test/**`, `package.json`, `.auto/**` (except updating the
  "What's Been Tried" section below)
- No new dependencies; Node 24, ESM only

## What's Been Tried

- (pre-wired baseline) naive `i % 4` + `switch` loop: ~18.4 ms per 16 MiB
  (~870 MB/s), measured with `.auto/measure.sh`.
