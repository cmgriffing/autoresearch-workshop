import type {
  AttemptPlotPoint,
  RunSnapshot,
  WinSummary,
} from "visualizar-common";

export type AttemptDecision =
  "baseline" | "win" | "kept" | "discarded" | "failed";

export interface AttemptRow {
  point: AttemptPlotPoint;
  run: RunSnapshot;
  decision: AttemptDecision;
  win: WinSummary | null;
}

export function attemptDecision(point: AttemptPlotPoint): AttemptDecision {
  if (point.isBaseline) return "baseline";
  if (point.isWin) return "win";
  if (point.status === "keep") return "kept";
  if (point.status === "discard") return "discarded";
  return "failed";
}

export const DECISION_LABEL: Record<AttemptDecision, string> = {
  baseline: "First kept baseline",
  win: "New best",
  kept: "Kept",
  discarded: "Discarded",
  failed: "Failed",
};

export function formatPercentage(value: number | null): string {
  return value === null ? "Unavailable" : `${value.toFixed(2)}%`;
}

export function formatMetric(
  value: number | null | undefined,
  unit: string,
): string {
  return value == null ? "Unavailable" : `${value} ${unit}`.trim();
}

export function formatThreshold(value: number): string {
  if (value === 0) return "0%";
  if (value < 1) return `${value.toFixed(2)}%`;
  if (value < 10) return `${value.toFixed(1)}%`;
  return `${value.toFixed(0)}%`;
}

// A new best passes when the threshold is 0 (every win, including wins whose
// percentage is unavailable) or its measured improvement reaches the
// threshold. Kept, discarded, and failed attempts are governed by the scope
// filter instead.
export function winPassesThreshold(
  win: WinSummary | null,
  threshold: number,
): boolean {
  return (
    threshold === 0 ||
    (win !== null &&
      win.incremental.percentage !== null &&
      win.incremental.percentage >= threshold)
  );
}

// Logarithmic stops (1/2/5 per decade) from 0 to the first stop strictly above
// the largest measured win. The configured default is always a stop so the
// reset control restores it exactly.
export function buildThresholdStops(
  maxPercentage: number,
  configured: number,
): number[] {
  const stops = [0];
  let top: number | null = null;
  for (let decade = 0.01; decade <= 1000 && top === null; decade *= 10) {
    for (const multiplier of [1, 2, 5]) {
      const value = decade * multiplier;
      if (value > maxPercentage) {
        top = value;
        break;
      }
      stops.push(value);
    }
  }
  stops.push(top ?? 1000);
  if (configured > 0) stops.push(configured);
  return [...new Set(stops)].sort((a, b) => a - b);
}

export function nearestStopIndex(stops: number[], value: number): number {
  let best = 0;
  for (let index = 1; index < stops.length; index += 1) {
    if (Math.abs(stops[index] - value) < Math.abs(stops[best] - value))
      best = index;
  }
  return best;
}
