/**
 * Bench-owned fixture origins.
 *
 * A single HTTP origin (the application receives its base URL as `PIM_URL`)
 * that hosts three path groups:
 *
 *   /api/*            PIM API: product, promo, reviews, shipping. Fixed
 *                     per-request latency, so an in-app sleep cannot be
 *                     "optimized" away.
 *   /cdn/<slug>/...   Image CDN: baked fixture assets with `w` and `fmt`
 *                     parameters. The CDN picks the largest baked width that
 *                     does not exceed the request.
 *   /fonts/*          Brand webfont files as served by the PIM origin.
 *
 * Every response carries `Access-Control-Allow-Origin` (fonts and client
 * fetches are cross-origin) and `Timing-Allow-Origin` (resource timing
 * otherwise reports zero sizes cross-origin, which would blind the font and
 * phase attribution checks).
 */

import fs from 'node:fs';
import http from 'node:http';
import { SEEDS, SEED_SLUGS, assetSize, assetsForSeed, generateDataset } from './dataset.js';
import { WORKLOAD } from './config.js';
import { FONT_FILES, FORMAT_EXT, fixturePath, fontPath, widthTiers } from './fixtures.js';

const DATASET_CACHE = new Map();

function datasetFor(seed) {
  const key = String(seed);
  if (!DATASET_CACHE.has(key)) {
    DATASET_CACHE.set(key, generateDataset(key));
  }
  return DATASET_CACHE.get(key);
}

function send(res, status, headers, body) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Timing-Allow-Origin': '*',
    ...headers,
  });
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(value));
}

/**
 * Largest baked width that does not exceed the request; the smallest tier
 * when the request is below every baked width. Never upscales past a tier.
 */
export function pickWidth(tiers, requested) {
  if (!requested) return tiers[tiers.length - 1];
  const below = tiers.filter((w) => w <= requested);
  if (below.length > 0) return Math.max(...below);
  return Math.min(...tiers);
}

function serveImage(res, namespace, asset, searchParams) {
  // Accept either the raw seed or the fixture-directory slug as the namespace.
  const seed =
    SEEDS.find((s) => s === namespace) ?? SEEDS.find((s) => SEED_SLUGS[s] === namespace);
  if (!seed) {
    sendJson(res, 404, { error: `unknown image namespace: ${namespace}` });
    return;
  }
  if (!assetsForSeed(seed).includes(asset)) {
    sendJson(res, 404, { error: `unknown asset: ${asset}` });
    return;
  }

  const tiers = widthTiers(assetSize(seed, asset).width);
  const requestedWidth = Number.parseInt(searchParams.get('w') ?? '', 10);
  const width = pickWidth(tiers, Number.isNaN(requestedWidth) ? null : requestedWidth);
  const fmt = searchParams.get('fmt') === 'webp' ? 'webp' : 'jpeg';
  const slug = SEED_SLUGS[seed];
  const file = fixturePath(slug, asset, width, FORMAT_EXT[fmt]);
  if (!fs.existsSync(file)) {
    sendJson(res, 404, { error: `fixture not baked: ${slug}/${asset}-${width}.${FORMAT_EXT[fmt]}` });
    return;
  }
  send(
    res,
    200,
    {
      'Content-Type': fmt === 'webp' ? 'image/webp' : 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
    fs.readFileSync(file),
  );
}

function serveFont(res, file) {
  if (!FONT_FILES.includes(file)) {
    sendJson(res, 404, { error: `unknown font: ${file}` });
    return;
  }
  const abs = fontPath(file);
  if (!fs.existsSync(abs)) {
    sendJson(res, 404, { error: `font fixture missing: ${file}` });
    return;
  }
  send(
    res,
    200,
    { 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=31536000, immutable' },
    fs.readFileSync(abs),
  );
}

function handle(req, res) {
  const url = new URL(req.url, 'http://origin.invalid');
  const { pathname, searchParams } = url;

  if (pathname.startsWith('/api/')) {
    const dataset = datasetFor(searchParams.get('seed') ?? '');
    setTimeout(() => {
      switch (pathname) {
        case '/api/product':
          sendJson(res, 200, dataset.product);
          break;
        case '/api/promo':
          sendJson(res, 200, dataset.promo);
          break;
        case '/api/reviews':
          sendJson(res, 200, { reviews: dataset.reviews });
          break;
        case '/api/shipping':
          sendJson(res, 200, dataset.shipping);
          break;
        default:
          sendJson(res, 404, { error: `unknown API route: ${pathname}` });
      }
    }, WORKLOAD.origins.apiLatencyMs);
    return;
  }

  if (pathname.startsWith('/fonts/')) {
    const file = pathname.slice('/fonts/'.length);
    setTimeout(() => serveFont(res, file), WORKLOAD.origins.apiLatencyMs);
    return;
  }

  if (pathname.startsWith('/cdn/')) {
    const [, , slug, asset] = pathname.split('/');
    serveImage(res, slug, asset, searchParams);
    return;
  }

  sendJson(res, 404, { error: `not found: ${pathname}` });
}

/** Starts the origins on an ephemeral loopback port. */
export async function startOrigins() {
  const server = http.createServer((req, res) => {
    try {
      handle(req, res);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}`;
  return {
    server,
    port,
    url,
    close: () =>
      new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
