import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SEEDS,
  TIMED_SEED,
  VERIFY_SEED,
  assetsForSeed,
  createRng,
  generateDataset,
} from '../bench/dataset.js';

const FILTER_QUERY = 'wireless';

function filteredCount(dataset) {
  return dataset.reviews.filter((review) => review.text.toLowerCase().includes(FILTER_QUERY)).length;
}

test('the generator is deterministic for a seed', () => {
  assert.deepEqual(generateDataset(TIMED_SEED), generateDataset(TIMED_SEED));
  assert.deepEqual(generateDataset(VERIFY_SEED), generateDataset(VERIFY_SEED));
});

test('the PRNG is deterministic per seed', () => {
  const a = createRng('seed:text');
  const b = createRng('seed:text');
  const c = createRng('seed:other');
  const draw = (rng) => [rng(), rng(), rng()];
  assert.deepEqual(draw(a), draw(b));
  assert.notDeepEqual(draw(b), draw(c));
});

test('golden values: timed seed', () => {
  const dataset = generateDataset(TIMED_SEED);
  assert.equal(dataset.product.name, 'Northlight Cinder Desk Lamp');
  assert.equal(dataset.product.priceCents, 17499);
  assert.equal(dataset.product.listCents, 24899);
  assert.equal(dataset.product.discountPct, 30);
  assert.deepEqual(dataset.product.hero, { asset: 'hero', width: 2560, height: 1600 });
  assert.equal(dataset.product.variants.length, 4);
  assert.equal(dataset.reviews.length, 3000);
  assert.equal(dataset.reviews[0].id, 'r0001');
  assert.equal(dataset.reviews.at(-1).id, 'r3000');
  assert.equal(filteredCount(dataset), 600);
  assert.equal(dataset.shipping.zips['10001'], 775);
  assert.equal(dataset.promo.text, 'Weekend offer: 30% off with code HOME30');
});

test('golden values: verify seed', () => {
  const dataset = generateDataset(VERIFY_SEED);
  assert.equal(dataset.product.name, 'Northlight Marlow Wall Sconce');
  assert.equal(dataset.product.priceCents, 10399);
  assert.equal(dataset.product.listCents, 12899);
  assert.equal(dataset.product.discountPct, 20);
  assert.deepEqual(dataset.product.hero, { asset: 'hero', width: 2400, height: 1800 });
  assert.equal(dataset.product.variants.length, 3);
  assert.equal(dataset.reviews.length, 2400);
  assert.equal(dataset.reviews.at(-1).id, 'r2400');
  assert.equal(filteredCount(dataset), 480);
  assert.equal(dataset.shipping.zips['10001'], 951);
  assert.equal(dataset.promo.text, 'Weekend offer: 20% off with code NIGHT20');
});

test('the two seeds differ as designed', () => {
  const timed = generateDataset(TIMED_SEED);
  const verify = generateDataset(VERIFY_SEED);
  assert.notEqual(timed.product.name, verify.product.name);
  assert.notEqual(timed.product.priceCents, verify.product.priceCents);
  assert.notEqual(timed.reviews.length, verify.reviews.length);
  assert.notEqual(timed.product.variants.length, verify.product.variants.length);
  assert.notDeepEqual(timed.product.hero, verify.product.hero);
  assert.notEqual(timed.shipping.zips['10001'], verify.shipping.zips['10001']);
  assert.notEqual(timed.promo.text, verify.promo.text);
});

test('every declared seed has a complete asset catalogue', () => {
  for (const seed of SEEDS) {
    const assets = assetsForSeed(seed);
    assert.ok(assets.includes('hero'));
    assert.ok(assets.length >= 5, `expected at least five assets for ${seed}`);
    assert.equal(new Set(assets).size, assets.length);
  }
});

test('the shipping table is dense and deterministic', () => {
  const dataset = generateDataset(TIMED_SEED);
  const zips = Object.keys(dataset.shipping.zips);
  assert.equal(zips.length, 3200);
  assert.equal(zips[0], '10000');
  assert.equal(zips.at(-1), '13199');
});
