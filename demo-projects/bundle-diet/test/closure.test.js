import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectCriticalFiles } from '../bench/lib.js';

const distDir = '/dist';

function fixtureManifest() {
  return {
    'src/main.js': {
      file: 'assets/main.js',
      src: 'src/main.js',
      isEntry: true,
      imports: ['src/shared.js'],
      dynamicImports: ['src/lazy.js'],
      css: ['assets/main.css'],
    },
    'src/shared.js': {
      file: 'assets/shared.js',
      src: 'src/shared.js',
      imports: [],
      dynamicImports: ['src/deeper-lazy.js'],
    },
    'src/lazy.js': {
      file: 'assets/lazy.js',
      src: 'src/lazy.js',
      imports: [],
      dynamicImports: [],
    },
    'src/deeper-lazy.js': {
      file: 'assets/deeper-lazy.js',
      src: 'src/deeper-lazy.js',
      imports: [],
      dynamicImports: [],
    },
  };
}

test('critical path includes static imports and CSS', () => {
  const files = collectCriticalFiles(fixtureManifest(), distDir);
  assert.ok(files.includes('/dist/assets/main.js'));
  assert.ok(files.includes('/dist/assets/shared.js'));
  assert.ok(files.includes('/dist/assets/main.css'));
});

test('critical path excludes dynamically imported chunks', () => {
  const files = collectCriticalFiles(fixtureManifest(), distDir);
  assert.ok(!files.includes('/dist/assets/lazy.js'));
  assert.ok(!files.includes('/dist/assets/deeper-lazy.js'));
});
