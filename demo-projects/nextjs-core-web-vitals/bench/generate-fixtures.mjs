/**
 * Authoring tool: bake the bench-owned image fixtures.
 *
 * Run once (or after changing the dataset asset catalogue):
 *
 *     node bench/generate-fixtures.mjs
 *
 * For every seed and asset, a deterministic procedural scene is drawn on a
 * canvas at the asset's natural size, then downscaled to the baked width
 * tiers and exported as JPEG and WebP. The outputs are committed under
 * `bench/fixtures/img/` and covered by the content manifest.
 *
 * Chromium is required (the same prerequisite as the benchmark harness).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { SEEDS, SEED_SLUGS, assetsForSeed, assetSize } from './dataset.js';
import { IMAGE_ROOT, FORMAT_EXT, widthTiers } from './fixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = IMAGE_ROOT;

/**
 * The hero assets carry the planted transfer cost: heavy grain at high JPEG
 * quality keeps the full-size file in the multi-megabyte range while smaller
 * widths stay modest.
 */
function renderProfile(asset, fmt) {
  if (asset === 'hero') {
    return { quality: fmt === 'jpeg' ? 0.92 : 0.82, noise: 56 };
  }
  return { quality: fmt === 'jpeg' ? 0.82 : 0.72, noise: 22 };
}

/** Baked width tiers per asset: thumbnails, a mid tier, and the natural size. */

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const manifest = {};

  for (const seed of SEEDS) {
    const slug = SEED_SLUGS[seed];
    const dir = path.join(OUT_ROOT, slug);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    for (const asset of assetsForSeed(seed)) {
      const natural = assetSize(seed, asset);
      if (!natural) throw new Error(`no natural size for asset ${asset}`);
      for (const width of widthTiers(natural.width)) {
        const height = Math.round((width / natural.width) * natural.height);
        for (const fmt of ['jpeg', 'webp']) {
          const dataUrl = await page.evaluate(
            ({ seedKey, asset: assetId, natural, width, height, fmt, quality, noise }) => {
              const fnv1a = (text) => {
                let h = 0x811c9dc5;
                for (let i = 0; i < text.length; i += 1) {
                  h ^= text.charCodeAt(i);
                  h = Math.imul(h, 0x01000193);
                }
                return h >>> 0;
              };
              const makeRng = (text) => {
                let state = fnv1a(text);
                return () => {
                  state = (state + 0x6d2b79f5) | 0;
                  let t = Math.imul(state ^ (state >>> 15), 1 | state);
                  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
                  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
                };
              };
              const rng = makeRng(`${seedKey}:${assetId}`);

              const source = document.createElement('canvas');
              source.width = natural.width;
              source.height = natural.height;
              const ctx = source.getContext('2d', { willReadFrequently: true });

              // Base: diagonal gradient between two seeded hues.
              const hueA = Math.floor(rng() * 360);
              const hueB = (hueA + 40 + Math.floor(rng() * 140)) % 360;
              const grad = ctx.createLinearGradient(0, 0, natural.width, natural.height);
              grad.addColorStop(0, `hsl(${hueA} ${40 + Math.floor(rng() * 30)}% ${58 + Math.floor(rng() * 20)}%)`);
              grad.addColorStop(1, `hsl(${hueB} ${35 + Math.floor(rng() * 30)}% ${18 + Math.floor(rng() * 22)}%)`);
              ctx.fillStyle = grad;
              ctx.fillRect(0, 0, natural.width, natural.height);

              // Layered abstract shapes.
              for (let i = 0; i < 240; i += 1) {
                ctx.save();
                ctx.globalAlpha = 0.12 + rng() * 0.5;
                ctx.fillStyle = `hsl(${(hueA + Math.floor(rng() * 180)) % 360} ${30 + Math.floor(rng() * 50)}% ${20 + Math.floor(rng() * 65)}%)`;
                const x = rng() * natural.width;
                const y = rng() * natural.height;
                const size = 40 + rng() * natural.width * 0.18;
                if (rng() < 0.5) {
                  ctx.beginPath();
                  ctx.arc(x, y, size * 0.5, 0, Math.PI * 2);
                  ctx.fill();
                } else {
                  ctx.translate(x, y);
                  ctx.rotate(rng() * Math.PI);
                  ctx.fillRect(-size / 2, -size / 4, size, size * (0.2 + rng() * 0.6));
                }
                ctx.restore();
              }

              // Vignette.
              const vignette = ctx.createRadialGradient(
                natural.width / 2,
                natural.height / 2,
                Math.min(natural.width, natural.height) * 0.2,
                natural.width / 2,
                natural.height / 2,
                Math.max(natural.width, natural.height) * 0.75,
              );
              vignette.addColorStop(0, 'rgba(255,255,255,0)');
              vignette.addColorStop(1, 'rgba(0,0,0,0.45)');
              ctx.fillStyle = vignette;
              ctx.fillRect(0, 0, natural.width, natural.height);

              // Photographic grain: keeps JPEG/WebP sizes in a realistic range.
              const image = ctx.getImageData(0, 0, natural.width, natural.height);
              const pixels = image.data;
              for (let i = 0; i < pixels.length; i += 4) {
                const n = (rng() - 0.5) * noise;
                pixels[i] = Math.max(0, Math.min(255, pixels[i] + n));
                pixels[i + 1] = Math.max(0, Math.min(255, pixels[i + 1] + n));
                pixels[i + 2] = Math.max(0, Math.min(255, pixels[i + 2] + n));
              }
              ctx.putImageData(image, 0, 0);

              // Asset caption for human inspection.
              ctx.save();
              ctx.globalAlpha = 0.85;
              ctx.fillStyle = 'rgba(0,0,0,0.55)';
              ctx.fillRect(24, natural.height - 120, Math.min(natural.width - 48, 640), 84);
              ctx.fillStyle = '#fff';
              ctx.font = `bold ${Math.round(natural.height * 0.035)}px system-ui, sans-serif`;
              ctx.fillText(`${assetId} · ${natural.width}×${natural.height}`, 44, natural.height - 64);
              ctx.restore();

              if (width === natural.width) {
                return source.toDataURL(`image/${fmt}`, quality);
              }
              const target = document.createElement('canvas');
              target.width = width;
              target.height = height;
              const tctx = target.getContext('2d');
              tctx.imageSmoothingQuality = 'high';
              tctx.drawImage(source, 0, 0, width, height);
              return target.toDataURL(`image/${fmt}`, quality);
            },
            {
              seedKey: seed,
              asset,
              natural,
              width,
              height,
              fmt,
              quality: renderProfile(asset, fmt).quality,
              noise: renderProfile(asset, fmt).noise,
            },
          );

          const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
          const file = `${asset}-${width}.${FORMAT_EXT[fmt]}`;
          fs.writeFileSync(path.join(dir, file), Buffer.from(base64, 'base64'));
          const { size } = fs.statSync(path.join(dir, file));
          manifest[`${slug}/${file}`] = size;
          console.log(`${String(size).padStart(9)}  ${slug}/${file}`);
        }
      }
    }
  }

  await browser.close();
  const total = Object.values(manifest).reduce((sum, size) => sum + size, 0);
  console.log(`\n${Object.keys(manifest).length} files, ${(total / 1024 / 1024).toFixed(1)} MiB total`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
