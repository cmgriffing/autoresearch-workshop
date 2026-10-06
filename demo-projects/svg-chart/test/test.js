import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderChart } from '../src/index.js';

const viewport = { width: 200, height: 100, padding: 10 };

function pathData(svg, index = 0) {
  const matches = Array.from(svg.matchAll(/<path[^>]*?d="([^"]*)"/g));
  return matches[index][1];
}

test('golden series produces the expected path commands', () => {
  const dataset = [
    {
      name: 'golden',
      data: [
        { x: 0, y: 0 },
        { x: 1, y: 2 },
        { x: 2, y: 1 },
      ],
    },
  ];
  const svg = renderChart(dataset, viewport);
  const d = pathData(svg, 0);

  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.endsWith('</svg>'));
  assert.ok(d.includes('M 10 90'));
  assert.ok(d.includes('L 100 10'));
  assert.ok(d.includes('L 190 50'));
});

test('empty series renders an empty path', () => {
  const dataset = [{ name: 'empty', data: [] }];
  const svg = renderChart(dataset, viewport);
  const d = pathData(svg, 0);

  assert.equal(d, '');
  assert.ok(svg.includes('<path fill="none" stroke="#1f77b4" d=""/>'));
});

test('single-point series centers the point in the viewport', () => {
  const dataset = [{ name: 'single', data: [{ x: 5, y: 10 }] }];
  const svg = renderChart(dataset, viewport);
  const d = pathData(svg, 0);

  assert.equal(d, 'M 100 50');
});

test('constant series renders a horizontal line', () => {
  const dataset = [
    {
      name: 'constant',
      data: [
        { x: 0, y: 5 },
        { x: 1, y: 5 },
        { x: 2, y: 5 },
      ],
    },
  ];
  const svg = renderChart(dataset, viewport);
  const d = pathData(svg, 0);

  assert.equal(d, 'M 10 50 L 100 50 L 190 50');
});

test('extreme value ranges stay inside the viewport', () => {
  const dataset = [
    {
      name: 'extreme',
      data: [
        { x: -1e9, y: -1e9 },
        { x: 0, y: 0 },
        { x: 1e9, y: 1e9 },
      ],
    },
  ];
  const svg = renderChart(dataset, viewport);
  const d = pathData(svg, 0);
  const tokens = d.match(/-?\d+\.?\d*/g) || [];

  for (let i = 0; i < tokens.length; i += 2) {
    const x = Number(tokens[i]);
    const y = Number(tokens[i + 1]);
    assert.ok(Number.isFinite(x));
    assert.ok(Number.isFinite(y));
    assert.ok(x >= 0 && x <= viewport.width, `x ${x} out of viewport`);
    assert.ok(y >= 0 && y <= viewport.height, `y ${y} out of viewport`);
  }
});
