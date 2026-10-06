# canvas-particles

A deterministic 2D particle simulation benchmark. The harness owns the workload
(particle count, frame count, timestep, canvas size and seed) and drives the
simulation frame by frame. The benchmark reports the cost of the simulation step,
the drawing step, and the total frame cost.

## Running

```bash
pnpm test      # correctness suite
pnpm bench     # benchmark with metrics
pnpm verify    # runs tests and benchmark
pnpm dev       # browser demo on http://localhost:3000
```

`@napi-rs/canvas` provides a node-native 2D canvas; no browser is required for
`pnpm bench` or `pnpm verify`.

## Simulation interface

`src/index.js` exports:

- `createSimulation(canvas, options)` — create a simulation bound to a canvas.
- `createFieldSampler(seed)` — create the field sampler used by the motion model.

`options` must include the harness-owned parameters:

| option         | meaning                              |
|----------------|--------------------------------------|
| `particleCount`| number of particles                  |
| `seed`         | deterministic seed                   |
| `width`        | simulation/canvas width              |
| `height`       | simulation/canvas height             |
| `timestep`     | frame timestep in seconds            |
| `fieldSampler` | optional external field sampler      |

The returned simulation has:

- `step(dt)` — advance physics one frame.
- `draw()` — render the current state.
- `particles` — read-only array of `{ x, y, vx, vy }` for oracle access.

## Metrics

The benchmark emits one `METRIC name=value` line per metric:

- `field_evals` — number of field samples evaluated, including per-octave work.
- `draw_calls` — number of draw operations issued.
- `culled` — particles skipped because they are outside the canvas.
- `sim_ms` — wall time spent in simulation steps.
- `draw_ms` — wall time spent in drawing steps.
- `total_ms` — total wall time for the full run (primary metric).
- `workload_hash` — hash of the workload definition and inputs.

## Rules

- The harness supplies all workload parameters; the application does not define
  defaults for the measured workload.
- The benchmark exits non-zero when the state oracle fails, so correctness gates
  any reported timing.
- The timed workload and the verification workload use different seeds.
- The browser entry point (`src/index.html` and `server.js`) is for human
  inspection only; it is not used by the benchmark.
