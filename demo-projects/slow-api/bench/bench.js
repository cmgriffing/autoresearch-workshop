import { randomBytes } from 'node:crypto';
import { existsSync, copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { createApp, setupSchema } from '../src/index.js';
import { generateBaseDatabase, COUNTS } from './data.js';
import { createInstrumentedDatabase } from './instrumented-db.js';
import { buildReferenceDatabase, computeReference, REFERENCE_COUNTS } from './reference.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE = join(ROOT, '.cache');

const TIMED_SEED = 42;
const VERIFY_SEED = 99;

mkdirSync(CACHE, { recursive: true });

function hashWorkload(scenarioParams) {
  const h = createHash('sha256');
  h.update(JSON.stringify(COUNTS));
  h.update(String(TIMED_SEED));
  h.update(String(VERIFY_SEED));
  h.update(JSON.stringify(scenarioParams));
  return h.digest('hex').slice(0, 16);
}

function ensureBaseDatabase(seed) {
  const name = `base-${seed}.db`;
  const path = join(CACHE, name);
  if (!existsSync(path)) {
    const start = performance.now();
    generateBaseDatabase(path, seed, COUNTS);
    const elapsed = (performance.now() - start).toFixed(1);
    console.log(`generated ${name} in ${elapsed} ms`);
  }
  return path;
}

function freshRunDb(seed) {
  const base = ensureBaseDatabase(seed);
  const runId = randomBytes(8).toString('hex');
  const runPath = join(CACHE, `run-${seed}-${runId}.db`);
  copyFileSync(base, runPath);
  const instrumented = createInstrumentedDatabase(runPath);
  setupSchema(instrumented.db);
  return { path: runPath, instrumented };
}

function findBusyIds(db) {
  const customer = db.prepare(
    `SELECT customer_id FROM orders GROUP BY customer_id ORDER BY COUNT(*) DESC LIMIT 1`
  ).get();
  const product = db.prepare(
    `SELECT product_id FROM reviews GROUP BY product_id ORDER BY COUNT(*) DESC LIMIT 1`
  ).get();
  const order = db.prepare(
    `SELECT order_id FROM order_items GROUP BY order_id ORDER BY COUNT(*) DESC LIMIT 1`
  ).get();
  return {
    customerId: customer?.customer_id ?? 1,
    productId: product?.product_id ?? 1,
    orderId: order?.order_id ?? 1,
  };
}

function buildScenarios(ids) {
  return [
    { name: 'customers_list', request: { method: 'GET', path: '/customers', query: { page: '1', pageSize: '20', sort: 'name', order: 'asc' } } },
    { name: 'customers_filtered', request: { method: 'GET', path: '/customers', query: { filter: 'Customer 500', filterField: 'name', page: '1', pageSize: '20' } } },
    { name: 'customers_sorted', request: { method: 'GET', path: '/customers', query: { page: '1', pageSize: '50', sort: 'city', order: 'desc' } } },
    { name: 'customers_deep_page', request: { method: 'GET', path: '/customers', query: { page: '500', pageSize: '20', sort: 'id', order: 'asc' } } },
    { name: 'customer_detail', request: { method: 'GET', path: `/customers/${ids.customerId}` } },
    { name: 'products_list', request: { method: 'GET', path: '/products', query: { page: '1', pageSize: '20', sort: 'price', order: 'desc' } } },
    { name: 'products_search', request: { method: 'GET', path: '/products', query: { search: 'electronics', page: '1', pageSize: '20' } } },
    { name: 'product_detail', request: { method: 'GET', path: `/products/${ids.productId}` } },
    { name: 'orders_list', request: { method: 'GET', path: '/orders', query: { page: '1', pageSize: '20', sort: 'created_at', order: 'desc' } } },
    { name: 'orders_filtered', request: { method: 'GET', path: '/orders', query: { filter: 'pending', filterField: 'status', page: '1', pageSize: '20' } } },
    { name: 'order_detail', request: { method: 'GET', path: `/orders/${ids.orderId}` } },
    { name: 'reviews_aggregate', request: { method: 'GET', path: '/reviews/aggregate' } },
    { name: 'write_order', request: { method: 'POST', path: '/orders', body: { customer_id: ids.customerId, items: [{ product_id: ids.productId, quantity: 2 }, { product_id: Math.min(ids.productId + 1, COUNTS.products), quantity: 1 }] } } },
  ];
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a == null || b == null) return a === b;
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) < 1e-9;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a).sort();
    const bk = Object.keys(b).sort();
    if (ak.length !== bk.length) return false;
    return ak.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

