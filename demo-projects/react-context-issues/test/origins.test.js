import test from 'node:test';
import assert from 'node:assert/strict';
import { handleFixtureRequest, startOrigins } from '../bench/origins.js';
import { TIMED_SEED, VERIFY_SEED } from '../bench/config.js';

test('the fixture handler serves the three endpoints', () => {
  const params = new URLSearchParams({ seed: VERIFY_SEED });
  for (const pathname of ['/api/snapshot', '/api/timeline', '/api/orders']) {
    const descriptor = handleFixtureRequest(pathname, params);
    assert.equal(descriptor.status, 200);
    assert.match(descriptor.contentType, /application\/json/);
    const payload = JSON.parse(descriptor.body);
    assert.equal(payload.seed, VERIFY_SEED);
  }
});

test('unknown routes and missing seeds are handled', () => {
  const unknown = handleFixtureRequest('/api/nope', new URLSearchParams({ seed: VERIFY_SEED }));
  assert.equal(unknown.status, 404);
  const noSeed = handleFixtureRequest('/api/snapshot', new URLSearchParams());
  assert.equal(noSeed.status, 200);
  assert.equal(JSON.parse(noSeed.body).seed, '');
});

test('the HTTP origin serves seeded fixtures and closes cleanly', async () => {
  const origins = await startOrigins({ latencyMs: 0 });
  try {
    const first = await fetch(`${origins.url}/api/snapshot?seed=${encodeURIComponent(TIMED_SEED)}`);
    const second = await fetch(`${origins.url}/api/snapshot?seed=${encodeURIComponent(VERIFY_SEED)}`);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const firstPayload = await first.json();
    const secondPayload = await second.json();
    assert.equal(firstPayload.seed, TIMED_SEED);
    assert.notEqual(firstPayload.symbols[0].name, secondPayload.symbols[0].name);
  } finally {
    await origins.close();
  }
});
