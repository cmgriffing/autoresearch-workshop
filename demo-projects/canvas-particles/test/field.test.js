import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createFieldSampler } from '../src/noise.js';

describe('field sampler', () => {
  it('returns deterministic values at known coordinates', () => {
    const a = createFieldSampler(42);
    const b = createFieldSampler(42);
    const points = [
      [0, 0],
      [12.34, 56.78],
      [400, 300],
      [799, 599],
    ];
    for (const [x, y] of points) {
      const va = a.sampleField(x, y);
      const vb = b.sampleField(x, y);
      assert.equal(va, vb, `mismatch at (${x}, ${y})`);
      assert.ok(Number.isFinite(va), `non-finite at (${x}, ${y})`);
    }
  });

  it('counts one evaluation per octave', () => {
    const sampler = createFieldSampler(7);
    sampler.resetFieldEvals();
    sampler.sampleField(10, 20);
    assert.equal(sampler.fieldEvals, 8);
  });
});
