/**
 * Playwright measurement session.
 *
 * Every measured page load gets:
 *   - a fresh browser context with the fixed viewport;
 *   - the commit instrumentation installed before any application script;
 *   - `page.route` fulfilment of the seeded fixture endpoints (no network);
 *   - a paused fake clock so timeline advances are explicit and deterministic.
 */

import { chromium } from 'playwright';
import { CLOCK_START, DATASET, VIEWPORTS } from './config.js';
import { generateDataset } from './dataset.js';
import { handleFixtureRequest } from './origins.js';
import { INSTRUMENTATION_SOURCE } from './instrumentation.js';
import { collectDom } from './dom.js';
import { commitCount, runScenario, waitForSettled } from './driver.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function launchBrowser() {
  return chromium.launch({ headless: true });
}

export async function waitFor(page, predicate, { timeoutMs = 15000, intervalMs = 5, label = 'condition', arg } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate, arg)) return;
    await sleep(intervalMs);
  }
  throw new Error(`${label} was not met within ${timeoutMs}ms`);
}

/**
 * Runs one dashboard session. With `withScenario`, the full nine-phase script
 * is executed; without it, only the initial load is measured.
 */
export async function runDashboard(browser, { appUrl, seed, withScenario = true }) {
  const dataset = generateDataset(seed);
  const context = await browser.newContext({ viewport: VIEWPORTS.default });
  await context.addInitScript({ content: INSTRUMENTATION_SOURCE });
  const fixtureRequests = [];
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const descriptor = handleFixtureRequest(url.pathname, url.searchParams);
    fixtureRequests.push(url.pathname);
    await route.fulfill({
      status: descriptor.status,
      contentType: descriptor.contentType,
      body: descriptor.body,
    });
  });

  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  try {
    await page.clock.install({ time: new Date(CLOCK_START) });
    await page.clock.pauseAt(new Date(CLOCK_START));
    const started = performance.now();
    await page.goto(`${appUrl}/?seed=${encodeURIComponent(seed)}`, {
      waitUntil: 'load',
      timeout: 30000,
    });
    await waitFor(
      page,
      (symbolCount) =>
        Boolean(window.__benchRender && window.__benchRender.injected) &&
        document.querySelectorAll('[data-bench-part="watch-row"]').length === symbolCount,
      { label: `dashboard load for seed ${seed}`, arg: DATASET.symbolCount },
    );
    await waitForSettled(page);

    const mountCommits = await commitCount(page);
    const mountDom = await collectDom(page);
    const scenario = withScenario ? await runScenario(page, { dataset }) : null;
    const scenarioMs = Math.round(performance.now() - started);
    const commits = await page.evaluate(() => window.__benchRender.commits);
    const instrumentationErrors = await page.evaluate(() => window.__benchRender.errors);

    return {
      seed,
      dataset,
      mountCommits,
      mountDom,
      commits,
      scenario,
      scenarioMs,
      fixtureRequests,
      pageErrors,
      consoleErrors,
      instrumentationErrors,
    };
  } finally {
    await context.close();
  }
}
