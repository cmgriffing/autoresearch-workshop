# nextjs-core-web-vitals

A Next.js 16 App Router product-detail storefront measured in a real browser
under a fixed shaping profile. The primary metric is `cwv_budget`, a single
number built from the page's paint, stability and interaction latency.

This demo follows the shared contract in [`../README.md`](../README.md): the
application lives under `app/` and `public/`, the benchmark owns the workload,
and an oracle gates every measured run.

## The metric

```
cwv_budget = (lcp_ms / 2500 + cls / 0.1 + inp_ms / 200) / 3     (lower is better)
```

`1.0` means all three components sit exactly at their "good" Core Web Vitals
thresholds (2.5 s, 0.1, 200 ms). The benchmark reports the median of three
measured loads; a warm-up load is reported separately as `*_cold`.

### What the components measure

| Component | Meaning | Source |
| --- | --- | --- |
| `lcp_ms` | paint time of the hero image — the page's largest content | Element Timing entry with identifier `hero`, plus resource-timing attribution (`lcp_ttfb_ms`, `lcp_load_delay_ms`, `lcp_load_duration_ms`, `lcp_render_delay_ms`) |
| `cls` | cumulative layout shift during the load and the scripted interactions | `layout-shift` entries without recent input |
| `inp_ms` | worst interaction latency across the scripted sequence (filter typing, variant select, add to cart, shipping estimate) | Event Timing, with input/processing/presentation phases emitted per interaction |

`lcp_ms` uses the hero's Element Timing entry because Chromium does not emit
image Largest Contentful Paint entries reliably under CDP network emulation
(measured: ~1 in 4 runs; text entries are unaffected). Element Timing uses the
same paint-timing machinery and is deterministic — 6 of 6 runs in the same
conditions. The raw LCP API value is still emitted as `lcp_api_ms`.

Secondary metrics include `long_task_ms`, `lcp_api_ms`, cold (`*_cold`) and
worst-of-run (`*_worst`) variants, `spread_pct`, the oracle signals
`hero_diff` and `font_bytes`, and `workload_hash`.

## How to run

From this directory (or `pnpm --filter nextjs-core-web-vitals <script>`):

```sh
pnpm run setup # once per machine: clean-state check, baseline capture, one bench pass
pnpm verify    # pre-flight check: correctness suite, then the benchmark
pnpm bench     # the benchmark alone (oracle-gated)
pnpm dev       # demo/UI: boots the fixture origins + the dev server
```

`pnpm dev` is the way to open the storefront in a browser: it starts the
bench-owned origins (PIM API, image CDN, fonts) and the Next.js dev server
together, wires up `PIM_URL`, and prints the seed URLs:

```
http://localhost:3000/?seed=storefront-timed-1
http://localhost:3000/?seed=storefront-verify-1
```

Use `pnpm run dev -- --port 3100` for another port, or `pnpm dev:next` for a
raw dev server (that one needs `PIM_URL` pointing at origins you started
yourself). Dev mode is for demos and UI work only, never for measurement.

`pnpm setup` is a pnpm built-in command, so the setup script is invoked as
`pnpm run setup` (or `pnpm --filter nextjs-core-web-vitals run setup`).

**Prerequisite:** Chromium for Playwright. It is the same browser the other
browser demo uses:

```sh
pnpm exec playwright install chromium
```

### Setup, baselines and pristine state

`pnpm run setup` requires the demo directory to be **pristine**: every tracked file
must match the content manifest at `bench/fixtures/demo-manifest.json`. The
check is content-based and demo-scoped — it never consults git, so branches,
stashes and dirty files elsewhere in the repository are invisible to it. Setup
captures, per seed:

- a 12×12 perceptual grid of the rendered hero, validated for visibility,
  minimum geometry and aspect ratio before it is stored (the oracle baseline),
- a full-page "before" screenshot and the measured baseline metrics.

All artifacts live under `.cache/oracle/` (version-ignored, machine-local,
never committed). They are recaptured automatically when their key changes:
fixture digests, viewport, or browser major version.

During a session the benchmark is lenient: it uses the existing baseline when
one is valid and the key matches, and it fails loudly rather than capturing a
baseline from modified code.

## Hooks and structural contract

The application must keep these stable; sessions may restyle freely but not
remove or rename them.

**Bench hooks — exactly one element each** (`data-bench="…"`):
`hero`, `title`, `price`, `discount`, `banner`, `variant`, `filter`,
`add-to-cart`, `cart-count`, `shipping`.

**Structural parts** (`data-bench-part="…"`): `original-price`,
`variant-option` (one per variant, with `data-variant-id` and `aria-pressed`),
`zip-input`, `estimate`, `review-count`, `filter-count`, `review-row` (one per
rendered review, with `data-review-id`), `cart-line`.

**Paint measurement**: the hero element must carry `elementtiming="hero"`.
The benchmark fails the run when the hero paint is missing or zero.

**Data contract**: all product, promo, review, variant and image data comes
from the bench-owned origins through `PIM_URL`; no dataset value may be
embedded in source. The page is addressed as `/?seed=<seed>` and the
benchmark supplies two seeds. Opening `/` without a seed redirects to the
demo's default seed, and any other seed string renders a synthesised dataset
with the baked fixture imagery — so a demo URL is never left without images.

## Rules

- **Writable:** `app/`, `public/`, `next.config.*` — anything the application
  serves may be restructured, replaced or removed.
- **Frozen:** `bench/`, `test/`, `verify.js`, `package.json`, `README.md`,
  `AGENTS.md`; dependencies are frozen (no additions, removals or upgrades).
- **Generated state** lives under `.cache/` and is reset per run; reverting
  code does not resurrect stale build output or caches.
- The **oracle gates the metric**: content is verified on the second seed, so
  optimizing only for the measured seed fails.
- **Heavy tier budget:** reset + build + verify pass + warm-up + three measured
  loads completes in about 20 s on the workshop reference machine (budget: 25 s).

## Instructor tooling

```sh
node bench/manifest.js generate    # rewrite the content manifest after authoring changes
node bench/generate-fixtures.mjs   # re-bake the image fixtures (needs Chromium)
node bench/manifest.js check       # the clean-state check on its own
```

The fixture generator is deterministic; its outputs are committed and covered
by the manifest. Expected values, planted-cost inventory and measurement
evidence live in the untracked `instructor-notes/` directory.
