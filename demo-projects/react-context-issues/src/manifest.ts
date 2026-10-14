/**
 * The region manifest, mirrored from the bench workload. It is part of the
 * application/benchmark contract: the twelve `data-bench-region` values are
 * fixed and every region root stays mounted.
 */
export const REGION_MANIFEST = [
  'topbar',
  'watchlist',
  'chart',
  'orderbook',
  'positions',
  'ticket',
  'news',
  'blotter',
  'tape',
  'toasts',
  'modal',
  'settings',
] as const;
