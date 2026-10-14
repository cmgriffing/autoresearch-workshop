import { useEffect, useState } from 'react';
import { loadDashboard } from './data';
import { formatClock } from './format';
import { AppContext, type AppState, type Draft, type Theme, type Toast } from './state';
import { Region } from './Region';
import type { DashboardData, NewsItem, Order, Position } from './types';
import { TopBar, Watchlist, Chart, OrderBook, Tape } from './regions/market';
import { Positions, OrderTicket, Blotter, Toasts } from './regions/trading';
import { News, Settings } from './regions/info';
import { Modal } from './regions/Modal';

function readSeed(): string {
  return new URLSearchParams(window.location.search).get('seed') ?? 'demo';
}

/** Applies a filled order to the position book. */
function applyFill(positions: Position[], order: Order): Position[] {
  const delta = order.side === 'buy' ? order.qty : -order.qty;
  const index = positions.findIndex((position) => position.symbol === order.symbol);
  if (index === -1) {
    return [
      ...positions,
      {
        id: `POS-${String(positions.length + 1).padStart(2, '0')}`,
        symbol: order.symbol,
        qty: delta,
        avgPrice: order.price,
      },
    ];
  }
  const next = positions.slice();
  const current = next[index];
  const qty = current.qty + delta;
  const avgPrice =
    qty === 0
      ? order.price
      : Math.round(((current.qty * current.avgPrice + delta * order.price) / qty) * 100) / 100;
  next[index] = { ...current, qty, avgPrice };
  return next;
}

export default function App() {
  const seed = readSeed();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [clock, setClock] = useState(() => formatClock(new Date()));
  const [pnl, setPnl] = useState(0);
  const [draft, setDraftState] = useState<Draft>({ side: 'buy', qty: '', price: '' });
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>('dark');
  const [positions, setPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [layoutWidth, setLayoutWidth] = useState(() => window.innerWidth);

  useEffect(() => {
    let cancelled = false;
    loadDashboard(seed)
      .then((loaded) => {
        if (cancelled) return;
        setData(loaded);
        setPositions(loaded.snapshot.positions);
        setOrders(loaded.orders.orders);
        setNews(loaded.snapshot.news.filter((item) => item.arrivalTick === null));
        setSelected(loaded.snapshot.symbols[0]?.id ?? null);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [seed]);

  useEffect(() => {
    if (!data) return;
    const tickTimer = setInterval(() => {
      setCursor((current) => Math.min(current + 1, data.timeline.ticks.length - 1));
    }, data.snapshot.tickMs);
    const clockTimer = setInterval(() => setClock(formatClock(new Date())), 1000);
    const newsTimer = setInterval(() => setNews((current) => [...current]), 700);
    return () => {
      clearInterval(tickTimer);
      clearInterval(clockTimer);
      clearInterval(newsTimer);
    };
  }, [data]);

  const tick = data ? data.timeline.ticks[cursor] : null;

  useEffect(() => {
    if (tick) setPnl(tick.pnl);
  }, [tick]);

  useEffect(() => {
    if (!tick || !tick.newsId || !data) return;
    const arriving = data.snapshot.news.find((item) => item.id === tick.newsId);
    if (!arriving) return;
    setNews((current) =>
      current.some((item) => item.id === arriving.id) ? current : [arriving, ...current],
    );
  }, [tick, data]);

  useEffect(() => {
    const update = () => setLayoutWidth(window.innerWidth);
    const observer = new ResizeObserver(update);
    observer.observe(document.documentElement);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  const setDraft = (patch: Partial<Draft>) =>
    setDraftState((current) => ({ ...current, ...patch }));

  const selectSymbol = (symbol: string) => {
    setSelected(symbol);
    if (data) {
      setDraftState((current) => ({
        ...current,
        price: String(data.timeline.ticks[cursor].prices[symbol]),
      }));
    }
  };

  const toggleTheme = () => setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  const dismissToast = (id: number) =>
    setToasts((current) => current.filter((toast) => toast.id !== id));
  const openModal = () => setModalOpen(true);
  const closeModal = () => setModalOpen(false);

  const submitDraft = () => {
    if (!tick || !selected) return;
    const qty = Number(draft.qty);
    const price = Number(draft.price || tick.prices[selected]);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) return;
    const order: Order = {
      id: `ORD-${1001 + orders.length}`,
      symbol: selected,
      side: draft.side,
      qty,
      price,
      status: 'filled',
      tick: cursor,
    };
    setOrders((current) => [order, ...current]);
    setPositions((current) => applyFill(current, order));
    setToasts((current) => [
      ...current,
      {
        id: current.length + 1,
        text: `Order ${order.id} filled: ${order.side.toUpperCase()} ${order.qty} ${order.symbol} @ ${order.price.toFixed(2)}`,
      },
    ]);
  };

  const value: AppState = {
    seed,
    data,
    loadError,
    tick,
    cursor,
    clock,
    pnl,
    draft,
    setDraft,
    selected,
    selectSymbol,
    hovered,
    setHovered,
    theme,
    toggleTheme,
    positions,
    orders,
    news,
    toasts,
    dismissToast,
    modalOpen,
    openModal,
    closeModal,
    layoutWidth,
    submitDraft,
  };

  return (
    <AppContext.Provider value={value}>
      <div className={`dashboard dashboard--${theme}`} data-theme={theme}>
        <Region name="topbar">
          <TopBar />
        </Region>
        <Region name="watchlist">
          <Watchlist />
        </Region>
        <Region name="chart">
          <Chart />
        </Region>
        <Region name="orderbook">
          <OrderBook />
        </Region>
        <Region name="positions">
          <Positions />
        </Region>
        <Region name="ticket">
          <OrderTicket />
        </Region>
        <Region name="news">
          <News />
        </Region>
        <Region name="blotter">
          <Blotter />
        </Region>
        <Region name="tape">
          <Tape />
        </Region>
        <Region name="toasts">
          <Toasts />
        </Region>
        <Region name="modal">
          <Modal />
        </Region>
        <Region name="settings">
          <Settings />
        </Region>
      </div>
    </AppContext.Provider>
  );
}
