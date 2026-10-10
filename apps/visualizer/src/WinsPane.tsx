import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  filteredWinsAtom,
  projectErrorAtom,
  selectedProjectAtom,
  selectedProjectIdAtom,
  selectedRunIdAtom,
  selectedSegmentAtom,
  selectResultAtom,
  winThresholdAtom,
} from "./state";

const formatPercentage = (value: number | null) =>
  value === null ? "Unavailable" : `${value.toFixed(2)}%`;

export default function WinsPane({ onNavigate }: { onNavigate?: () => void }) {
  const snapshot = useAtomValue(selectedProjectAtom);
  const projectError = useAtomValue(projectErrorAtom);
  const selectedProjectId = useAtomValue(selectedProjectIdAtom);
  const segment = useAtomValue(selectedSegmentAtom);
  const filteredWins = useAtomValue(filteredWinsAtom);
  const [threshold, setThreshold] = useAtom(winThresholdAtom);
  const runId = useAtomValue(selectedRunIdAtom);
  const selectResult = useSetAtom(selectResultAtom);
  const runsById = new Map(snapshot?.runs.map((value) => [value.id, value]));
  const baseline = segment?.baselineRunId
    ? runsById.get(segment.baselineRunId)
    : null;
  const visibleWinIds = new Set(filteredWins.map((value) => value.runId));
  const selectedWin = segment?.wins.find((value) => value.runId === runId);
  const selectedOutsideFilter = Boolean(
    selectedWin && !visibleWinIds.has(selectedWin.runId),
  );
  const choose = (id: string) => {
    selectResult(id);
    onNavigate?.();
  };
  return (
    <aside className="experiment-pane" aria-label="Wins">
      <div className="experiment-header">
        <p className="eyebrow">NEW BESTS</p>
        <h2>
          Wins <span>{filteredWins.length}</span>
        </h2>
        <label className="threshold-control">
          Minimum improvement
          <span>
            <input
              aria-label="Minimum win improvement percentage"
              type="number"
              min="0"
              step="0.1"
              value={threshold ?? snapshot?.minWinImprovementPct ?? 0}
              onChange={(event) =>
                setThreshold(Math.max(0, Number(event.target.value) || 0))
              }
            />
            %
          </span>
        </label>
      </div>
      <div className="experiment-list">
        {baseline ? (
          <button
            className="experiment-button baseline-button"
            aria-label={`Baseline experiment ${baseline.run}`}
            aria-pressed={baseline.id === runId}
            onClick={() => choose(baseline.id)}
          >
            <div className="experiment-top">
              <span>First kept baseline</span>
              <span className="mono">#{baseline.run}</span>
            </div>
            <strong>
              {baseline.metric} <span>{segment?.metricUnit}</span>
            </strong>
            <p>{baseline.description || "No description recorded."}</p>
          </button>
        ) : null}
        {filteredWins.map((win) => {
          const result = runsById.get(win.runId);
          return result ? (
            <button
              key={result.id}
              className="experiment-button"
              aria-label={`Win experiment ${result.run}: ${
                win.incremental.percentage === null
                  ? `Percentage unavailable; absolute improvement ${win.incremental.absolute}`
                  : `${formatPercentage(win.incremental.percentage)} improvement`
              }`}
              aria-pressed={result.id === runId}
              onClick={() => choose(result.id)}
            >
              <div className="experiment-top">
                <span className="mono">#{result.run}</span>
                <span className="win-change">
                  {win.incremental.percentage === null
                    ? `+${win.incremental.absolute} ${segment?.metricUnit} (% unavailable)`
                    : `+${formatPercentage(win.incremental.percentage)}`}
                </span>
              </div>
              <strong>
                {result.metric} <span>{segment?.metricUnit}</span>
              </strong>
              <p>{result.description || "No description recorded."}</p>
            </button>
          ) : null;
        })}
        {selectedOutsideFilter ? (
          <p className="outside-filter" role="status">
            Selected win remains open outside the current filter.
          </p>
        ) : null}
        {projectError ? (
          <p role="alert" className="pane-message">
            {projectError}
          </p>
        ) : selectedProjectId && !snapshot ? (
          <p role="status" className="pane-message">
            Loading wins…
          </p>
        ) : snapshot && snapshot.runs.length === 0 ? (
          <p className="pane-message">
            {snapshot.project.sourceState === "limited"
              ? "Log exceeds the size limit. No history is available yet."
              : snapshot.project.sourceState === "error"
                ? "Log unavailable. Refresh after the source recovers."
                : snapshot.project.sourceState === "missing"
                  ? "This session has not produced a log yet."
                  : snapshot.project.diagnostics.some(
                        (diagnostic) => diagnostic.code === "EMPTY_LOG",
                      )
                    ? "This log is empty."
                    : "No valid experiments in this session."}
          </p>
        ) : segment && segment.wins.length > 0 && filteredWins.length === 0 ? (
          <p className="pane-message">
            No wins meet this filter. The baseline and full history remain
            available.
          </p>
        ) : segment && segment.wins.length === 0 ? (
          <p className="pane-message">
            No post-baseline wins are recorded in this segment.
          </p>
        ) : null}
      </div>
    </aside>
  );
}
