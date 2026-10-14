/** Content hashing helpers shared by the manifest and the workload hash. */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function isBinary(buffer) {
  return buffer.includes(0);
}

/**
 * Normalized content hash: text files hash with CRLF normalized to LF so a
 * checkout on another platform still reads as pristine; binary files hash
 * byte-for-byte.
 */
export function hashFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (isBinary(buffer)) return sha256Hex(buffer);
  const text = buffer.toString('utf8').replace(/\r\n/g, '\n');
  return sha256Hex(Buffer.from(text, 'utf8'));
}

/** Recursively lists files under `rootDir` as POSIX-style relative paths, sorted. */
export function walkFiles(rootDir, { filter = () => true } = {}) {
  const results = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(rootDir, abs).split(path.sep).join('/');
      if (!filter(rel, entry)) continue;
      if (entry.isDirectory()) {
        visit(abs);
      } else if (entry.isFile()) {
        results.push(rel);
      }
    }
  };
  visit(rootDir);
  return results.sort();
}
