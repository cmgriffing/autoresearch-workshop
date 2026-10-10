#!/usr/bin/env node
/**
 * Development / demo runner.
 *
 * Boots the bench-owned fixture origins (PIM API, image CDN, fonts) and the
 * Next.js dev server together, with `PIM_URL` wired up, so the storefront can
 * be opened in a browser for demos and UI work without the benchmark:
 *
 *     pnpm dev
 *     pnpm dev --port 3100     # optional: Next dev port (default 3000)
 *
 * The benchmark harness is unaffected: it boots its own origins on an
 * ephemeral port per run and measures a production build.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEEDS } from './dataset.js';
import { startOrigins } from './origins.js';

const require = createRequire(import.meta.url);
const NEXT_BIN = require.resolve('next/dist/bin/next');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const portIndex = argv.indexOf('--port');
const port = portIndex !== -1 ? argv[portIndex + 1] : process.env.PORT;
const appArgs = ['dev'];
if (port) appArgs.push('-p', String(port));

const origins = await startOrigins();
const app = spawn(process.execPath, [NEXT_BIN, ...appArgs], {
  cwd: ROOT,
  env: { ...process.env, PIM_URL: origins.url },
  stdio: 'inherit',
});

const base = `http://localhost:${port ?? 3000}`;
process.stdout.write(
  [
    '',
    `fixture origins: ${origins.url}  (PIM API, image CDN, fonts)`,
    'open the storefront:',
    ...SEEDS.map((seed) => `  ${base}/?seed=${seed}`),
    'stop with Ctrl-C.',
    '',
  ].join('\n'),
);

let stopping = false;
const shutdown = async (code) => {
  if (stopping) return;
  stopping = true;
  if (app.exitCode === null) app.kill('SIGTERM');
  await origins.close().catch(() => {});
  process.exit(code);
};

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
app.on('exit', (code, signal) => {
  // The dev server stopping (or failing to start) ends the session too.
  shutdown(signal ? 0 : (code ?? 0));
});
