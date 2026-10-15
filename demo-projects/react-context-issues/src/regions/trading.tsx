import { useApp } from '../state';
import { formatPnl, formatPrice, formatQty } from '../format';
import type { Order, Position } from '../types';

interface PositionRowProps {
  position: Position;
  mark: number;
}

function PositionRow({ position, mark }: PositionRowProps) {
  const value = position.qty * (mark - position.avgPrice);
  return (
    <div data-bench-part="position-row" data-symbol={position.symbol} className="position-row">
      <span className="position-row__symbol">{position.symbol}</span>
      <span data-field="qty">{formatQty(position.qty)}</span>
      <span data-field="avg">{formatPrice(position.avgPrice)}</span>
      <span data-field="mark">{formatPrice(mark)}</span>
      <span data-field="pnl" className={value >= 0 ? 'up' : 'down'}>
        {formatPnl(value)}
      </span>
    </div>
  );
}

export function Positions() {
  const { positions, tick, pnl } = useApp();
  const prices = tick?.prices ?? {};
  return (
    <div className="panel">
      <header className="panel__header">
        <h2>Positions</h2>
        <span data-bench="positions-total" className={pnl >= 0 ? 'up' : 'down'}>
          {formatPnl(pnl)}
        </span>
      </header>
      <div className="panel__body positions">
        {positions.map((position) => (
          <PositionRow
            key={position.id}
            position={position}
            mark={prices[position.symbol] ?? position.avgPrice}
          />
        ))}
      </div>
    </div>
  );
}

export function OrderTicket() {
  const { selected, draft, setDraft, submitDraft } = useApp();
  return (
    <div className="panel">
      <header className="panel__header">
        <h2>Order ticket</h2>
        <span data-bench="ticket-symbol">{selected ?? '—'}</span>
      </header>
      <div className="panel__body ticket">
        <div className="ticket__sides">
          {(['buy', 'sell'] as const).map((side) => (
            <button
              key={side}
              type="button"
              data-bench-part="ticket-side"
              data-side={side}
              aria-pressed={draft.side === side}
              className={`ticket__side ticket__side--${side}${draft.side === side ? ' is-active' : ''}`}
              onClick={() => setDraft({ side })}
            >
              {side.toUpperCase()}
            </button>
          ))}
        </div>
        <label className="ticket__field">
          <span>Quantity</span>
          <input
            data-bench="ticket-qty"
            inputMode="numeric"
            value={draft.qty}
            onChange={(event) => setDraft({ qty: event.target.value })}
          />
        </label>
        <label className="ticket__field">
          <span>Limit price</span>
          <input
            data-bench="ticket-price"
            inputMode="decimal"
            value={draft.price}
            onChange={(event) => setDraft({ price: event.target.value })}
          />
        </label>
        <button type="button" className="ticket__submit" data-bench="ticket-submit" onClick={submitDraft}>
          Submit order
        </button>
      </div>
    </div>
  );
}

function BlotterRow({ order }: { order: Order }) {
  return (
    <div
      data-bench-part="blotter-row"
      data-order-id={order.id}
      data-side={order.side}
      data-status={order.status}
      className="blotter-row"
    >
      <span className="blotter-row__id">{order.id}</span>
      <span>{order.symbol}</span>
      <span className={order.side === 'buy' ? 'up' : 'down'}>{order.side.toUpperCase()}</span>
      <span data-field="qty">{formatQty(order.qty)}</span>
      <span data-field="price">{formatPrice(order.price)}</span>
      <span className="blotter-row__status">{order.status}</span>
    </div>
  );
}

export function Blotter() {
  const { orders } = useApp();
  return (
    <div className="panel">
      <header className="panel__header">
        <h2>Blotter</h2>
        <span data-bench="blotter-count">{orders.length}</span>
      </header>
      <div className="panel__body blotter">
        {orders.map((order) => (
          <BlotterRow key={order.id} order={order} />
        ))}
      </div>
    </div>
  );
}

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="panel">
      <header className="panel__header">
        <h2>Alerts</h2>
        <span data-bench="toast-count">{toasts.length}</span>
      </header>
      <div className="panel__body toasts">
        {toasts.map((toast) => (
          <div key={toast.id} data-bench-part="toast" className="toast">
            <span>{toast.text}</span>
            <button type="button" data-bench="toast-dismiss" onClick={() => dismissToast(toast.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
