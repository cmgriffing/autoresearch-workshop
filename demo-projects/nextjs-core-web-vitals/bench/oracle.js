/**
 * The oracle: correctness and anti-degradation gate.
 *
 * Layers:
 *   L0  declared hooks resolve exactly once, visibility of required elements
 *   L1  dataset-derived content matches the generator for the verify seed
 *   L2  every scripted interaction produced its observable outcome
 *   L3  hero geometry, hit-testability, hero perceptual grid vs the baseline
 *   L4  hygiene: uncaught / hydration errors, subresource origin allowlist
 *
 * A missing or zero LCP measurement is always an oracle failure.
 */

import { WORKLOAD } from './config.js';
import { assetSize } from './dataset.js';
import { gridDistance } from './grid.js';

const FONT_URL_PATTERN = /\.(woff2?|ttf|otf|eot)([?#]|$)/i;

export function parseMoneyToCents(text) {
  const match = (text ?? '').replace(/,/g, '').match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
  return match ? Math.round(Number(match[1]) * 100) : null;
}

export function parseDigits(text) {
  const match = (text ?? '').replace(/,/g, '').match(/\d+/);
  return match ? Number(match[0]) : null;
}

/** Independent implementation of the filtering contract the app must satisfy. */
export function expectedFilteredReviews(dataset, query) {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return dataset.reviews;
  return dataset.reviews.filter((review) => review.text.toLowerCase().includes(needle));
}

export function renderedAspect(hero) {
  if (!hero) return Number.NaN;
  if (hero.rect && hero.rect.height > 0) return hero.rect.width / hero.rect.height;
  if (hero.naturalHeight > 0) return hero.naturalWidth / hero.naturalHeight;
  return Number.NaN;
}

function aspectWithin(hero, expectedAspect, tolerance) {
  const aspect = renderedAspect(hero);
  if (!Number.isFinite(aspect)) return { ok: false, aspect };
  return { ok: Math.abs(aspect - expectedAspect) / expectedAspect <= tolerance, aspect };
}

function sameSorted(a, b) {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

function fontCheck(domAfter, resources) {
  const fontEntries = resources.filter(
    (resource) =>
      (resource.initiatorType === 'css' || resource.initiatorType === 'link') &&
      FONT_URL_PATTERN.test(resource.name) &&
      (resource.transferSize > 0 || resource.encodedBodySize > 0),
  );
  const fontBytes = fontEntries.reduce(
    (sum, resource) =>
      sum + (resource.transferSize > 0 ? resource.transferSize : resource.encodedBodySize),
    0,
  );

  const families = new Set();
  for (const stack of [domAfter?.titleFontFamily, domAfter?.priceFontFamily]) {
    for (const family of (stack ?? '').split(',')) {
      const cleaned = family.trim().replace(/^["']|["']$/g, '');
      if (cleaned) families.add(cleaned);
    }
  }
  const familyInUse = [...families].some(
    (family) =>
      domAfter?.fonts?.some((face) => face.family === family && face.status === 'loaded') &&
      domAfter?.fontChecks?.[family] === true,
  );

  return {
    ok: fontEntries.length > 0 && familyInUse,
    fontBytes,
    fontResourceCount: fontEntries.length,
    families: [...families],
    familyInUse,
  };
}

/**
 * Evaluates the oracle for one verify-seed load.
 *
 * @param {object} context
 * @param {object} context.dataset      generated dataset for the verify seed
 * @param {object} context.load         result of `runLoad` in 'oracle' mode
 * @param {number[][]|null} context.baselineGrid  captured 12×12 hero grid
 * @param {string} context.appOrigin    application origin
 * @param {string} context.originsOrigin  fixture origins origin
 */
export function evaluateOracle({ seed, dataset, load, baselineGrid, appOrigin, originsOrigin }) {
  const failures = [];
  const fail = (layer, message) => failures.push({ layer, message });
  const product = dataset.product;
  const { domBefore, domAfter, metrics } = load;

  // ---------------------------------------------------------------- L0
  const hookCounts = domAfter?.hookCounts ?? {};
  for (const hook of Object.keys(hookCounts)) {
    if (hookCounts[hook] !== 1) {
      fail('L0', `hook "${hook}" resolves ${hookCounts[hook]} times (expected exactly 1)`);
    }
  }
  if (!domAfter?.hero?.visible) fail('L0', 'hero hook is missing or not visible');
  if (!domBefore?.hero?.visible) fail('L0', 'hero hook is missing or not visible on the initial render');
  if (domAfter?.hero?.elementTiming !== 'hero') {
    fail('L0', 'hero element must carry elementtiming="hero" (the paint-time measurement hook)');
  }

  // ---------------------------------------------------------------- L1
  if (domBefore?.title !== product.name) {
    fail('L1', `title "${domBefore?.title}" does not match the verify seed's product name`);
  }
  const priceCents = parseMoneyToCents(domBefore?.priceText);
  if (priceCents !== product.priceCents) {
    fail('L1', `price "${domBefore?.priceText}" does not match the verify seed's price`);
  }
  if (product.discountPct > 0) {
    const discountPct = parseDigits(domBefore?.discountText);
    if (discountPct !== product.discountPct) {
      fail('L1', `discount "${domBefore?.discountText}" does not match the verify seed's discount`);
    }
    const originalCents = parseMoneyToCents(domBefore?.originalPriceText);
    if (originalCents !== product.listCents) {
      fail('L1', `original price "${domBefore?.originalPriceText}" does not match the verify seed`);
    }
  }
  const reviewCount = parseDigits(domBefore?.reviewCountText);
  if (reviewCount !== dataset.reviews.length) {
    fail('L1', `review count "${domBefore?.reviewCountText}" does not match the verify seed`);
  }
  const variantCount = domBefore?.variantOptions?.length ?? 0;
  if (variantCount !== product.variants.length) {
    fail('L1', `variant count ${variantCount} does not match the verify seed (${product.variants.length})`);
  }
  const heroAspect = aspectWithin(
    domBefore?.hero,
    product.hero.width / product.hero.height,
    WORKLOAD.heroGeometry.aspectTolerance,
  );
  if (!heroAspect.ok) {
    fail(
      'L1',
      `initial hero aspect ${heroAspect.aspect?.toFixed?.(3)} does not match the verify seed's asset (${(product.hero.width / product.hero.height).toFixed(3)})`,
    );
  }

  // ---------------------------------------------------------------- L2
  const byName = Object.fromEntries((load.outcomes ?? []).map((entry) => [entry.name, entry]));
  for (const name of ['filter', 'variant', 'cart', 'shipping', 'banner']) {
    const outcome = byName[name];
    if (!outcome) {
      fail('L2', `interaction "${name}" did not run`);
    } else if (!outcome.ok) {
      fail('L2', `interaction "${name}" produced no observable outcome (${outcome.error})`);
    }
  }

  const expected = expectedFilteredReviews(dataset, WORKLOAD.filterQuery);
  const actualIds = (domAfter?.reviewIds ?? []).filter(Boolean);
  if (!sameSorted(actualIds, expected.map((review) => review.id))) {
    fail(
      'L2',
      `filtered review set mismatch: ${actualIds.length} rendered, ${expected.length} expected`,
    );
  }
  const filterCount = parseDigits(domAfter?.filterCountText);
  if (filterCount !== expected.length) {
    fail('L2', `filter match count "${domAfter?.filterCountText}" !== ${expected.length}`);
  }

  const clickedVariant = product.variants[1];
  const pressed = (domAfter?.variantOptions ?? []).filter((option) => option.pressed);
  if (pressed.length !== 1 || pressed[0]?.id !== clickedVariant.id) {
    fail('L2', `selected variant chip is "${pressed.map((option) => option.id).join(',')}"`);
  }
  const variantAsset = assetSize(seed, clickedVariant.asset);
  const variantAspect = aspectWithin(
    domAfter?.hero,
    variantAsset.width / variantAsset.height,
    WORKLOAD.heroGeometry.aspectTolerance,
  );
  if (!variantAspect.ok) {
    fail('L2', 'hero did not resolve to the selected variant asset (aspect mismatch)');
  }

  const cartCount = parseDigits(domAfter?.cartCountText);
  if (cartCount !== 1) fail('L2', `cart count "${domAfter?.cartCountText}" !== 1 after add to cart`);
  if (!(domAfter?.cartLineTexts ?? []).some((line) => line.includes(product.name))) {
    fail('L2', 'cart line does not show the product name');
  }

  const expectedShippingCents = dataset.shipping.zips[WORKLOAD.estimateZip];
  const shippingCents = parseMoneyToCents(domAfter?.shippingText);
  if (shippingCents !== expectedShippingCents) {
    fail(
      'L2',
      `shipping estimate "${domAfter?.shippingText}" does not match the dataset value for ZIP ${WORKLOAD.estimateZip}`,
    );
  }

  if (!domAfter?.bannerVisible) fail('L2', 'promo banner is not visible');
  if (domAfter?.bannerText !== dataset.promo.text) {
    fail('L2', `promo banner text "${domAfter?.bannerText}" does not match the dataset promo`);
  }

  // ---------------------------------------------------------------- L3
  for (const [name, passed] of Object.entries(domAfter?.hitTests ?? {})) {
    if (!passed) fail('L3', `control "${name}" is not hit-testable at its center`);
  }
  const minWidth = WORKLOAD.viewport.width * WORKLOAD.heroGeometry.minViewportWidthFraction;
  if (domBefore?.hero && domBefore.hero.rect.width < minWidth) {
    fail('L3', `hero is ${Math.round(domBefore.hero.rect.width)}px wide (minimum ${minWidth}px)`);
  }
  if (domBefore?.hero && domBefore.hero.rect.height < WORKLOAD.heroGeometry.minHeightPx) {
    fail('L3', `hero is ${Math.round(domBefore.hero.rect.height)}px tall (minimum ${WORKLOAD.heroGeometry.minHeightPx}px)`);
  }

  const heroDiff =
    load.grid && baselineGrid ? gridDistance(load.grid, baselineGrid) : Number.POSITIVE_INFINITY;
  if (!(heroDiff <= WORKLOAD.heroGrid.maxMeanDistance)) {
    fail(
      'L3',
      `hero perceptual distance ${Number.isFinite(heroDiff) ? heroDiff.toFixed(2) : 'unavailable'} exceeds the threshold ${WORKLOAD.heroGrid.maxMeanDistance}`,
    );
  }

  // ---------------------------------------------------------------- L4
  if ((load.pageErrors ?? []).length > 0) {
    fail('L4', `uncaught page error(s): ${load.pageErrors.join(' | ')}`);
  }
  if ((load.hydrationErrors ?? []).length > 0) {
    fail('L4', `hydration error(s): ${load.hydrationErrors.join(' | ')}`);
  }
  const allowedOrigins = new Set([appOrigin, originsOrigin]);
  for (const resource of metrics?.resources ?? []) {
    let origin;
    try {
      origin = new URL(resource.name).origin;
    } catch {
      continue;
    }
    if (!origin.startsWith('http')) continue;
    if (!allowedOrigins.has(origin)) {
      fail('L4', `subresource from disallowed origin: ${resource.name}`);
    }
  }

  // ---------------------------------------------------------------- LCP
  // Primary paint component: the hero's Element Timing entry. A missing or
  // zero paint fails; it cannot be "kept" as an infinite win.
  if (!metrics?.lcp || metrics.lcp.renderTime <= 0) {
    fail('LCP', 'hero paint is missing or zero — the paint component cannot be trusted');
  }

  // ---------------------------------------------------------------- fonts
  const font = fontCheck(domAfter, metrics?.resources ?? []);
  if (!font.ok) {
    fail(
      'FONT',
      `brand webfont no longer loads: ${font.fontResourceCount} font resource(s), family in use: ${font.familyInUse}`,
    );
  }

  return {
    ok: failures.length === 0,
    failures,
    signals: {
      hero_diff: Number.isFinite(heroDiff) ? Math.round(heroDiff * 100) / 100 : null,
      font_bytes: font.fontBytes,
    },
  };
}

export function formatOracleFailures(failures) {
  return failures.map((failure) => `  [${failure.layer}] ${failure.message}`).join('\n');
}
