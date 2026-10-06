import { createFieldSampler } from '../src/noise.js';
import { createRng } from '../src/rng.js';

export function referenceState({ particleCount, seed, width, height, timestep, frames }) {
  const sampler = createFieldSampler(seed);
  const rng = createRng(seed);
  const particles = [];
  for (let i = 0; i < particleCount; i++) {
    particles.push({
      x: rng() * width,
      y: rng() * height,
      vx: (rng() - 0.5) * 10,
      vy: (rng() - 0.5) * 10,
    });
  }

  const dt = timestep;
  for (let f = 0; f < frames; f++) {
    for (const p of particles) {
      const angle = sampler.sampleField(p.x, p.y) * Math.PI * 2;
      const strength = sampler.sampleField(p.y, p.x) + 1.5;
      const ax = Math.cos(angle) * 80 * strength;
      const ay = Math.sin(angle) * 80 * strength;

      p.vx += ax * dt;
      p.vy += ay * dt;
      p.vx *= 0.99;
      p.vy *= 0.99;

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      if (p.x < 0) {
        p.x = -p.x;
        p.vx *= -0.8;
      } else if (p.x > width) {
        p.x = 2 * width - p.x;
        p.vx *= -0.8;
      }
      if (p.y < 0) {
        p.y = -p.y;
        p.vy *= -0.8;
      } else if (p.y > height) {
        p.y = 2 * height - p.y;
        p.vy *= -0.8;
      }
    }
  }

  return particles;
}

export function compareState(actual, expected, { width, height, tolerance }) {
  if (actual.length !== expected.length) {
    return { ok: false, reason: `particle count mismatch: ${actual.length} vs ${expected.length}` };
  }
  for (let i = 0; i < actual.length; i++) {
    const a = actual[i];
    const e = expected[i];
    for (const k of ['x', 'y', 'vx', 'vy']) {
      if (!Number.isFinite(a[k])) {
        return { ok: false, reason: `non-finite ${k} at index ${i}` };
      }
    }
    if (a.x < -tolerance || a.x > width + tolerance || a.y < -tolerance || a.y > height + tolerance) {
      return { ok: false, reason: `out of bounds at index ${i}: (${a.x}, ${a.y})` };
    }
    if (Math.abs(a.x - e.x) > tolerance || Math.abs(a.y - e.y) > tolerance) {
      return { ok: false, reason: `position mismatch at index ${i}: (${a.x}, ${a.y}) vs (${e.x}, ${e.y})` };
    }
  }
  return { ok: true };
}
