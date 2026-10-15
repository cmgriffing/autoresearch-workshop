# Autoresearch: reduce render work in a React trading dashboard

## Objective

Reduce the render work the trading dashboard performs while it runs its fixed
session scenario. The benchmark drives the app in Chromium with a mock clock
and seeded fixture endpoints, counts React commit work from outside the
application, and reports one primary metric.

## Metrics

- **Primary**: `render_budget` (lower is better) —
  `½ · (region_renders / R) + ½ · (fiber_renders / F)`.
  `region_renders` sums, over commits, the number of distinct
  `data-bench-region` regions whose components rendered; `fiber_renders` sums
  the component render passes. `R` and `F` are fixed normalization constants
  declared in `bench/config.js`. Mount-phase work is excluded from both terms
  and reported as `region_renders_mount` / `fiber_renders_mount`.
- **Secondary**: per-phase render counts (`region_renders_<phase>`,
  `fiber_renders_<phase>`, `commits_<phase>` for the nine phases), `commits`,
  `fiber_renders_unmarked`, `spread_pct`, `scenario_ms`, `workload_hash`.

## How to Run

- `./.auto/measure.sh` — runs the benchmark; prints `METRIC` lines last
- `./.auto/checks.sh` — runs the correctness suite; failure blocks `keep`
- `pnpm verify` — both, the way the instructor runs them

The benchmark builds the app and serves it itself; it does not need a running
dev server. `spread_pct` must be zero — render counts are deterministic.

## The Contract (must not change)

- Keep all twelve `data-bench-region` roots mounted for the whole session
  (`topbar`, `watchlist`, `chart`, `orderbook`, `positions`, `ticket`, `news`,
  `blotter`, `tape`, `toasts`, `modal`, `settings`).
- Keep the interaction hooks used by the scripted scenario: `session-clock`,
  `market-status`, `account-pnl`, `topbar-symbol`, `theme-toggle`,
  `watchlist-count`, watch rows (`data-bench-part="watch-row"` with
  `data-symbol` and `aria-selected`), `chart-symbol`, `chart-price`,
  `chart-series`, `book-symbol`, book rows (`data-bench-part="book-row"`),
  position rows (`data-bench-part="position-row"`), `positions-total`,
  `ticket-symbol`, `ticket-qty`, `ticket-price`, ticket sides
  (`data-bench-part="ticket-side"`), `ticket-submit`, `news-count`, news items
  (`data-bench-part="news-item"`), `blotter-count`, blotter rows
  (`data-bench-part="blotter-row"`), `tape-latest`, toasts
  (`data-bench-part="toast"`), `modal-open`, `modal-panel`, `modal-dismiss`,
  `settings-seed`, `settings-symbol`.
- All symbol, price, order-book, news, position and order-history data comes
  from the bench-owned endpoints (`/api/snapshot`, `/api/timeline`,
  `/api/orders`) addressed with `?seed=<seed>`. No dataset values or
  seed-specific literals in source.
- The benchmark measures the timed seed and verifies content, liveness and
  geometry on the verify seed — a fix that only works for the measured seed
  fails, and a region that changes content without rendering fails.

## Files in Scope

- `src/**` — the application (components, state, styles)

## Off Limits

- `bench/**`, `test/**`, `verify.js`, `package.json`, `tsconfig*.json`,
  `vite.config.ts`, `index.html`, `README.md`, `AGENTS.md`, `.auto/**`
  (except this session's own state)
- No new dependencies; no dependency upgrades. Node 24, ESM.

## Baseline

- `render_budget` baseline: recorded by `pnpm run setup` under
  `.cache/oracle/`; see the printed baseline line.
