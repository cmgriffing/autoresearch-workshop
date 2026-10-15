#!/usr/bin/env node
/**
 * Pre-flight check: correctness suite, then the benchmark.
 *
 * Prints per-step timings and the observed values only — never expected
 * results or optimization suggestions. Exits non-zero if any step fails.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

const steps = [
  ['test', 'node', ['--test', 'test/*.test.js']],
  ['bench', 'node', ['bench/run.js']],
];

for (const [name, command, args] of steps) {
  const started = performance.now();
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: false });
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  if (result.status !== 0) {
    process.stderr.write(`verify: ${name} failed after ${seconds}s\n`);
    process.exit(result.status ?? 1);
  }
  process.stdout.write(`verify: ${name} ok (${seconds}s)\n`);
}
