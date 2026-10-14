/**
 * Metric aggregation.
 *
 * `render_budget = ½ · (region_renders / R) + ½ · (fiber_renders / F)` — lower
 * is better. Mount-phase work is excluded from both terms and reported
 * separately. Per-phase secondaries localize the work; `spread_pct` catches
 * non-deterministic runs.
 */

import { NORMALIZATION, PHASE_SCRIPT, REGION_MANIFEST } from './config.js';

/** Sums instrumentation commits over the half-open range `[from, to)`. */
export function sliceTotals(commits, from, to) {
  const regions = {};
  let count = 0;
  let fiberRenders = 0;
  let regionRenders = 0;
  let unmarked = 0;
  for (let index = from; index < to; index += 1) {
    const commit = commits[index];
    if (!commit) continue;
    count += 1;
    fiberRenders += commit.fiberRenders;
    regionRenders += commit.regionRenders;
    unmarked += commit.unmarked;
    for (const [region, value] of Object.entries(commit.regions)) {
      regions[region] = (regions[region] ?? 0) + value;
    }
  }
  return { commits: count, fiberRenders, regionRenders, unmarked, regions };
}

/** Distinct regions touched by any commit in `[from, to)`. */
export function regionsInRange(commits, from, to) {
  const regions = new Set();
  for (let index = from; index < to; index += 1) {
    const commit = commits[index];
    if (!commit) continue;
    for (const region of Object.keys(commit.regions)) regions.add(region);
  }
  return regions;
}

export function renderBudget(regionRenders, fiberRenders) {
  const { R, F } = NORMALIZATION;
  return 0.5 * (regionRenders / R) + 0.5 * (fiberRenders / F);
}

const round3 = (value) => Math.round(value * 1000) / 1000;
const round1 = (value) => Math.round(value * 10) / 10;

/** Builds the emitted metric set for one measured session. */
export function computeMetrics(run, workloadHash) {
  const mount = sliceTotals(run.commits, 0, run.mountCommits);
  const measured = sliceTotals(run.commits, run.mountCommits, run.commits.length);

  const metrics = {
    render_budget: round3(renderBudget(measured.regionRenders, measured.fiberRenders)),
    region_renders: measured.regionRenders,
    fiber_renders: measured.fiberRenders,
    commits: measured.commits,
    region_renders_mount: mount.regionRenders,
    fiber_renders_mount: mount.fiberRenders,
    fiber_renders_unmarked: measured.unmarked,
  };

  for (const phase of PHASE_SCRIPT.order) {
    const record = run.scenario?.phases?.[phase];
    const totals = record
      ? sliceTotals(run.commits, record.commitStart, record.commitEnd)
      : { commits: 0, fiberRenders: 0, regionRenders: 0 };
    metrics[`region_renders_${phase}`] = totals.regionRenders;
    metrics[`fiber_renders_${phase}`] = totals.fiberRenders;
    metrics[`commits_${phase}`] = totals.commits;
  }

  metrics.workload_hash = workloadHash;
  metrics.scenario_ms = run.scenarioMs;
  return metrics;
}

/** Deterministic part of the metric set, used to compare repeated runs. */
export function metricsSignature(metrics) {
  const { scenario_ms: ignoredMs, workload_hash: ignoredHash, ...rest } = metrics;
  return JSON.stringify(rest);
}

/** Percentage spread of the primary across repeated runs; zero is expected. */
export function computeSpreadPct(runs) {
  const budgets = runs.map((run) => {
    const measured = sliceTotals(run.commits, run.mountCommits, run.commits.length);
    return renderBudget(measured.regionRenders, measured.fiberRenders);
  });
  const min = Math.min(...budgets);
  const max = Math.max(...budgets);
  const mean = budgets.reduce((total, value) => total + value, 0) / budgets.length;
  if (mean === 0) return 0;
  return round1(((max - min) / mean) * 100);
}

export { REGION_MANIFEST };
