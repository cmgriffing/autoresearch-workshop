import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGION_MANIFEST } from '../bench/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

function sourceText() {
  const files = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(abs);
      else if (/\.(ts|tsx|css)$/.test(entry.name)) files.push(fs.readFileSync(abs, 'utf8'));
    }
  };
  visit(SRC);
  return files.join('\n');
}

/** The interaction hooks the scripted scenario and the oracle rely on. */
const HOOKS = [
  'session-clock',
  'market-status',
  'account-pnl',
  'topbar-symbol',
  'theme-toggle',
  'watchlist-count',
  'watch-row',
  'chart-symbol',
  'chart-price',
  'chart-series',
  'book-symbol',
  'book-row',
  'position-row',
  'positions-total',
  'ticket-symbol',
  'ticket-qty',
  'ticket-price',
  'ticket-side',
  'ticket-submit',
  'news-count',
  'news-item',
  'blotter-count',
  'blotter-row',
  'tape-latest',
  'toast',
  'toast-dismiss',
  'modal-open',
  'modal-panel',
  'modal-confirm',
  'modal-dismiss',
  'settings-seed',
  'settings-symbol',
];

test('application source defines every region marker value', () => {
  const source = sourceText();
  for (const region of REGION_MANIFEST) {
    assert.ok(
      source.includes(`'${region}'`) || source.includes(`"${region}"`),
      `region marker value "${region}" is missing from src/`,
    );
  }
});

test('application source carries every interaction hook', () => {
  const source = sourceText();
  for (const hook of HOOKS) {
    assert.ok(source.includes(`"${hook}"`), `interaction hook "${hook}" is missing from src/`);
  }
});
