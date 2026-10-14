/**
 * `workload_hash`.
 *
 * Derived from the workload definition only: seeds, tick cadence, dataset
 * configuration, phase script, viewport sizes and the region manifest.
 * Application source is deliberately not part of it, so the hash stays stable
 * across optimization experiments while any change to the measured workload
 * changes the hash.
 */

import { WORKLOAD } from './config.js';
import { sha256Hex } from './hash.js';

export function computeWorkloadHash() {
  return `sha256:${sha256Hex(Buffer.from(JSON.stringify(WORKLOAD))).slice(0, 24)}`;
}
