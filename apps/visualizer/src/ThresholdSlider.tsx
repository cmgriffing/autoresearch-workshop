import { useAtom, useAtomValue } from "jotai";
import { formatThreshold } from "./attempts";
import {
  filterReadoutAtom,
  thresholdStopIndexAtom,
  thresholdStopsAtom,
  winThresholdAtom,
} from "./state";

export default function ThresholdSlider() {
  const stops = useAtomValue(thresholdStopsAtom);
  const index = useAtomValue(thresholdStopIndexAtom);
  const readout = useAtomValue(filterReadoutAtom);
  const [threshold, setThreshold] = useAtom(winThresholdAtom);
  if (!stops) return null;
  const readoutText = `${formatThreshold(readout.threshold)} · ${
    readout.winsPassing
  } of ${readout.winsTotal} wins · ${readout.listed} of ${
    readout.total
  } attempts`;
  return (
    <section className="threshold" aria-labelledby="threshold-title">
      <div className="threshold-heading">
        <h3 id="threshold-title">Minimum improvement</h3>
        <button
          type="button"
          className="threshold-reset"
          aria-label="Reset minimum improvement to the configured default"
          disabled={threshold === null || threshold === stops.configured}
          onClick={() => setThreshold(null)}
        >
          Reset
        </button>
      </div>
      {!stops.hasWins ? (
        <p className="threshold-readout" data-testid="threshold-readout">
          No new-best wins are recorded in this segment.
        </p>
      ) : (
        <>
          <input
            type="range"
            className="threshold-slider"
            min={0}
            max={Math.max(0, stops.stops.length - 1)}
            step={1}
            value={index}
            disabled={!stops.measured}
            aria-label="Minimum win improvement percentage"
            aria-valuetext={
              stops.measured
                ? readoutText
                : "All recorded wins included; improvement percentage unavailable."
            }
            onChange={(event) =>
              setThreshold(stops.stops[Number(event.target.value)] ?? 0)
            }
          />
          <p className="threshold-readout" data-testid="threshold-readout">
            {stops.measured
              ? readoutText
              : "Percentages are unavailable; every recorded win is included."}
          </p>
          {stops.measured ? (
            <div className="threshold-scale" aria-hidden="true">
              <span>0%</span>
              <span>
                {formatThreshold(stops.stops[stops.stops.length - 1])}
              </span>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
