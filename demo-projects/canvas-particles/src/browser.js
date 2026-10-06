import { createSimulation } from './index.js';

const canvas = document.getElementById('scene');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const sim = createSimulation(canvas, {
  particleCount: 2000,
  seed: 12345,
  width: canvas.width,
  height: canvas.height,
  timestep: 1 / 60,
});

function frame() {
  sim.step();
  sim.draw();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
