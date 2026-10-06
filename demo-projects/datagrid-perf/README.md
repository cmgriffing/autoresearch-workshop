# datagrid-perf

A React data grid demo for the autoresearch workshop. The grid is measured on
React render-phase work in a headless jsdom environment.

## Objective

Implement and optimize a React data grid while keeping the public interface
stable. The benchmark reports profiler-reported render time, DOM mutation count
and DOM node count, not raw wall-clock time.

## How to run

- `pnpm test` — run the correctness suite.
- `pnpm bench` — run the benchmark and print metric lines.
- `pnpm verify` — run the correctness suite followed by the benchmark.

## Component interface

The app exports the following stable interface:

- `Grid` — a forward-ref component. Props:
  - `rows: Row[]` — dataset supplied by the harness.
  - `viewport: { width: number, height: number }` — visible area supplied by the
    harness.
  - The component ref exposes `{ tick() }` so the harness can advance one
    background update under controlled time.
- `ROW_HEIGHT` — fixed row height in pixels. Virtualization must not depend on
  layout measurement.
- `GridContext` — the grid's React context object.

A `Row` is any object with at least an `id` field. Optional fields may be
missing and must render as empty cells.

## Metric definitions

`pnpm bench` prints machine-readable `METRIC name=value` lines after a short
human summary:

- `render_ms` — median total `actualDuration` reported by the harness-installed
  `React.Profiler` across repeated iterations.
- `commits` — number of profiler commits observed during an iteration.
- `mutations` — number of DOM mutation records observed.
- `nodes` — number of DOM elements rendered in the grid container.
- `phase_mount_ms`, `phase_interaction_ms`, `phase_background_ms` —
  profiler-reported render time split by the interaction phase that scheduled
  the work.
- `workload_hash` — hash of the harness-owned workload definition.

## Rules

- Only files under `src/` may be changed during an optimization session.
- `bench/`, `test/`, `README.md`, `package.json` and `verify.js` are owned by
  the harness and must not be modified.
- The harness supplies the dataset, viewport, interaction script and seeds.
- The benchmark runs against a production profiling build of React DOM with no
  development-only double invocation.
- The DOM oracle gates the metric: a run that renders incorrect or incomplete
  output exits non-zero before any passing summary is printed.
