import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routes as appRoutes } from '../src/routes.js';
import { routes as harnessRoutes } from '../bench/routes.js';

test('application route paths match the harness route list', () => {
  const appPaths = appRoutes.map((r) => r.path);
  const harnessPaths = harnessRoutes.map((r) => r.path);
  assert.deepEqual(
    appPaths,
    harnessPaths,
    'application routes must agree with the harness-owned route list'
  );
});

test('every harness route has a corresponding application route', () => {
  for (const harnessRoute of harnessRoutes) {
    const match = appRoutes.find((r) => r.path === harnessRoute.path);
    assert.ok(match, `missing application route for ${harnessRoute.path}`);
  }
});
