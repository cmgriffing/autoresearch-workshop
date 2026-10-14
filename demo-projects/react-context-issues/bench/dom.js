/**
 * DOM snapshot collected after every scripted step.
 *
 * Everything the oracle checks is read from this snapshot: region markers and
 * geometry, timeline-derived values, interaction results, theme/hover computed
 * styles and modal visibility. It never reads instrumentation internals.
 */

/** Runs inside the page. Must be self-contained (serialized by `page.evaluate`). */
export function collectDomInPage() {
  function text(element) {
    return element ? element.textContent.trim().replace(/\s+/g, ' ') : null;
  }
  function num(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  function field(row, name) {
    return text(row.querySelector(`[data-field="${name}"]`));
  }
  function rect(element) {
    const box = element.getBoundingClientRect();
    return {
      x: Math.round(box.x * 100) / 100,
      y: Math.round(box.y * 100) / 100,
      width: Math.round(box.width * 100) / 100,
      height: Math.round(box.height * 100) / 100,
    };
  }

  const regionNames = [];
  const regionRects = {};
  for (const element of document.querySelectorAll('[data-bench-region]')) {
    const name = element.getAttribute('data-bench-region');
    regionNames.push(name);
    regionRects[name] = rect(element);
  }

  const watchRows = [...document.querySelectorAll('[data-bench-part="watch-row"]')].map((row) => ({
    symbol: row.getAttribute('data-symbol'),
    price: field(row, 'price'),
    change: field(row, 'change'),
    selected: row.getAttribute('aria-selected') === 'true',
    background: getComputedStyle(row).backgroundColor,
  }));

  const bookRows = [...document.querySelectorAll('[data-bench-part="book-row"]')].map((row) => ({
    side: row.getAttribute('data-side'),
    price: num(row.getAttribute('data-price')),
    size: num(row.getAttribute('data-size')),
  }));

  const positionRows = [...document.querySelectorAll('[data-bench-part="position-row"]')].map(
    (row) => ({
      symbol: row.getAttribute('data-symbol'),
      qty: field(row, 'qty'),
      avg: field(row, 'avg'),
      mark: field(row, 'mark'),
      pnl: field(row, 'pnl'),
    }),
  );

  const blotterRows = [...document.querySelectorAll('[data-bench-part="blotter-row"]')].map((row) => ({
    id: row.getAttribute('data-order-id'),
    side: row.getAttribute('data-side'),
    status: row.getAttribute('data-status'),
    symbol: text(row.querySelector('span:nth-child(2)')),
    qty: field(row, 'qty'),
    price: field(row, 'price'),
  }));

  const newsItems = [...document.querySelectorAll('[data-bench-part="news-item"]')];

  const ticketSide = [...document.querySelectorAll('[data-bench-part="ticket-side"]')].find(
    (button) => button.getAttribute('aria-pressed') === 'true',
  );

  const modalPanel = document.querySelector('[data-bench-part="modal-panel"]');
  let modalVisible = false;
  if (modalPanel) {
    const box = modalPanel.getBoundingClientRect();
    const style = getComputedStyle(modalPanel);
    modalVisible =
      box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }

  const topbar = document.querySelector('[data-bench-region="topbar"]');
  const dashboard = document.querySelector('.dashboard');

  return {
    regionNames,
    regionRects,
    theme: dashboard ? dashboard.getAttribute('data-theme') : null,
    topbarBackground: topbar ? getComputedStyle(topbar).backgroundColor : null,
    clock: text(document.querySelector('[data-bench="session-clock"]')),
    status: text(document.querySelector('[data-bench="market-status"]')),
    pnl: text(document.querySelector('[data-bench="account-pnl"]')),
    topbarSymbol: text(document.querySelector('[data-bench="topbar-symbol"]')),
    watchlistCount: num(text(document.querySelector('[data-bench="watchlist-count"]'))),
    watchRows,
    chartSymbol: text(document.querySelector('[data-bench="chart-symbol"]')),
    chartPrice: text(document.querySelector('[data-bench="chart-price"]')),
    chartPoints: num(
      document.querySelector('[data-bench-part="chart-series"]')?.getAttribute('data-points'),
    ),
    bookSymbol: text(document.querySelector('[data-bench="book-symbol"]')),
    bookRows,
    positionRows,
    positionsTotal: text(document.querySelector('[data-bench="positions-total"]')),
    ticketSymbol: text(document.querySelector('[data-bench="ticket-symbol"]')),
    ticketQty: document.querySelector('[data-bench="ticket-qty"]')?.value ?? null,
    ticketPrice: document.querySelector('[data-bench="ticket-price"]')?.value ?? null,
    ticketSide: ticketSide ? ticketSide.getAttribute('data-side') : null,
    newsCount: num(text(document.querySelector('[data-bench="news-count"]'))),
    newsIds: newsItems.map((item) => item.getAttribute('data-news-id')),
    newsHeadlines: newsItems.map((item) => text(item.querySelector('p'))),
    blotterCount: num(text(document.querySelector('[data-bench="blotter-count"]'))),
    blotterRows,
    tapeLatest: text(document.querySelector('[data-bench="tape-latest"]')),
    toasts: [...document.querySelectorAll('[data-bench-part="toast"]')].map((toast) => text(toast)),
    modalVisible,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
}

export function collectDom(page) {
  return page.evaluate(collectDomInPage);
}
