/**
 * Baseline capture: renders both seeds, validates the hero crop (visible,
 * minimum geometry, aspect within tolerance of the fixture) before storing a
 * 12×12 perceptual grid, and records full-page "before" screenshots.
 */

import { SEEDS, SEED_SLUGS, assetSize, generateDataset } from './dataset.js';
import { WORKLOAD } from './config.js';
import { runLoad } from './measure.js';
import { writeBeforeScreenshot, writeBaseline, readBaseline } from './baseline.js';
import { renderedAspect } from './oracle.js';

export function validateHeroCrop({ seed, dom }) {
  const dataset = generateDataset(seed);
  const hero = dom?.hero;
  const problems = [];
  if (!hero || !hero.visible) problems.push('hero is missing or not visible');
  if (hero) {
    const minWidth = WORKLOAD.viewport.width * WORKLOAD.heroGeometry.minViewportWidthFraction;
    if (hero.rect.width < minWidth) {
      problems.push(`hero is ${Math.round(hero.rect.width)}px wide (minimum ${minWidth}px)`);
    }
    if (hero.rect.height < WORKLOAD.heroGeometry.minHeightPx) {
      problems.push(
        `hero is ${Math.round(hero.rect.height)}px tall (minimum ${WORKLOAD.heroGeometry.minHeightPx}px)`,
      );
    }
    const expectedAspect = dataset.product.hero.width / dataset.product.hero.height;
    const aspect = renderedAspect(hero);
    if (!Number.isFinite(aspect) || Math.abs(aspect - expectedAspect) / expectedAspect > WORKLOAD.heroGeometry.aspectTolerance) {
      problems.push(`hero aspect ${aspect.toFixed(3)} does not match the fixture (${expectedAspect.toFixed(3)})`);
    }
  }
  return problems;
}

export async function captureBaselines({ root, browser, appUrl, baselineKey, log = () => {} }) {
  const grids = {};
  for (const seed of SEEDS) {
    const load = await runLoad({ browser, appUrl, seed, mode: 'capture' });
    const problems = validateHeroCrop({ seed, dom: load.domBefore });
    if (problems.length > 0) {
      throw new Error(`baseline capture failed for seed ${seed}: ${problems.join('; ')}`);
    }
    grids[seed] = load.grid;
    writeBeforeScreenshot(root, SEED_SLUGS[seed], load.fullPagePng);
    log(
      `capture ${SEED_SLUGS[seed]}: hero ${Math.round(load.domBefore.hero.rect.width)}x${Math.round(load.domBefore.hero.rect.height)}px, grid ${WORKLOAD.heroGrid.cells}x${WORKLOAD.heroGrid.cells}`,
    );
  }
  writeBaseline(root, { key: baselineKey, grids });
  return readBaseline(root);
}
