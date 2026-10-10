/**
 * Build and server lifecycle for the application under test.
 *
 * Runs `next build` and `next start` as direct child Node processes (never
 * through a package-manager wrapper) so teardown is guaranteed. The Next CLI
 * is resolved from the installed package; the demo pins its version.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const NEXT_BIN = require.resolve('next/dist/bin/next');

export const GENERATED_RUNTIME_PATHS = [
  '.cache/next/cache/images',
  '.cache/next/cache/fetch-cache',
];

/**
 * Per-invocation state reset. Removes the image-optimizer and fetch caches
 * only; `.cache/oracle/` (the machine-local baseline) is never touched.
 */
export function resetGeneratedState(root) {
  for (const rel of GENERATED_RUNTIME_PATHS) {
    fs.rmSync(path.join(root, rel), { recursive: true, force: true });
  }
}

export function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function runNext(args, { cwd, env, timeoutMs = 120000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [NEXT_BIN, ...args], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`next ${args[0]} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, child });
    });
  });
}

export async function buildApp({ root, env, timeoutMs }) {
  const started = performance.now();
  const result = await runNext(['build'], { cwd: root, env, timeoutMs });
  if (result.code !== 0) {
    throw new Error(`next build failed (exit ${result.code})\n${result.stdout}\n${result.stderr}`);
  }
  return { ms: Math.round(performance.now() - started) };
}

import { spawnTree, stopTree } from './process.js';

export async function startApp({ root, env, port, timeoutMs = 30000 }) {
  const started = performance.now();
  const child = spawnTree(process.execPath, [NEXT_BIN, 'start', '-p', String(port)], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });

  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + timeoutMs;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`next start exited early (code ${child.exitCode})\n${output}`);
    }
    try {
      const response = await fetch(`${url}/`, { signal: AbortSignal.timeout(2000) });
      // Any HTTP response (even an error page) means the server is listening.
      if (response.status > 0) {
        ready = true;
        break;
      }
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!ready) {
    await stopTree(child, { timeoutMs: 1000 });
    throw new Error(`next start did not become ready within ${timeoutMs}ms\n${output}`);
  }

  const stop = () => stopTree(child);

  return { url, ms: Math.round(performance.now() - started), stop, child };
}
