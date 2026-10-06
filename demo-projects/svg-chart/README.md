# svg-chart

Deterministic SVG line-chart path generation in plain Node.

## Objective

Implement a multi-series line chart renderer that takes a dataset and a viewport
size and returns an SVG string. The renderer is measured by the benchmark in
`bench/`; the workload, the viewport, the seeds, the iteration count and the
correctness checks are all owned by the harness.

## Interface

```js
import { renderChart } from './src/index.js';

const svg = renderChart(dataset, viewport);
```

- `dataset` — `Array<{ name: string, data: Array<{ x: number, y: number }> }>`
  - One entry per series.
  - Points within a series are ordered by `x`.
  - A series may be empty (`data: []`).
- `viewport` — `{ width: number, height: number, padding: number }`
  - `width` and `height` define the SVG viewport in pixels.
  - `padding` is reserved inside the axes.
- Returns a single SVG document string containing one `<path>` per series.

## Scripts

- `pnpm test` — correctness suite (`test/test.js`).
- `pnpm bench` — benchmark, prints `METRIC` lines on stdout and exits non-zero if
the oracle fails.
- `pnpm verify` — runs the test suite and the benchmark.

## Metrics

The benchmark reports the following metrics:

- `METRIC points_emitted` — total number of points emitted across all series.
- `METRIC path_kb` — size of the returned SVG string in kilobytes.
- `METRIC max_deviation_px` — maximum vertical screen-space deviation between
  the rendered polyline and the source data, in pixels.
- `METRIC ms` — median render time over the timed iterations, in milliseconds.
- `METRIC workload_hash` — hash of the workload definition and inputs.

The benchmark exits non-zero when the path data is malformed, when any
coordinate falls outside the declared viewport, or when the maximum deviation
exceeds the fidelity threshold.

## Rules

- Only the implementation in `src/` is open to optimization.
- `bench/`, `test/`, `README.md`, `package.json` and `verify.js` are harness-owned
  and must not be modified during an optimization session.
- Dependencies are frozen.
