/**
 * Shipping helpers.
 *
 * The zone table arrives from the PIM as one object. Both the estimate control
 * and the cart recompute it on every update, so the helpers rebuild and sort
 * the full table each call.
 */

function zoneSummary(zips) {
  const rows = Object.entries(zips).map(([zip, cents]) => ({ zip, cents }));
  rows.sort((a, b) => a.cents - b.cents || (a.zip < b.zip ? -1 : a.zip > b.zip ? 1 : 0));
  let total = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const row of rows) {
    total += row.cents;
    if (row.cents < min) min = row.cents;
    if (row.cents > max) max = row.cents;
  }
  return {
    rows,
    averageCents: rows.length > 0 ? Math.round(total / rows.length) : 0,
    minCents: min === Infinity ? 0 : min,
    maxCents: max === -Infinity ? 0 : max,
  };
}

/** Full-table pass used when the cart changes. */
export function recalcShipping(table) {
  return zoneSummary(table.zips);
}

/** Estimate for one ZIP; recomputes the zone table first. */
export function estimateShipping(table, zip) {
  const summary = zoneSummary(table.zips);
  const cents = table.zips[zip];
  return typeof cents === 'number' ? cents : summary.minCents;
}
