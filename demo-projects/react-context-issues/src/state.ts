import { createContext, useContext } from 'react';
import type { DashboardData, NewsItem, Order, Position, Side, Tick } from './types';

export interface Draft {
  side: Side;
  qty: string;
  price: string;
}

export interface Toast {
  id: number;
  text: string;
}

export type Theme = 'dark' | 'light';

export interface AppState {
  seed: string;
  data: DashboardData | null;
  loadError: string | null;
  tick: Tick | null;
  cursor: number;
  clock: string;
  pnl: number;
  draft: Draft;
  setDraft: (patch: Partial<Draft>) => void;
  selected: string | null;
  selectSymbol: (symbol: string) => void;
  hovered: string | null;
  setHovered: (symbol: string | null) => void;
  theme: Theme;
  toggleTheme: () => void;
  positions: Position[];
  orders: Order[];
  news: NewsItem[];
  toasts: Toast[];
  dismissToast: (id: number) => void;
  modalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
  layoutWidth: number;
  submitDraft: () => void;
}

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside the dashboard provider');
  return value;
}
