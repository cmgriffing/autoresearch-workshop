/**
 * Machine-local oracle baseline.
 *
 * The baseline lives under `.cache/` (version-ignored, never committed) and is
 * keyed by the workload hash, the viewport and the browser major version, so
 * it is recaptured when any of those change. The harness never deletes it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { VIEWPORTS } from './config.js';

export const ORACLE_DIR_REL = '.cache/oracle';

export function oracleDir(root) {
  return path.join(root, ORACLE_DIR_REL);
}

export function baselinePath(root) {
  return path.join(oracleDir(root), 'baseline.json');
}

export function makeBaselineKey({ workloadHash, browserMajor, viewport = VIEWPORTS.default }) {
  return {
    workloadHash,
    viewport: `${viewport.width}x${viewport.height}`,
    browserMajor: String(browserMajor),
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
  if (!baseline || !baseline.key || !baseline.metrics) return false;
  return Object.keys(key).every((field) => baseline.key[field] === key[field]);
}

export function writeBaselineMetrics(root, { key, metrics, run }) {
  const dir = oracleDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const payload = {
    version: 1,
    capturedAt: new Date().toISOString(),
    key,
    run,
    metrics,
  };
  fs.writeFileSync(baselinePath(root), `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

export function readBaselineMetrics(root) {
  const file = baselinePath(root);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
