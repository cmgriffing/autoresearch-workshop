/**
 * Seeded, deterministic dataset for the trading dashboard.
 *
 * The generator is the single source of truth for every symbol, price tick,
 * order-book snapshot, news item, position and historical order. The
 * application never sees this file; it receives the generated JSON from the
 * bench-owned fixture endpoints. The oracle re-derives expected values from
 * the same generator plus the run's seed, so it never compares against
 * constants.
 */

import { DATASET, TICK_MS } from './config.js';

/** xmur3-style string hash feeding a mulberry32 PRNG. */
export function createRng(seed) {
  let h = 1779033703 ^ seed.length;
  for (let index = 0; index < seed.length; index += 1) {
    h = Math.imul(h ^ seed.charCodeAt(index), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let state = h >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round2 = (value) => Math.round(value * 100) / 100;

/** 40 fictional instruments; each seed gets a deterministic 30-symbol subset. */
const SYMBOL_POOL = [
  ['AURA', 'Aurora Metals', 'Materials'],
  ['BAST', 'Bastion Industrial', 'Industrials'],
  ['CDRA', 'Cedar Ridge Energy', 'Energy'],
  ['DUNE', 'Dune Analytics Co', 'Technology'],
  ['ELVA', 'Elva Semiconductor', 'Technology'],
  ['FTHM', 'Fathom Shipping', 'Industrials'],
  ['GILD', 'Gilded Holdings', 'Financials'],
  ['HRZN', 'Horizon Foods', 'Consumer'],
  ['IRIS', 'Iris Biotech', 'Healthcare'],
  ['JUNO', 'Juno Robotics', 'Technology'],
  ['KLAR', 'Klarn Health', 'Healthcare'],
  ['LUMI', 'Lumen Grid', 'Utilities'],
  ['MRDN', 'Meridian Rail', 'Industrials'],
  ['NOVA', 'Nova Retail Group', 'Consumer'],
  ['ORCA', 'Orca Logistics', 'Industrials'],
  ['PINE', 'Pinewood Capital', 'Financials'],
  ['QUIL', 'Quill Software', 'Technology'],
  ['RDGE', 'Ridgeway Mining', 'Materials'],
  ['SOLA', 'Sola Renewables', 'Energy'],
  ['TERN', 'Tern Aviation', 'Industrials'],
  ['UMBR', 'Umbra Security', 'Technology'],
  ['VEST', 'Vesta Homes', 'Consumer'],
  ['WILL', 'Willow Pharma', 'Healthcare'],
  ['XENO', 'Xeno Dynamics', 'Technology'],
  ['YARD', 'Yardarm Marine', 'Industrials'],
  ['ZEPH', 'Zephyr Air', 'Industrials'],
  ['ALDR', 'Alder Timber', 'Materials'],
  ['BRAM', 'Bramble Agritech', 'Consumer'],
  ['CORV', 'Corvus Defense', 'Industrials'],
  ['DRFT', 'Driftline Media', 'Communication'],
  ['EMBR', 'Ember Utilities', 'Utilities'],
  ['FERN', 'Fernway Hotels', 'Consumer'],
  ['GLEN', 'Glenmark Insurance', 'Financials'],
  ['HOLL', 'Hollowpoint Games', 'Communication'],
  ['ISLE', 'Isleworth Data', 'Technology'],
  ['JADE', 'Jadeite Mining', 'Materials'],
  ['KITE', 'Kite Financial', 'Financials'],
  ['LOOM', 'Loomcraft Textiles', 'Consumer'],
  ['MOSS', 'Mossgate Labs', 'Healthcare'],
  ['NIMB', 'Nimbus Cloud', 'Technology'],
];

const NEWS_SOURCES = ['Market Wire', 'Global Desk', 'Session Brief', 'Ticker Talk', 'Desk Notes'];

const NEWS_TEMPLATES = [
  '{name} guides full-year revenue above consensus',
  'Analysts raise {ticker} price target after channel checks',
  '{name} announces buyback of up to 4% of shares',
  '{name} wins multi-year supply agreement',
  '{ticker} downgraded on margin concerns',
  '{name} reports record quarterly orders',
  'Regulator clears {name} expansion plan',
  '{name} names new chief operating officer',
  '{ticker} added to mid-cap index watchlist',
  '{name} flags soft demand in its largest segment',
  'Institutional flow lifts {ticker} in early trade',
  '{name} completes divestiture of non-core unit',
];

function shuffle(rng, values) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

const pick = (rng, values) => values[Math.floor(rng() * values.length)];

function formatSessionTime(tickIndex) {
  const totalSeconds = tickIndex * 10;
  const hours = 9 + Math.floor((30 * 60 + totalSeconds) / 3600);
  const minutes = Math.floor(((30 * 60 + totalSeconds) % 3600) / 60);
  const seconds = (30 * 60 + totalSeconds) % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

function makeBook(rng, price) {
  const spread = round2(0.02 + rng() * 0.05);
  const bids = [];
  const asks = [];
  for (let level = 0; level < DATASET.bookLevels; level += 1) {
    bids.push([round2(price - spread * (level + 1)), (1 + Math.floor(rng() * 90)) * 100]);
    asks.push([round2(price + spread * (level + 1)), (1 + Math.floor(rng() * 90)) * 100]);
  }
  return { bids, asks };
}

/**
 * Builds the dataset for one seed. Deterministic: the same seed always yields
 * a deep-equal dataset.
 */
export function generateDataset(seed) {
  const key = String(seed);
  const rng = createRng(`trading:${key}`);

  // ------------------------------------------------------------- symbols
  const chosen = shuffle(rng, SYMBOL_POOL).slice(0, DATASET.symbolCount);
  const symbols = chosen.map(([id, name, sector]) => {
    const price = round2(8 + rng() * 240);
    const driftPct = (rng() - 0.5) * 0.06;
    return {
      id,
      name,
      sector,
      prevClose: round2(price / (1 + driftPct)),
      price,
      /** Trend bias per symbol, in basis points of drift per tick. */
      driftBps: Math.round((rng() - 0.5) * DATASET.volatilityBps),
    };
  });

  // ----------------------------------------------------------- positions
  const positionSymbols = shuffle(rng, symbols).slice(0, DATASET.positionCount);
  const positions = positionSymbols.map((symbol, index) => {
    const qty = (1 + Math.floor(rng() * 40)) * 100;
    const avgPrice = round2(symbol.price * (1 + (rng() - 0.5) * 0.08));
    return { id: `POS-${String(index + 1).padStart(2, '0')}`, symbol: symbol.id, qty, avgPrice };
  });

  // ------------------------------------------------------------ timeline
  const prices = Object.fromEntries(symbols.map((symbol) => [symbol.id, symbol.price]));
  const timeline = [];
  for (let tick = 0; tick < DATASET.tickCount; tick += 1) {
    if (tick > 0) {
      for (const symbol of symbols) {
        const noiseBps = (rng() - 0.5) * 2 * DATASET.volatilityBps;
        const next = prices[symbol.id] * (1 + (symbol.driftBps + noiseBps) / 10000);
        prices[symbol.id] = round2(Math.max(1, next));
      }
    }
    const books = Object.fromEntries(
      symbols.map((symbol) => [symbol.id, makeBook(rng, prices[symbol.id])]),
    );
    const pnl = round2(
      positions.reduce(
        (total, position) => total + position.qty * (prices[position.symbol] - position.avgPrice),
        0,
      ),
    );
    const tapeSymbol = pick(rng, symbols);
    const tapePct = round2((rng() - 0.5) * 0.8);
    const tape = `${formatSessionTime(tick)} ${tapeSymbol.id} ${prices[tapeSymbol.id].toFixed(2)} ${
      tapePct >= 0 ? '+' : '-'
    }${Math.abs(tapePct).toFixed(2)}%`;
    timeline.push({ i: tick, prices: { ...prices }, books, pnl, tape, newsId: null });
  }

  // ---------------------------------------------------------------- news
  const news = [];
  const newsCount = DATASET.newsInitial + DATASET.newsArrivals.length;
  for (let index = 0; index < newsCount; index += 1) {
    const symbol = pick(rng, symbols);
    const template = pick(rng, NEWS_TEMPLATES);
    const arrivalTick =
      index < DATASET.newsInitial ? null : DATASET.newsArrivals[index - DATASET.newsInitial];
    news.push({
      id: `N-${String(index + 1).padStart(2, '0')}`,
      headline: template.replaceAll('{name}', symbol.name).replaceAll('{ticker}', symbol.id),
      source: pick(rng, NEWS_SOURCES),
      symbol: symbol.id,
      arrivalTick,
    });
  }
  news.forEach((item, index) => {
    item.sequence = index;
  });
  for (const item of news) {
    if (item.arrivalTick !== null) timeline[item.arrivalTick].newsId = item.id;
  }

  // -------------------------------------------------------------- orders
  const statuses = ['filled', 'filled', 'filled', 'open', 'cancelled'];
  const orders = [];
  for (let index = 0; index < DATASET.orderCount; index += 1) {
    const symbol = pick(rng, symbols);
    orders.push({
      id: `ORD-${1001 + index}`,
      symbol: symbol.id,
      side: rng() < 0.5 ? 'buy' : 'sell',
      qty: (1 + Math.floor(rng() * 20)) * 10,
      price: round2(symbol.price * (1 + (rng() - 0.5) * 0.1)),
      status: pick(rng, statuses),
      tick: index - DATASET.orderCount,
    });
  }

  return {
    seed: key,
    tickMs: TICK_MS,
    symbols: symbols.map(({ driftBps, ...symbol }) => symbol),
    positions,
    news: [...news].sort((a, b) => b.sequence - a.sequence),
    orders,
    timeline,
  };
}

/** The snapshot the application loads first: instruments, positions, news. */
export function snapshotFor(dataset) {
  return {
    seed: dataset.seed,
    tickMs: dataset.tickMs,
    symbols: dataset.symbols.map((symbol) => ({
      ...symbol,
      price: dataset.timeline[0].prices[symbol.id],
    })),
    positions: dataset.positions,
    news: dataset.news,
  };
}

export function timelineFor(dataset) {
  return { seed: dataset.seed, ticks: dataset.timeline };
}

export function ordersFor(dataset) {
  return { seed: dataset.seed, orders: dataset.orders };
}
