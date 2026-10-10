/**
 * `workload_hash` and the fixture digest.
 *
 * `workload_hash` covers the workload definition (seeds, shaping profile,
 * viewport, interaction script, metric definition), the fixture digests and
 * the application build inputs. Change any of them and the hash changes.
 */

import path from 'node:path';
import { WORKLOAD } from './config.js';
import { MANIFEST_REL, listTrackedFiles } from './manifest.js';
import { hashFile, sha256Hex } from './hash.js';

function digestOf(entries) {
  return `sha256:${sha256Hex(Buffer.from(entries.join('\n'))).slice(0, 24)}`;
}

export function computeWorkloadHash(root) {
  const parts = [`workload:${JSON.stringify(WORKLOAD)}`];
  for (const rel of listTrackedFiles(root)) {
    if (rel === MANIFEST_REL) continue; // derived from the same files; adds nothing
    parts.push(`${rel}:${hashFile(path.join(root, rel))}`);
  }
  return digestOf(parts);
}

/** Stable digest of every baked fixture; part of the baseline key. */
export function computeFixturesDigest(root) {
  const parts = [];
  for (const rel of listTrackedFiles(root)) {
    if (!rel.startsWith('bench/fixtures/')) continue;
    if (rel === MANIFEST_REL) continue;
    parts.push(`${rel}:${hashFile(path.join(root, rel))}`);
  }
  return digestOf(parts);
}
