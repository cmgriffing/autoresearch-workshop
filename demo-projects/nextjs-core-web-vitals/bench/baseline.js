/**
 * Machine-local oracle baseline.
 *
 * The baseline lives under `.cache/` (version-ignored, never committed) and
 * is keyed by fixture digests + viewport + browser major version, so it is
 * recaptured automatically when any of those change.
 */

import fs from 'node:fs';
import path from 'node:path';
import { WORKLOAD } from './config.js';
import { computeFixturesDigest } from './workload-hash.js';

export const ORACLE_DIR_REL = '.cache/oracle';

export function oracleDir(root) {
  return path.join(root, ORACLE_DIR_REL);
}

export function baselinePath(root) {
  return path.join(oracleDir(root), 'baseline.json');
}

export function makeBaselineKey({ root, browserMajor, viewport = WORKLOAD.viewport }) {
  return {
    fixturesDigest: computeFixturesDigest(root),
    viewport: `${viewport.width}x${viewport.height}`,
    browserMajor: String(browserMajor),
    gridCells: WORKLOAD.heroGrid.cells,
  };
}

export function readBaseline(root) {
  const file = baselinePath(root);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function isValidBaseline(baseline, key) {
  if (!baseline || !baseline.key || !baseline.seeds) return false;
  const sameKey = Object.keys(key).every((field) => baseline.key[field] === key[field]);
  if (!sameKey) return false;
  return Object.values(baseline.seeds).every(
    (entry) => Array.isArray(entry?.grid) && entry.grid.length === key.gridCells * key.gridCells,
  );
}

export function gridForSeed(baseline, seed) {
  return baseline?.seeds?.[seed]?.grid ?? null;
}

export function writeBaseline(root, { key, grids }) {
  const dir = oracleDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const payload = {
    version: 1,
    capturedAt: new Date().toISOString(),
    key,
    seeds: Object.fromEntries(
      Object.entries(grids).map(([seed, grid]) => [seed, { grid }]),
    ),
  };
  fs.writeFileSync(baselinePath(root), `${JSON.stringify(payload)}\n`);
  return payload;
}

export function writeBeforeScreenshot(root, slug, buffer) {
  const dir = path.join(oracleDir(root), 'before');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${slug}.png`);
  fs.writeFileSync(file, buffer);
  return file;
}

export function writeBaselineMetrics(root, metrics) {
  const file = path.join(oracleDir(root), 'baseline-metrics.json');
  fs.writeFileSync(file, `${JSON.stringify(metrics, null, 2)}\n`);
  return file;
}

export function readBaselineMetrics(root) {
  const file = path.join(oracleDir(root), 'baseline-metrics.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
