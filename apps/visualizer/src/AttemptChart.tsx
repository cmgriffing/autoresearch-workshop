import { memo } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipContentProps } from "recharts";
import type { AttemptPlotPoint, SegmentSnapshot } from "visualizar-common";
import { selectedRunIdAtom, selectResultAtom } from "./state";

function pointLabel(point: AttemptPlotPoint) {
  return point.isBaseline
    ? "First kept baseline"
    : point.isWin
      ? "New best"
      : {
          keep: "Kept",
          discard: "Discarded",
          crash: "Crashed",
          checks_failed: "Checks failed",
        }[point.status];
}

function AttemptMarker({
  cx,
  cy,
  point,
}: {
  cx: number;
  cy: number;
  point: AttemptPlotPoint;
}) {
  const selected = useAtomValue(selectedRunIdAtom) === point.runId;
  const onSelect = useSetAtom(selectResultAtom);
  const color = point.status === "discard" ? "#757a69" : "#3c552e";
  const label = `Select experiment ${point.run} from chart, attempt ${point.attempt}: ${pointLabel(point)}, metric ${point.metric}`;
  return (
    <g
      className="attempt-marker"
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={selected}
      data-run-id={point.runId}
      data-marker={
        point.isWin ? "win" : point.isBaseline ? "baseline" : point.status
      }
      onClick={() => onSelect(point.runId)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          onSelect(point.runId);
        }
      }}
    >
      <title>{label}</title>
      <circle cx={cx} cy={cy} r={13} fill="transparent" />
      <circle
        className="marker-ring"
        cx={cx}
        cy={cy}
        r={10}
        fill="none"
        stroke="#bd722d"
        strokeWidth={2}
        opacity={selected ? 1 : 0}
      />
      {point.isWin ? (
        <path
          d={`M${cx},${cy - 6} l6,6 l-6,6 l-6,-6 Z`}
          fill={color}
          stroke={color}
        />
      ) : point.isBaseline ? (
        <rect
          x={cx - 5}
          y={cy - 5}
          width={10}
          height={10}
          rx={1}
          fill={color}
        />
      ) : (
        <circle
          cx={cx}
          cy={cy}
          r={5}
          stroke={color}
          strokeWidth={2}
          fill={point.status === "discard" ? "#fffef9" : color}
        />
      )}
    </g>
  );
}

function renderAttemptMarker({
  cx,
  cy,
  payload,
}: {
  cx?: number;
  cy?: number;
  payload?: AttemptPlotPoint;
}) {
  return payload &&
    payload.metric !== null &&
    cx !== undefined &&
    cy !== undefined ? (
    <AttemptMarker key={payload.runId} cx={cx} cy={cy} point={payload} />
  ) : (
    <g />
  );
}

function FailedAttempt({ point }: { point: AttemptPlotPoint }) {
  const selected = useAtomValue(selectedRunIdAtom) === point.runId;
  const onSelect = useSetAtom(selectResultAtom);
  return (
    <button
      aria-label={`Select failed experiment ${point.run} from chart, attempt ${point.attempt}: ${pointLabel(point)}`}
      aria-pressed={selected}
      data-run-id={point.runId}
      onClick={() => onSelect(point.runId)}
    >
      <span aria-hidden="true">×</span> Attempt {point.attempt} · #{point.run} ·{" "}
      {pointLabel(point)}
    </button>
  );
}

function AttemptTooltip({
  active,
  payload,
  unit,
}: TooltipContentProps & { unit: string }) {
  const point = payload?.[0]?.payload as AttemptPlotPoint | undefined;
  if (!active || !point) return null;
  return (
    <div className="attempt-tooltip" role="status" aria-live="polite">
      <strong>
        Attempt {point.attempt} · Experiment {point.run}
      </strong>
      <p>{pointLabel(point)}</p>
      <p>
        {point.metric === null
          ? "Failed metric is not plotted"
          : `${point.metric} ${unit}`}
      </p>
      <p>
        Best kept:{" "}
        {point.bestMetric === null
          ? "Unavailable"
          : `${point.bestMetric} ${unit}`}
      </p>
    </div>
  );
}

