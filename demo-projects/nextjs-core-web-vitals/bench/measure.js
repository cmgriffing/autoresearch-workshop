/**
 * Playwright + CDP measurement pipeline.
 *
 * Every load uses a fresh browser context with:
 *   - 4× CPU throttling and 20 Mbps / 40 ms network emulation, applied before
 *     navigation (the profile is active from the first byte);
 *   - a fixed 1280×800 viewport;
 *   - observers installed via `addInitScript` for LCP (with attribution),
 *     CLS, Event Timing (INP) and long tasks.
 *
 * The scripted interaction sequence is fixed: filter typing, variant select,
 * add to cart, shipping estimate, banner check. Each interaction runs inside
 * a timestamped window so Event Timing entries can be attributed to it.
 */

import { chromium } from 'playwright';
import { screenshotGrid } from './grid.js';
import { WORKLOAD } from './config.js';

export const DECLARED_HOOKS = [
  'hero',
  'title',
  'price',
  'discount',
  'banner',
  'variant',
  'filter',
  'add-to-cart',
  'cart-count',
  'shipping',
];

const HYDRATION_PATTERNS = [
  /hydrat/i,
  /did not match/i,
  /Minified React error #(418|419|421|423|425)/,
];

export function isHydrationError(text) {
  return HYDRATION_PATTERNS.some((pattern) => pattern.test(text));
}

function instrumentationScript() {
  window.__bench = { lcp: [], cls: 0, events: [], longTasks: [], elements: [] };
  const observe = (type, handler, options = {}) => {
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) handler(entry);
      }).observe({ type, buffered: true, ...options });
    } catch {
      // The browser does not support this entry type; the metric is absent.
    }
  };
  // Raw LCP candidates are collected for transparency, but Chromium's image
  // LCP entries are unreliable under CDP network emulation (observed ~1/4 of
  // runs), so the primary paint signal is the hero's Element Timing entry
  // below — same paint-timing machinery, emitted deterministically.
  observe(
    'largest-contentful-paint',
    (entry) => {
      window.__bench.lcp.push({
        startTime: entry.startTime,
        renderTime: entry.renderTime || 0,
        loadTime: entry.loadTime || 0,
        size: entry.size || 0,
        url: entry.url || null,
        element: entry.element ? entry.element.tagName : null,
      });
    },
    { durationThreshold: 16 },
  );
  observe('element', (entry) => {
    window.__bench.elements.push({
      identifier: entry.identifier,
      renderTime: entry.renderTime || 0,
      loadTime: entry.loadTime || 0,
      size: entry.size || 0,
      url: entry.url || null,
      element: entry.element ? entry.element.tagName : null,
    });
  });
  observe('layout-shift', (entry) => {
    if (!entry.hadRecentInput) window.__bench.cls += entry.value;
  });
  observe(
    'event',
    (entry) => {
      window.__bench.events.push({
        name: entry.name,
        interactionId: entry.interactionId || 0,
        duration: entry.duration,
        startTime: entry.startTime,
        processingStart: entry.processingStart,
        processingEnd: entry.processingEnd,
      });
    },
    { durationThreshold: 16 },
  );
  observe('longtask', (entry) => {
    window.__bench.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
  });
}

export async function launchBrowser() {
  return chromium.launch({ headless: true });
}

export async function createInstrumentedContext(browser) {
  const context = await browser.newContext({ viewport: WORKLOAD.viewport });
  await context.addInitScript(instrumentationScript);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: WORKLOAD.profile.cpuThrottleRate });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: WORKLOAD.profile.latencyMs,
    downloadThroughput: WORKLOAD.profile.downloadThroughputBps,
    uploadThroughput: WORKLOAD.profile.uploadThroughputBps,
  });
  return { context, page };
}

export async function readRaw(page) {
  return page.evaluate(() => {
    const state = window.__bench ?? { lcp: [], cls: 0, events: [], longTasks: [] };
    const nav = performance.getEntriesByType('navigation')[0];
    return {
      lcp: state.lcp,
      elements: state.elements,
      cls: state.cls,
      events: state.events,
      longTasks: state.longTasks,
      navigation: nav
        ? {
            startTime: nav.startTime,
            responseStart: nav.responseStart,
            responseEnd: nav.responseEnd,
            domContentLoadedEventEnd: nav.domContentLoadedEventEnd,
            loadEventEnd: nav.loadEventEnd,
          }
        : null,
      resources: performance.getEntriesByType('resource').map((entry) => ({
        name: entry.name,
        initiatorType: entry.initiatorType,
        transferSize: entry.transferSize,
        encodedBodySize: entry.encodedBodySize,
        startTime: entry.startTime,
        responseEnd: entry.responseEnd,
        duration: entry.duration,
      })),
    };
  });
}

