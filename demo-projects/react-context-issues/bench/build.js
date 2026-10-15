/**
 * Build and static-serve the application under test.
 *
 * The production Vite build writes to `.cache/dist` (generated state). The
 * harness serves that directory itself over an ephemeral loopback port, so no
 * package-manager wrapper is involved and teardown is guaranteed.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const require = createRequire(import.meta.url);
const VITE_BIN = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');

/** Generated paths owned by the harness, reset before each measured run. */
export const GENERATED_RUNTIME_PATHS = ['.cache/dist'];

export function resetGeneratedState(root) {
  for (const rel of GENERATED_RUNTIME_PATHS) {
    fs.rmSync(path.join(root, rel), { recursive: true, force: true });
  }
}

function run(command, args, { cwd, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${path.basename(command)} timed out after ${timeoutMs}ms`));
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
      resolve({ code, stdout, stderr });
    });
  });
}

/** Runs the production Vite build. */
export async function buildApp({ root, timeoutMs = 120000 }) {
  const started = performance.now();
  const result = await run(process.execPath, [VITE_BIN, 'build', '--logLevel', 'warn'], {
    cwd: root,
    timeoutMs,
  });
  if (result.code !== 0) {
    throw new Error(`vite build failed (exit ${result.code})\n${result.stdout}\n${result.stderr}`);
  }
  return { ms: Math.round(performance.now() - started) };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/** Serves the built app on an ephemeral loopback port. */
export async function startApp({ root, timeoutMs = 15000 }) {
  const dist = path.join(root, '.cache/dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    throw new Error('build output missing: .cache/dist/index.html');
  }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://app.invalid');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    let filePath = path.resolve(dist, `.${pathname}`);
    if (!filePath.startsWith(dist)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      if (path.extname(pathname)) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      filePath = path.join(dist, 'index.html');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(filePath).pipe(res);
  });

  const started = performance.now();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}`;
  try {
    const response = await fetch(`${url}/`, { signal: AbortSignal.timeout(timeoutMs) });
    if (response.status !== 200) throw new Error(`static server responded ${response.status}`);
  } catch (error) {
    await new Promise((resolve) => server.close(resolve));
    throw error;
  }

  return {
    url,
    port,
    ms: Math.round(performance.now() - started),
    stop: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
