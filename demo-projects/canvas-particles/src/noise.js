import { createRng } from './rng.js';

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

export function createFieldSampler(seed) {
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

  return {
    sampleField,
  };
}
