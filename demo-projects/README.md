# Demo Projects

Targets for autoresearch sessions. Each demo is a small, plausible application with a
deliberate performance ceiling, a low-noise metric, a correctness oracle, and
instrumentation that makes its bottleneck observable. They share one contract so a
session can move between them without relearning the rules.

`checksum/` is the bare starter project and does not implement this contract.

## Layout contract

Every demo directory is fenced:

| Path | Role | Optimization-session access |
| --- | --- | --- |
| `src/` | the application under test | writable — the only writable directory |
| `bench/` | benchmark harness: workload, instrumentation, oracle | off-limits |
| `test/` | correctness suite | off-limits |
| `README.md` | project specification | off-limits |
| `package.json` | `test`, `bench` and `verify` scripts | off-limits; dependencies are frozen |
| `verify.js` | pre-flight check for the instructor | off-limits |

The application is a library. `src/` exports the entry points the harness calls, and the
harness supplies everything measured: datasets, row counts, viewport sizes, iteration
counts, frame counts, interaction scripts and seeds. Application defaults are never the
measured workload.

If it is not under `src/`, an optimization run must not modify it.

## Measurement protocol

A benchmark prints its metrics on stdout, one per line, in the form:

    METRIC name=value

- A metric name matches `[\w.µ]+`; a value contains no whitespace.
- The benchmark exits `0` only when its oracle passed. A failed oracle exits non-zero
  before any passing summary is printed.
- The harness prints at most ten lines of human-facing output. The `METRIC` lines are
  always the last lines, so the agent-visible output window contains them.
- The benchmark command is part of the gate: a run whose oracle fails cannot be kept,
  regardless of how fast it was.

## Bench-owned workload and instrumentation

- Datasets, sizes, iteration counts, frame counts, viewport sizes and interaction
  scripts are defined in `bench/`.
- Counters and observers that produce the primary metric are installed by `bench/` from
  outside the application, so deleting application-side instrumentation cannot change the
  measurement.
- The primary metric is reported together with deterministic secondary metrics — counts,
  sizes and structural counters — so algorithmic change is distinguishable from
  constant-factor change and timing noise.

## Integrity rules

- **Oracle gates the metric.** Every benchmark verifies the correctness of the work it
  measured and fails the run when verification fails.
- **Two seeds.** The timed workload and the verification workload use different seeds, so
  special-casing the timed input fails verification.
- **`workload_hash`.** Every benchmark emits `METRIC workload_hash`, derived from the
  workload definition and its inputs. A silent workload change changes the hash.
- **Per-run state reset.** State that outlives a process — databases, build output,
  caches — lives under the demo's `.cache/` directory. That path is version-ignored so it
  survives reverts, and the harness restores it to a pristine condition before each
  measured run. Reverting code reverts code; generated state is reset separately.
- **Dependency freeze.** Dependencies are declared in the committed manifests.
  Adding, removing or upgrading a dependency during a session is out of contract; the
  session's check script (`checks.sh`) fails if `pnpm-lock.yaml` or any `package.json`
  differs from the committed revision.
- **No answer key.** No tracked file — this document, a project README, the test suite or
  the slides — describes the optimizations, where the wins are, or their expected
  magnitudes. Instructor material lives in the gitignored `instructor-notes/` directory.

## Verify

Each demo provides `verify.js`, run as `pnpm verify` (or `node verify.js`) from the demo
directory. It runs the correctness suite, runs the benchmark, and reports observed values
only: test status per case plus the metric lines. It never prints expected results,
optimization suggestions or expected magnitudes.

## Budget

A baseline benchmark completes within three seconds on the workshop reference machine.
Sizing is part of each project's design and is checked by `verify`; the workload is not a
session tuning knob.
