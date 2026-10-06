import { createCanvas } from '@napi-rs/canvas';
import { createSimulation } from '../src/simulation.js';
import { createFieldSampler } from '../src/noise.js';
import { wrapFieldSampler } from './field-counter.js';
import { referenceState, compareState } from './reference.js';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

const WORKLOAD = {
  particleCount: 2500,
  frames: 120,
  width: 800,
  height: 600,
  timestep: 1 / 60,
  seed: 123456789,
  verifySeed: 987654321,
};

const TOLERANCE = 1e-6;

function hashWorkload(workload) {
  const payload = JSON.stringify({
    particleCount: workload.particleCount,
    frames: workload.frames,
    width: workload.width,
    height: workload.height,
    timestep: workload.timestep,
    seed: workload.seed,
    verifySeed: workload.verifySeed,
  });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

function countingContext(canvas) {
  const ctx = canvas.getContext('2d');
  let drawCalls = 0;
  const baseFill = ctx.fill.bind(ctx);
  ctx.fill = function () {
    drawCalls++;
    return baseFill.apply(this, arguments);
  };
  return { ctx, drawCalls: () => drawCalls };
}

function countCulled(particles, width, height) {
  let count = 0;
  for (const p of particles) {
    if (p.x < 0 || p.x > width || p.y < 0 || p.y > height) {
      count++;
    }
  }
  return count;
}

function runBenchmark() {
  const canvas = createCanvas(WORKLOAD.width, WORKLOAD.height);
  const baseSampler = createFieldSampler(WORKLOAD.seed);
  const sampler = wrapFieldSampler(baseSampler);
  const { ctx, drawCalls } = countingContext(canvas);
  const sim = createSimulation(canvas, {
    ...WORKLOAD,
    fieldSampler: sampler,
  });

  sampler.resetFieldEvals();
  let simMs = 0;
  let drawMs = 0;
  let culled = 0;
  const start = performance.now();
  for (let f = 0; f < WORKLOAD.frames; f++) {
    const s0 = performance.now();
    sim.step(WORKLOAD.timestep);
    simMs += performance.now() - s0;

    culled += countCulled(sim.particles, WORKLOAD.width, WORKLOAD.height);

    const d0 = performance.now();
    sim.draw();
    drawMs += performance.now() - d0;
  }
  const totalMs = performance.now() - start;

  return {
    metrics: {
      fieldEvals: sampler.fieldEvals,
      drawCalls: drawCalls(),
      culled,
      simMs,
      drawMs,
      totalMs,
      workloadHash: hashWorkload(WORKLOAD),
    },
  };
}

function verify() {
  const canvas = createCanvas(WORKLOAD.width, WORKLOAD.height);
  const sim = createSimulation(canvas, { ...WORKLOAD, seed: WORKLOAD.verifySeed });
  for (let f = 0; f < WORKLOAD.frames; f++) {
    sim.step(WORKLOAD.timestep);
  }
  const expected = referenceState({ ...WORKLOAD, seed: WORKLOAD.verifySeed });
  const result = compareState(sim.particles, expected, {
    width: WORKLOAD.width,
    height: WORKLOAD.height,
    tolerance: TOLERANCE,
  });
  if (!result.ok) {
    throw new Error(`Oracle failed: ${result.reason}`);
  }
}

const { metrics } = runBenchmark();
verify();

if (metrics.totalMs <= 0 || metrics.simMs <= 0) {
  console.error('Timing metrics must be positive');
  process.exit(1);
}

console.log(`particles=${WORKLOAD.particleCount} frames=${WORKLOAD.frames} canvas=${WORKLOAD.width}x${WORKLOAD.height}`);
console.log(`METRIC field_evals=${metrics.fieldEvals}`);
console.log(`METRIC draw_calls=${metrics.drawCalls}`);
console.log(`METRIC culled=${metrics.culled}`);
console.log(`METRIC sim_ms=${metrics.simMs.toFixed(3)}`);
console.log(`METRIC draw_ms=${metrics.drawMs.toFixed(3)}`);
console.log(`METRIC total_ms=${metrics.totalMs.toFixed(3)}`);
console.log(`METRIC workload_hash=${metrics.workloadHash}`);
