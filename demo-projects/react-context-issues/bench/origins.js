/**
 * Bench-owned fixture endpoints.
 *
 * One handler serves the seeded snapshot, timeline and order history. It is
 * used in two ways: the benchmark fulfils in-page requests through
 * `page.route` (no network), and `bench/dev.js` exposes the same handler over
 * HTTP so a human can use the dashboard outside a session.
 *
 * Endpoints (always addressed with `?seed=`):
 *   /api/snapshot   instruments, positions and news for the seed
 *   /api/timeline   the full deterministic tick timeline
 *   /api/orders     the historical order blotter
 */

import http from 'node:http';
import { generateDataset, ordersFor, snapshotFor, timelineFor } from './dataset.js';

const DATASET_CACHE = new Map();

export function datasetFor(seed) {
  const key = String(seed);
  if (!DATASET_CACHE.has(key)) {
    DATASET_CACHE.set(key, generateDataset(key));
  }
  return DATASET_CACHE.get(key);
}

/**
 * Resolves one fixture request to a response descriptor:
 * `{ status, contentType, body }` (body is a string).
 */
export function handleFixtureRequest(pathname, searchParams) {
  const seed = searchParams.get('seed') ?? '';
  const dataset = datasetFor(seed);
  switch (pathname) {
    case '/api/snapshot':
      return { status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(snapshotFor(dataset)) };
    case '/api/timeline':
      return { status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(timelineFor(dataset)) };
    case '/api/orders':
      return { status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(ordersFor(dataset)) };
    default:
      return { status: 404, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ error: `unknown fixture route: ${pathname}` }) };
  }
}

function send(res, descriptor) {
  res.writeHead(descriptor.status, { 'Content-Type': descriptor.contentType });
  res.end(descriptor.body);
}

/** Starts the fixture endpoints on an ephemeral loopback port. */
export async function startOrigins({ latencyMs = 20 } = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://origins.invalid');
    const descriptor = handleFixtureRequest(url.pathname, url.searchParams);
    setTimeout(() => send(res, descriptor), latencyMs);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    server,
    port,
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
