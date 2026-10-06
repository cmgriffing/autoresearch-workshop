import { build } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { routes } from './routes.js';
import { collectCriticalFiles, TIMED_SEED, VERIFY_SEED } from './lib.js';
import { runBoot } from './boot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const cacheDir = path.resolve(repoRoot, '.cache');
const distDir = path.join(cacheDir, 'dist');
const srcDir = path.resolve(repoRoot, 'src');
const manifestPath = path.join(distDir, '.vite', 'manifest.json');
const moduleSizesPath = path.join(cacheDir, 'module-sizes.json');

let capturedConfig = null;

function captureConfigPlugin() {
  return {
    name: 'bundle-diet-capture-config',
    configResolved(config) {
      capturedConfig = {
        sourcemap: config.build.sourcemap,
        target: config.build.target,
        input: config.build.rollupOptions.input,
        outDir: config.build.outDir,
        emptyOutDir: config.build.emptyOutDir,
      };
    },
  };
}

function moduleSizePlugin() {
  return {
    name: 'bundle-diet-module-sizes',
    generateBundle(_options, bundle) {
      const sizes = {};
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk' && chunk.modules) {
          for (const [modId, info] of Object.entries(chunk.modules)) {
            const len = info.renderedLength || 0;
            sizes[modId] = (sizes[modId] || 0) + len;
          }
        }
      }
      fs.mkdirSync(path.dirname(moduleSizesPath), { recursive: true });
      fs.writeFileSync(moduleSizesPath, JSON.stringify(sizes, null, 2));
    },
  };
}

function hashWorkload(manifest, buildConfig, compression) {
  const indexHtmlPath = path.join(srcDir, 'index.html');
  const entryDigest = fs.existsSync(indexHtmlPath)
    ? crypto.createHash('sha256').update(fs.readFileSync(indexHtmlPath)).digest('hex').slice(0, 16)
    : '';
  const payload = JSON.stringify({
    routes,
    seeds: { timed: TIMED_SEED, verify: VERIFY_SEED },
    buildConfig,
    compression,
    manifest,
    entryDigest,
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

function listRenderedModules() {
  if (!fs.existsSync(moduleSizesPath)) {
    return [];
  }
  const sizes = JSON.parse(fs.readFileSync(moduleSizesPath, 'utf8'));
  return Object.entries(sizes)
    .map(([name, size]) => ({ name: path.relative(repoRoot, name), size }))
    .sort((a, b) => b.size - a.size);
}

async function main() {
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.rmSync(moduleSizesPath, { force: true });

  const t0 = performance.now();
  capturedConfig = null;
  await build({
    configFile: path.join(srcDir, 'vite.config.js'),
    mode: 'production',
    logLevel: 'silent',
    build: {
      outDir: distDir,
      emptyOutDir: true,
    },
    plugins: [captureConfigPlugin(), moduleSizePlugin()],
  });
  const buildMs = performance.now() - t0;

  if (!capturedConfig) {
    throw new Error('Failed to capture resolved build config');
  }

  const manifest = readManifest();
  const criticalFiles = collectCriticalFiles(manifest, distDir);
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
  const modules = listRenderedModules();

  // Browser boot oracle gates the metric.
  const bootMs = await runBoot({ distDir, seed: VERIFY_SEED });

  console.log(`Build completed in ${buildMs.toFixed(0)} ms`);
  console.log(`Emitted ${jsChunks} JS chunks`);
  console.log(
    `Critical path: ${criticalFiles.length} files, ${(criticalBytes / 1024).toFixed(2)} kB gzipped`
  );
  console.log(
    `Total output: ${allFiles.length} files, ${(totalBytes / 1024).toFixed(2)} kB gzipped`
  );
  console.log('Heaviest rendered modules:');
  for (const m of modules.slice(0, 4)) {
    console.log(`  ${m.name} ${(m.size / 1024).toFixed(1)} kB`);
  }

  const workloadHash = hashWorkload(manifest, capturedConfig, { level: 9 });
  console.log(`METRIC total_gzip_kb=${(totalBytes / 1024).toFixed(3)}`);
  console.log(`METRIC chunks=${jsChunks}`);
  console.log(`METRIC critical_gzip_kb=${(criticalBytes / 1024).toFixed(3)}`);
  console.log(`METRIC boot_ms=${Math.round(bootMs)}`);
  console.log(`METRIC workload_hash=${workloadHash}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
