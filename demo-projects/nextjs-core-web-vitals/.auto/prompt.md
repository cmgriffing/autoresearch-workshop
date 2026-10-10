# Autoresearch: improve Core Web Vitals on a Next.js storefront

## Objective

Make the product-detail page faster on a fixed browser profile: the benchmark
measures the shipped page in Chromium (4x CPU throttle, 20 Mbps / 40 ms
network emulation, 1280x800, fresh context per load) and reports one primary
metric.

## Metrics

- **Primary**: `cwv_budget` (lower is better) —
  `(lcp_ms / 2500 + cls / 0.1 + inp_ms / 200) / 3`, where `1.0` is all three
  components at their "good" thresholds.
- **Secondary**: `lcp_ms`, `cls`, `inp_ms`, the LCP attribution phases
  (`lcp_ttfb_ms`, `lcp_load_delay_ms`, `lcp_load_duration_ms`,
  `lcp_render_delay_ms`), per-interaction latencies and phases
  (`inp_<interaction>_*`), `long_task_ms`, cold and worst-of-run variants
  (`*_cold`, `*_worst`), `spread_pct`, `hero_diff`, `font_bytes`,
  `workload_hash`.

`lcp_ms` is the hero's paint time (Element Timing `hero`). A missing or zero
paint fails the run.

## How to Run

- `./.auto/measure.sh` — runs the benchmark; prints `METRIC` lines last
- `./.auto/checks.sh` — runs the correctness suite; failure blocks `keep`
- `pnpm verify` — both, the way the instructor runs them

The benchmark builds the app and boots the bench-owned origins itself; the
first run on a machine captures the oracle baseline (or run `pnpm setup`).

`spread_pct` above ~5% means the machine was noisy; re-run before trusting a
small win.

## The Contract (must not change)

- Keep the ten `data-bench` hooks, the `data-bench-part` attributes,
  `data-review-id` on review rows and `elementtiming="hero"` on the hero
  element.
- All product, promo, review, variant and image data comes from the origins
  addressed through `PIM_URL` by `/?seed=<seed>`. No dataset values in source.
- The oracle verifies content, geometry, interactions, the hero's perceptual
  grid and the font on the verify seed — a fix that only works for the
  measured seed fails.

## Files in Scope

- `app/**` — the application (server and client components, helpers, styles)
- `public/**` — static assets served by the app
- `next.config.*` — build and image configuration

## Off Limits

- `bench/**`, `test/**`, `verify.js`, `package.json`, `README.md`,
  `AGENTS.md`, `.auto/**` (except this session's own state)
- No new dependencies; no dependency upgrades. Node 24, ESM.

## What's Been Tried

- (pre-wired baseline) `cwv_budget` ≈ 2.0 — observed: `lcp_ms` ≈ 1460,
  `cls` ≈ 0.37, `inp_ms` ≈ 344, `spread_pct` ≈ 1–2%.
