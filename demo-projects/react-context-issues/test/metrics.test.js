import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMetrics,
  computeSpreadPct,
  metricsSignature,
  regionsInRange,
  renderBudget,
  sliceTotals,
} from '../bench/metrics.js';
import { NORMALIZATION, PHASE_SCRIPT, REGION_MANIFEST } from '../bench/config.js';

const commit = (fiberRenders, regions) => ({
  fiberRenders,
  regionRenders: Object.keys(regions).length,
  unmarked: 0,
  regions,
});

test('sliceTotals sums commit ranges half-open', () => {
  const commits = [
    commit(10, { topbar: 5 }),
    commit(20, { topbar: 3, chart: 2 }),
    commit(30, { chart: 4 }),
  ];
  assert.deepEqual(sliceTotals(commits, 0, 3), {
    commits: 3,
    fiberRenders: 60,
    regionRenders: 4,
    unmarked: 0,
    regions: { topbar: 8, chart: 6 },
  });
  assert.equal(sliceTotals(commits, 1, 2).fiberRenders, 20);
});

test('regionsInRange reports distinct regions', () => {
  const commits = [commit(1, { a: 1 }), commit(1, { b: 1 }), commit(1, { a: 1 })];
  assert.deepEqual([...regionsInRange(commits, 0, 3)].sort(), ['a', 'b']);
  assert.deepEqual([...regionsInRange(commits, 2, 3)], ['a']);
});

test('renderBudget is the normalized composite', () => {
  assert.equal(renderBudget(NORMALIZATION.R * 2, NORMALIZATION.F * 4), 3);
});

test('computeMetrics excludes mount work and emits per-phase secondaries', () => {
  const commits = [
    commit(100, { topbar: 10 }), // mount
    ...Array.from({ length: 9 }, () => commit(10, { watchlist: 1, chart: 1 })),
  ];
  const scenario = {
    phases: Object.fromEntries(
      PHASE_SCRIPT.order.map((phase, index) => [
        phase,
        { commitStart: 1 + index, commitEnd: 2 + index },
      ]),
    ),
  };
  const metrics = computeMetrics({ commits, mountCommits: 1, scenario, scenarioMs: 1234 }, 'sha256:test');
  assert.equal(metrics.region_renders, 18);
  assert.equal(metrics.fiber_renders, 90);
  assert.equal(metrics.region_renders_mount, 1);
  assert.equal(metrics.fiber_renders_mount, 100);
  for (const phase of PHASE_SCRIPT.order) {
    assert.equal(metrics[`region_renders_${phase}`], 2);
    assert.equal(metrics[`fiber_renders_${phase}`], 10);
    assert.equal(metrics[`commits_${phase}`], 1);
  }
  assert.equal(metrics.workload_hash, 'sha256:test');
});

test('metricsSignature ignores timing and the hash but not counts', () => {
  const base = { a: 1, scenario_ms: 5, workload_hash: 'x' };
  assert.equal(metricsSignature(base), metricsSignature({ ...base, scenario_ms: 9, workload_hash: 'y' }));
  assert.notEqual(metricsSignature(base), metricsSignature({ ...base, a: 2 }));
});

test('computeSpreadPct is zero for identical runs', () => {
  const run = (fiberRenders) => ({
    commits: [commit(fiberRenders, { topbar: 1 })],
    mountCommits: 0,
  });
  assert.equal(computeSpreadPct([run(10), run(10)]), 0);
  assert.ok(computeSpreadPct([run(10), run(20)]) > 0);
});

test('the region manifest lists exactly twelve regions', () => {
  assert.equal(REGION_MANIFEST.length, 12);
  assert.equal(new Set(REGION_MANIFEST).size, 12);
});
