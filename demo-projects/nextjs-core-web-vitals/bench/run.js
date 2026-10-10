#!/usr/bin/env node
/**
 * Benchmark entry point.
 *
 * Run order: state reset → origins → build → start → (baseline policy) →
 * verify pass on the verify seed (oracle gate) → one warm-up load reported as
 * `*_cold` → three measured loads (median primary). Output: at most ten
 * human-facing lines, then all `METRIC` lines last. The oracle is evaluated
 * before any passing summary and the process exits non-zero when it fails.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED_SLUGS, TIMED_SEED, VERIFY_SEED, generateDataset } from './dataset.js';
import { WORKLOAD } from './config.js';
import { startOrigins } from './origins.js';
import { buildApp, findFreePort, resetGeneratedState, startApp } from './build.js';
import { launchBrowser, runLoad } from './measure.js';
import { evaluateOracle, formatOracleFailures } from './oracle.js';
import { checkCleanState, formatCleanStateReport } from './manifest.js';
import { computeWorkloadHash } from './workload-hash.js';
import { captureBaselines } from './capture.js';
import {
  gridForSeed,
  isValidBaseline,
  makeBaselineKey,
  readBaseline,
  writeBaselineMetrics,
} from './baseline.js';
import { aggregateRuns } from './metrics.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const round1 = (value) => Math.round(value * 10) / 10;

function assertLoadValid(label, load) {
  if (!load.metrics.lcp || load.metrics.lcp.renderTime <= 0) {
    throw new Error(`${label}: LCP is missing or zero — the measurement cannot be trusted`);
  }
  if ((load.pageErrors ?? []).length > 0) {
    throw new Error(`${label}: uncaught page error: ${load.pageErrors.join(' | ')}`);
  }
  if ((load.hydrationErrors ?? []).length > 0) {
    throw new Error(`${label}: hydration error: ${load.hydrationErrors.join(' | ')}`);
  }
}

async function main() {
  const flags = new Set(process.argv.slice(2));
  const captureFlag = flags.has('--capture');
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
    const state = checkCleanState(ROOT);
    if (captureFlag && !state.ok) {
      throw new Error(`setup requires a pristine demo directory.\n${formatCleanStateReport(state)}`);
    }

    const resetStart = performance.now();
    resetGeneratedState(ROOT);
    const resetMs = Math.round(performance.now() - resetStart);

    const origins = await startOrigins();
    teardowns.push(() => origins.close());

    const env = { ...process.env, PIM_URL: origins.url };
    const { ms: buildMs } = await buildApp({ root: ROOT, env });
    const port = await findFreePort();
    const app = await startApp({ root: ROOT, env, port });
    teardowns.push(() => app.stop());
    log(`reset ${resetMs}ms | build ${buildMs}ms | start ${app.ms}ms`);

    const browser = await launchBrowser();
    teardowns.push(() => browser.close());
    const appOrigin = new URL(app.url).origin;
    const originsOrigin = new URL(origins.url).origin;
    const browserMajor = browser.version().split('.')[0];
    const baselineKey = makeBaselineKey({ root: ROOT, browserMajor });

    let baseline = readBaseline(ROOT);
    if (captureFlag) {
      log('capturing oracle baselines for both seeds');
      baseline = await captureBaselines({ root: ROOT, browser, appUrl: app.url, baselineKey, log });
    } else if (!isValidBaseline(baseline, baselineKey)) {
      if (!state.ok) {
        throw new Error(
          'no valid oracle baseline and the demo is modified.\n' +
            formatCleanStateReport(state) +
            '\nRestore the demo and re-run `pnpm setup` to capture a baseline.',
        );
      }
      log('no valid baseline on a pristine demo — capturing one');
      baseline = await captureBaselines({ root: ROOT, browser, appUrl: app.url, baselineKey, log });
    }

    // ------------------------------------------------------- verify pass
    const verifyLoad = await runLoad({ browser, appUrl: app.url, seed: VERIFY_SEED, mode: 'oracle' });
    const oracle = evaluateOracle({
      seed: VERIFY_SEED,
      dataset: generateDataset(VERIFY_SEED),
      load: verifyLoad,
      baselineGrid: gridForSeed(baseline, VERIFY_SEED),
      appOrigin,
      originsOrigin,
    });
    if (!oracle.ok) {
      throw new Error(
        `oracle failed on the verify seed ${VERIFY_SEED}\n${formatOracleFailures(oracle.failures)}`,
      );
    }
    log(
      `verify ${SEED_SLUGS[VERIFY_SEED]}: oracle ok (${verifyLoad.outcomes.length} interactions, hero_diff ${oracle.signals.hero_diff}, font_bytes ${oracle.signals.font_bytes})`,
    );

    // ------------------------------------------------------- warm-up + measured
    const cold = await runLoad({ browser, appUrl: app.url, seed: TIMED_SEED, mode: 'metrics' });
    assertLoadValid('warm-up', cold);
    log(
      `warm-up (cold): lcp ${round1(cold.metrics.lcp.renderTime)}ms cls ${cold.metrics.cls} inp ${round1(cold.metrics.inpMs)}ms`,
    );

    const runs = [];
    for (let index = 0; index < WORKLOAD.loadShape.measured; index += 1) {
      const load = await runLoad({ browser, appUrl: app.url, seed: TIMED_SEED, mode: 'metrics' });
      assertLoadValid(`load ${index + 1}`, load);
      runs.push(load);
      log(
        `load ${index + 1}/${WORKLOAD.loadShape.measured}: lcp ${round1(load.metrics.lcp.renderTime)}ms cls ${load.metrics.cls} inp ${round1(load.metrics.inpMs)}ms`,
      );
    }

    const metrics = aggregateRuns(runs, cold);
    const workloadHash = computeWorkloadHash(ROOT);
    const elapsedSeconds = (performance.now() - started) / 1000;
    log(`total ${elapsedSeconds.toFixed(1)}s`);

    output = {
      humanLines,
      metrics: {
        ...metrics,
        hero_diff: oracle.signals.hero_diff,
        font_bytes: oracle.signals.font_bytes,
        workload_hash: workloadHash,
      },
      workloadHash,
      elapsedSeconds,
    };
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
  const metricEntries = Object.entries(output.metrics);
  for (const [name, value] of metricEntries) {
    process.stdout.write(`METRIC ${name}=${value}\n`);
  }

  if (recordMetrics) {
    writeBaselineMetrics(ROOT, {
      recordedAt: new Date().toISOString(),
      seeds: { timed: TIMED_SEED, verify: VERIFY_SEED },
      workload_hash: output.workloadHash,
      metrics: output.metrics,
    });
  }

  process.exit(0);
}

main();
