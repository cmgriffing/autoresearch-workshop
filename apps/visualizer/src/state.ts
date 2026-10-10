import { atom } from "jotai";
import type {
  DiffComparison,
  DiffResponse,
  ProjectSnapshot,
  ProjectsResponse,
} from "visualizar-common";
import {
  attemptDecision,
  buildThresholdStops,
  nearestStopIndex,
  winPassesThreshold,
} from "./attempts";
import type { AttemptRow } from "./attempts";

export const projectListAtom = atom<ProjectsResponse | null>(null);
export const projectListErrorAtom = atom<string | null>(null);
export const projectReloadAtom = atom(0);
export type LiveConnection =
  "connecting" | "connected" | "disconnected" | "manual";
export const liveConnectionAtom = atom<LiveConnection>("connecting");
export const selectionNoticeAtom = atom<string | null>(null);
export const selectedProjectIdAtom = atom<string | null>(null);
export const projectSnapshotAtom = atom<ProjectSnapshot | null>(null);
export const projectErrorAtom = atom<string | null>(null);
export const selectedSegmentIdAtom = atom<string | null>(null);
export const selectedRunIdAtom = atom<string | null>(null);
export const mainViewAtom = atom<"results" | "ideas" | "prompt">("results");
export const selectResultAtom = atom(null, (_get, set, id: string) => {
  set(selectedRunIdAtom, id);
  set(mainViewAtom, "results");
});
export const winThresholdAtom = atom<number | null>(null);
export type AttemptScope = "all" | "wins" | "failed";
export const attemptScopeAtom = atom<AttemptScope>("all");
export const diffComparisonAtom = atom<DiffComparison>("parent");
export const includeAutoAtom = atom(false);
export const diffPresentationAtom = atom<"unified" | "split">("unified");
export const selectedDiffFileAtom = atom<{ key: string; path: string } | null>(
  null,
);
export const diffRequestKey = (
  projectId: string,
  runId: string,
  revision: string,
  comparison: DiffComparison,
  includeAuto: boolean,
) => `${projectId}:${runId}:${revision}:${comparison}:${includeAuto}`;
export type DiffLoadState =
  | { key: string; status: "loading" }
  | { key: string; status: "loaded"; value: DiffResponse }
  | { key: string; status: "error"; message: string };
