import { useAtomValue } from "jotai";
import { liveConnectionAtom } from "./state";
import type { LiveConnection } from "./state";
import ProjectSelector, { ProjectMetadata } from "./ProjectSelector";
import ThresholdSlider from "./ThresholdSlider";
import AttemptList from "./AttemptList";

export function connectionLabel(connection: LiveConnection): string {
  return connection === "connected"
    ? "Live updates connected"
    : connection === "disconnected"
      ? "Live updates disconnected"
      : connection === "manual"
        ? "Manual updates"
        : "Connecting live updates";
}

export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        a/
      </span>
      <span>
        autoresearch
        <span className="brand-sub">LOCAL SESSION REVIEW</span>
      </span>
    </div>
  );
}

export function ConnectionState() {
  const connection = useAtomValue(liveConnectionAtom);
  return (
    <div className="connection-state">
      <span
        className={`source-dot source-dot-${connection}`}
        aria-hidden="true"
      />
      <span role="status">{connectionLabel(connection)}</span>
      <p>
        {connection === "manual"
          ? "Use Refresh projects to reload local files"
          : connection === "disconnected"
            ? "Showing recorded data while reconnecting"
            : "Recorded session data"}
      </p>
    </div>
  );
}

export default function Rail({
  refresh,
  refreshing,
  refreshError,
  onNavigate,
}: {
  refresh: () => void;
  refreshing: boolean;
  refreshError: string | null;
  onNavigate?: () => void;
}) {
  return (
    <aside className="rail" aria-label="Session rail">
      <div className="rail-head">
        <Brand />
        <ProjectSelector onNavigate={onNavigate} />
        <button
          className="refresh-button"
          disabled={refreshing}
          onClick={() => void refresh()}
        >
          {refreshing ? "Refreshing…" : "Refresh projects"}
        </button>
        {refreshError ? (
          <p role="alert" className="pane-message">
            {refreshError}
          </p>
        ) : null}
        <ProjectMetadata />
      </div>
      <div className="rail-scroll">
        <ThresholdSlider />
        <AttemptList onNavigate={onNavigate} />
      </div>
      <div className="rail-footer">
        <ConnectionState />
      </div>
    </aside>
  );
}
