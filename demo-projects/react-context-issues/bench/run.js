#!/usr/bin/env node
/**
 * Benchmark entry point.
 *
 * Run order: state reset → build → serve → verify pass on the verify seed
 * (oracle gate) → one warm-up session → two measured sessions (identical by
 * construction; `spread_pct` must be zero). Output: at most ten human-facing
 * lines, then all `METRIC` lines last. The oracle is evaluated before any
 * passing summary and the process exits non-zero when it fails.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIMED_SEED, VIEWPORTS, VERIFY_SEED } from './config.js';
import { generateDataset } from './dataset.js';
import { buildApp, resetGeneratedState, startApp } from './build.js';
import { launchBrowser, runDashboard } from './measure.js';
import { evaluateOracle, formatOracleFailures } from './oracle.js';
import { computeMetrics, computeSpreadPct, metricsSignature, sliceTotals } from './metrics.js';
import { computeWorkloadHash } from './workload-hash.js';
import { makeBaselineKey, writeBaselineMetrics } from './baseline.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MEASURED_RUNS = 2;

function totalsLine(run) {
  const totals = sliceTotals(run.commits, run.mountCommits, run.commits.length);
  return `region_renders ${totals.regionRenders} fiber_renders ${totals.fiberRenders} commits ${totals.commits}`;
}

async function main() {
  const flags = new Set(process.argv.slice(2));
  const recordMetrics = flags.has('--record-metrics');
  const humanLines = [];
  const log = (line) => {
    if (humanLines.length < 10) humanLines.push(line);
  };

  const teardowns = [];
  const started = performance.now();
  let failure = null;
  let output = null;

  try {
    const resetStart = performance.now();
    resetGeneratedState(ROOT);
    const resetMs = Math.round(performance.now() - resetStart);

    const { ms: buildMs } = await buildApp({ root: ROOT });
    const app = await startApp({ root: ROOT });
    teardowns.push(() => app.stop());
    log(`reset ${resetMs}ms | build ${buildMs}ms | serve ${app.ms}ms`);

    const browser = await launchBrowser();
    teardowns.push(() => browser.close());
    const workloadHash = computeWorkloadHash();
    const browserMajor = browser.version().split('.')[0];

    // ------------------------------------------------------- verify pass
    const verifyRun = await runDashboard(browser, { appUrl: app.url, seed: VERIFY_SEED });
    const oracle = evaluateOracle({ dataset: generateDataset(VERIFY_SEED), run: verifyRun });
    if (!oracle.ok) {
      throw new Error(
        `oracle failed on the verify seed ${VERIFY_SEED}\n${formatOracleFailures(oracle.failures)}`,
      );
    }
    log(`verify ${VERIFY_SEED}: oracle ok (${verifyRun.scenario.steps.length} steps)`);

    // --------------------------------------------- warm-up + measured runs
    const warmup = await runDashboard(browser, { appUrl: app.url, seed: TIMED_SEED });
    log(`warm-up ${TIMED_SEED}: ${totalsLine(warmup)}`);

    const measured = [];
    for (let index = 0; index < MEASURED_RUNS; index += 1) {
      measured.push(await runDashboard(browser, { appUrl: app.url, seed: TIMED_SEED }));
    }
    const signatures = measured.map((run) => metricsSignature(computeMetrics(run, workloadHash)));
    if (!signatures.every((signature) => signature === signatures[0])) {
      throw new Error(
        'repeated measured runs produced different render metrics — the benchmark is not deterministic on this machine',
      );
    }
    measured.forEach((run, index) => log(`run ${index + 1}/${MEASURED_RUNS}: ${totalsLine(run)}`));

    const metrics = computeMetrics(measured[0], workloadHash);
    metrics.spread_pct = computeSpreadPct(measured);
    const elapsedSeconds = (performance.now() - started) / 1000;
    log(`total ${elapsedSeconds.toFixed(1)}s`);

    output = { humanLines, metrics, workloadHash, browserMajor, appUrl: app.url };
    if (recordMetrics) {
      writeBaselineMetrics(ROOT, {
        key: makeBaselineKey({ workloadHash, browserMajor, viewport: VIEWPORTS.default }),
        metrics,
        run: {
          seed: TIMED_SEED,
          measuredRuns: MEASURED_RUNS,
          scenarioMs: measured[0].scenarioMs,
        },
      });
      log(`baseline recorded: render_budget ${metrics.render_budget}`);
    }
  } catch (error) {
    failure = error;
  } finally {
    for (const teardown of teardowns.reverse()) {
      try {
        await teardown();
      } catch {
        // teardown is best-effort; the process is about to exit
      }
    }
  }

  if (failure) {
    for (const line of humanLines) process.stderr.write(`${line}\n`);
    process.stderr.write(`bench failed: ${failure.message}\n`);
    process.exit(1);
  }

  for (const line of output.humanLines) process.stdout.write(`${line}\n`);
  for (const [name, value] of Object.entries(output.metrics)) {
    process.stdout.write(`METRIC ${name}=${value}\n`);
  }
  process.exit(0);
}

main();
