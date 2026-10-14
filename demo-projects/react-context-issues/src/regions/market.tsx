import { useApp } from '../state';
import { changePercent, formatPercent, formatPnl, formatPrice } from '../format';

export function TopBar() {
  const { clock, pnl, theme, toggleTheme, selected } = useApp();
  const status = clock >= '14:30:00' && clock < '21:00:00' ? 'OPEN' : 'CLOSED';
  return (
    <div className="topbar">
      <span className="topbar__brand">MeridianTrader</span>
      <span className="topbar__session">
        <span data-bench="session-clock">{clock}</span>
        <span data-bench="market-status" className={`status status--${status.toLowerCase()}`}>
          {status}
        </span>
      </span>
      <span className="topbar__pnl" data-field="pnl">
        <span className="topbar__label">P&amp;L</span>
        <span data-bench="account-pnl" className={pnl >= 0 ? 'up' : 'down'}>
          {formatPnl(pnl)}
        </span>
      </span>
      <span className="topbar__symbol" data-bench="topbar-symbol">
        {selected ?? '—'}
      </span>
      <button type="button" className="topbar__theme" data-bench="theme-toggle" onClick={toggleTheme}>
        {theme === 'dark' ? 'Dark' : 'Light'}
      </button>
    </div>
  );
}

interface WatchRowProps {
  symbol: string;
  name: string;
  price: number;
  prevClose: number;
}

function WatchRow({ symbol, name, price, prevClose }: WatchRowProps) {
  const { selected, selectSymbol, hovered, setHovered } = useApp();
  const change = changePercent(price, prevClose);
  const state = selected === symbol ? 'selected' : hovered === symbol ? 'hovered' : '';
  return (
    <div
      data-bench-part="watch-row"
      data-symbol={symbol}
      aria-selected={selected === symbol}
      className={`watch-row watch-row--${state || 'idle'}`}
      onMouseEnter={() => setHovered(symbol)}
      onMouseLeave={() => setHovered(null)}
      onClick={() => selectSymbol(symbol)}
    >
      <span className="watch-row__symbol">{symbol}</span>
      <span className="watch-row__name">{name}</span>
      <span className="watch-row__price" data-field="price">
        {formatPrice(price)}
      </span>
      <span className={`watch-row__change ${change >= 0 ? 'up' : 'down'}`} data-field="change">
        {formatPercent(change)}
      </span>
    </div>
  );
}

export function Watchlist() {
  const { data, tick } = useApp();
  const symbols = data?.snapshot.symbols ?? [];
  const prices = tick?.prices ?? {};
  return (
    <div className="panel">
      <header className="panel__header">
        <h2>Watchlist</h2>
        <span data-bench="watchlist-count">{symbols.length}</span>
      </header>
      <div className="panel__body watchlist">
        {symbols.map((symbol) => (
          <WatchRow
            key={symbol.id}
            symbol={symbol.id}
            name={symbol.name}
            price={prices[symbol.id] ?? symbol.price}
            prevClose={symbol.prevClose}
          />
        ))}
      </div>
    </div>
  );
}

export function Chart() {
  const { data, tick, cursor, selected } = useApp();
  const symbol = data?.snapshot.symbols.find((row) => row.id === selected) ?? null;
  const series = data
    ? data.timeline.ticks.slice(0, cursor + 1).map((entry) => (selected ? entry.prices[selected] : 0))
    : [];
  const price = selected && tick ? tick.prices[selected] : (symbol?.price ?? 0);
  const change = symbol ? changePercent(price, symbol.prevClose) : 0;
  const min = series.length > 0 ? Math.min(...series) : 0;
  const max = series.length > 0 ? Math.max(...series) : 0;
  const range = max - min || 1;
  const points = series
    .map(
      (value, index) =>
        `${((index / Math.max(1, series.length - 1)) * 100).toFixed(2)},${(100 - ((value - min) / range) * 100).toFixed(2)}`,
    )
    .join(' ');
  return (
    <div className="panel">
      <header className="panel__header">
        <h2>{symbol?.name ?? 'Chart'}</h2>
        <span data-bench="chart-symbol">{selected ?? '—'}</span>
      </header>
      <div className="panel__body chart">
        <div className="chart__quote">
          <span className="chart__price" data-bench="chart-price">
            {formatPrice(price)}
          </span>
          <span className={`chart__change ${change >= 0 ? 'up' : 'down'}`}>
            {formatPercent(change)}
          </span>
        </div>
        <svg className="chart__svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polyline data-bench-part="chart-series" data-points={series.length} points={points} />
        </svg>
      </div>
    </div>
  );
}

interface BookRowProps {
  side: 'ask' | 'bid';
  price: number;
  size: number;
  position: number;
}

function BookRow({ side, price, size, position }: BookRowProps) {
  return (
    <div
      data-bench-part="book-row"
      data-side={side}
      data-price={price}
      data-size={size}
      data-position={position}
      className={`book-row book-row--${side}`}
    >
      <span data-field="price">{formatPrice(price)}</span>
      <span data-field="size">{size.toLocaleString('en-US')}</span>
    </div>
  );
}

export function OrderBook() {
  const { tick, selected } = useApp();
  const book = tick && selected ? tick.books[selected] : null;
  const asks = book ? [...book.asks].reverse() : [];
  const bids = book ? book.bids : [];
  return (
    <div className="panel">
      <header className="panel__header">
        <h2>Order book</h2>
        <span data-bench="book-symbol">{selected ?? '—'}</span>
      </header>
      <div className="panel__body book">
        {asks.map(([price, size], index) => (
          <BookRow key={`ask-${price}-${index}`} side="ask" price={price} size={size} position={index} />
        ))}
        {bids.map(([price, size], index) => (
          <BookRow key={`bid-${price}-${index}`} side="bid" price={price} size={size} position={index} />
        ))}
        {!book && <div className="empty">No instrument selected</div>}
      </div>
    </div>
  );
}

function TapeRow({ entry }: { entry: string }) {
  return <div className="tape__row">{entry}</div>;
}

export function Tape() {
  const { data, cursor, tick } = useApp();
  const recent = data ? data.timeline.ticks.slice(Math.max(0, cursor - 4), cursor + 1).reverse() : [];
  return (
    <div className="panel">
      <header className="panel__header">
        <h2>Tape</h2>
        <span data-bench="tape-count">{recent.length}</span>
      </header>
      <div className="panel__body tape">
        <div className="tape__latest" data-bench="tape-latest">
          {tick?.tape ?? ''}
        </div>
        {recent.slice(1).map((entry) => (
          <TapeRow key={entry.i} entry={entry.tape} />
        ))}
      </div>
    </div>
  );
}
