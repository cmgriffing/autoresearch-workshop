import { createCanvas } from '@napi-rs/canvas';
import { createSimulation } from '../src/simulation.js';
import { createFieldSampler } from '../src/noise.js';
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
  });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}


function countingContext(canvas) {
  const ctx = canvas.getContext('2d');
  let drawCalls = 0;
  let culled = 0;
  const baseFill = ctx.fill.bind(ctx);
  ctx.fill = function () {
    drawCalls++;
    return baseFill.apply(this, arguments);
  };
  return { ctx, drawCalls: () => drawCalls, culled: () => culled };
}

function runBenchmark() {
  const canvas = createCanvas(WORKLOAD.width, WORKLOAD.height);
  const sampler = createFieldSampler(WORKLOAD.seed);
  const { ctx, drawCalls, culled } = countingContext(canvas);
  const sim = createSimulation(canvas, {
    ...WORKLOAD,
    fieldSampler: sampler,
  });

  sampler.resetFieldEvals();
  let simMs = 0;
  let drawMs = 0;
  const start = performance.now();
  for (let f = 0; f < WORKLOAD.frames; f++) {
    const s0 = performance.now();
    sim.step(WORKLOAD.timestep);
    simMs += performance.now() - s0;

    const d0 = performance.now();
    sim.draw();
    drawMs += performance.now() - d0;
  }
  const totalMs = performance.now() - start;

  const fieldEvals = sampler.fieldEvals;
  const drawCallCount = drawCalls();
  const culledCount = culled();

  console.log(`particles=${WORKLOAD.particleCount} frames=${WORKLOAD.frames} canvas=${WORKLOAD.width}x${WORKLOAD.height}`);
  console.log(`METRIC field_evals=${fieldEvals}`);
  console.log(`METRIC draw_calls=${drawCallCount}`);
  console.log(`METRIC culled=${culledCount}`);
  console.log(`METRIC sim_ms=${simMs.toFixed(3)}`);
  console.log(`METRIC draw_ms=${drawMs.toFixed(3)}`);
  console.log(`METRIC total_ms=${totalMs.toFixed(3)}`);
  console.log(`METRIC workload_hash=${hashWorkload(WORKLOAD)}`);

  return { sim, totalMs, simMs, drawMs };
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

const { totalMs, simMs, drawMs } = runBenchmark();
verify();

if (totalMs <= 0 || simMs <= 0) {
  throw new Error('Timing metrics must be positive');
}
if (simMs <= drawMs) {
  throw new Error(`Simulation cost must dominate drawing cost (sim_ms=${simMs.toFixed(3)} draw_ms=${drawMs.toFixed(3)})`);
}
