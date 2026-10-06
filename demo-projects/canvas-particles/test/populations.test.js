import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../src/simulation.js';

const TOLERANCE = 1e-12;

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

describe('populations', () => {
  it('handles an empty population', () => {
    const sim = createSimulation(fakeCanvas(100, 100), {
      particleCount: 0,
      seed: 1,
      width: 100,
      height: 100,
      timestep: 1 / 60,
    });
    sim.step();
    sim.draw();
    assert.equal(sim.particles.length, 0);
  });

  it('handles a single particle', () => {
    const sim = createSimulation(fakeCanvas(100, 100), {
      particleCount: 1,
      seed: 2,
      width: 100,
      height: 100,
      timestep: 1 / 60,
    });
    const before = { ...sim.particles[0] };
    sim.step();
    sim.draw();
    const after = sim.particles[0];
    assert.ok(Number.isFinite(after.x) && Number.isFinite(after.y));
    const moved =
      Math.abs(after.x - before.x) > TOLERANCE ||
      Math.abs(after.y - before.y) > TOLERANCE;
    assert.ok(moved, 'particle did not move');
  });
});
