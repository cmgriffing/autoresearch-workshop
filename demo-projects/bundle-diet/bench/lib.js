import path from 'node:path';
import crypto from 'node:crypto';

export const TIMED_SEED = 'bundle-diet-timed-2024';
export const VERIFY_SEED = 'bundle-diet-verify-2025';

export function collectCriticalFiles(manifest, distDir) {
  const entryKey = Object.keys(manifest).find(
    (k) => manifest[k].isEntry && manifest[k].file?.endsWith('.js')
  );
  if (!entryKey) {
    throw new Error('No JS entry found in Vite manifest');
  }

  const visited = new Set();
  const files = new Set();

  function visit(key) {
    if (visited.has(key)) return;
    visited.add(key);
    const chunk = manifest[key];
    if (!chunk) return;

    files.add(path.join(distDir, chunk.file));
    for (const css of chunk.css || []) {
      files.add(path.join(distDir, css));
    }
    for (const child of chunk.imports || []) {
      visit(child);
    }
  }

  visit(entryKey);
  return Array.from(files);
}

export function deterministicShuffle(items, seed) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const buf = crypto.createHmac('sha256', seed).update(String(i)).digest();
    const j = buf.readUInt32BE(0) % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