const round1 = (value) => Math.round(value * 10) / 10;

/** Reduces raw observer output into per-load metrics. */
export function summarize(raw, windows) {
  const nav = raw.navigation;

  // Primary paint signal: the hero image's Element Timing entry (identifier
  // "hero"). Deterministic under the shaping profile, unlike Chromium's image
  // LCP entries. A missing or zero hero paint fails the oracle. The earliest
  // entry is the initial load paint (variant selection remounts the gallery,
  // which emits further entries for the same identifier).
  const heroEntry =
    (raw.elements ?? [])
      .filter((entry) => entry.identifier === 'hero' && entry.renderTime > 0)
      .sort((a, b) => a.renderTime - b.renderTime)[0] ?? null;
  const heroResource = heroEntry?.url
    ? raw.resources.find((resource) => resource.name === heroEntry.url)
    : null;

  const lcp = heroEntry
    ? {
        renderTime: round1(heroEntry.renderTime),
        loadTime: round1(heroEntry.loadTime),
        size: heroEntry.size,
        url: heroEntry.url ?? '',
        element: heroEntry.element ?? null,
        isHeroElementTiming: true,
        isImage: Boolean(heroResource),
        ttfbMs: nav ? round1(Math.max(0, nav.responseStart - nav.startTime)) : 0,
        loadDelayMs: heroResource
          ? round1(Math.max(0, heroResource.startTime - (nav?.responseStart ?? 0)))
          : 0,
        loadDurationMs: heroResource ? round1(heroResource.duration) : 0,
        renderDelayMs: heroResource
          ? round1(Math.max(0, heroEntry.renderTime - heroResource.responseEnd))
          : round1(Math.max(0, heroEntry.renderTime - (nav?.responseStart ?? 0))),
      }
    : null;

  // Raw LCP API candidate, reported as a secondary for transparency.
  const lcpApiEntry =
    (raw.lcp ?? [])
      .filter((entry) => entry.renderTime > 0)
      .sort((a, b) => b.renderTime - a.renderTime)[0] ?? null;
  const lcpApi = lcpApiEntry
    ? {
        renderTime: round1(lcpApiEntry.renderTime),
        element: lcpApiEntry.element ?? null,
        url: lcpApiEntry.url ?? '',
        isImage: Boolean(lcpApiEntry.url),
      }
    : null;

  const groups = new Map();
  for (const event of raw.events) {
    if (!event.interactionId) continue;
    const current = groups.get(event.interactionId);
    if (!current || event.duration > current.duration) groups.set(event.interactionId, event);
  }

  const interactions = {};
  for (const [name, window] of Object.entries(windows ?? {})) {
    let best = null;
    for (const event of groups.values()) {
      if (event.startTime < window.start - 100 || event.startTime > window.end + 1000) continue;
      if (!best || event.duration > best.duration) best = event;
    }
    interactions[name] = best
      ? {
          latencyMs: round1(best.duration),
          inputDelayMs: round1(Math.max(0, best.processingStart - best.startTime)),
          processingMs: round1(Math.max(0, best.processingEnd - best.processingStart)),
          presentationMs: round1(
            Math.max(0, best.duration - (best.processingEnd - best.startTime)),
          ),
          eventName: best.name,
        }
      : null;
  }
  const inpMs = Object.values(interactions).reduce(
    (max, entry) => Math.max(max, entry?.latencyMs ?? 0),
    0,
  );

  const longTaskMs = raw.longTasks.reduce((sum, task) => sum + task.duration, 0);

  return {
    lcp,
    lcpApi,
    cls: round1(raw.cls * 1000) / 1000,
    inpMs,
    interactions,
    longTaskMs: round1(longTaskMs),
    resources: raw.resources,
  };
}

