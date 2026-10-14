#!/usr/bin/env node
/**
 * Development / demo runner.
 *
 * Boots the seeded fixture endpoints and the Vite dev server together, with
 * `BENCH_ORIGINS_URL` wired up so the dev server proxies `/api/*`, so the
 * dashboard can be opened in a browser without the benchmark:
 *
 *     pnpm dev
 *     pnpm dev --port 5200     # optional: Vite dev port (default 5300)
 *
 * The benchmark is unaffected: it serves a production build itself and
 * fulfils the fixture endpoints in-page.
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEEDS } from './config.js';
import { startOrigins } from './origins.js';
import { spawnTree, stopTree } from './process.js';

const require = createRequire(import.meta.url);
const VITE_BIN = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const portIndex = argv.indexOf('--port');
const port = portIndex !== -1 ? argv[portIndex + 1] : (process.env.PORT ?? '5300');
const origins = await startOrigins();

const app = spawnTree(process.execPath, [VITE_BIN, '--host', '127.0.0.1', '--port', String(port)], {
  cwd: ROOT,
  env: { ...process.env, BENCH_ORIGINS_URL: origins.url },
  stdio: 'inherit',
});

process.stdout.write(
  [
    '',
    `fixture endpoints: ${origins.url}  (/api/snapshot, /api/timeline, /api/orders)`,
    'open the dashboard:',
    ...SEEDS.map((seed) => `  http://127.0.0.1:${port}/?seed=${seed}`),
    'stop with Ctrl-C.',
    '',
  ].join('\n'),
);

let stopping = false;
const shutdown = async (code) => {
  if (stopping) return;
  stopping = true;
  await stopTree(app);
  await origins.close().catch(() => {});
  process.exit(code);
};

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
app.on('exit', (code, signal) => {
  shutdown(signal ? 0 : (code ?? 0));
});
