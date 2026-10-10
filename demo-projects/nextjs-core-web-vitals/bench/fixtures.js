/**
 * Shared fixture-path helpers for the baked image and font assets.
 * Used by the fixture generator, the origins server and the manifest tool.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const FIXTURE_ROOT = path.join(__dirname, 'fixtures');
export const IMAGE_ROOT = path.join(FIXTURE_ROOT, 'img');
export const FONT_ROOT = path.join(FIXTURE_ROOT, 'font');

export const FORMAT_EXT = { jpeg: 'jpg', webp: 'webp' };
export const FONT_FILES = ['brand-400.woff2', 'brand-600.woff2'];

/** Baked width tiers per asset: thumbnail, mid tier, and the natural size. */
export function widthTiers(naturalWidth) {
  const tiers = [320, 960, naturalWidth];
  return [...new Set(tiers.filter((w) => w <= naturalWidth))].sort((a, b) => a - b);
}

export function fixturePath(slug, asset, width, fmt) {
  const ext = FORMAT_EXT[fmt] ?? fmt;
  return path.join(IMAGE_ROOT, slug, `${asset}-${width}.${ext}`);
}

export function fontPath(file) {
  return path.join(FONT_ROOT, file);
}

export function fixtureExists(slug, asset, width, fmt) {
  return fs.existsSync(fixturePath(slug, asset, width, fmt));
}
