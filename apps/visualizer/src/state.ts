import { atom } from "jotai";
import type {
  DiffComparison,
  DiffResponse,
  ProjectSnapshot,
  ProjectsResponse,
} from "visualizar-common";

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
export const segmentRunsAtom = atom((get) => {
  const project = get(selectedProjectAtom);
  const segment = get(selectedSegmentAtom);
  if (!project || !segment) return [];
  const runIds = new Set(segment.runIds);
  return project.runs.filter((run) => runIds.has(run.id));
});
export const filteredWinsAtom = atom((get) => {
  const segment = get(selectedSegmentAtom);
  const project = get(selectedProjectAtom);
  if (!segment || !project) return [];
  const threshold = get(winThresholdAtom) ?? project.minWinImprovementPct;
  return segment.wins.filter(
    (win) =>
      threshold === 0 ||
      (win.incremental.percentage !== null &&
        win.incremental.percentage >= threshold),
  );
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
