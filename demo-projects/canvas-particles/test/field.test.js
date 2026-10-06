import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createFieldSampler } from '../src/noise.js';

const TOLERANCE = 1e-12;

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
      assert.ok(Math.abs(va - vb) < TOLERANCE, `mismatch at (${x}, ${y})`);
      assert.ok(Number.isFinite(va), `non-finite at (${x}, ${y})`);
    }
  });

  it('returns finite values for arbitrary coordinates', () => {
    const sampler = createFieldSampler(7);
    const points = [
      [10, 20],
      [-5, 100],
      [1000, -2000],
      [Math.PI, Math.E],
    ];
    for (const [x, y] of points) {
      const v = sampler.sampleField(x, y);
      assert.ok(Number.isFinite(v), `non-finite at (${x}, ${y})`);
    }
  });
});
