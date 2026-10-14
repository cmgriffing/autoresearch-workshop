# react-context-issues

A React 19 + Vite single-page trading dashboard measured in a real browser.
The benchmark drives a fixed session scenario with a mocked clock and seeded
fixture endpoints, counts React commit work from outside the application, and
reports one primary metric: `render_budget`.

This demo follows the shared contract in [`../README.md`](../README.md): the
application lives under `src/`, the benchmark owns the workload, and an oracle
gates every measured run.

## The metric

```
render_budget = ½ · (region_renders / R) + ½ · (fiber_renders / F)   (lower is better)
```

`region_renders` sums, over every React commit, the number of distinct
`data-bench-region` regions whose components performed render work in that
commit (a region touched twice in one commit counts once). `fiber_renders`
sums the component render passes across the same commits. `R` and `F` are
fixed normalization constants declared in `bench/config.js`; with the default
value `1` the terms are reported as raw counts.

Mount-phase work is excluded from both terms and reported separately as
`region_renders_mount` and `fiber_renders_mount`.

### How the work is counted

The benchmark installs `__REACT_DEVTOOLS_GLOBAL_HOOK__` through a Playwright
init script before any application module evaluates. On every React commit the
hook walks the committed fiber tree, counts fibers carrying the
`PerformedWork` flag, and attributes each one to a logical region by walking to
the nearest `[data-bench-region]` host element. Components whose output spans
several regions are counted in `fiber_renders` but attributed to no region.
The accounting lives entirely in `bench/` — application source cannot change or
disable it.

### The scripted scenario

Nine phases run in a fixed order: `tick`, `draft`, `select`, `hover`, `theme`,
`news`, `submit`, `modal`, `resize`. The page clock is paused; the driver
advances it by exactly one tick period at a time and waits for React to settle
after each step. The oracle verifies every step, and the benchmark reports
`region_renders_<phase>`, `fiber_renders_<phase>` and `commits_<phase>` for each
phase, plus `commits`, `fiber_renders_unmarked`, `scenario_ms`,
`spread_pct` and `workload_hash`.

`spread_pct` must be zero: the workload is deterministic, so repeated runs
produce identical counts. A run whose oracle fails exits non-zero before any
passing summary is printed.

## How to run

From this directory (or `pnpm --filter react-context-issues <script>`):

```sh
pnpm run setup # once per machine: clean-state check + baseline capture
pnpm verify    # pre-flight check: correctness suite, then the benchmark
pnpm bench     # the benchmark alone (oracle-gated)
pnpm dev       # demo/UI: boots the fixture endpoints + the Vite dev server
```

`pnpm dev` prints seeded dashboard URLs such as
`http://127.0.0.1:5300/?seed=<seed>`. Dev mode is for demos and UI work only,
never for measurement.

**Prerequisite:** Chromium for Playwright. It is the same browser the other
browser demo uses:

```sh
pnpm exec playwright install chromium
```

### Setup, baselines and pristine state

`pnpm run setup` requires the demo directory to be **pristine**: every tracked
file must match the content manifest at `bench/demo-manifest.json`. The check
is content-based and demo-scoped — it never consults git, so branches, stashes
and dirty files elsewhere in the repository are invisible to it. Setup runs one
full benchmark pass and records the baseline metrics under `.cache/oracle/`
(version-ignored, machine-local, never committed). The baseline is keyed by the
workload hash, the viewport and the browser major version; change any of them
and it is recaptured.

## Hooks and structural contract

The application must keep these stable; sessions may restructure freely but not
remove or rename them.

**Regions** (`data-bench-region`, exactly one root each, always mounted):
`topbar`, `watchlist`, `chart`, `orderbook`, `positions`, `ticket`, `news`,
`blotter`, `tape`, `toasts`, `modal`, `settings`.

**Interaction hooks** (`data-bench` / `data-bench-part`): `session-clock`,
`market-status`, `account-pnl`, `topbar-symbol`, `theme-toggle`,
`watchlist-count`, `watch-row` (with `data-symbol`, `aria-selected`),
`chart-symbol`, `chart-price`, `chart-series`, `book-symbol`, `book-row`
(with `data-side`, `data-price`, `data-size`), `position-row`,
`positions-total`, `ticket-symbol`, `ticket-qty`, `ticket-price`, `ticket-side`
(with `data-side`, `aria-pressed`), `ticket-submit`, `news-count`,
`news-item` (with `data-news-id`), `blotter-count`, `blotter-row` (with
`data-order-id`, `data-side`, `data-status`), `tape-latest`, `toast`,
`toast-dismiss`, `modal-open`, `modal-panel`, `modal-confirm`,
`modal-dismiss`, `settings-seed`, `settings-symbol`.

**Data contract**: all symbol, price, order-book, news, position and
order-history data comes from the bench-owned endpoints `/api/snapshot`,
`/api/timeline` and `/api/orders`, addressed with `?seed=<seed>`. No dataset
value or seed-specific literal may appear in source. The page is opened as
`/?seed=<seed>`.

## Rules

- **Writable:** `src/**` — the application may be restructured, replaced or
  removed.
- **Frozen:** `bench/**`, `test/**`, `verify.js`, `package.json`,
  `tsconfig*.json`, `vite.config.ts`, `index.html`, `README.md`, `AGENTS.md`
  and the session files under `.auto/**`. Adding, removing or upgrading a
  dependency is out of contract.
- Generated state (build output, caches, the oracle baseline) lives under
  `.cache/` — never commit it, never rely on it surviving a reset.
