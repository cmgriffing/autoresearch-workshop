/**
 * The oracle: correctness and anti-degradation gate.
 *
 * Layers:
 *   L0  structure — twelve regions exactly once, instrumentation active,
 *       fixture endpoints used, no page/instrumentation errors;
 *   L1  content — final state matches values derived from the run's seed;
 *   L2  per-step — every timeline advance lands on the right tick, hover and
 *       modal states are observed, resize geometry stays valid;
 *   LIVE must-render — regions whose data changed rendered after the event,
 *       so direct-DOM bypasses and frozen regions fail.
 *
 * A failed oracle exits the benchmark non-zero before any passing summary.
 */

import { CLOCK_START, DATASET, PHASE_SCRIPT, REGION_MANIFEST } from './config.js';
import { regionsInRange, sliceTotals } from './metrics.js';

const TICK_REGIONS = ['watchlist', 'chart', 'orderbook', 'positions', 'tape'];

function parseNumber(text) {
  if (typeof text !== 'string') return null;
  const cleaned = text.replace(/[^0-9.eE+-]/g, '');
  if (cleaned === '' || cleaned === '+' || cleaned === '-') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

const approx = (a, b, epsilon = 0.011) => a !== null && b !== null && Math.abs(a - b) <= epsilon;
const round2 = (value) => Math.round(value * 100) / 100;
const changePct = (price, prevClose) => ((price - prevClose) / prevClose) * 100;

function expectedClock(elapsedMs) {
  const start = Date.parse(CLOCK_START);
  return new Date(start + Math.floor(elapsedMs / 1000) * 1000).toISOString().slice(11, 19);
}

function expectedPositions(dataset, plan) {
  const rows = new Map(dataset.positions.map((position) => [position.symbol, { ...position }]));
  const qty = Number(PHASE_SCRIPT.submit.qty);
  const delta = PHASE_SCRIPT.submit.side === 'buy' ? qty : -qty;
  const existing = rows.get(plan.selectedSymbol);
  if (existing) {
    const nextQty = existing.qty + delta;
    existing.avgPrice =
      nextQty === 0
        ? plan.submitPrice
        : round2((existing.qty * existing.avgPrice + delta * plan.submitPrice) / nextQty);
    existing.qty = nextQty;
  } else {
    rows.set(plan.selectedSymbol, { qty: delta, avgPrice: plan.submitPrice });
  }
  return rows;
}

function checkGeometry(dom, fail) {
  const { width: viewportWidth, height: viewportHeight } = dom.viewport;
  const boxes = [];
  for (const name of REGION_MANIFEST) {
    const box = dom.regionRects[name];
    if (!box) {
      fail('GEOM', `region "${name}" is missing from the layout`);
      continue;
    }
    if (box.width <= 0 || box.height <= 0) continue; // display:contents regions have no box
    if (
      box.x < -0.5 ||
      box.y < -0.5 ||
      box.x + box.width > viewportWidth + 0.5 ||
      box.y + box.height > viewportHeight + 0.5
    ) {
      fail(
        'GEOM',
        `region "${name}" is outside the ${viewportWidth}x${viewportHeight} viewport (${JSON.stringify(box)})`,
      );
    }
    boxes.push({ name, box });
  }
  for (let left = 0; left < boxes.length; left += 1) {
    for (let right = left + 1; right < boxes.length; right += 1) {
      const a = boxes[left].box;
      const b = boxes[right].box;
      const overlapWidth = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapHeight = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (overlapWidth > 0.5 && overlapHeight > 0.5) {
        fail('GEOM', `regions "${boxes[left].name}" and "${boxes[right].name}" overlap`);
      }
    }
  }
}

export function evaluateOracle({ dataset, run }) {
  const failures = [];
  const fail = (layer, message) => failures.push({ layer, message });
  const plan = run.scenario;
  const mountDom = run.mountDom;

  // ------------------------------------------------------------------ L0
  if (run.instrumentationErrors.length > 0) {
    fail('L0', `instrumentation error(s): ${run.instrumentationErrors.join(' | ')}`);
  }
  if (run.pageErrors.length > 0) {
    fail('L0', `uncaught page error(s): ${run.pageErrors.join(' | ')}`);
  }
  if (run.consoleErrors.length > 0) {
    fail('L0', `console error(s): ${run.consoleErrors.join(' | ')}`);
  }
  const mountRegions = [...mountDom.regionNames].sort();
  const expectedRegions = [...REGION_MANIFEST].sort();
  if (JSON.stringify(mountRegions) !== JSON.stringify(expectedRegions)) {
    fail('L0', `mounted regions are ${JSON.stringify(mountDom.regionNames)}`);
  }
  const mountTotals = sliceTotals(run.commits, 0, run.mountCommits);
  if (run.mountCommits < 1 || mountTotals.fiberRenders <= 0 || mountTotals.regionRenders < REGION_MANIFEST.length) {
    fail(
      'L0',
      `instrumentation self-check failed during mount: ${run.mountCommits} commit(s), ${mountTotals.fiberRenders} fiber render(s), ${mountTotals.regionRenders} region render(s)`,
    );
  }
  const expectedRequests = ['/api/snapshot', '/api/timeline', '/api/orders'].sort();
  const requestKinds = [...new Set(run.fixtureRequests)].sort();
  if (JSON.stringify(requestKinds) !== JSON.stringify(expectedRequests)) {
    fail('L0', `fixture endpoints requested: ${JSON.stringify(requestKinds)}`);
  }
  if (!plan) {
    fail('L0', 'no scenario was run');
    return { ok: false, failures, signals: { mount: mountTotals } };
  }

  const finalStep = plan.steps[plan.steps.length - 1];
  const finalDom = finalStep.dom;
  if (JSON.stringify([...finalDom.regionNames].sort()) !== JSON.stringify(expectedRegions)) {
    fail('L0', `regions after the scenario are ${JSON.stringify(finalDom.regionNames)}`);
  }

  // ------------------------------------------------------------------ L1
  const cursor = plan.finalCursor;
  const tick = dataset.timeline[cursor];
  if (!tick) {
    fail('L1', `final cursor ${cursor} is outside the timeline`);
    return { ok: false, failures, signals: { mount: mountTotals } };
  }

  if (finalDom.watchlistCount !== DATASET.symbolCount || finalDom.watchRows.length !== DATASET.symbolCount) {
    fail('L1', `watchlist has ${finalDom.watchRows.length} row(s), expected ${DATASET.symbolCount}`);
  }
  const selectedRows = finalDom.watchRows.filter((row) => row.selected);
  if (selectedRows.length !== 1 || selectedRows[0].symbol !== plan.selectedSymbol) {
    fail('L1', `selected watchlist row is ${JSON.stringify(selectedRows.map((row) => row.symbol))}`);
  }
  for (const row of finalDom.watchRows) {
    const symbol = dataset.symbols.find((entry) => entry.id === row.symbol);
    if (!symbol) {
      fail('L1', `watchlist shows unknown symbol "${row.symbol}"`);
      continue;
    }
    if (!approx(parseNumber(row.price), tick.prices[row.symbol])) {
      fail('L1', `watchlist ${row.symbol} price "${row.price}" does not match tick ${cursor}`);
    }
    if (!approx(parseNumber(row.change), round2(changePct(tick.prices[row.symbol], symbol.prevClose)))) {
      fail('L1', `watchlist ${row.symbol} change "${row.change}" does not match tick ${cursor}`);
    }
  }
  if (finalDom.topbarSymbol !== plan.selectedSymbol) {
    fail('L1', `top bar shows "${finalDom.topbarSymbol}", expected "${plan.selectedSymbol}"`);
  }
  if (finalDom.chartSymbol !== plan.selectedSymbol) {
    fail('L1', `chart shows "${finalDom.chartSymbol}", expected "${plan.selectedSymbol}"`);
  }
  if (!approx(parseNumber(finalDom.chartPrice), tick.prices[plan.selectedSymbol])) {
    fail('L1', `chart price "${finalDom.chartPrice}" does not match tick ${cursor}`);
  }
  if (finalDom.chartPoints !== cursor + 1) {
    fail('L1', `chart series has ${finalDom.chartPoints} point(s), expected ${cursor + 1}`);
  }
  if (finalDom.bookSymbol !== plan.selectedSymbol) {
    fail('L1', `order book shows "${finalDom.bookSymbol}", expected "${plan.selectedSymbol}"`);
  }
  const expectedBook = tick.books[plan.selectedSymbol];
  const askRows = finalDom.bookRows.filter((row) => row.side === 'ask');
  const bidRows = finalDom.bookRows.filter((row) => row.side === 'bid');
  if (askRows.length !== DATASET.bookLevels || bidRows.length !== DATASET.bookLevels) {
    fail(
      'L1',
      `order book has ${askRows.length} ask(s) and ${bidRows.length} bid(s), expected ${DATASET.bookLevels} each`,
    );
  } else {
    const expectedAsks = [...expectedBook.asks].reverse();
    expectedAsks.forEach(([price, size], index) => {
      if (!approx(askRows[index].price, price) || askRows[index].size !== size) {
        fail('L1', `order book ask ${index} does not match tick ${cursor}`);
      }
    });
    expectedBook.bids.forEach(([price, size], index) => {
      if (!approx(bidRows[index].price, price) || bidRows[index].size !== size) {
        fail('L1', `order book bid ${index} does not match tick ${cursor}`);
      }
    });
  }

  const positions = expectedPositions(dataset, plan);
  if (finalDom.positionRows.length !== positions.size) {
    fail(
      'L1',
      `positions region has ${finalDom.positionRows.length} row(s), expected ${positions.size} after the fill`,
    );
  }
  for (const row of finalDom.positionRows) {
    const expected = positions.get(row.symbol);
    if (!expected) {
      fail('L1', `positions region shows unexpected symbol "${row.symbol}"`);
      continue;
    }
    const mark = tick.prices[row.symbol] ?? expected.avgPrice;
    if (parseNumber(row.qty) !== expected.qty) {
      fail('L1', `position ${row.symbol} quantity "${row.qty}" does not match the fill`);
    }
    if (!approx(parseNumber(row.avg), round2(expected.avgPrice))) {
      fail('L1', `position ${row.symbol} average "${row.avg}" does not match the fill`);
    }
    if (!approx(parseNumber(row.mark), mark)) {
      fail('L1', `position ${row.symbol} mark "${row.mark}" does not match tick ${cursor}`);
    }
    if (!approx(parseNumber(row.pnl), round2(expected.qty * (mark - expected.avgPrice)), 0.05)) {
      fail('L1', `position ${row.symbol} P&L "${row.pnl}" does not match tick ${cursor}`);
    }
  }
  if (!approx(parseNumber(finalDom.positionsTotal), round2(tick.pnl), 0.02)) {
    fail('L1', `positions total "${finalDom.positionsTotal}" does not match tick ${cursor}`);
  }

  if (finalDom.ticketSymbol !== plan.selectedSymbol) {
    fail('L1', `ticket header shows "${finalDom.ticketSymbol}", expected "${plan.selectedSymbol}"`);
  }
  if (finalDom.ticketQty !== PHASE_SCRIPT.submit.qty) {
    fail('L1', `ticket quantity field is "${finalDom.ticketQty}", expected "${PHASE_SCRIPT.submit.qty}"`);
  }
  if (finalDom.ticketSide !== PHASE_SCRIPT.submit.side) {
    fail('L1', `ticket side is "${finalDom.ticketSide}", expected "${PHASE_SCRIPT.submit.side}"`);
  }
  if (!approx(parseNumber(finalDom.ticketPrice), plan.submitPrice)) {
    fail('L1', `ticket price field is "${finalDom.ticketPrice}", expected ${plan.submitPrice}`);
  }

  const expectedArrivals = DATASET.newsArrivals.filter((arrival) => arrival <= cursor).length;
  if (finalDom.newsCount !== DATASET.newsInitial + expectedArrivals) {
    fail(
      'L1',
      `news count is ${finalDom.newsCount}, expected ${DATASET.newsInitial + expectedArrivals} at tick ${cursor}`,
    );
  }
  if (finalDom.newsIds[0] !== tick.newsId) {
    fail('L1', `newest news item is "${finalDom.newsIds[0]}", expected "${tick.newsId}"`);
  }
  const newest = dataset.news.find((item) => item.id === tick.newsId);
  if (newest && finalDom.newsHeadlines[0] !== newest.headline) {
    fail('L1', `newest news headline "${finalDom.newsHeadlines[0]}" does not match the dataset`);
  }

  const orderId = `ORD-${1001 + dataset.orders.length}`;
  if (finalDom.blotterCount !== dataset.orders.length + 1 || finalDom.blotterRows.length !== dataset.orders.length + 1) {
    fail('L1', `blotter shows ${finalDom.blotterRows.length} row(s), expected ${dataset.orders.length + 1}`);
  }
  const firstOrder = finalDom.blotterRows[0];
  if (!firstOrder) {
    fail('L1', 'blotter has no submitted order');
  } else {
    if (firstOrder.id !== orderId) fail('L1', `submitted order id is "${firstOrder.id}", expected "${orderId}"`);
    if (firstOrder.symbol !== plan.selectedSymbol) fail('L1', 'submitted order symbol does not match the ticket');
    if (firstOrder.side !== PHASE_SCRIPT.submit.side) fail('L1', 'submitted order side does not match the ticket');
    if (parseNumber(firstOrder.qty) !== Number(PHASE_SCRIPT.submit.qty)) {
      fail('L1', 'submitted order quantity does not match the ticket');
    }
    if (!approx(parseNumber(firstOrder.price), plan.submitPrice)) {
      fail('L1', 'submitted order price does not match the ticket');
    }
    if (firstOrder.status !== 'filled') fail('L1', `submitted order status is "${firstOrder.status}"`);
  }
  const orderIds = finalDom.blotterRows.map((row) => row.id);
  if (new Set(orderIds).size !== orderIds.length) fail('L1', 'blotter order ids are not unique');

  if (finalDom.toasts.length !== 1) {
    fail('L1', `toast count is ${finalDom.toasts.length}, expected 1 after submission`);
  } else {
    const toast = finalDom.toasts[0];
    for (const fragment of [orderId, plan.selectedSymbol, PHASE_SCRIPT.submit.qty, plan.submitPrice.toFixed(2)]) {
      if (!toast.includes(fragment)) fail('L1', `toast "${toast}" does not mention ${fragment}`);
    }
  }

  if (finalDom.tapeLatest !== tick.tape) {
    fail('L1', `tape "${finalDom.tapeLatest}" does not match tick ${cursor}`);
  }

  const clock = expectedClock(plan.fakeElapsedMs);
  if (finalDom.clock !== clock) {
    fail('L1', `session clock is "${finalDom.clock}", expected "${clock}"`);
  }
  const status = clock >= '14:30:00' && clock < '21:00:00' ? 'OPEN' : 'CLOSED';
  if (finalDom.status !== status) {
    fail('L1', `market status is "${finalDom.status}", expected "${status}"`);
  }

  const themeStart = plan.phases.theme?.startDom;
  if (finalDom.theme !== 'light') {
    fail('L1', `theme is "${finalDom.theme}", expected "light" after one toggle`);
  } else if (themeStart && themeStart.topbarBackground === finalDom.topbarBackground) {
    fail('L1', 'theme toggle did not change computed styles');
  }

  // ------------------------------------------------------------------ L2
  let previousCursor = 0;
  for (const step of plan.steps) {
    if (step.cursorAfter > previousCursor) {
      const entry = dataset.timeline[step.cursorAfter];
      const row = step.dom.watchRows[0];
      if (!row || !approx(parseNumber(row.price), entry.prices[row.symbol])) {
        fail('TICK', `step ${step.phase}.${step.name}: watchlist did not advance to tick ${step.cursorAfter}`);
      }
      if (step.dom.tapeLatest !== entry.tape) {
        fail('TICK', `step ${step.phase}.${step.name}: tape did not advance to tick ${step.cursorAfter}`);
      }
      const regions = regionsInRange(run.commits, step.commitBefore, step.commitAfter);
      for (const required of TICK_REGIONS) {
        if (!regions.has(required)) {
          fail('LIVE', `step ${step.phase}.${step.name}: region "${required}" did not render after the clock advanced`);
        }
      }
      previousCursor = step.cursorAfter;
    }
  }
  if (plan.finalCursor !== previousCursor) {
    fail('TICK', `driver cursor ${previousCursor} does not match the recorded final cursor ${plan.finalCursor}`);
  }
  if (plan.newsArrivedAt === null) {
    fail('TICK', 'no news item arrived during the news phase');
  }

  const hoverPhase = plan.phases.hover;
  if (hoverPhase) {
    const enter = hoverPhase.steps.find((step) => step.name === 'enter');
    const leave = hoverPhase.steps.find((step) => step.name === 'leave');
    const idleBackground = enter?.dom.watchRows[0]?.background;
    const hoveredBackground = enter?.dom.watchRows[PHASE_SCRIPT.hover.row]?.background;
    if (!enter || idleBackground === hoveredBackground) {
      fail('L2', 'hovered watchlist row is not visually distinct from an idle row');
    }
    const afterLeave = leave?.dom.watchRows[PHASE_SCRIPT.hover.row]?.background;
    if (!leave || afterLeave !== idleBackground) {
      fail('L2', 'hover styling did not clear after the pointer left the row');
    }
  }

  const modalPhase = plan.phases.modal;
  if (modalPhase) {
    const open = modalPhase.steps.find((step) => step.name === 'open');
    const dismiss = modalPhase.steps.find((step) => step.name === 'dismiss');
    if (!open?.dom.modalVisible) fail('L2', 'modal did not become visible');
    if (dismiss?.dom.modalVisible) fail('L2', 'modal did not dismiss');
    if (dismiss && dismiss.dom.regionNames.length !== REGION_MANIFEST.length) {
      fail('L2', 'regions disappeared while the modal was open');
    }
    const openRegions = regionsInRange(run.commits, open.commitBefore, open.commitAfter);
    if (!openRegions.has('modal')) fail('LIVE', 'modal region did not render when it opened');
    const dismissRegions = regionsInRange(run.commits, dismiss.commitBefore, dismiss.commitAfter);
    if (!dismissRegions.has('modal')) fail('LIVE', 'modal region did not render when it dismissed');
  }

  const resizePhase = plan.phases.resize;
  for (const step of resizePhase?.steps ?? []) {
    checkGeometry(step.dom, fail);
    if (step.dom.watchRows.length !== DATASET.symbolCount) {
      fail('GEOM', `step resize.${step.name}: watchlist lost rows after resize`);
    }
    if (step.dom.blotterRows.length !== dataset.orders.length + 1) {
      fail('GEOM', `step resize.${step.name}: blotter lost rows after resize`);
    }
  }

  const selectStep = plan.steps.find((step) => step.phase === 'select');
  if (selectStep) {
    const regions = regionsInRange(run.commits, selectStep.commitBefore, selectStep.commitAfter);
    for (const required of ['watchlist', 'chart', 'orderbook', 'ticket']) {
      if (!regions.has(required)) {
        fail('LIVE', `selecting a symbol did not render region "${required}"`);
      }
    }
  }
  for (const stepName of ['type-qty', 'type-price']) {
    const step = plan.phases.draft?.steps.find((entry) => entry.name === stepName);
    if (!step) continue;
    const regions = regionsInRange(run.commits, step.commitBefore, step.commitAfter);
    if (!regions.has('ticket')) {
      fail('LIVE', `typing in the ticket did not render the ticket region (${stepName})`);
    }
  }
  const submitStep = plan.phases.submit?.steps.find((entry) => entry.name === 'click');
  if (submitStep) {
    const regions = regionsInRange(run.commits, submitStep.commitBefore, submitStep.commitAfter);
    for (const required of ['blotter', 'toasts', 'positions']) {
      if (!regions.has(required)) {
        fail('LIVE', `submitting an order did not render region "${required}"`);
      }
    }
  }
  const newsStep = plan.steps.find(
    (step) => step.phase === 'news' && step.cursorAfter === plan.newsArrivedAt,
  );
  if (newsStep) {
    const regions = regionsInRange(run.commits, newsStep.commitBefore, newsStep.commitAfter);
    if (!regions.has('news')) {
      fail('LIVE', 'news region did not render when an item arrived');
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    signals: { mount: mountTotals, cursor, commitCount: run.commits.length },
  };
}

export function formatOracleFailures(failures) {
  return failures.map((failure) => `  [${failure.layer}] ${failure.message}`).join('\n');
}
