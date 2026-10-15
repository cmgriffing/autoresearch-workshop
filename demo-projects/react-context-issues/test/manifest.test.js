import test from 'node:test';
import assert from 'node:assert/strict';
import { isIgnored, listTrackedFiles } from '../bench/manifest.js';
import { computeWorkloadHash } from '../bench/workload-hash.js';
import { WORKLOAD } from '../bench/config.js';

test('generated and instructor paths are not tracked', () => {
  assert.equal(isIgnored('.cache/dist/index.html'), true);
  assert.equal(isIgnored('.auto/measure.sh'), true);
  assert.equal(isIgnored('node_modules/react/index.js'), true);
  assert.equal(isIgnored('instructor-notes/calibration.md'), true);
  assert.equal(isIgnored('bench/demo-manifest.json'), true);
  assert.equal(isIgnored('src/App.tsx'), false);
  assert.equal(isIgnored('bench/run.js'), false);
});

test('the tracked file list excludes answer-key material', () => {
  const tracked = listTrackedFiles();
  assert.ok(tracked.length > 0);
  for (const rel of tracked) {
    assert.ok(!rel.startsWith('instructor-notes/'), `${rel} must not be tracked`);
    assert.ok(!rel.startsWith('.cache/'), `${rel} must not be tracked`);
  }
});

test('workload_hash is stable and covers the measured workload', () => {
  const hash = computeWorkloadHash();
  assert.match(hash, /^sha256:[0-9a-f]{24}$/);
  assert.equal(hash, computeWorkloadHash());
  const parts = JSON.parse(JSON.stringify(WORKLOAD));
  assert.deepEqual(Object.keys(parts).sort(), [
    'dataset',
    'phases',
    'regions',
    'seeds',
    'tickMs',
    'version',
    'viewports',
  ]);
  assert.equal(parts.regions.length, 12);
  assert.deepEqual(parts.phases.order, [
    'tick',
    'draft',
    'select',
    'hover',
    'theme',
    'news',
    'submit',
    'modal',
    'resize',
  ]);
});
