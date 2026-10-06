import path from 'node:path';

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
