import type { RunSnapshot, SegmentSnapshot } from "visualizar-common";
import { DECISION_LABEL, attemptDecision } from "./attempts";

export default function RunDetails({
  run,
  segment,
}: {
  run: RunSnapshot;
  segment: SegmentSnapshot | null;
}) {
  const point = segment?.attempts.find((value) => value.runId === run.id);
  const decision = point
    ? point.status === "crash" || point.status === "checks_failed"
      ? "Failed attempt · recorded metric excluded from the chart"
      : DECISION_LABEL[attemptDecision(point)]
    : "Not recorded in the selected segment";
  const previousBest =
    point && point.attempt > 1
      ? segment?.attempts[point.attempt - 2]?.bestMetric
      : null;
  const win = segment?.wins.find((value) => value.runId === run.id);
  const unit = segment?.metricUnit ?? "";
  const formatMetric = (value: number | null | undefined) =>
    value == null ? "Unavailable" : `${value} ${unit}`;
  const formatImprovement = (value: {
    absolute: number;
    percentage: number | null;
  }) =>
    `${value.absolute} ${unit} · ${value.percentage === null ? "percentage unavailable (zero reference)" : `${value.percentage.toFixed(2)}%`}`;
  const metrics = Object.entries(run.metrics ?? {});
  return (
    <div className="run-details">
      <dl className="result-meta">
        <div>
          <dt>Decision</dt>
          <dd>{decision}</dd>
        </div>
        <div>
          <dt>Recorded timestamp (UTC)</dt>
          <dd>
            {run.timestamp == null ? (
              "Not recorded"
            ) : (
              <time dateTime={new Date(run.timestamp).toISOString()}>
                {new Date(run.timestamp).toISOString()}
              </time>
            )}
          </dd>
        </div>
      </dl>
      <dl className="metric-references">
        <div>
          <dt>Previous best kept metric</dt>
          <dd>{formatMetric(previousBest)}</dd>
        </div>
        <div>
          <dt>First kept baseline metric</dt>
          <dd>{formatMetric(segment?.baselineMetric)}</dd>
        </div>
        <div>
          <dt>Incremental improvement</dt>
          <dd>
            {win ? formatImprovement(win.incremental) : "No incremental win"}
          </dd>
        </div>
        <div>
          <dt>Cumulative win improvement</dt>
          <dd>
            {win ? formatImprovement(win.cumulative) : "No cumulative win"}
          </dd>
        </div>
      </dl>
      <section className="secondary-metrics" aria-label="Secondary metrics">
        <h3>Secondary metrics</h3>
        {metrics.length > 0 ? (
          <dl>
            {metrics.map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd className="mono">{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p>No secondary metrics recorded.</p>
        )}
      </section>
      <section
        className="advisory-diagnostics"
        aria-label="Recorded advisory diagnostics"
      >
        <h3>Recorded advisory diagnostics</h3>
        <p>
          Session-reported context. Confidence is an advisory value; it does not
          determine wins.
        </p>
        <dl>
          <div>
            <dt>Reported confidence</dt>
            <dd className="mono">{run.confidence ?? "Not recorded"}</dd>
          </div>
        </dl>
        <h4>ASI diagnostics</h4>
        {run.asi === undefined ? (
          <p>No ASI diagnostics recorded.</p>
        ) : (
          <pre tabIndex={0} aria-label="Recorded ASI JSON">
            <code>{JSON.stringify(run.asi, null, 2)}</code>
          </pre>
        )}
      </section>
    </div>
  );
}
