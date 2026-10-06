import { createRng } from './rng.js';
import { createFieldSampler } from './noise.js';

export function createSimulation(canvas, options) {
  const {
    particleCount,
    seed,
    width = canvas?.width ?? 800,
    height = canvas?.height ?? 600,
    timestep,
    fieldSampler,
  } = options;

  const sampler = fieldSampler || createFieldSampler(seed);
  const ctx = canvas?.getContext?.('2d') || null;
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

  function step(dt = timestep) {
    const w = width;
    const h = height;
    for (const p of particles) {
      const field = {
        angle: sampler.sampleField(p.x, p.y) * Math.PI * 2,
        strength: sampler.sampleField(p.y, p.x) + 1.5,
      };
      const ax = Math.cos(field.angle) * 80 * field.strength;
      const ay = Math.sin(field.angle) * 80 * field.strength;

      p.vx += ax * dt;
      p.vy += ay * dt;
      p.vx *= 0.99;
      p.vy *= 0.99;

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      if (p.x < 0) {
        p.x = -p.x;
        p.vx *= -0.8;
      } else if (p.x > w) {
        p.x = 2 * w - p.x;
        p.vx *= -0.8;
      }
      if (p.y < 0) {
        p.y = -p.y;
        p.vy *= -0.8;
      } else if (p.y > h) {
        p.y = 2 * h - p.y;
        p.vy *= -0.8;
      }
    }
  }

  function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    for (const p of particles) {
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = '#3a86ff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return {
    step,
    draw,
    get particles() {
      return particles;
    },
    get fieldSampler() {
      return sampler;
    },
  };
}
