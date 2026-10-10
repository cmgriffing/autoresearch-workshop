/**
 * Seeded dataset generator.
 *
 * This is the single source of truth for the bench-owned fixture origins and
 * for the oracle: expected values are computed here, never copied from the
 * application. `generateDataset(seed)` is pure and deterministic — same seed,
 * same dataset, byte for byte.
 *
 * The generator intentionally produces two deliberately different datasets
 * (see PER_SEED). Sessions cannot pass the verify-seed oracle by hardcoding
 * the timed seed's values.
 */

import { TIMED_SEED, VERIFY_SEED } from './config.js';

export { TIMED_SEED, VERIFY_SEED, SEEDS, SEED_SLUGS } from './config.js';

/* ------------------------------------------------------------------ *
 * Deterministic PRNG (mulberry32 over an FNV-1a hash of the seed).    *
 * ------------------------------------------------------------------ */

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createRng(seed) {
  let state = fnv1a(String(seed));
  return function rng() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, values) {
  return values[Math.floor(rng() * values.length) % values.length];
}

function intBetween(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function toPriceEndingIn99(cents) {
  return Math.round(cents / 100) * 100 + 99;
}

/* ------------------------------------------------------------------ *
 * Per-seed knobs.                                                    *
 * ------------------------------------------------------------------ */

const PER_SEED = {
  [TIMED_SEED]: { variantCount: 4, reviewCount: 3000 },
  [VERIFY_SEED]: { variantCount: 3, reviewCount: 2400 },
};

const HERO_BY_SEED = {
  [TIMED_SEED]: { width: 2560, height: 1600 },
  [VERIFY_SEED]: { width: 2400, height: 1800 },
};

export function seedConfig(seed) {
  const known = PER_SEED[seed];
  if (known) {
    return { ...known, hero: HERO_BY_SEED[seed] };
  }
  const rng = createRng(`config:${seed}`);
  return {
    variantCount: 3,
    reviewCount: 800,
    hero: { width: 2560, height: 1600 },
  };
}

/* ------------------------------------------------------------------ *
 * Content vocabulary.                                               *
 * ------------------------------------------------------------------ */

const BRAND = 'Northlight';

const ADJECTIVES = [
  'Aurora',
  'Halcyon',
  'Ember',
  'Quartz',
  'Marlow',
  'Kestrel',
  'Solstice',
  'Vantage',
  'Beacon',
  'Juniper',
  'Cinder',
  'Mariner',
];

const PRODUCT_TYPES = [
  'Bedside Lamp',
  'Floor Lamp',
  'Pendant Light',
  'Desk Lamp',
  'Wall Sconce',
  'Table Lamp',
];

const COLORWAYS = [
  'Warm White',
  'Cool White',
  'Matte Black',
  'Brushed Brass',
  'Sage',
  'Terracotta',
];

const PROMO_CODES = ['GLOW', 'LIGHT', 'WARM', 'HOME', 'NIGHT', 'COZY'];

const FIRST_NAMES = [
  'Ada',
  'Bea',
  'Cleo',
  'Devon',
  'Eli',
  'Fern',
  'Gus',
  'Hana',
  'Iris',
  'Jonah',
  'Kai',
  'Lena',
  'Mira',
  'Noor',
  'Omar',
  'Priya',
  'Quinn',
  'Rosa',
  'Sam',
  'Tess',
  'Uma',
  'Vik',
  'Wren',
  'Yara',
];

const LAST_INITIALS = ['A', 'B', 'C', 'D', 'F', 'G', 'H', 'K', 'L', 'M', 'P', 'R', 'S', 'T', 'V'];

const REVIEW_SUBJECTS = [
  'Lovely light',
  'Exactly what I needed',
  'Solid build',
  'Better in person',
  'Works well',
  'Nice piece',
  'Happy with this',
  'Good value',
  'Beautiful finish',
  'Almost perfect',
  'Great for the price',
  'Would buy again',
];

const REVIEW_BODIES = [
  'The dimmer is smooth and the finish matches the photos.',
  'Shipping was quick and the packaging was recyclable.',
  'The shade throws a warm, even glow for a bedroom.',
  'Bought two for the living room and they look great together.',
  'The touch control is responsive and the base stays put.',
  'Took a star off because the cable is a little short.',
  'The colour is slightly warmer than expected, but I still like it.',
  'Assembly was simple and everything lined up properly.',
  'It is brighter than expected on the lowest setting.',
  'The materials feel sturdy and there are no wobbles.',
];

/** Phrases that the scripted filter query matches (case-insensitively). */
const FILTER_PHRASES = [
  'Pairs over wireless with the app in seconds.',
  'The WIRELESS remote is a thoughtful touch.',
  'Setup is wireless and took under a minute.',
];

export const FILTER_QUERY = 'wireless';

/* ------------------------------------------------------------------ *
 * Asset catalogue.                                                  *
 * ------------------------------------------------------------------ */

export const ASSET_SIZES = {
  hero: null, // per seed
  alt1: { width: 960, height: 600 },
  alt2: { width: 960, height: 600 },
  alt3: { width: 960, height: 600 },
  rec1: { width: 640, height: 400 },
  rec2: { width: 640, height: 400 },
  rec3: { width: 640, height: 400 },
};

export function assetSize(seed, asset) {
  const { hero } = seedConfig(seed);
  const size = ASSET_SIZES[asset];
  if (!size) {
    if (asset === 'hero') return { width: hero.width, height: hero.height };
    return null;
  }
  return size;
}

/* ------------------------------------------------------------------ *
 * Dataset generation.                                               *
 * ------------------------------------------------------------------ */

export function generateDataset(seed) {
  const cfg = seedConfig(seed);
  const rng = createRng(`dataset:${seed}`);

  const productName = `${BRAND} ${pick(rng, ADJECTIVES)} ${pick(rng, PRODUCT_TYPES)}`;
  const listCents = toPriceEndingIn99(intBetween(rng, 7900, 25900));
  const discountPct = pick(rng, [15, 20, 25, 30]);
  const priceCents = toPriceEndingIn99(Math.round((listCents * (100 - discountPct)) / 100));

  const variants = [];
  for (let i = 0; i < cfg.variantCount; i += 1) {
    variants.push({
      id: `v${i + 1}`,
      label: COLORWAYS[i % COLORWAYS.length],
      asset: i === 0 ? 'hero' : `alt${i}`,
    });
  }

  const recommendations = [];
  for (let i = 0; i < 3; i += 1) {
    const adjective = pick(rng, ADJECTIVES);
    const type = pick(rng, PRODUCT_TYPES);
    recommendations.push({
      id: `rec${i + 1}`,
      name: `${BRAND} ${adjective} ${type}`,
      priceCents: toPriceEndingIn99(intBetween(rng, 5900, 19900)),
      asset: `rec${i + 1}`,
    });
  }

  const reviews = [];
  let ratingTotal = 0;
  for (let i = 0; i < cfg.reviewCount; i += 1) {
    const rating = pick(rng, [5, 5, 5, 5, 4, 4, 4, 3, 3, 2, 1]);
    ratingTotal += rating;
    const author = `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_INITIALS)}.`;
    let text = pick(rng, REVIEW_BODIES);
    if (i % 5 === 0) {
      text = `${pick(rng, FILTER_PHRASES)} ${text}`;
    }
    reviews.push({
      id: `r${String(i + 1).padStart(4, '0')}`,
      author,
      rating,
      text: `${pick(rng, REVIEW_SUBJECTS)} — ${text}`,
    });
  }

  const zips = {};
  for (let i = 0; i < 3200; i += 1) {
    zips[String(10000 + i)] = intBetween(rng, 499, 2499);
  }

  const promoCode = `${pick(rng, PROMO_CODES)}${discountPct}`;

  return {
    seed,
    product: {
      name: productName,
      brand: BRAND,
      priceCents,
      listCents,
      discountPct,
      currency: 'USD',
      hero: { asset: 'hero', width: cfg.hero.width, height: cfg.hero.height },
      variants,
      recommendations,
      reviewCount: reviews.length,
      ratingAvg: Number((ratingTotal / reviews.length).toFixed(2)),
    },
    promo: {
      text: `Weekend offer: ${discountPct}% off with code ${promoCode}`,
    },
    reviews,
    shipping: {
      origin: '10000',
      zips,
    },
  };
}

/** Assets that need baked fixtures for a seed. */
export function assetsForSeed(seed) {
  const dataset = generateDataset(seed);
  return [
    dataset.product.hero.asset,
    ...dataset.product.variants.map((v) => v.asset),
    ...dataset.product.recommendations.map((r) => r.asset),
  ].filter((asset, index, all) => all.indexOf(asset) === index);
}
