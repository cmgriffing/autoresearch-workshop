import { createRng } from '../src/rng.js';

const SMOOTH = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const LERP = (a, b, t) => a + (b - a) * t;

function buildPermutation(seed) {
  const rng = createRng(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  return p;
}

function createReferenceFieldSampler(seed) {
  const perm = buildPermutation(seed);

  function gradient(i, j) {
    const idx = perm[(perm[i & 0xff] + j) & 0xff];
    const angle = (idx / 256) * Math.PI * 2;
    return [Math.cos(angle), Math.sin(angle)];
  }

  function noise2D(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = SMOOTH(xf);
    const v = SMOOTH(yf);

    const g00 = gradient(xi, yi);
    const g10 = gradient(xi + 1, yi);
    const g01 = gradient(xi, yi + 1);
    const g11 = gradient(xi + 1, yi + 1);

    const n00 = g00[0] * xf + g00[1] * yf;
    const n10 = g10[0] * (xf - 1) + g10[1] * yf;
    const n01 = g01[0] * xf + g01[1] * (yf - 1);
    const n11 = g11[0] * (xf - 1) + g11[1] * (yf - 1);

    const nx0 = LERP(n00, n10, u);
    const nx1 = LERP(n01, n11, u);
    return LERP(nx0, nx1, v);
  }

  function sampleField(x, y) {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    for (let octave = 0; octave < 8; octave++) {
      value += noise2D(x * frequency, y * frequency) * amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return value;
  }

  return { sampleField };
}

export function referenceState({ particleCount, seed, width, height, timestep, frames }) {
  const sampler = createReferenceFieldSampler(seed);
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
