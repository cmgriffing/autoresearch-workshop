import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SEEDS,
  TIMED_SEED,
  VERIFY_SEED,
  DATASET,
} from '../bench/config.js';
import {
  createRng,
  generateDataset,
  snapshotFor,
  timelineFor,
  ordersFor,
} from '../bench/dataset.js';

test('the generator is deterministic for a seed', () => {
  assert.deepEqual(generateDataset(TIMED_SEED), generateDataset(TIMED_SEED));
  assert.deepEqual(generateDataset(VERIFY_SEED), generateDataset(VERIFY_SEED));
});

test('the PRNG is deterministic per seed', () => {
  const a = createRng('seed:text');
  const b = createRng('seed:text');
  for (let index = 0; index < 10; index += 1) {
    assert.equal(a(), b());
  }
  assert.notEqual(createRng('seed:other')(), createRng('seed:text')());
});

test('the two seeds produce different dashboards', () => {
  const timed = generateDataset(TIMED_SEED);
  const verify = generateDataset(VERIFY_SEED);
  assert.notDeepEqual(
    timed.symbols.map((symbol) => symbol.id),
    verify.symbols.map((symbol) => symbol.id),
  );
  assert.notDeepEqual(timed.timeline[0].prices, verify.timeline[0].prices);
  assert.notDeepEqual(
    timed.orders.map((order) => `${order.id}:${order.symbol}:${order.price}`),
    verify.orders.map((order) => `${order.id}:${order.symbol}:${order.price}`),
  );
});

test('the dataset has the declared shape', () => {
  for (const seed of SEEDS) {
    const dataset = generateDataset(seed);
    assert.equal(dataset.symbols.length, DATASET.symbolCount);
    assert.equal(dataset.positions.length, DATASET.positionCount);
    assert.equal(dataset.orders.length, DATASET.orderCount);
    assert.equal(dataset.timeline.length, DATASET.tickCount);
    assert.equal(dataset.news.length, DATASET.newsInitial + DATASET.newsArrivals.length);
    assert.equal(new Set(dataset.symbols.map((symbol) => symbol.id)).size, DATASET.symbolCount);
    for (const tick of dataset.timeline) {
      assert.equal(Object.keys(tick.prices).length, DATASET.symbolCount);
      assert.equal(Object.keys(tick.books).length, DATASET.symbolCount);
      for (const symbol of dataset.symbols) {
        const book = tick.books[symbol.id];
        assert.equal(book.bids.length, DATASET.bookLevels);
        assert.equal(book.asks.length, DATASET.bookLevels);
        for (let level = 1; level < DATASET.bookLevels; level += 1) {
          assert.ok(book.bids[level][0] < book.bids[level - 1][0], 'bids must descend');
          assert.ok(book.asks[level][0] > book.asks[level - 1][0], 'asks must ascend');
        }
        assert.ok(book.asks[0][0] > book.bids[0][0], 'the spread must be positive');
      }
    }
  }
});

test('news arrivals land on their declared ticks and stay most-recent-first', () => {
  for (const seed of SEEDS) {
    const dataset = generateDataset(seed);
    const arrivals = dataset.news
      .filter((item) => item.arrivalTick !== null)
      .map((item) => item.arrivalTick);
    assert.deepEqual([...arrivals].sort((a, b) => a - b), [...DATASET.newsArrivals].sort((a, b) => a - b));
    for (const item of dataset.news) {
      if (item.arrivalTick === null) continue;
      assert.equal(dataset.timeline[item.arrivalTick].newsId, item.id);
    }
    const sequences = dataset.news.map((item) => item.sequence);
    assert.deepEqual(sequences, [...sequences].sort((a, b) => b - a));
  }
});

test('tick prices move deterministically but not identically between seeds', () => {
  const timed = generateDataset(TIMED_SEED);
  const verify = generateDataset(VERIFY_SEED);
  assert.notDeepEqual(timed.timeline[5].prices, verify.timeline[5].prices);
  const timedAgain = generateDataset(TIMED_SEED);
  assert.deepEqual(timed.timeline[5], timedAgain.timeline[5]);
});

test('endpoint payloads carry the seed and match the dataset', () => {
  const dataset = generateDataset(VERIFY_SEED);
  const snapshot = snapshotFor(dataset);
  const timeline = timelineFor(dataset);
  const orders = ordersFor(dataset);
  assert.equal(snapshot.seed, VERIFY_SEED);
  assert.equal(timeline.seed, VERIFY_SEED);
  assert.equal(orders.seed, VERIFY_SEED);
  assert.equal(snapshot.symbols[0].price, dataset.timeline[0].prices[dataset.symbols[0].id]);
  assert.equal(snapshot.news.length, dataset.news.length);
  assert.equal(snapshot.news.filter((item) => item.arrivalTick === null).length, DATASET.newsInitial);
  assert.equal(timeline.ticks.length, DATASET.tickCount);
  assert.equal(orders.orders.length, DATASET.orderCount);
});
