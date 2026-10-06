# Proposal: Checksum demo — benchmarks, tests, and pre-wired autoresearch session

**Status:** implemented, revised after adversarial review (G6 + aperiodic workload); pending re-review
**Branch:** `kepler/checksum-demo-benchmarks-tests`
**Scope:** `demo-projects/checksum/**` only
**Purpose of this document:** capture the plans and intent behind the change so a
separate session can validate the implementation against them. Developer-facing —
not part of the participant-facing demo. Decide whether it ships before merging.

---

## 1. Intent

The workshop repo ships `demo-projects/checksum` as the optimization target for
participants learning pi-autoresearch. Before this change the project was a bare
function: no export, no tests, no benchmark, no session files, and a broken
`package.json` (`main: index.js`, `test: "echo Error..."`).

**Goal:** make the project ready to loop:

1. A deterministic benchmark that emits `METRIC` lines pi-autoresearch can parse.
2. A correctness suite that pins the checksum contract and gates `keep`s.
3. A pre-wired `.auto/` session so a participant can open Pi in the directory
   and immediately run `/autoresearch`.
4. A short participant README that does not duplicate the root README.

**Non-goals:** changing the checksum's behavior or public API; optimizing the
implementation (that is the participant's job); wiring turbo/root scripts
(demos stay standalone); adding dependencies.

---

## 2. Decisions and rationale

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Freeze the contract as: bytes in, lane sums mod 2³², big-endian lane combine | It is the existing behavior, verified against an independent BigInt reference. Optimizers may change mechanism, not results. |
| D2 | Pin the contract at scale with a 16 MiB `0xff` vector (`0xffc00000`) | Lane sums exceed all truncation widths (2⁸/2¹⁶/2²⁴); the golden is hand-derivable, so it cannot silently bake in a bug. |
| D3 | Zero dependencies: `node:test` + hand-rolled bench | Node ≥24 is already required; workshop stays offline-friendly; no pnpm/lockfile churn. Vitest + tinybench was the alternative, rejected. |
| D4 | Workload: 16 MiB `Uint8Array`, median of 5 runs, one call per distinct aperiodic buffer | Measured best stability-vs-battery point (see §3); distinct buffers close cross-call caching, stream filling closes intra-buffer periodicity (D12). |
| D5 | Guards G1–G6 in `bench.js` (smoke goldens, warmup, distinct aperiodic buffers, uint32 check, untimed generation, timed-result golden) | A wrong-but-fast change must crash the experiment, never log a keepable metric. G6 was added after adversarial review: smoke-only checking let a wrong-above-1-MiB implementation pass all 24 tests and log a keepable metric. |
| D6 | Pre-wire `.auto/prompt.md`, `measure.sh`, `checks.sh` | Explicit user decision: the checksum demo should be immediately runnable in the workshop. |
| D7 | Demo stays standalone; no `turbo.json` tasks | Explicit user decision. |
| D8 | Primary metric `checksum_ms` (lower better); secondaries `mbps`, `spread_pct`, `bytes`, `runs` | `_ms` suffix gives the harness a unit label; secondaries are context, never gate `keep`. |
| D9 | `spread_pct` = relative MAD, not min-max range | Min-max swung 2.5–26.6% on identical runs due to single scheduling outliers; MAD measures median precision (0.9–3.7%). Changed mid-implementation for this reason — reviewer should confirm the choice. |
| D10 | Smoke checks run *before* timing but use `Uint8Array` only | See §4 — this is the least obvious design constraint in the change. |
| D11 | Timed results validated against a golden accumulated during untimed generation | Closes the reviewed guard gap: G1's smoke vectors are tiny and the suite's non-degenerate anchors stop at 1 MiB, so a bug that only manifests above that could otherwise be kept. Accumulation rides along with generation, so validation costs no extra run. |
| D12 | Stream-fill inputs (xorshift across the whole buffer) instead of tiling one 64 KiB tile | Tiling made every timed buffer periodic; a correct tile-detector won ~186x without reflecting real checksum speed. Stream fill costs ~52 ms for the default five buffers — acceptable (see §3). |

Rejected alternatives worth noting:

- **Two alternating buffers** (A/B) for anti-caching: an identity-keyed 2-entry
  cache still wins. N distinct aperiodic buffers is the stronger design;
  generation costs ≈0.65 ms/MiB with the stream fill and is untimed.
- **BigInt reference for all sizes**: reads like the spec but costs ~1.5 ms per
  64 KiB; kept for small/boundary inputs, with a fast integer reference for the
  1 MiB cross-check.
- **Min-max spread**: see D9.

---

## 3. Workload sizing evidence

Measured on an M-series Mac, Node 24.16, median of 7, single buffer:

| workload | median | spread | note |
|---|---|---|---|
| 8 MiB | 9.19 ms | 6.3% | |
| 16 MiB | 18.34 ms | 1.2% (MAD 0.02 ms) | chosen default |
| 32 MiB | 37.25 ms | 6.8% | |
| 64 MiB | 77.81 ms | 13.8% | |

16 MiB × 5 + warmup + aperiodic generation ≈ **165 ms of work per experiment**
(≈200–220 ms wall including node startup) — roughly 3.5x kinder overall than
64 MiB × 7 (5x on timed bytes alone) at equal or better stability. Stream
generation adds ~52 ms versus the old tile copy; D12 explains why that trade
is worth it. A 2% win at 16 MiB is ~0.37 ms versus a ~0.02 ms measured noise
floor, so the harness confidence score can still discriminate. `BENCH_MB` /
`BENCH_RUNS` override up.

---

## 4. Discovery: the V8 element-kind footgun

**Symptom:** `bench.js` originally reported ~26.5 ms while an identical inline
probe reported ~18.4 ms.

**Cause:** calling `checksum` with `number[]` (or `Buffer`) before the timed
16 MiB `Uint8Array` workload put the function in a worse V8 optimization state
for the remainder of the process. Extra warmups did not recover it.

**Reproduction matrix** (fresh process each; median of 5 timed runs):

| pre-timing calls | round 1 | round 2 |
|---|---|---|
| 3 × `number[]` smoke | 26.60 ms | 26.04 ms |
| 3 × `Buffer` smoke | 25.12 ms | 25.85 ms |
| 3 × `Uint8Array` smoke | 18.87 ms | 18.46 ms |
| `number[]` smoke after timing | 18.73 ms | 18.35 ms |
| 1 × `Uint8Array` smoke | 18.68 ms | 18.34 ms |

**Mitigation:** every call before the timed loop passes a plain `Uint8Array`.
`bench.js` carries a "V8 footgun, do not simplify" comment; `number[]`/`Buffer`
coverage lives in the test suite instead.

**Why the reviewer should care:** this is ~1.4x of silent baseline drift. A
well-meaning cleanup that re-adds a `number[]` smoke vector — or switches smoke
inputs to `Buffer` — will poison every future session's numbers.

---

## 5. Implementation summary

### `src/index.js`
Added `export` to the existing `checksum` function. That is the only source
change. No behavior change.

### `test/checksum.test.js` — 24 tests, ~90 ms, zero deps
- **Goldens:** empty/zero, `[1]`→`0x01000000` (index 0 is most significant),
  `[255]`→`0xff000000`, lengths 2–4, `[255×4]`→`0xffffffff`,
  `[1,0,0,0,255]`→`0` (lane-0 modular truncation), `[1..8]`→`0x06080a0c`,
  ASCII `"123456789"`→`0x9f686a6c`.
- **Lane mapping:** single byte `b` at index `i` ⇒ `(b << 8*(3 − i%4)) >>> 0`,
  for `i` in 0..11.
- **Properties:** purity, determinism, uint32 range, single-byte-flip
  sensitivity, recompute-after-mutation (stale-cache killer).
- **Cross-type:** `number[]` ≡ `Uint8Array` ≡ `Buffer` for the same bytes.
- **References:** BigInt spec reference (lengths 0..33, boundary sizes up to
  64 KiB) + fast integer reference (1 MiB), with the two references cross-checked.
- **Scale:** 16 MiB `0xff` ⇒ `0xffc00000`, with the derivation in a comment
  (lane sum `0x3fc00000`; `+ (0xc00000 << 8)`).

### `bench.js` — guards, then METRIC output
- G1 smoke goldens (Uint8Array only, fails fast — no METRIC lines on failure)
- G2 one warmup call
- G3 one timed call per distinct aperiodic buffer (distinct seeds)
- G4 every timed result asserted uint32
- G5 inputs generated up front, outside the timed region
- G6 every timed result compared against a golden accumulated during
  generation (catches wrong-above-1-MiB implementations that pass the suite)
- generation: xorshift stream across the whole buffer — no repeated 64 KiB
  tiles (D12)
- stdout: only `METRIC` lines; diagnostics to stderr
- Env: `BENCH_MB` (MiB, default 16), `BENCH_RUNS` (default 5)

### `.auto/`
- `prompt.md` — objective, metrics, contract, scope (`src/**`), off-limits
  (`bench.js`, `test/**`, `package.json`, `.auto/**`), env knobs, baseline noted.
- `measure.sh` — `cd` to project root, `exec node bench.js`.
- `checks.sh` — `node --test --test-reporter=dot 2>&1 | tail -50`; non-zero
  exit blocks `keep` (`set -o pipefail` keeps node's status through the pipe).
  Both executable.

### `package.json`
`main` → `src/index.js`; `test` → `node --test`; `bench` → `node bench.js`;
description updated. No dependency changes. The first `pnpm` invocation added
the (empty, dependency-free) `demo-projects/checksum` importer entry to
`pnpm-lock.yaml` — the package was already listed in `pnpm-workspace.yaml` but
missing from the stale lockfile.

### `README.md`
Contract, commands, benchmark design note (aperiodic buffers + result
validation), and the `/autoresearch` quickstart. Links to the root README for
install/setup instead of repeating it.

---

## 6. Verification evidence (as run, post-review revision)

| Check | Result |
|---|---|
| `pnpm test` | 24/24 pass, ~90–95 ms |
| `pnpm bench` (×3) | `checksum_ms` 18.86 / 18.97 / 20.30; `spread_pct` 1.60 / 3.65 / 4.09 (a few per cent of run-to-run drift on this machine) |
| `./.auto/measure.sh` | exit 0, clean METRIC lines, ≈220 ms wall incl. node startup |
| `./.auto/checks.sh` | exit 0, ~120 ms |
| `BENCH_MB=4 BENCH_RUNS=3 pnpm bench` | `bytes=4194304`, `runs=3`, exit 0 |
| `BENCH_MB=nope pnpm bench` | exit 2, empty stdout, stderr message |
| Broken impl (tmp copy, `sum + 1`) | `bench.js` exit 1, **empty stdout**, stderr smoke failure; `measure.sh` exit 1; `checks.sh` exit 1; 9/24 tests pass, 15 fail |
| Wrong above 1 MiB, correct on smoke + 24/24 tests (tmp copy) | `bench.js` exit 1, **empty stdout**, stderr `result validation failed` — G6 catches what `checks.sh` cannot |
| 64 KiB periodic shortcut, correct on 24/24 tests (tmp copy) | no exploit: falls through to the naive path (~19.7 ms), so tiling can no longer inflate the metric (D12) |

Baseline recorded in `.auto/prompt.md`: ~18.4 ms / ~870 MB/s for the naive
`i % 4` + `switch` loop. The initial session's evidence (bench 18.36–18.59 ms)
is preserved in git history.

---

## 7. Review checklist for the validating session

Work from `demo-projects/checksum`.

**Standard verification**

```bash
git show HEAD -- src/index.js    # expect only the added `export`
pnpm test                        # 24/24 pass
for i in 1 2 3; do pnpm bench; done
# expect: stable medians, spread_pct < ~5%, exactly 5 METRIC lines
BENCH_MB=4 BENCH_RUNS=3 pnpm bench        # overrides work
BENCH_MB=nope pnpm bench; echo "exit=$?"  # expect exit 2, stderr message
```

**Adversarial verification (guards actually fire)**

```bash
# 1. Smoke-level breakage: caught by G1 before any METRIC line.
rm -rf /tmp/checksum-review && cp -R . /tmp/checksum-review
sed -i '' 's/return sum;/return (sum + 1) >>> 0;/' /tmp/checksum-review/src/index.js
cd /tmp/checksum-review
node bench.js > out.txt; echo "bench exit=$?"   # expect 1, out.txt empty
./.auto/checks.sh; echo "checks exit=$?"        # expect 1
```

```bash
# 2. Wrong only above the suite's 1 MiB anchor: passes smoke and 24/24 tests,
#    so only G6 can stop it. Regression test for the reviewed guard gap.
rm -rf /tmp/checksum-review2 && cp -R . /tmp/checksum-review2
cat > /tmp/checksum-review2/src/index.js <<'EOF'
export function checksum(arr) {
  if (arr.length > 1024 * 1024) {
    if (!(arr[0] === 0xff && arr[arr.length - 1] === 0xff)) return 0;
  }
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
  for (let i = 0; i < arr.length; i++) {
    switch (i % 4) {
      case 0: s0 = (s0 + arr[i]) | 0; break;
      case 1: s1 = (s1 + arr[i]) | 0; break;
      case 2: s2 = (s2 + arr[i]) | 0; break;
      case 3: s3 = (s3 + arr[i]) | 0; break;
    }
  }
  return (s3 + (s2 << 8) + (s1 << 16) + (s0 << 24)) >>> 0;
}
EOF
cd /tmp/checksum-review2
./.auto/checks.sh; echo "checks exit=$?"       # expect 0 — the suite cannot see it
node bench.js > out.txt 2> err.txt; echo "bench exit=$?"  # expect 1, out.txt empty
cat err.txt                                    # expect result validation failed
```

**Design conformance**

- [ ] All `bench.js` calls before the timed loop pass `Uint8Array` (grep for
      array literals / `Buffer` in the smoke section) — see §4.
- [ ] Timed results are validated: `bench.js` compares every result against
      `expected` (grep `result !== expected`) — G6.
- [ ] Inputs are aperiodic: `generateInput` stream-fills the buffer (grep for
      the absence of `buffer.set(tile…)` repetition) — D12.
- [ ] stdout of `bench.js` carries only `METRIC` lines; errors go to stderr.
- [ ] `.auto/measure.sh` and `.auto/checks.sh` are executable and path-safe.
- [ ] `.auto/prompt.md` off-limits list covers `bench.js`, `test/**`,
      `package.json`, `.auto/**`.
- [ ] No new dependencies: the `pnpm-lock.yaml` diff is only the empty
      `demo-projects/checksum: {}` importer entry; `turbo.json` untouched.
- [ ] README does not duplicate root README setup content.
- [ ] Test suite runtime stays well under 500 ms (checks.sh runs every keep).

---

## 8. Known limitations and open questions

1. **Very fast results.** If an optimizer beats ~10x, 16 MiB calls approach
   ~2 ms and timer/scheduling overhead grows relatively. Mitigation exists
   (`BENCH_MB`/`BENCH_RUNS`), but a reviewer may want a floor on runs.
2. **Absolute numbers are machine-specific.** The metric is meaningful within a
   session (baseline vs candidate), not across machines. Timings also drift a
   few per cent run to run with system load; `spread_pct` reports the
   within-run noise.
3. **Out-of-contract inputs.** `number[]` values outside 0..255 are explicitly
   not pinned. The implementation's mod-2³² behavior is incidental; only byte
   values are contractual.
4. **2³¹ crossing is not semantically meaningful.** Signed `|0` and unsigned
   `>>>0` accumulation are identical mod 2³²; tests therefore pin truncation
   widths rather than a "wrap event".
5. **Memory.** Peak ≈ `BENCH_MB × BENCH_RUNS` MiB (80 MiB at defaults).
6. **This document.** Decide whether a developer-facing proposal should ship
   with the demo or be moved/removed before merge.
7. **OpenSpec.** This repo has no initialized OpenSpec project. If the team
   wants these plans tracked as a formal OpenSpec change instead of a Markdown
   document, that conversion can be done after review.
8. **Benchmark-specific mechanisms.** `bench.js` is readable and the workload
   is deterministic; a targeted implementation could special-case the exact
   inputs while still returning correct results. G6 catches wrong results, not
   a correct-but-non-general mechanism. The guard stack is sized for a
   workshop loop, not adversarial code.
