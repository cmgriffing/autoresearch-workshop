/**
 * Content manifest and clean-state check.
 *
 * "Pristine" means: every tracked file in this demo directory matches the
 * content hash recorded in `bench/demo-manifest.json`. The check is
 * demo-scoped and content-based — it never consults git, so branches, stashes
 * and dirty files anywhere else in the repository are invisible by
 * construction.
 *
 * Ignored paths are generated state (`.cache/`, `.auto/`, `node_modules/`),
 * OS junk, and the untracked `instructor-notes/` directory (answer-key
 * material must never enter the manifest or the workload hash).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashFile, walkFiles } from './hash.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DEMO_ROOT = path.resolve(__dirname, '..');
export const MANIFEST_REL = 'bench/demo-manifest.json';
export const MANIFEST_ABS = path.join(DEMO_ROOT, MANIFEST_REL);

const IGNORED_DIR_PREFIXES = ['.cache/', '.auto/', 'node_modules/', 'instructor-notes/'];
const IGNORED_BASENAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

export function isIgnored(relPath) {
  if (relPath === MANIFEST_REL) return true;
  if (IGNORED_DIR_PREFIXES.some((prefix) => relPath.startsWith(prefix))) return true;
  const base = relPath.split('/').pop();
  return IGNORED_BASENAMES.has(base);
}

/** Tracked files of the demo directory (ignores generated state and junk). */
export function listTrackedFiles(root = DEMO_ROOT) {
  return walkFiles(root, { filter: (rel) => !isIgnored(rel) });
}

export function computeManifest({ root = DEMO_ROOT, generatedBy = 'bench/manifest.js' } = {}) {
  const files = {};
  for (const rel of listTrackedFiles(root)) {
    files[rel] = hashFile(path.join(root, rel));
  }
  return {
    version: 1,
    generatedBy,
    algorithm: 'sha256(normalized content)',
    files,
  };
}

/** Authoring tool: rewrites the manifest from the current working tree. */
export function writeManifest({ root = DEMO_ROOT } = {}) {
  const manifest = computeManifest({ root });
  const manifestPath = path.join(root, MANIFEST_REL);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function readManifest(root = DEMO_ROOT) {
  const manifestPath = path.join(root, MANIFEST_REL);
  if (!fs.existsSync(manifestPath)) return null;
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

/**
 * Compares the working tree against the recorded manifest.
 * Returns `{ ok, changed, missing, extra, noManifest }`.
 */
export function checkCleanState(root = DEMO_ROOT) {
  const manifest = readManifest(root);
  if (!manifest) {
    return { ok: false, changed: [], missing: [], extra: [], noManifest: true };
  }
  const changed = [];
  const missing = [];
  const extra = [];
  const tracked = new Set(Object.keys(manifest.files));

  for (const [rel, expected] of Object.entries(manifest.files)) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) {
      missing.push(rel);
      continue;
    }
    if (hashFile(abs) !== expected) changed.push(rel);
  }
  for (const rel of listTrackedFiles(root)) {
    if (!tracked.has(rel)) extra.push(rel);
  }

  changed.sort();
  missing.sort();
  extra.sort();
  return {
    ok: changed.length === 0 && missing.length === 0 && extra.length === 0,
    changed,
    missing,
    extra,
    noManifest: false,
  };
}

/** Human-readable diff plus the advisory commit / restore commands. */
export function formatCleanStateReport(diff, { demoPath = 'demo-projects/react-context-issues' } = {}) {
  if (diff.noManifest) {
    return [
      'clean-state check: no content manifest found.',
      `Run: node ${demoPath}/bench/manifest.js generate`,
    ].join('\n');
  }
  const lines = ['clean-state check: the demo differs from the recorded content manifest:'];
  for (const rel of diff.changed) lines.push(`  M ${rel}`);
  for (const rel of diff.extra) lines.push(`  ? ${rel}`);
  for (const rel of diff.missing) lines.push(`  D ${rel}`);
  lines.push('');
  lines.push('To accept the current state as the new baseline:');
  lines.push(`  git add ${demoPath} && git commit -m "${path.basename(demoPath)}: new baseline"`);
  lines.push(
    `  node ${demoPath}/bench/manifest.js generate && git add ${demoPath}/bench/demo-manifest.json`,
  );
  lines.push('To restore the recorded state instead:');
  lines.push(`  git restore ${demoPath}`);
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * CLI: `node bench/manifest.js generate|check`                       *
 * ------------------------------------------------------------------ */

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  const command = process.argv[2] ?? 'generate';
  if (command === 'generate') {
    const manifest = writeManifest();
    process.stdout.write(`manifest written: ${Object.keys(manifest.files).length} files\n`);
  } else if (command === 'check') {
    const diff = checkCleanState();
    if (diff.ok) {
      process.stdout.write('clean-state check: ok (pristine)\n');
    } else {
      process.stderr.write(`${formatCleanStateReport(diff)}\n`);
      process.exit(1);
    }
  } else {
    process.stderr.write('usage: node bench/manifest.js [generate|check]\n');
    process.exit(2);
  }
}
