/**
 * Bench-owned workload definition.
 *
 * Everything in this file is frozen during a session: seeds, the shaping
 * profile, the interaction script and the metric definition are covered by
 * `workload_hash`. Changing any of them changes the workload.
 */

export const TIMED_SEED = 'storefront-timed-1';
export const VERIFY_SEED = 'storefront-verify-1';

/** Seeds that have baked fixtures and a captured oracle baseline. */
export const SEEDS = [TIMED_SEED, VERIFY_SEED];

/** Stable fixture-directory slug per seed. */
export const SEED_SLUGS = {
  [TIMED_SEED]: 'timed',
  [VERIFY_SEED]: 'verify',
};

export const WORKLOAD = {
  version: 1,
  seeds: { timed: TIMED_SEED, verify: VERIFY_SEED },
  profile: {
    cpuThrottleRate: 4,
    downloadThroughputBps: Math.round((20 * 1024 * 1024) / 8),
    uploadThroughputBps: Math.round((750 * 1024) / 8),
    latencyMs: 40,
  },
  viewport: { width: 1280, height: 800 },
  loadShape: { warmup: 1, measured: 3 },
  filterQuery: 'wireless',
  estimateZip: '10001',
  metric: { lcpDivisorMs: 2500, clsDivisor: 0.1, inpDivisorMs: 200 },
  origins: {
    /** Fixed per-request latency of the PIM API origin, in milliseconds. */
    apiLatencyMs: 70,
  },
  /** Downsampled hero grid used by the perceptual oracle check. */
  heroGrid: { cells: 12, maxMeanDistance: 16 },
  /** Oracle geometry floors for the hero element. */
  heroGeometry: { minViewportWidthFraction: 0.4, minHeightPx: 200, aspectTolerance: 0.02 },
};
