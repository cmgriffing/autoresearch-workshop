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

describe('bounds enforcement', () => {
  it('keeps particles inside the canvas after many frames', () => {
    const width = 320;
    const height = 240;
    const sim = createSimulation(fakeCanvas(width, height), {
      particleCount: 50,
      seed: 123,
      width,
      height,
      timestep: 1 / 60,
    });
    for (let f = 0; f < 200; f++) {
      sim.step();
    }
    for (const p of sim.particles) {
      assert.ok(p.x >= 0 && p.x <= width, `x out of bounds: ${p.x}`);
      assert.ok(p.y >= 0 && p.y <= height, `y out of bounds: ${p.y}`);
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    }
  });
});
