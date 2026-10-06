import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../src/simulation.js';

function fakeCanvas(width, height) {
  const ctx = {
    clearRect() {},
    set globalAlpha(_) {},
    set fillStyle(_) {},
    beginPath() {},
    arc() {},
    fill() {},
  };
  return { width, height, getContext: () => ctx };
}

describe('reproducibility', () => {
  it('produces the same state for the same seed and frame count', () => {
    const options = {
      particleCount: 30,
      seed: 999,
      width: 200,
      height: 150,
      timestep: 1 / 60,
    };
    const a = createSimulation(fakeCanvas(options.width, options.height), options);
    const b = createSimulation(fakeCanvas(options.width, options.height), options);
    for (let f = 0; f < 60; f++) {
      a.step();
      b.step();
    }
    assert.equal(a.particles.length, b.particles.length);
    for (let i = 0; i < a.particles.length; i++) {
      assert.equal(a.particles[i].x, b.particles[i].x);
      assert.equal(a.particles[i].y, b.particles[i].y);
      assert.equal(a.particles[i].vx, b.particles[i].vx);
      assert.equal(a.particles[i].vy, b.particles[i].vy);
    }
  });
});
