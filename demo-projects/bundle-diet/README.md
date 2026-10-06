# bundle-diet

A client-routed Vite + React demo application used for autoresearch bundle-size
optimization sessions. The benchmark measures the compressed size of the assets that
must load before the first route can render.

## Objective

Reduce the size of the critical JavaScript/CSS payload delivered on initial load
while keeping every route renderable and reachable.

## How to run

```bash
pnpm test      # correctness suite
pnpm bench     # build + manifest-driven size measurement
pnpm verify    # correctness suite, benchmark, and browser boot oracle
```

`pnpm verify` requires a Chromium installation. The Playwright browser is
pre-cached in this worktree; if it is missing, run the Playwright install step
for this workspace before verifying.

## Routes

The harness-owned route list lives in `bench/routes.js`. The application
declares matching routes in `src/routes.js`.

| Route | Content marker |
|-------|----------------|
| `/` | `home-marker` |
| `/catalog` | `catalog-marker` |
| `/detail` | `detail-marker` |
| `/edit` | `edit-marker` |
| `/settings` | `settings-marker` |
| `/about` | `about-marker` |

## Metrics

`pnpm bench` emits the following metrics after the human-facing summary:

- `critical_gzip_kb` — gzipped size of the transitive static-import closure from
  the entry chunk. Dynamically imported chunks are excluded.
- `total_gzip_kb` — gzipped size of all emitted assets.
- `chunks` — number of emitted JavaScript chunks.
- `workload_hash` — hash of the workload definition, build inputs and manifest.

`pnpm verify` also emits `boot_ms`, the time for the first route to render in a
real Chromium browser.

## Rules

- Only files under `src/` may be changed during an optimization session.
- The workload is owned by `bench/`; do not shrink the application below the
  feature set required by the route table above.
- The benchmark must exit non-zero if the oracle detects missing routes,
  stubbed content, broken dynamic imports, or a mismatch between the harness
  route list and the application routes.
- No browser is launched inside the measured `pnpm bench` step.
