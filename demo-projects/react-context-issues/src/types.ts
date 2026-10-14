export type Side = 'buy' | 'sell';

export interface SymbolRow {
  id: string;
  name: string;
  sector: string;
  prevClose: number;
  price: number;
}

export interface Position {
  id: string;
  symbol: string;
  qty: number;
  avgPrice: number;
}

export interface NewsItem {
  id: string;
  headline: string;
  source: string;
  symbol: string;
  arrivalTick: number | null;
  sequence: number;
}

export interface Order {
  id: string;
  symbol: string;
  side: Side;
  qty: number;
  price: number;
  status: string;
  tick: number;
}

export type BookLevel = [number, number];

export interface OrderBookSnapshot {
  bids: BookLevel[];
  asks: BookLevel[];
}

export interface Tick {
  i: number;
  prices: Record<string, number>;
  books: Record<string, OrderBookSnapshot>;
  pnl: number;
  tape: string;
  newsId: string | null;
}

export interface Snapshot {
  seed: string;
  tickMs: number;
  symbols: SymbolRow[];
  positions: Position[];
  news: NewsItem[];
}

export interface Timeline {
  seed: string;
  ticks: Tick[];
}

export interface OrderHistory {
  seed: string;
  orders: Order[];
}

export interface DashboardData {
  snapshot: Snapshot;
  timeline: Timeline;
  orders: OrderHistory;
}
