export function formatPrice(value: number): string {
  return value.toFixed(2);
}

export function formatPnl(value: number): string {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

export function formatQty(value: number): string {
  return value.toLocaleString('en-US');
}

export function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function formatClock(date: Date): string {
  return date.toISOString().slice(11, 19);
}

export function changePercent(price: number, prevClose: number): number {
  return ((price - prevClose) / prevClose) * 100;
}
