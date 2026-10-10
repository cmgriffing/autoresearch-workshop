import { useAtomValue, useSetAtom } from "jotai";
import {
  DECISION_LABEL,
  formatPercentage,
  type AttemptDecision,
  type AttemptRow,
} from "./attempts";
import {
  attemptCountsAtom,
  attemptScopeAtom,
  filterReadoutAtom,
  projectErrorAtom,
  selectedAttemptOutsideFilterAtom,
  selectedProjectAtom,
  selectedProjectIdAtom,
  selectedRunIdAtom,
  selectedSegmentAtom,
  selectResultAtom,
  visibleAttemptRowsAtom,
} from "./state";
import type { AttemptScope } from "./state";

const STATUS_CLASS: Record<AttemptDecision, string> = {
  baseline: "status status-keep",
  win: "status status-keep",
  kept: "status status-keep",
  discarded: "status status-discard",
  failed: "status status-crash",
};

function AttemptEntry({
  row,
  unit,
  selected,
  onSelect,
}: {
  row: AttemptRow;
  unit: string;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const { point, run, decision, win } = row;
  const decisionLabel = DECISION_LABEL[decision];
  const improvement = win
    ? win.incremental.percentage === null
      ? `+${win.incremental.absolute} ${unit} (percentage unavailable)`
      : `+${formatPercentage(win.incremental.percentage)}`
    : null;
  const label = [
    `Select experiment ${run.run} from the attempt list: attempt ${point.attempt}`,
    decisionLabel,
    `metric ${run.metric}${unit ? ` ${unit}` : ""}`,
    `best kept so far ${point.bestMetric ?? "unavailable"}`,
    `description ${run.description || "none recorded"}`,
  ].join(", ");
  return (
    <button
      type="button"
      className={`attempt-entry attempt-entry-${decision}`}
      aria-label={label}
      aria-pressed={selected}
      data-run-id={run.id}
      onClick={() => onSelect(run.id)}
    >
      <span className="attempt-entry-top">
        <span className="attempt-entry-number">
          <span className="mono">#{run.run}</span>
          <span className="attempt-entry-position">
            Attempt {point.attempt}
          </span>
        </span>
        <span className="attempt-entry-tags">
          {improvement ? (
            <span className="win-change">{improvement}</span>
          ) : null}
          <span className={STATUS_CLASS[decision]}>{decisionLabel}</span>
        </span>
      </span>
      <span className="attempt-entry-metric">
        {run.metric}
        {unit ? <span className="attempt-entry-unit">{unit}</span> : null}
      </span>
      <span className="attempt-entry-best">
        Best kept so far{" "}
        <span className="mono">
          {point.bestMetric === null
            ? "Unavailable"
            : `${point.bestMetric}${unit ? ` ${unit}` : ""}`}
        </span>
      </span>
      <span className="attempt-entry-description">
        {run.description || "No description recorded."}
      </span>
    </button>
  );
}

export default function AttemptList({
  onNavigate,
}: {
  onNavigate?: () => void;
}) {
  const snapshot = useAtomValue(selectedProjectAtom);
  const selectedProjectId = useAtomValue(selectedProjectIdAtom);
  const projectError = useAtomValue(projectErrorAtom);
  const segment = useAtomValue(selectedSegmentAtom);
  const rows = useAtomValue(visibleAttemptRowsAtom);
  const counts = useAtomValue(attemptCountsAtom);
  const readout = useAtomValue(filterReadoutAtom);
  const outsideFilter = useAtomValue(selectedAttemptOutsideFilterAtom);
  const scope = useAtomValue(attemptScopeAtom);
  const setScope = useSetAtom(attemptScopeAtom);
  const runId = useAtomValue(selectedRunIdAtom);
  const selectResult = useSetAtom(selectResultAtom);
  const unit = segment?.metricUnit ?? "";
  const choose = (id: string) => {
    selectResult(id);
    onNavigate?.();
  };
  const scopeOptions: { scope: AttemptScope; label: string; count: number }[] =
    [
      { scope: "all", label: "All attempts", count: counts.all },
      { scope: "wins", label: "Wins", count: counts.wins + counts.baseline },
      { scope: "failed", label: "Failed", count: counts.failed },
    ];
  const emptyMessage = (() => {
    if (projectError) return { role: "alert" as const, message: projectError };
    if (selectedProjectId && !snapshot)
      return { role: "status" as const, message: "Loading attempts…" };
    if (snapshot && snapshot.runs.length === 0) {
      const { sourceState, diagnostics } = snapshot.project;
      if (sourceState === "limited")
        return {
          role: "status" as const,
          message: "Log exceeds the size limit. No history is available yet.",
        };
      if (sourceState === "error")
        return {
          role: "status" as const,
          message: "Log unavailable. Refresh after the source recovers.",
        };
      if (sourceState === "missing")
        return {
          role: "status" as const,
          message: "This session has not produced a log yet.",
        };
      if (diagnostics.some((diagnostic) => diagnostic.code === "EMPTY_LOG"))
        return { role: "status" as const, message: "This log is empty." };
      return {
        role: "status" as const,
        message: "No valid experiments in this session.",
      };
    }
    if (!segment || counts.all === 0)
      return {
        role: "status" as const,
        message: "No valid experiments in this segment.",
      };
    if (rows.length > 0) return null;
    if (scope === "wins")
      return counts.wins === 0
        ? {
            role: "status" as const,
            message: "No post-baseline wins are recorded in this segment.",
          }
        : null;
    if (scope === "failed")
      return {
        role: "status" as const,
        message: "No failed attempts are recorded in this segment.",
      };
    return null;
  })();
  return (
    <section
      className="attempt-list"
      aria-labelledby="attempt-list-title"
      data-testid="attempt-list"
    >
      <div className="attempt-list-heading">
        <h2 id="attempt-list-title">Attempts</h2>
        <span className="attempt-list-count">
          {rows.length} of {counts.all}
        </span>
      </div>
      <div className="scope-filter" role="group" aria-label="Attempt scope">
        {scopeOptions.map((option) => (
          <button
            key={option.scope}
            type="button"
            aria-pressed={scope === option.scope}
            onClick={() => setScope(option.scope)}
          >
            {option.label} <span className="scope-count">{option.count}</span>
          </button>
        ))}
      </div>
      <div className="attempt-list-scroll">
        {readout.winsTotal > 0 && readout.winsPassing === 0 ? (
          <p className="pane-message" role="status">
            No wins meet this threshold. The baseline stays listed and failed
            attempts remain available through the attempt scope.
          </p>
        ) : null}
        {rows.map((row) => (
          <AttemptEntry
            key={row.run.id}
            row={row}
            unit={unit}
            selected={row.run.id === runId}
            onSelect={choose}
          />
        ))}
        {outsideFilter ? (
          <p className="outside-filter" role="status">
            Selected experiment remains open outside the current filter.
          </p>
        ) : null}
        {emptyMessage ? (
          <p role={emptyMessage.role} className="pane-message">
            {emptyMessage.message}
          </p>
        ) : null}
      </div>
    </section>
  );
}
