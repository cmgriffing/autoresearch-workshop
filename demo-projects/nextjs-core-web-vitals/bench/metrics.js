/**
 * Metric aggregation.
 *
 * `cwv_budget = (lcp_ms / 2500 + cls / 0.1 + inp_ms / 200) / 3` — lower is
 * better; 1.0 means all three Core Web Vitals sit exactly at their "good"
 * thresholds. The primary is the median of the measured loads; cold
 * (warm-up) and worst-of-run values are reported as secondaries together with
 * `spread_pct`.
 */

import { WORKLOAD } from './config.js';

export function cwvBudget({ lcpMs, cls, inpMs }) {
  const { lcpDivisorMs, clsDivisor, inpDivisorMs } = WORKLOAD.metric;
  return (lcpMs / lcpDivisorMs + cls / clsDivisor + inpMs / inpDivisorMs) / 3;
}

export function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const round1 = (value) => Math.round(value * 10) / 10;
const round3 = (value) => Math.round(value * 1000) / 1000;

function medianOf(runs, pick) {
  const values = runs.map(pick).filter((value) => typeof value === 'number' && Number.isFinite(value));
  return values.length > 0 ? median(values) : 0;
}

const INTERACTIONS = ['filter', 'variant', 'cart', 'shipping'];

/** Reduces the measured loads (and the warm-up) into the emitted metric set. */
export function aggregateRuns(runs, cold) {
  const lcpMs = medianOf(runs, (run) => run.metrics.lcp?.renderTime);
  const cls = medianOf(runs, (run) => run.metrics.cls);
  const inpMs = medianOf(runs, (run) => run.metrics.inpMs);
  const primaryBudget = cwvBudget({ lcpMs, cls, inpMs });

  const budgets = runs.map((run) =>
    cwvBudget({
      lcpMs: run.metrics.lcp?.renderTime ?? 0,
      cls: run.metrics.cls,
      inpMs: run.metrics.inpMs,
    }),
  );
  const spreadPct = primaryBudget > 0 ? ((Math.max(...budgets) - Math.min(...budgets)) / primaryBudget) * 100 : 0;

  const worst = {
    lcpMs: Math.max(...runs.map((run) => run.metrics.lcp?.renderTime ?? 0)),
    cls: Math.max(...runs.map((run) => run.metrics.cls)),
    inpMs: Math.max(...runs.map((run) => run.metrics.inpMs)),
  };

  const coldBudget = cwvBudget({
    lcpMs: cold.metrics.lcp?.renderTime ?? 0,
    cls: cold.metrics.cls,
    inpMs: cold.metrics.inpMs,
  });

  const metrics = {
    cwv_budget: round3(primaryBudget),
    lcp_ms: round1(lcpMs),
    cls: round3(cls),
    inp_ms: round1(inpMs),

    // Raw LCP API candidate (often the largest text block); secondary only —
    // Chromium's image LCP entries are unreliable under network emulation.
    lcp_api_ms: round1(medianOf(runs, (run) => run.metrics.lcpApi?.renderTime)),
    lcp_api_is_image: runs.filter((run) => run.metrics.lcpApi?.isImage).length >= 2 ? 1 : 0,

    lcp_ttfb_ms: round1(medianOf(runs, (run) => run.metrics.lcp?.ttfbMs)),
    lcp_load_delay_ms: round1(medianOf(runs, (run) => run.metrics.lcp?.loadDelayMs)),
    lcp_load_duration_ms: round1(medianOf(runs, (run) => run.metrics.lcp?.loadDurationMs)),
    lcp_render_delay_ms: round1(medianOf(runs, (run) => run.metrics.lcp?.renderDelayMs)),
    lcp_is_image: runs.every((run) => run.metrics.lcp?.isImage) ? 1 : 0,

    long_task_ms: round1(medianOf(runs, (run) => run.metrics.longTaskMs)),

    lcp_cold_ms: round1(cold.metrics.lcp?.renderTime ?? 0),
    cls_cold: round3(cold.metrics.cls),
    inp_cold_ms: round1(cold.metrics.inpMs),
    cwv_budget_cold: round3(coldBudget),

    lcp_worst_ms: round1(worst.lcpMs),
    cls_worst: round3(worst.cls),
    inp_worst_ms: round1(worst.inpMs),
    cwv_budget_worst: round3(cwvBudget(worst)),

    spread_pct: round1(spreadPct),
  };

  for (const name of INTERACTIONS) {
    const entry = (pick) =>
      medianOf(runs, (run) => {
        const interaction = run.metrics.interactions?.[name];
        return interaction ? pick(interaction) : undefined;
      });
    metrics[`inp_${name}_ms`] = round1(entry((interaction) => interaction.latencyMs));
    metrics[`inp_${name}_input_ms`] = round1(entry((interaction) => interaction.inputDelayMs));
    metrics[`inp_${name}_processing_ms`] = round1(entry((interaction) => interaction.processingMs));
    metrics[`inp_${name}_presentation_ms`] = round1(entry((interaction) => interaction.presentationMs));
  }

  return metrics;
}