function AttemptChart({ segment }: { segment: SegmentSnapshot }) {
  const points = segment.attempts;
  const failed = points.filter((point) => point.metric === null);
  const hasMeasurements = points.some((point) => point.metric !== null);
  return (
    <section className="chart-card" aria-labelledby="trajectory-title">
      <div className="chart-heading">
        <h2 id="trajectory-title">Metric trajectory</h2>
      </div>
      <p className="chart-context">
        {points.length} attempts in recorded source order.{" "}
        <a href="#attempt-list-title">The attempt list</a> provides every
        recorded metric, decision, and best-kept value with keyboard selection.
      </p>
      {points.length === 0 ? (
        <p className="chart-context">No attempts recorded in this segment.</p>
      ) : hasMeasurements ? (
        <div className="attempt-chart" data-testid="attempt-chart">
          <ResponsiveContainer
            width="100%"
            height={280}
            minWidth={0}
            initialDimension={{ width: 600, height: 280 }}
          >
            <LineChart
              data={points}
              margin={{ top: 18, right: 18, left: 0, bottom: 8 }}
              title={`${segment.name}: recorded attempts and best kept ${segment.metricName}`}
              accessibilityLayer
            >
              <CartesianGrid
                vertical={false}
                stroke="#e1e4d8"
                strokeDasharray="3 3"
              />
              <XAxis
                dataKey="attempt"
                type="number"
                domain={[1, Math.max(2, points.length)]}
                allowDecimals={false}
                minTickGap={24}
                height={42}
                tick={{ fontSize: 11, fill: "#677568" }}
                label={{
                  value: "Attempt order",
                  position: "insideBottom",
                  offset: -2,
                  fill: "#677568",
                  fontSize: 11,
                }}
              />
              <YAxis
                domain={["auto", "auto"]}
                width={70}
                tick={{ fontSize: 11, fill: "#677568" }}
                tickFormatter={(value: number) =>
                  Number(value.toPrecision(4)).toString()
                }
              />
              <Tooltip
                content={(props) => (
                  <AttemptTooltip {...props} unit={segment.metricUnit} />
                )}
              />
              <Line
                dataKey="bestMetric"
                name="Best kept"
                type="stepAfter"
                stroke="#81965e"
                strokeWidth={2}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
              <Line
                dataKey="metric"
                name="Recorded attempt"
                stroke="none"
                activeDot={false}
                isAnimationActive={false}
                dot={renderAttemptMarker}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="chart-context">
          No measured kept or discarded attempts. Failed attempts remain
          selectable below.
        </p>
      )}
      {hasMeasurements ? (
        <ul className="chart-legend" aria-label="Chart legend">
          <li>
            <span className="legend-baseline" aria-hidden="true">
              ■
            </span>{" "}
            First kept baseline
          </li>
          <li>
            <span className="legend-win" aria-hidden="true">
              ◆
            </span>{" "}
            New best
          </li>
          <li>
            <span aria-hidden="true">●</span> Kept
          </li>
          <li>
            <span aria-hidden="true">○</span> Discarded
          </li>
          <li>
            <span className="legend-line" aria-hidden="true" /> Best kept so far
          </li>
        </ul>
      ) : null}
      {failed.length > 0 ? (
        <div
          className="failed-attempts"
          role="group"
          aria-label="Failed attempts"
        >
          <p>
            Failed attempts · recorded metrics excluded from the metric axis
          </p>
          <div>
            {failed.map((point) => (
              <FailedAttempt key={point.runId} point={point} />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

// Only source/segment changes redraw the plot. Selection updates local markers,
// retaining SVG keyboard focus through result and lazy diff updates.
export default memo(AttemptChart);