/** The DOM contract the oracle checks. Runs inside the page. */
export function collectDom(page) {
  return page.evaluate((declaredHooks) => {
    const q = (selector) => document.querySelector(selector);
    const clean = (value) => (value ?? '').replace(/\s+/g, ' ').trim();
    const text = (selector) => clean(q(selector)?.textContent);
    const rectOf = (element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const visible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity) > 0
      );
    };
    const hitTest = (element) => {
      if (!element) return false;
      element.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = element.getBoundingClientRect();
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
      const hit = document.elementFromPoint(x, y);
      return Boolean(hit) && (hit === element || element.contains(hit) || hit.contains(element));
    };
    const styleOf = (selector) => {
      const element = q(selector);
      return element ? getComputedStyle(element) : null;
    };

    const hookCounts = {};
    for (const hook of declaredHooks) {
      hookCounts[hook] = document.querySelectorAll(`[data-bench="${hook}"]`).length;
    }

    const hero = q('[data-bench="hero"]');
    const titleStyle = styleOf('[data-bench="title"]');
    const priceStyle = styleOf('[data-bench="price"]');

    const fonts = [...document.fonts].map((face) => ({
      family: face.family.replace(/^["']|["']$/g, ''),
      status: face.status,
      weight: face.weight,
      style: face.style,
    }));
    const fontChecks = {};
    for (const face of fonts) {
      fontChecks[face.family] = document.fonts.check(`16px "${face.family}"`);
    }

    return {
      hookCounts,
      title: text('[data-bench="title"]'),
      priceText: text('[data-bench="price"]'),
      originalPriceText: text('[data-bench-part="original-price"]'),
      discountText: text('[data-bench="discount"]'),
      bannerText: text('[data-bench="banner"]'),
      bannerVisible: visible(q('[data-bench="banner"]')),
      reviewCountText: text('[data-bench-part="review-count"]'),
      filterCountText: text('[data-bench-part="filter-count"]'),
      reviewIds: [...document.querySelectorAll('[data-bench-part="review-row"]')].map((row) =>
        row.getAttribute('data-review-id'),
      ),
      variantOptions: [...document.querySelectorAll('[data-bench-part="variant-option"]')].map(
        (option) => ({
          id: option.getAttribute('data-variant-id'),
          label: clean(option.textContent),
          pressed: option.getAttribute('aria-pressed') === 'true',
        }),
      ),
      hero: hero
        ? {
            rect: rectOf(hero),
            naturalWidth: hero.naturalWidth,
            naturalHeight: hero.naturalHeight,
            complete: hero.complete,
            src: hero.currentSrc || hero.getAttribute('src') || '',
            visible: visible(hero),
            elementTiming: hero.getAttribute('elementtiming'),
          }
        : null,
      shippingText: text('[data-bench="shipping"]'),
      cartCountText: text('[data-bench="cart-count"]'),
      cartLineTexts: [...document.querySelectorAll('[data-bench-part="cart-line"]')].map((line) =>
        clean(line.textContent),
      ),
      hitTests: {
        filter: hitTest(q('[data-bench="filter"]')),
        addToCart: hitTest(q('[data-bench="add-to-cart"]')),
        variantOption: hitTest(q('[data-bench-part="variant-option"]')),
        zipInput: hitTest(q('[data-bench-part="zip-input"]')),
        estimate: hitTest(q('[data-bench-part="estimate"]')),
      },
      titleFontFamily: titleStyle?.fontFamily ?? '',
      priceFontFamily: priceStyle?.fontFamily ?? '',
      fonts,
      fontChecks,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scrollHeight: document.documentElement.scrollHeight,
    };
  }, DECLARED_HOOKS);
}

async function waitForHero(page, timeoutMs) {
  try {
    await page.waitForFunction(
      () => {
        const hero = document.querySelector('[data-bench="hero"]');
        return Boolean(hero) && hero.complete && hero.naturalWidth > 0;
      },
      null,
      { timeout: timeoutMs },
    );
  } catch {
    throw new Error(
      `hero image did not load within ${timeoutMs}ms (the hero hook must resolve to a loaded image)`,
    );
  }
}

