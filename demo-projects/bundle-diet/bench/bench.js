import { build } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { routes } from './routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const distDir = path.resolve(repoRoot, 'dist');
const srcDir = path.resolve(repoRoot, 'src');
const manifestPath = path.join(distDir, '.vite', 'manifest.json');

function hashWorkload(manifest) {
  const payload = JSON.stringify({
    routes,
    buildInputs: {
      sourcemap: 'inline',
      target: 'es2015',
      entry: 'src/index.html',
    },
    manifest,
  });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

function gzipSize(buffer) {
  return zlib.gzipSync(buffer, { level: 9 }).length;
}

function walk(dir, callback) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, callback);
    } else {
      callback(full);
    }
  }
}

function readManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function collectCriticalFiles(manifest) {
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

function listSourceModules() {
  const modules = [];
  walk(srcDir, (full) => {
    if (full.endsWith('.js')) {
      modules.push({
        name: path.relative(srcDir, full),
        size: fs.statSync(full).size,
      });
    }
  });
  return modules.sort((a, b) => b.size - a.size);
}

async function main() {
  const t0 = performance.now();
  await build({
    configFile: path.join(srcDir, 'vite.config.js'),
    mode: 'production',
  });
  const buildMs = performance.now() - t0;

  const manifest = readManifest();
  const criticalFiles = collectCriticalFiles(manifest);
  const criticalBytes = criticalFiles
    .map((f) => gzipSize(fs.readFileSync(f)))
    .reduce((a, b) => a + b, 0);

  const allFiles = [];
  walk(distDir, (full) => {
    const rel = path.relative(distDir, full);
    if (rel === path.join('.vite', 'manifest.json')) return;
    allFiles.push(full);
  });
  const totalBytes = allFiles
    .map((f) => gzipSize(fs.readFileSync(f)))
    .reduce((a, b) => a + b, 0);

  const jsChunks = allFiles.filter((f) => f.endsWith('.js')).length;
  const modules = listSourceModules();

  console.log(`Build completed in ${buildMs.toFixed(0)} ms`);
  console.log(`Emitted ${jsChunks} JS chunks`);
  console.log(
    `Critical path: ${criticalFiles.length} files, ${(criticalBytes / 1024).toFixed(2)} kB gzipped`
  );
  console.log(
    `Total output: ${allFiles.length} files, ${(totalBytes / 1024).toFixed(2)} kB gzipped`
  );
  console.log('Heaviest source modules:');
  for (const m of modules.slice(0, 5)) {
    console.log(`  ${m.name} ${(m.size / 1024).toFixed(1)} kB`);
  }

  console.log(`METRIC total_gzip_kb=${(totalBytes / 1024).toFixed(3)}`);
  console.log(`METRIC chunks=${jsChunks}`);
  console.log(`METRIC critical_gzip_kb=${(criticalBytes / 1024).toFixed(3)}`);
  console.log(`METRIC workload_hash=${hashWorkload(manifest)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