export const diffLoadAtom = atom<DiffLoadState | null>(null);
export const selectedProjectAtom = atom((get) => {
  const snapshot = get(projectSnapshotAtom);
  return snapshot?.project.id === get(selectedProjectIdAtom) ? snapshot : null;
});
export const selectedRunAtom = atom(
  (get) =>
    get(selectedProjectAtom)?.runs.find(
      (run) => run.id === get(selectedRunIdAtom),
    ) ?? null,
);
export const selectedSegmentAtom = atom((get) => {
  const project = get(selectedProjectAtom);
  const segmentId = get(selectedSegmentIdAtom);
  return project?.segments.find((segment) => segment.id === segmentId) ?? null;
});
export const thresholdValueAtom = atom((get) => {
  const project = get(selectedProjectAtom);
  return get(winThresholdAtom) ?? project?.minWinImprovementPct ?? 0;
});
export const attemptRowsAtom = atom<AttemptRow[]>((get) => {
  const project = get(selectedProjectAtom);
  const segment = get(selectedSegmentAtom);
  if (!project || !segment) return [];
  const runsById = new Map(project.runs.map((run) => [run.id, run]));
  const winsById = new Map(segment.wins.map((win) => [win.runId, win]));
  return segment.attempts.flatMap((point) => {
    const run = runsById.get(point.runId);
    return run
      ? [
          {
            point,
            run,
            decision: attemptDecision(point),
            win: winsById.get(point.runId) ?? null,
          },
        ]
      : [];
  });
});
export const attemptCountsAtom = atom((get) => {
  const rows = get(attemptRowsAtom);
  const wins = rows.filter((row) => row.decision === "win").length;
  const baseline = rows.filter((row) => row.decision === "baseline").length;
  return {
    all: rows.length,
    wins,
    baseline,
    failed: rows.filter((row) => row.decision === "failed").length,
  };
});
export const visibleAttemptRowsAtom = atom<AttemptRow[]>((get) => {
  const rows = get(attemptRowsAtom);
  const scope = get(attemptScopeAtom);
  const threshold = get(thresholdValueAtom);
  return rows.filter((row) => {
    const passes = !row.point.isWin || winPassesThreshold(row.win, threshold);
    switch (scope) {
      case "wins":
        return (
          row.decision === "baseline" || (row.decision === "win" && passes)
        );
      case "failed":
        return row.decision === "failed";
      default:
        return passes;
    }
  });
});
export const filterReadoutAtom = atom((get) => {
  const rows = get(attemptRowsAtom);
  const threshold = get(thresholdValueAtom);
  const wins = rows.filter((row) => row.decision === "win");
  return {
    threshold,
    winsPassing: wins.filter((row) => winPassesThreshold(row.win, threshold))
      .length,
    winsTotal: wins.length,
    listed: get(visibleAttemptRowsAtom).length,
    total: rows.length,
  };
});
export const selectedAttemptOutsideFilterAtom = atom((get) => {
  const runId = get(selectedRunIdAtom);
  if (!runId) return false;
  const rows = get(attemptRowsAtom);
  if (!rows.some((row) => row.run.id === runId)) return false;
  return !get(visibleAttemptRowsAtom).some((row) => row.run.id === runId);
});
export const thresholdStopsAtom = atom((get) => {
  const project = get(selectedProjectAtom);
  const segment = get(selectedSegmentAtom);
  if (!segment) return null;
  const configured = project?.minWinImprovementPct ?? 0;
  const percentages = segment.wins.flatMap((win) =>
    win.incremental.percentage === null ? [] : [win.incremental.percentage],
  );
  if (percentages.length === 0)
    return {
      stops: [0],
      measured: false,
      hasWins: segment.wins.length > 0,
      configured,
    };
  return {
    stops: buildThresholdStops(Math.max(...percentages), configured),
    measured: true,
    hasWins: true,
    configured,
  };
});
export const thresholdStopIndexAtom = atom((get) => {
  const stops = get(thresholdStopsAtom);
  if (!stops) return 0;
  return nearestStopIndex(stops.stops, get(thresholdValueAtom));
});
export const selectedDiffAtom = atom((get) => {
  const project = get(selectedProjectAtom);
  const run = get(selectedRunAtom);
  const diff = get(diffLoadAtom);
  if (!project || !run || !diff) return null;
  const key = diffRequestKey(
    project.project.id,
    run.id,
    project.project.revision,
    get(diffComparisonAtom),
    get(includeAutoAtom),
  );
  return diff.key === key ? diff : null;
});
export const selectProjectAtom = atom(null, (get, set, id: string | null) => {
  if (get(selectedProjectIdAtom) === id) return;
  set(selectedProjectIdAtom, id);
  set(selectedSegmentIdAtom, null);
  set(selectedRunIdAtom, null);
  set(winThresholdAtom, null);
  set(attemptScopeAtom, "all");
  set(projectSnapshotAtom, null);
  set(projectErrorAtom, null);
  set(diffLoadAtom, null);
  set(selectionNoticeAtom, null);
});
export const installProjectListAtom = atom(
  null,
  (get, set, list: ProjectsResponse) => {
    set(projectListAtom, list);
    set(projectListErrorAtom, null);
    const current = get(selectedProjectIdAtom);
    if (!list.projects.some((project) => project.id === current)) {
      set(selectProjectAtom, list.projects[0]?.id ?? null);
      if (current)
        set(
          selectionNoticeAtom,
          "The selected project is no longer discovered. Choose an available project.",
        );
    }
  },
);
export const installProjectSnapshotAtom = atom(
  null,
  (get, set, snapshot: ProjectSnapshot) => {
    if (get(selectedProjectIdAtom) !== snapshot.project.id) return;
    set(projectSnapshotAtom, snapshot);
    set(projectErrorAtom, null);
    const segmentId = get(selectedSegmentIdAtom);
    if (!snapshot.segments.some((segment) => segment.id === segmentId))
      set(selectedSegmentIdAtom, snapshot.segments[0]?.id ?? null);
    if (get(winThresholdAtom) === null)
      set(winThresholdAtom, snapshot.minWinImprovementPct);
    const runId = get(selectedRunIdAtom);
    if (runId && !snapshot.runs.some((run) => run.id === runId)) {
      set(selectedRunIdAtom, null);
      set(diffLoadAtom, null);
      set(
        selectionNoticeAtom,
        "The selected experiment is no longer in this source. Select another experiment.",
      );
    }
  },
);
export const selectSegmentAtom = atom(null, (get, set, id: string) => {
  if (get(selectedSegmentIdAtom) === id) return;
  set(selectedSegmentIdAtom, id);
  const project = get(selectedProjectAtom);
  const selectedRunId = get(selectedRunIdAtom);
  const segment = project?.segments.find((value) => value.id === id);
  if (selectedRunId && !segment?.runIds.includes(selectedRunId)) {
    set(selectedRunIdAtom, null);
    set(diffLoadAtom, null);
  }
});
