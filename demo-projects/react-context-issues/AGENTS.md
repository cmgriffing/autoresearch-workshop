# Session constraints: react-context-issues

This file is loaded automatically when a session runs with this directory as
its working directory. It carries framework and fence constraints only — it
does not say where the wins are.

## What this is

A React 19 + Vite single-page trading dashboard measured in a real browser. The
primary metric is `render_budget` (lower is better), a deterministic count of
React commit work (region- and fiber-level). See `README.md` for the metric,
the run commands, the hook contract and the shared rules in `../README.md`.

## Framework

- **React 19.3 + Vite 8 + TypeScript**, pinned in `package.json`. The app is a
  client-only SPA: one root, no router, no state-management library.
- **Verify APIs against the installed packages, not training data.** React
  behavior can change between versions; read what is in `node_modules/react`
  and `node_modules/react-dom` (or the bundled docs/types) before relying on a
  remembered API.
- The benchmark runs a production build (`vite build` → `.cache/dist`) served
  by the harness. `pnpm build` runs the same build for a compile check.
- The timeline advances on a fixed tick cadence; all market data comes from the
  bench-owned `/api/*` endpoints. `pnpm dev` boots the fixture endpoints and the
  Vite dev server together and proxies `/api/*`, so the dashboard opens in a
  browser without the harness.

## The fence

- **Writable:** `src/**`.
- **Frozen:** `bench/**`, `test/**`, `verify.js`, `package.json`,
  `tsconfig*.json`, `vite.config.ts`, `index.html`, `README.md`, `AGENTS.md`,
  and the session files under `.auto/**` (except this session's own state).
  Adding, removing or upgrading a dependency is out of contract.
- Generated state (build output, caches, the oracle baseline) lives under
  `.cache/` — never commit it, never rely on it surviving a reset.

## Measurement contract

- Keep all twelve `data-bench-region` roots mounted for the whole session, and
  keep the interaction hooks listed in `README.md`. The oracle fails on missing
  regions, stale content, missing renders and broken geometry.
- All market data comes from the bench-owned endpoints addressed with
  `?seed=<seed>`; no dataset values in source.
- The benchmark measures the **timed** seed and verifies content, liveness and
  geometry on the **verify** seed. Optimizing only for the timed seed fails
  verification.
- `./.auto/measure.sh` runs the benchmark (oracle-gated, exit non-zero on any
  oracle failure, `spread_pct` must be zero). `./.auto/checks.sh` runs the
  correctness suite. A `keep` requires both to pass.
