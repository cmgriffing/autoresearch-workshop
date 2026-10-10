#!/usr/bin/env node
/**
 * One-time, machine-local setup:
 *
 *   1. strict content-manifest clean-state check — baselines are only ever
 *      captured from a pristine demo directory;
 *   2. baseline capture for both seeds (hero grids, crop validation, before
 *      screenshots) plus one benchmark pass whose metrics are recorded as the
 *      baseline metrics.
 *
 * Exits non-zero when the pristine application fails the benchmark's oracle.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCleanState, formatCleanStateReport } from './manifest.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const state = checkCleanState(ROOT);
if (!state.ok) {
  process.stderr.write(`${formatCleanStateReport(state)}\n`);
  process.stderr.write('setup aborted: the demo must be pristine before a baseline is captured.\n');
  process.exit(1);
}
process.stdout.write('setup: clean-state check ok (pristine)\n');

const started = performance.now();
const result = spawnSync(process.execPath, [path.join(ROOT, 'bench', 'run.js'), '--capture', '--record-metrics'], {
  cwd: ROOT,
  stdio: 'inherit',
});
const seconds = ((performance.now() - started) / 1000).toFixed(1);

if (result.status !== 0) {
  process.stderr.write(`setup failed after ${seconds}s\n`);
  process.exit(result.status ?? 1);
}
process.stdout.write(`setup: capture + baseline bench pass ok in ${seconds}s\n`);