async function runWindow(page, windows, outcomes, name, fn) {
  const start = await page.evaluate(() => performance.now());
  let observed = null;
  let error = null;
  try {
    observed = await fn();
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  const end = await page.evaluate(() => performance.now());
  windows[name] = { start, end };
  outcomes.push({ name, ok: error == null, observed, error });
}

/** Scripted interaction sequence with observable outcomes. */
export async function runInteractions(page, { filterQuery, zip, timeoutMs }) {
  const windows = {};
  const outcomes = [];

  await runWindow(page, windows, outcomes, 'filter', async () => {
    const beforeText = await page.locator('[data-bench-part="filter-count"]').textContent();
    const beforeRows = await page.locator('[data-bench-part="review-row"]').count();
    const input = page.locator('[data-bench="filter"]');
    await input.click();
    await input.pressSequentially(filterQuery, { delay: 30 });
    await page.waitForFunction(
      (before) =>
        document.querySelector('[data-bench-part="filter-count"]')?.textContent !== before,
      beforeText,
      { timeout: timeoutMs },
    );
    const afterText = await page.locator('[data-bench-part="filter-count"]').textContent();
    const afterRows = await page.locator('[data-bench-part="review-row"]').count();
    return { beforeText, afterText, beforeRows, afterRows };
  });

  await runWindow(page, windows, outcomes, 'variant', async () => {
    const hero = page.locator('[data-bench="hero"]');
    const beforeSrc = await hero.getAttribute('src');
    const option = page.locator('[data-bench-part="variant-option"]').nth(1);
    await option.click();
    await page.waitForFunction(
      (before) => {
        const image = document.querySelector('[data-bench="hero"]');
        const src = image?.currentSrc || image?.getAttribute('src') || '';
        return src.length > 0 && src !== before;
      },
      beforeSrc,
      { timeout: timeoutMs },
    );
    return { beforeSrc, afterSrc: await hero.getAttribute('src') };
  });

  await runWindow(page, windows, outcomes, 'cart', async () => {
    const beforeCount = await page.locator('[data-bench="cart-count"]').textContent();
    await page.locator('[data-bench="add-to-cart"]').click();
    await page.waitForFunction(
      (before) => {
        const count = document.querySelector('[data-bench="cart-count"]');
        return Boolean(count) && count.textContent.trim() !== before;
      },
      beforeCount,
      { timeout: timeoutMs },
    );
    return { beforeCount, afterCount: await page.locator('[data-bench="cart-count"]').textContent() };
  });

  await runWindow(page, windows, outcomes, 'shipping', async () => {
    const beforeText = await page.locator('[data-bench="shipping"]').textContent();
    const zipInput = page.locator('[data-bench-part="zip-input"]');
    await zipInput.click();
    await zipInput.pressSequentially(zip, { delay: 25 });
    await page.locator('[data-bench-part="estimate"]').click();
    await page.waitForFunction(
      (before) => document.querySelector('[data-bench="shipping"]')?.textContent.trim() !== before,
      beforeText.trim(),
      { timeout: timeoutMs },
    );
    return { beforeText, afterText: await page.locator('[data-bench="shipping"]').textContent() };
  });

  await runWindow(page, windows, outcomes, 'banner', async () => {
    await page.waitForSelector('[data-bench="banner"]', { state: 'visible', timeout: timeoutMs });
    return { visible: true };
  });

  return { windows, outcomes };
}

/**
 * Runs one instrumented page load.
 *
 * mode:
 *   'metrics' — warm-up / measured loads: interactions + metrics only.
 *   'oracle'  — verify pass: DOM snapshots before/after, hero grid, outcomes.
 *   'capture' — setup: DOM snapshot, hero grid and a full-page screenshot,
 *               no interactions.
 */
export async function runLoad({
  browser,
  appUrl,
  seed,
  mode = 'metrics',
  settleMs = 400,
  postSettleMs = 250,
  interactionTimeoutMs = 5000,
}) {
  const { context, page } = await createInstrumentedContext(browser);
  const pageErrors = [];
  const consoleErrors = [];
  const requestFailures = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) =>
    requestFailures.push(`${request.url()} :: ${request.failure()?.errorText ?? 'failed'}`),
  );

  const url = `${appUrl}/?seed=${encodeURIComponent(seed)}`;

  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await waitForHero(page, 15000);
    // The first interaction must act on a populated review list, otherwise
    // the planted per-keystroke work would be skipped.
    await page.waitForSelector('[data-bench-part="review-row"]', { timeout: 15000 });
    await page.waitForTimeout(settleMs);

    let domBefore = null;
    let grid = null;
    let fullPagePng = null;
    if (mode === 'oracle' || mode === 'capture') {
      domBefore = await collectDom(page);
      const heroHandle = await page.$('[data-bench="hero"]');
      grid = await screenshotGrid(heroHandle, WORKLOAD.heroGrid.cells);
    }
    if (mode === 'capture') {
      fullPagePng = await page.screenshot({ fullPage: true, type: 'png' });
    }

    let outcomes = null;
    let windows = null;
    if (mode !== 'capture') {
      const result = await runInteractions(page, {
        filterQuery: WORKLOAD.filterQuery,
        zip: WORKLOAD.estimateZip,
        timeoutMs: interactionTimeoutMs,
      });
      outcomes = result.outcomes;
      windows = result.windows;
    }
    await page.waitForTimeout(postSettleMs);

    const raw = await readRaw(page);
    const metrics = summarize(raw, windows);
    const domAfter = mode === 'oracle' ? await collectDom(page) : null;

    return {
      url,
      metrics,
      domBefore,
      domAfter,
      grid,
      fullPagePng,
      outcomes,
      windows,
      pageErrors,
      hydrationErrors: consoleErrors.filter(isHydrationError),
      consoleErrors,
      requestFailures,
    };
  } finally {
    await context.close();
  }
}
