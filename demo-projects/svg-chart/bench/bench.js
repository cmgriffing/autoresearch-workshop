import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { renderChart } from '../src/index.js';

const viewport = { width: 800, height: 400, padding: 30 };
const FIDELITY_THRESHOLD_PX = 6.0;

// Deterministic PRNG so the workload is reproducible across runs.
function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateDataset(rng, seriesCount, pointsPerSeries) {
  const dataset = [];
  for (let s = 0; s < seriesCount; s++) {
    const data = [];
    let y = rng() * 100;
    for (let i = 0; i < pointsPerSeries; i++) {
      const x = i;
      y += (rng() - 0.5) * 10;
      data.push({ x, y });
    }
    dataset.push({ name: `series-${s}`, data });
  }
  return dataset;
}

const workload = {
  viewport,
  seriesCount: 8,
  pointsPerSeries: 100000,
  timedSeed: 12345,
  verifySeed: 67890,
  iterations: 7,
};

function hashWorkload(obj) {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16);
}

function parsePathPoints(d) {
  const tokens = d.match(/[MLml]|-?(?:\d*\.\d+|\d+\.?\d*)/g) || [];
  const points = [];
  let i = 0;
  let cmd = null;

  while (i < tokens.length) {
    const tok = tokens[i];

    if (/^[MLml]$/.test(tok)) {
      cmd = tok.toUpperCase();
      i++;
      continue;
    }

    if (cmd === 'M' || cmd === 'L') {
      if (i + 1 >= tokens.length) {
        throw new Error('Unexpected end of path data');
      }
      const x = Number(tokens[i]);
      const y = Number(tokens[i + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error('Invalid coordinate in path data');
      }
      points.push({ x, y });
      i += 2;
    } else {
      throw new Error('Unsupported command in path data: ' + cmd);
    }
  }

  return points;
}

function extents(points) {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const p of points) {
    if (p.x < xMin) xMin = p.x;
    if (p.x > xMax) xMax = p.x;
    if (p.y < yMin) yMin = p.y;
    if (p.y > yMax) yMax = p.y;
  }
  return { xMin, xMax, yMin, yMax };
}

function analyzeRendered(svg, dataset) {
  const paths = Array.from(svg.matchAll(/<path[^>]*?d="([^"]*)"/g)).map((m) => m[1]);

  if (paths.length !== dataset.length) {
    throw new Error(`Expected ${dataset.length} paths, found ${paths.length}`);
  }

  let pointsEmitted = 0;
  let maxDeviation = 0;

  for (let s = 0; s < dataset.length; s++) {
    const rendered = parsePathPoints(paths[s]);
    pointsEmitted += rendered.length;

    for (const p of rendered) {
      if (p.x < 0 || p.x > viewport.width || p.y < 0 || p.y > viewport.height) {
        throw new Error(`Coordinate out of viewport: ${p.x},${p.y}`);
      }
    }

    const src = dataset[s].data;
    if (src.length === 0) {
      if (rendered.length !== 0) {
        throw new Error(`Empty series ${s} rendered ${rendered.length} points`);
      }
      continue;
    }

    const { xMin, xMax, yMin, yMax } = extents(src);
    const xSpan = xMax - xMin;
    const ySpan = yMax - yMin;
    const innerW = viewport.width - 2 * viewport.padding;
    const innerH = viewport.height - 2 * viewport.padding;

    // Vertical deviation of each source point from the rendered polyline;
    // interpolate the segment that spans the source x coordinate.
    let seg = 0;
    for (let i = 0; i < src.length; i++) {
      const ex =
        xSpan === 0 ? viewport.width / 2 : viewport.padding + ((src[i].x - xMin) / xSpan) * innerW;
      const ey =
        ySpan === 0
          ? viewport.height / 2
          : viewport.height - viewport.padding - ((src[i].y - yMin) / ySpan) * innerH;

      let deviation = 0;
      if (rendered.length === 0) {
        // An empty path cannot represent any data.
        deviation = Number.POSITIVE_INFINITY;
      } else if (rendered.length === 1) {
        deviation = Math.abs(rendered[0].y - ey);
      } else {
        while (seg < rendered.length - 2 && rendered[seg + 1].x < ex) {
          seg++;
        }
        const a = rendered[seg];
        const b = rendered[seg + 1];
        const t = b.x === a.x ? 0 : (ex - a.x) / (b.x - a.x);
        const lineY = a.y + t * (b.y - a.y);
        deviation = Math.abs(lineY - ey);
      }

      if (deviation > maxDeviation) {
        maxDeviation = deviation;
      }
    }
  }

  return { pointsEmitted, maxDeviation };
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function main() {
  const timedDataset = generateDataset(
    mulberry32(workload.timedSeed),
    workload.seriesCount,
    workload.pointsPerSeries,
  );

  const times = [];
  for (let i = 0; i < workload.iterations; i++) {
    const t0 = performance.now();
    renderChart(timedDataset, viewport);
    const t1 = performance.now();
    times.push(t1 - t0);
  }
  const ms = median(times);

  const verifyDataset = generateDataset(
    mulberry32(workload.verifySeed),
    workload.seriesCount,
    workload.pointsPerSeries,
  );
  const svg = renderChart(verifyDataset, viewport);
  const { pointsEmitted, maxDeviation } = analyzeRendered(svg, verifyDataset);

  if (maxDeviation > FIDELITY_THRESHOLD_PX) {
    console.error(
      `Fidelity gate failed: max deviation ${maxDeviation.toFixed(9)} px exceeds threshold ${FIDELITY_THRESHOLD_PX}`,
    );
    process.exit(1);
  }

  const pathKb = (Buffer.byteLength(svg) / 1024).toFixed(3);

  console.log(
    `Rendered ${workload.seriesCount} series x ${workload.pointsPerSeries} points ` +
      `(${workload.iterations} iterations, median time)`,
  );
  console.log(`METRIC points_emitted=${pointsEmitted}`);
  console.log(`METRIC path_kb=${pathKb}`);
  console.log(`METRIC max_deviation_px=${maxDeviation.toFixed(6)}`);
  console.log(`METRIC ms=${ms.toFixed(3)}`);
  console.log(`METRIC workload_hash=${hashWorkload(workload)}`);
}

main();
