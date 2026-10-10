import test from 'node:test';
import assert from 'node:assert/strict';
import { imageUrl } from '../app/lib/images.js';

const BASE = 'http://127.0.0.1:4100';

test('imageUrl builds a natural-size CDN URL by default', () => {
  assert.equal(
    imageUrl(BASE, 'storefront-timed-1', 'hero'),
    'http://127.0.0.1:4100/cdn/storefront-timed-1/hero?fmt=jpeg',
  );
});

test('imageUrl carries width and format parameters', () => {
  assert.equal(
    imageUrl(BASE, 'storefront-timed-1', 'alt1', { width: 960, fmt: 'webp' }),
    'http://127.0.0.1:4100/cdn/storefront-timed-1/alt1?w=960&fmt=webp',
  );
});

test('imageUrl encodes seed and asset path segments', () => {
  const url = imageUrl('http://127.0.0.1:4100/', 'seed with space', 'a/b');
  assert.equal(url, 'http://127.0.0.1:4100/cdn/seed%20with%20space/a%2Fb?fmt=jpeg');
});
