import type { ReactNode } from 'react';
import { useApp } from './state';
import { REGION_MANIFEST } from './manifest';

export type RegionName = (typeof REGION_MANIFEST)[number];

type Bucket = 'wide' | 'mid' | 'narrow';

interface Area {
  column: string;
  row: string;
}

const wide: Record<RegionName, Area> = {
  topbar: { column: '1 / 13', row: '1 / 2' },
  watchlist: { column: '1 / 4', row: '2 / 5' },
  chart: { column: '4 / 10', row: '2 / 3' },
  orderbook: { column: '10 / 13', row: '2 / 5' },
  ticket: { column: '4 / 10', row: '3 / 5' },
  positions: { column: '1 / 5', row: '5 / 7' },
  news: { column: '5 / 9', row: '5 / 7' },
  tape: { column: '9 / 13', row: '5 / 6' },
  toasts: { column: '9 / 13', row: '6 / 7' },
  blotter: { column: '1 / 9', row: '7 / 8' },
  settings: { column: '9 / 13', row: '7 / 8' },
  modal: { column: '1 / 13', row: '1 / 2' },
};

const mid: Record<RegionName, Area> = {
  ...wide,
  chart: { column: '4 / 9', row: '2 / 3' },
  orderbook: { column: '9 / 13', row: '2 / 5' },
  ticket: { column: '4 / 9', row: '3 / 5' },
};

const narrow: Record<RegionName, Area> = {
  topbar: { column: '1 / 13', row: '1 / 2' },
  watchlist: { column: '1 / 5', row: '2 / 5' },
  chart: { column: '5 / 13', row: '2 / 3' },
  orderbook: { column: '5 / 13', row: '3 / 5' },
  ticket: { column: '5 / 9', row: '5 / 7' },
  positions: { column: '1 / 5', row: '5 / 7' },
  news: { column: '9 / 13', row: '5 / 7' },
  tape: { column: '1 / 5', row: '7 / 8' },
  toasts: { column: '5 / 9', row: '7 / 8' },
  settings: { column: '9 / 13', row: '7 / 8' },
  blotter: { column: '1 / 13', row: '8 / 9' },
  modal: { column: '1 / 13', row: '1 / 2' },
};

const LAYOUTS: Record<Bucket, Record<RegionName, Area>> = { wide, mid, narrow };

function bucketFor(width: number): Bucket {
  if (width >= 1360) return 'wide';
  if (width >= 1120) return 'mid';
  return 'narrow';
}

/**
 * Every region root stays mounted for the lifetime of the session and carries
 * exactly one `data-bench-region` marker. Layout is applied from the tracked
 * viewport width.
 */
export function Region({ name, children }: { name: RegionName; children?: ReactNode }) {
  const { theme, layoutWidth } = useApp();
  const area = LAYOUTS[bucketFor(layoutWidth)][name];
  return (
    <section
      data-bench-region={name}
      className={`region region--${name} region--${theme}`}
      style={{ gridColumn: area.column, gridRow: area.row }}
    >
      {children}
    </section>
  );
}
