# Session constraints: nextjs-core-web-vitals

This file is loaded automatically when a session runs with this directory as
its working directory. It carries framework and fence constraints only — it
does not say where the wins are.

## What this is

A Next.js App Router product-detail storefront measured in a real browser under
a fixed shaping profile. The primary metric is `cwv_budget` (lower is better),
built from the hero paint time, layout stability and interaction latency. See
`README.md` for the metric, the run commands, the hook contract and the shared
rules in `../README.md`.

## Framework

- **Next.js 16 App Router with Turbopack**, pinned in `package.json`. Server
  components render on the server; client components (`'use client'`) hydrate
  in the browser. `next.config.mjs` uses `distDir: '.cache/next'`.
- **Verify APIs against the installed package, not training data.** Framework
  behavior changes between versions; read what is in `node_modules/next` (or
  its bundled docs/types) before relying on a remembered API.
- The build runs as `next build` + `next start` through the harness; the page
  is dynamic (`force-dynamic`). Run `pnpm build` yourself only for a quick
  compile check — it writes to `.cache/next`.
- `PIM_URL` is injected by the benchmark at run time. `pnpm dev` needs it too;
  for UI work, run the bench once and use its origins, or expect the page to
  throw without it.

## The fence

- **Writable:** `app/`, `public/`, `next.config.*`.
- **Frozen:** `bench/`, `test/`, `verify.js`, `package.json`, `README.md`,
  `AGENTS.md`, and the session files under `.auto/` (except this session's own
  state). Adding, removing or upgrading a dependency is out of contract.
- Generated state (build output, caches, the oracle baseline) lives under
  `.cache/` — never commit it, never rely on it surviving a reset.

## Measurement contract

- The ten `data-bench` hooks, the `data-bench-part` structural attributes and
  `elementtiming="hero"` on the hero element are part of the contract. Keep
  exactly one element per hook; keep review rows tagged with `data-review-id`.
- All product, promo, review, variant and image data comes from the bench-owned
  origins via `PIM_URL`, addressed by `/?seed=<seed>`. No dataset values in
  source.
- The benchmark measures the **timed** seed and verifies content, geometry,
  interactions, the hero's perceptual grid and the font on the **verify** seed.
  Optimizing only for the timed seed fails verification.
- `./.auto/measure.sh` runs the benchmark (oracle-gated, exit non-zero on any
  oracle failure). `./.auto/checks.sh` runs the correctness suite. A `keep`
  requires both to pass.
