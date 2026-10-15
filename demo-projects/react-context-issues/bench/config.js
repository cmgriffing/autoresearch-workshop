/**
 * Bench-owned workload definition.
 *
 * Everything in this file is frozen during a session: seeds, tick cadence,
 * dataset shape, viewport sizes, phase script and the region manifest are
 * covered by `workload_hash`. Changing any of them changes the workload.
 */

export const TICK_MS = 250;

export const TIMED_SEED = 'trading-timed-1';
export const VERIFY_SEED = 'trading-verify-1';

/** Seeds the benchmark and the oracle use. */
export const SEEDS = [TIMED_SEED, VERIFY_SEED];

/** Shape of the generated dataset (see `dataset.js`). */
export const DATASET = {
  symbolCount: 34,
  positionCount: 16,
  orderCount: 26,
  bookLevels: 10,
  newsInitial: 12,
  /** Ticks at which an additional news item arrives. */
  newsArrivals: [8, 18, 30, 62, 92],
  /** Number of timeline entries. */
  tickCount: 112,
  /** Per-tick price move, in basis points, upper bound. */
  volatilityBps: 14,
};

/** The twelve logical regions, kept mounted for the whole session. */
export const REGION_MANIFEST = [
  'topbar',
  'watchlist',
  'chart',
  'orderbook',
  'positions',
  'ticket',
  'news',
  'blotter',
  'tape',
  'toasts',
  'modal',
  'settings',
];

export const VIEWPORTS = {
  default: { width: 1440, height: 900 },
  resized: [
    { width: 1280, height: 800 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ],
};

/**
 * The scripted scenario. Fixed interaction values are part of the workload:
 * a run that changes them is a different workload.
 */
export const PHASE_SCRIPT = {
  order: ['tick', 'draft', 'select', 'hover', 'theme', 'news', 'submit', 'modal', 'resize'],
  tick: { advances: 88 },
  draft: { qty: '125', price: '99.50', settleTicks: 1 },
  select: { row: 6 },
  hover: { row: 2 },
  theme: {},
  news: { maxAdvances: 10 },
  submit: { side: 'sell', qty: '40' },
  modal: {},
  resize: {},
};

/**
 * The benchmark drives the timeline through the application's own tick
 * cadence; the driver holds the page's clock at a fixed start and fast-forwards
 * it one tick period at a time.
 */
export const CLOCK_START = '2026-03-12T14:30:00.000Z';

/**
 * Metric normalization. `R` and `F` are instructor-calibrated so both terms of
 * `render_budget` sit at a similar ratio to the baseline; see `metrics.js`.
 * The default value 1 reports raw counts.
 */
export const NORMALIZATION = { R: 2460, F: 28677 };

/** `workload_hash` input. Metric normalization is deliberately not part of it. */
export const WORKLOAD = {
  version: 1,
  seeds: { timed: TIMED_SEED, verify: VERIFY_SEED },
  tickMs: TICK_MS,
  dataset: DATASET,
  regions: REGION_MANIFEST,
  phases: PHASE_SCRIPT,
  viewports: VIEWPORTS,
};
