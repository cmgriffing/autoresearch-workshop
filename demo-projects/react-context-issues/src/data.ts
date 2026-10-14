import type { DashboardData, OrderHistory, Snapshot, Timeline } from './types';

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} responded ${response.status}`);
  }
  return (await response.json()) as T;
}

/** Loads the seeded snapshot, timeline and order history from the harness. */
export async function loadDashboard(seed: string): Promise<DashboardData> {
  const query = `?seed=${encodeURIComponent(seed)}`;
  const [snapshot, timeline, orders] = await Promise.all([
    fetchJson<Snapshot>(`/api/snapshot${query}`),
    fetchJson<Timeline>(`/api/timeline${query}`),
    fetchJson<OrderHistory>(`/api/orders${query}`),
  ]);
  return { snapshot, timeline, orders };
}