function normalizeResponse(res) {
  return JSON.parse(JSON.stringify(res, (_, v) => {
    if (typeof v === 'number') return Math.round(v * 1e6) / 1e6;
    return v;
  }));
}

function runScenarios(instrumented, scenarioList) {
  const handle = createApp(instrumented.db);
  const results = [];
  for (const { name, request } of scenarioList) {
    instrumented.reset();
    const start = performance.now();
    const response = handle(request);
    const elapsed = performance.now() - start;
    const metrics = instrumented.metrics();
    results.push({ name, response, elapsed, metrics });
  }
  return results;
}

function verifyScenarios(appResults, scenarioList, seed) {
  const refPath = join(CACHE, `reference-${seed}.db`);
  if (existsSync(refPath)) rmSync(refPath);
  buildReferenceDatabase(refPath, seed);
  const refDb = new DatabaseSync(refPath);

  const fullRefPath = join(CACHE, `reference-full-${seed}.db`);
  if (existsSync(fullRefPath)) rmSync(fullRefPath);
  const baseFull = ensureBaseDatabase(seed);
  copyFileSync(baseFull, fullRefPath);
  const fullRefDb = new DatabaseSync(fullRefPath);

  for (let i = 0; i < scenarioList.length; i++) {
    const { name, request } = scenarioList[i];
    const actual = appResults[i].response;

    const fullExpected = computeReference(request, fullRefDb);
    if (!deepEqual(normalizeResponse(fullExpected), normalizeResponse(actual))) {
      throw new Error(`oracle mismatch in scenario "${name}" for seed ${seed}`);
    }
  }

  refDb.close();
  fullRefDb.close();
}

function main() {
  // Discover busy IDs from the timed base database.
  const timedBasePath = ensureBaseDatabase(TIMED_SEED);
  const idDb = new DatabaseSync(timedBasePath);
  const timedIds = findBusyIds(idDb);
  idDb.close();

  const scenarioList = buildScenarios(timedIds);
  const workloadHash = hashWorkload({ ids: timedIds });

  // Timed run.
  const timed = freshRunDb(TIMED_SEED);
  const timedResults = runScenarios(timed.instrumented, scenarioList);

  // Verification run on a different seed.
  const verify = freshRunDb(VERIFY_SEED);
  const verifyResults = runScenarios(verify.instrumented, scenarioList);

  // Cross-check expected results.
  verifyScenarios(timedResults, scenarioList, TIMED_SEED);
  verifyScenarios(verifyResults, scenarioList, VERIFY_SEED);

  // Aggregate metrics from the timed run.
  let totalMs = 0;
  let totalStatements = 0;
  let totalDistinct = 0;
  let totalScans = 0;
  const perScenario = [];
  for (const r of timedResults) {
    totalMs += r.elapsed;
    totalStatements += r.metrics.statements;
    totalDistinct += r.metrics.distinct_statements;
    totalScans += r.metrics.full_scans;
    perScenario.push({ name: r.name, ms: r.elapsed });
  }

  // Clean up run databases.
  try { rmSync(timed.path); } catch {}
  try { rmSync(verify.path); } catch {}

  // Human summary (<= 10 lines).
  console.log(`slow-api benchmark: ${scenarioList.length} scenarios`);
  console.log(`total scenario time: ${totalMs.toFixed(2)} ms`);
  console.log(`statements=${totalStatements} distinct=${totalDistinct} scans=${totalScans}`);

  // Metric lines last.
  for (const { name, ms } of perScenario) {
    console.log(`METRIC scenario_${name}_ms=${ms.toFixed(3)}`);
  }
  console.log(`METRIC scenario_ms=${totalMs.toFixed(3)}`);
  console.log(`METRIC statements=${totalStatements}`);
  console.log(`METRIC distinct_statements=${totalDistinct}`);
  console.log(`METRIC full_scans=${totalScans}`);
  console.log(`METRIC workload_hash=${workloadHash}`);
}

main();
