/**
 * Deterministic phase driver.
 *
 * The page clock is paused; every timeline advance is an explicit
 * `clock.runFor(tickMs)` for exactly one tick period, followed by a settle
 * wait for React commits to stop. Each step records its commit range and a DOM
 * snapshot, so the oracle can assert per-step content and must-render liveness
 * without re-running anything.
 */

import { PHASE_SCRIPT, VIEWPORTS } from './config.js';
import { collectDom } from './dom.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function commitCount(page) {
  return page.evaluate(() => (window.__benchRender ? window.__benchRender.commits.length : -1));
}

export async function waitForSettled(page, { quietMs = 12, timeoutMs = 10000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = await commitCount(page);
  if (last < 0) throw new Error('render instrumentation is missing from the page');
  let lastChange = Date.now();
  while (Date.now() < deadline) {
    await sleep(4);
    const current = await commitCount(page);
    if (current !== last) {
      last = current;
      lastChange = Date.now();
    } else if (Date.now() - lastChange >= quietMs) {
      return current;
    }
  }
  throw new Error(`React commits did not settle within ${timeoutMs}ms`);
}

/**
 * Runs the fixed scenario against a loaded, settled page.
 *
 * Returns phase ranges (absolute commit indices), per-step records with DOM
 * snapshots, and the derived cursor/submit values the oracle needs.
 */
export async function runScenario(page, { dataset, script = PHASE_SCRIPT }) {
  const phases = {};
  const steps = [];
  let cursor = 0;
  let elapsedMs = 0;
  let newsArrivedAt = null;
  const selectedSymbol = dataset.symbols[script.select.row].id;
  let submitCursor = null;
  let submitPrice = null;

  async function phase(name) {
    if (!phases[name]) {
      phases[name] = {
        name,
        commitStart: await commitCount(page),
        startDom: await collectDom(page),
        commitEnd: null,
        steps: [],
      };
    }
    return phases[name];
  }

  async function step(phaseName, stepName, action) {
    const phaseRecord = await phase(phaseName);
    const commitBefore = await commitCount(page);
    if (action) await action();
    await waitForSettled(page);
    const commitAfter = await commitCount(page);
    const entry = {
      phase: phaseName,
      name: stepName,
      commitBefore,
      commitAfter,
      cursorAfter: cursor,
      dom: await collectDom(page),
    };
    phaseRecord.steps.push(entry);
    phaseRecord.commitEnd = commitAfter;
    steps.push(entry);
    return entry;
  }

  async function advanceTick(phaseName, stepName) {
    return step(phaseName, stepName, async () => {
      await page.clock.runFor(dataset.tickMs);
      cursor += 1;
      elapsedMs += dataset.tickMs;
    });
  }

  // ------------------------------------------------------------- tick
  for (let index = 1; index <= script.tick.advances; index += 1) {
    await advanceTick('tick', `tick-${index}`);
  }

  // ------------------------------------------------------------ draft
  const qtyInput = page.locator('[data-bench="ticket-qty"]');
  const priceInput = page.locator('[data-bench="ticket-price"]');
  await step('draft', 'focus-qty', () => qtyInput.click());
  await step('draft', 'type-qty', () => qtyInput.pressSequentially(script.draft.qty, { delay: 8 }));
  await step('draft', 'focus-price', () => priceInput.click());
  await step('draft', 'type-price', () =>
    priceInput.pressSequentially(script.draft.price, { delay: 8 }),
  );
  for (let index = 1; index <= script.draft.settleTicks; index += 1) {
    await advanceTick('draft', `settle-tick-${index}`);
  }

  // ----------------------------------------------------------- select
  await step('select', 'row', () =>
    page.locator('[data-bench-part="watch-row"]').nth(script.select.row).click(),
  );

  // ------------------------------------------------------------ hover
  const hoverRow = page.locator('[data-bench-part="watch-row"]').nth(script.hover.row);
  await step('hover', 'enter', async () => {
    const box = await hoverRow.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  });
  await step('hover', 'leave', () => page.mouse.move(1, 1));

  // ------------------------------------------------------------ theme
  await step('theme', 'toggle', () => page.locator('[data-bench="theme-toggle"]').click());

  // ------------------------------------------------------------- news
  const newsStart = (await phase('news')).startDom.newsIds[0] ?? null;
  for (let index = 1; index <= script.news.maxAdvances; index += 1) {
    const record = await advanceTick('news', `advance-${index}`);
    if ((record.dom.newsIds[0] ?? null) !== newsStart) {
      newsArrivedAt = cursor;
      break;
    }
  }

  // ----------------------------------------------------------- submit
  await step('submit', 'set-qty', () => qtyInput.fill(script.submit.qty));
  submitCursor = cursor;
  submitPrice = dataset.timeline[cursor].prices[selectedSymbol];
  await step('submit', 'set-price', () => priceInput.fill(submitPrice.toFixed(2)));
  await step('submit', 'set-side', () =>
    page.locator(`[data-bench-part="ticket-side"][data-side="${script.submit.side}"]`).click(),
  );
  await step('submit', 'click', () => page.locator('[data-bench="ticket-submit"]').click());

  // ------------------------------------------------------------ modal
  await step('modal', 'open', () => page.locator('[data-bench="modal-open"]').click());
  await step('modal', 'dismiss', () => page.locator('[data-bench="modal-dismiss"]').click());

  // ----------------------------------------------------------- resize
  // Viewport changes are driven by the browser, not the mock clock; wait for
  // the resize event to be delivered (and give ResizeObserver callbacks a
  // quiet window) before the step boundary is recorded.
  for (const size of VIEWPORTS.resized) {
    await step('resize', `${size.width}x${size.height}`, async () => {
      await page.evaluate(() => {
        window.__benchResizeSeen = false;
        window.addEventListener(
          'resize',
          () => {
            window.__benchResizeSeen = true;
          },
          { once: true },
        );
      });
      await page.setViewportSize(size);
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        if (await page.evaluate(() => window.__benchResizeSeen === true)) break;
        await sleep(2);
      }
      await sleep(60);
    });
  }

  return {
    phases,
    steps,
    finalCursor: cursor,
    fakeElapsedMs: elapsedMs,
    selectedSymbol,
    submitCursor,
    submitPrice: Math.round(submitPrice * 100) / 100,
    newsArrivedAt,
  };
}
