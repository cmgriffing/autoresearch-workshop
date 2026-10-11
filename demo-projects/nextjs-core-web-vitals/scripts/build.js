#!/usr/bin/env node
/** Build with a supplied PIM_URL or temporary bench-owned fixture origins. */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startOrigins } from '../bench/origins.js';
import { spawnTree, stopTree } from '../bench/process.js';

const require = createRequire(import.meta.url);
const NEXT_BIN = require.resolve('next/dist/bin/next');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const origins = process.env.PIM_URL ? null : await startOrigins();
const pimUrl = process.env.PIM_URL || origins.url;
if (origins) {
  process.stdout.write(`fixture origins: ${pimUrl} (PIM API, image CDN, fonts)\n`);
}

let app;
let stopping = false;
const shutdown = async (code) => {
  if (stopping) return;
  stopping = true;
  await stopTree(app);
  if (origins) await origins.close().catch(() => {});
  process.exit(code);
};

process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));

try {
  app = spawnTree(process.execPath, [NEXT_BIN, 'build', ...process.argv.slice(2)], {
    cwd: ROOT,
    env: { ...process.env, PIM_URL: pimUrl },
    stdio: 'inherit',
  });
  app.on('error', (error) => {
    process.stderr.write(`build failed: ${error.message}\n`);
    shutdown(1);
  });
  app.on('exit', (code, signal) => {
    shutdown(code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1));
  });
} catch (error) {
  process.stderr.write(`build failed: ${error.message}\n`);
  await shutdown(1);
}
