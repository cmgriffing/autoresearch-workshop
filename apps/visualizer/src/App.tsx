import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  DiffResponseSchema,
  LiveEventSchema,
  ProjectSnapshotSchema,
  ProjectsResponseSchema,
  RefreshResponseSchema,
} from "visualizar-common";
import type { ProjectSnapshot, RunSnapshot } from "visualizar-common";
import { readApi } from "./api";
import {
  projectListAtom,
  projectListErrorAtom,
  projectReloadAtom,
  liveConnectionAtom,
  installProjectListAtom,
  installProjectSnapshotAtom,
  selectionNoticeAtom,
  projectErrorAtom,
  selectedProjectAtom,
  selectedProjectIdAtom,
  selectedSegmentIdAtom,
  selectedSegmentAtom,
  segmentRunsAtom,
  selectedRunIdAtom,
  selectedRunAtom,
  selectResultAtom,
  mainViewAtom,
  filteredWinsAtom,
  selectSegmentAtom,
  diffLoadAtom,
  selectedDiffAtom,
  diffComparisonAtom,
  includeAutoAtom,
  diffRequestKey,
} from "./state";
import CompactNavigation from "./CompactNavigation";
import DiffPanel from "./DiffPanel";
import ProjectPane from "./ProjectPane";
import RunDetails from "./RunDetails";
import WinsPane from "./WinsPane";
import { useMediaQuery } from "./useMediaQuery";

const CurrentNotes = lazy(() => import("./CurrentNotes"));
const AttemptChart = lazy(() => import("./AttemptChart"));
const LIVE_CONNECTION_TIMEOUT_MS = 12_000;

const statusText = (status: RunSnapshot["status"]) =>
  ({
    keep: "Kept",
    discard: "Discarded",
    crash: "Crashed",
    checks_failed: "Checks failed",
  })[status];
function Status({ status }: { status: RunSnapshot["status"] }) {
  return (
    <span className={`status status-${status}`}>{statusText(status)}</span>
  );
}

function useProjectData() {
  const setList = useSetAtom(installProjectListAtom);
  const setListError = useSetAtom(projectListErrorAtom);
  const projectId = useAtomValue(selectedProjectIdAtom);
  const setSnapshot = useSetAtom(installProjectSnapshotAtom);
  const setError = useSetAtom(projectErrorAtom);
  const [reload, setReload] = useAtom(projectReloadAtom);
  const list = useAtomValue(projectListAtom);
  const setConnection = useSetAtom(liveConnectionAtom);
  const indexRevision = useRef(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const refreshController = useRef<AbortController | null>(null);
  useEffect(() => () => refreshController.current?.abort(), []);
  useEffect(() => {
    indexRevision.current = list?.indexRevision ?? 0;
  }, [list?.indexRevision]);
  useEffect(() => {
    if (list?.watchEnabled === false) {
      setConnection("manual");
      return;
    }
    if (list?.watchEnabled !== true) return;
    setConnection("connecting");
    let lastMessageAt = Date.now();
    let disposed = false;
    let events: EventSource | null = null;
    let reconnectTimer: number | null = null;
    const reconnect = () => {
      if (disposed || reconnectTimer !== null) return;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 1_000);
    };
    const connect = () => {
      if (disposed) return;
      const source = new EventSource("/api/events");
      events = source;
      source.onopen = () => {
        lastMessageAt = Date.now();
        setConnection("connected");
        setReload((value) => value + 1);
      };
      source.onmessage = (message) => {
        try {
          const event = LiveEventSchema.parse(JSON.parse(message.data));
          lastMessageAt = Date.now();
          setConnection("connected");
          if (
            event.type === "invalidate" &&
            event.indexRevision > indexRevision.current
          )
            setReload((value) => value + 1);
        } catch {
          // Ignore malformed third-party/proxy data; typed API refetches remain authoritative.
        }
      };
      source.onerror = () => {
        if (events === source) events = null;
        source.close();
        setConnection("disconnected");
        reconnect();
      };
    };
    connect();
    const watchdog = window.setInterval(() => {
      if (Date.now() - lastMessageAt > LIVE_CONNECTION_TIMEOUT_MS) {
        setConnection("disconnected");
        events?.close();
        events = null;
        reconnect();
      }
    }, 1_000);
    return () => {
      disposed = true;
      window.clearInterval(watchdog);
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      events?.close();
    };
  }, [list?.watchEnabled, setConnection, setReload]);
  async function refresh() {
    if (refreshController.current) return;
    const controller = new AbortController();
    refreshController.current = controller;
    setRefreshing(true);
    setRefreshError(null);
    try {
      await readApi("/api/refresh", RefreshResponseSchema, controller.signal, {
        method: "POST",
      });
      if (!controller.signal.aborted) setReload((value) => value + 1);
    } catch (error) {
      if (!controller.signal.aborted)
        setRefreshError(
          error instanceof Error ? error.message : "Cannot refresh projects.",
        );
    } finally {
      refreshController.current = null;
      if (!controller.signal.aborted) setRefreshing(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void readApi("/api/projects", ProjectsResponseSchema, controller.signal)
      .then((list) => {
        if (controller.signal.aborted) return;
        setList(list);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setListError(
            error instanceof Error ? error.message : "Cannot load projects.",
          );
      });
    return () => controller.abort();
  }, [reload, setList, setListError]);
  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    void readApi(
      `/api/projects/${encodeURIComponent(projectId)}`,
      ProjectSnapshotSchema,
      controller.signal,
    )
      .then((snapshot) => {
        if (!controller.signal.aborted) setSnapshot(snapshot);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : "Cannot load this project.",
          );
      });
    return () => controller.abort();
  }, [projectId, reload, setSnapshot, setError]);
  return { refresh, refreshing, refreshError };
}

function useSelectedDiff(
  snapshot: ProjectSnapshot | null,
  run: RunSnapshot | null,
) {
  const setDiff = useSetAtom(diffLoadAtom);
  const comparison = useAtomValue(diffComparisonAtom);
  const includeAuto = useAtomValue(includeAutoAtom);
  useEffect(() => {
    if (!snapshot || !run) {
      setDiff(null);
      return;
    }
    const controller = new AbortController();
    const key = diffRequestKey(
      snapshot.project.id,
      run.id,
      snapshot.project.revision,
      comparison,
      includeAuto,
    );
    setDiff({ key, status: "loading" });
    const path = `/api/projects/${encodeURIComponent(snapshot.project.id)}/runs/${encodeURIComponent(run.id)}/diff?revision=${encodeURIComponent(snapshot.project.revision)}&comparison=${comparison}&includeAuto=${includeAuto}`;
    void readApi(path, DiffResponseSchema, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted)
          setDiff({ key, status: "loaded", value });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setDiff({
            key,
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "Cannot load this historical diff.",
          });
      });
    return () => controller.abort();
  }, [run, setDiff, snapshot, comparison, includeAuto]);
}

export function App() {
  const { refresh, refreshing, refreshError } = useProjectData();
  const list = useAtomValue(projectListAtom);
  const connection = useAtomValue(liveConnectionAtom);
  const narrow = useMediaQuery("(max-width: 960px)");
  const snapshot = useAtomValue(selectedProjectAtom);
  const segmentId = useAtomValue(selectedSegmentIdAtom);
  const selectionNotice = useAtomValue(selectionNoticeAtom);
  const segment = useAtomValue(selectedSegmentAtom);
  const segmentRuns = useAtomValue(segmentRunsAtom);
  const filteredWins = useAtomValue(filteredWinsAtom);
  const selectSegment = useSetAtom(selectSegmentAtom);
  const runId = useAtomValue(selectedRunIdAtom);
  const selectResult = useSetAtom(selectResultAtom);
  const [mainView, setMainView] = useAtom(mainViewAtom);
  const run = useAtomValue(selectedRunAtom);
  useSelectedDiff(snapshot, run);
  const diff = useAtomValue(selectedDiffAtom);
  const metric = segment ?? snapshot?.metricConfig;
  const formatPercentage = (value: number | null) =>
    value === null ? "Unavailable" : `${value.toFixed(2)}%`;
  return (
    <div className={narrow ? "app-shell app-shell-narrow" : "app-shell"}>
      <a href="#review" className="skip-link">
        Skip to result review
      </a>
      {narrow ? (
        <CompactNavigation
          projectsCount={list?.projects.length ?? 0}
          winsCount={filteredWins.length}
          connection={connection}
          renderProjects={(close) => (
            <ProjectPane
              refresh={refresh}
              refreshing={refreshing}
              refreshError={refreshError}
              onNavigate={close}
              showConnection={false}
            />
          )}
          renderWins={(close) => <WinsPane onNavigate={close} />}
        />
      ) : (
        <>
          <ProjectPane
            refresh={refresh}
            refreshing={refreshing}
            refreshError={refreshError}
          />
          <WinsPane />
        </>
      )}
      <main id="review" tabIndex={-1} className="review-pane">
        <header className="review-header">
          <p className="eyebrow">
            PROJECT / {snapshot?.project.name ?? "SELECT A PROJECT"}
          </p>
          <span className="file-label">
            .auto / {mainView === "results" ? "log.jsonl" : `${mainView}.md`}
          </span>
        </header>
        <div className="review-content">
          <div className="session-title">
            <p className="eyebrow">EXPERIMENT NOTEBOOK</p>
            <h1>{metric?.name ?? "Review a local session"}</h1>
            <p>
              {metric
                ? `${metric.metricName} · ${metric.bestDirection === "lower" ? "Lower" : "Higher"} is better`
                : "Choose a project and an experiment to inspect its recorded result."}
            </p>
          </div>
          {selectionNotice ? (
            <p className="diagnostic" role="status">
              {selectionNotice}
            </p>
          ) : null}
          {snapshot?.project.stale ? (
            <p className="diagnostic" role="status">
              Stale data: showing the last successfully read project data.
              Updates resume when the source or root recovers.
            </p>
          ) : snapshot?.project.sourceState === "missing" ? (
            <p className="diagnostic" role="status">
              Uninitialized session. No log.jsonl has been recorded; refresh
              after the first experiment.
            </p>
          ) : null}
          {snapshot ? (
            <nav className="view-navigation" aria-label="Project views">
              <button
                aria-pressed={mainView === "results"}
                onClick={() => setMainView("results")}
                aria-controls="result-review"
              >
                Review results
              </button>
              <button
                aria-pressed={mainView === "ideas"}
                onClick={() => setMainView("ideas")}
                aria-controls="current-notes"
              >
                Current ideas
              </button>
              <button
                aria-pressed={mainView === "prompt"}
                onClick={() => setMainView("prompt")}
                aria-controls="current-notes"
              >
                Current prompt
              </button>
            </nav>
          ) : null}
          <div id="current-notes" hidden={mainView === "results"}>
            {snapshot && mainView !== "results" ? (
              <Suspense fallback={<p role="status">Loading document view…</p>}>
                <CurrentNotes
                  name={mainView}
                  document={snapshot.documents[mainView]}
                  projectName={snapshot.project.name}
                />
              </Suspense>
            ) : null}
          </div>
          <div id="result-review" hidden={mainView !== "results"}>
            {snapshot && snapshot.segments.length > 0 ? (
              <section className="segment-summary" aria-label="Metric segment">
                <label>
                  Metric segment
                  <select
                    value={segmentId ?? ""}
                    onChange={(event) => selectSegment(event.target.value)}
                  >
                    {snapshot.segments.map((value) => (
                      <option value={value.id} key={value.id}>
                        {value.name} · {value.metricName}
                      </option>
                    ))}
                  </select>
                </label>
                {segment ? (
                  <dl>
                    <div>
                      <dt>Direction</dt>
                      <dd>
                        {segment.bestDirection === "lower" ? "Lower" : "Higher"}
                        {" is better"}
                      </dd>
                    </div>
                    <div>
                      <dt>First kept baseline</dt>
                      <dd className="mono">
                        {segment.baselineMetric ?? "Unavailable"}{" "}
                        {segment.metricUnit}
                      </dd>
                    </div>
                    <div>
                      <dt>Best</dt>
                      <dd className="mono">
                        {segment.bestMetric ?? "Unavailable"}{" "}
                        {segment.metricUnit}
                      </dd>
                    </div>
                    <div>
                      <dt>Cumulative improvement</dt>
                      <dd>
                        {formatPercentage(
                          segment.cumulativeImprovement?.percentage ?? null,
                        )}
                      </dd>
                    </div>
                  </dl>
                ) : null}
              </section>
            ) : null}
            {snapshot?.project.diagnostics.map((diagnostic, index) => (
              <p className="diagnostic" role="status" key={index}>
                {diagnostic.sourceLine ? `Line ${diagnostic.sourceLine}: ` : ""}
                {diagnostic.message}
              </p>
            ))}
            {segment && mainView === "results" ? (
              <Suspense
                fallback={
                  <p className="chart-loading" role="status">
                    Loading metric trajectory…
                  </p>
                }
              >
                <AttemptChart segment={segment} />
              </Suspense>
            ) : null}
            {run ? (
              <>
                <section
                  className="result-card"
                  aria-label="Selected experiment"
                >
                  <div className="result-heading">
                    <h2>Experiment {String(run.run).padStart(2, "0")}</h2>
                    <Status status={run.status} />
                  </div>
                  <p className="eyebrow">RECORDED {metric?.metricName}</p>
                  <p className="metric-value" data-testid="selected-metric">
                    {run.metric}
                    <span>{metric?.metricUnit}</span>
                  </p>
                  <div className="description">
                    <h3>Description</h3>
                    <p>{run.description || "No description recorded."}</p>
                  </div>
                  <dl className="result-meta">
                    <div>
                      <dt>Recorded commit</dt>
                      <dd className="mono">{run.commit || "Not recorded"}</dd>
                    </div>
                    <div>
                      <dt>Source line</dt>
                      <dd>{run.sourceLine}</dd>
                    </div>
                  </dl>
                  <RunDetails run={run} segment={segment} />
                </section>
                <DiffPanel diff={diff} />
              </>
            ) : (
              <div className="selection-empty">
                <span aria-hidden="true">↖</span>
                <h2>
                  {snapshot?.runs.length === 0
                    ? "No experiments available"
                    : "Select an experiment"}
                </h2>
                <p>
                  {snapshot?.runs.length === 0
                    ? "Review the source diagnostics and refresh when results are available."
                    : "Inspect its metric, decision, and recorded description."}
                </p>
              </div>
            )}
            {snapshot && segmentRuns.length > 0 ? (
              <section
                className="history-section"
                aria-labelledby="history-title"
              >
                <div className="history-heading">
                  <h2 id="history-title">Full history</h2>
                  <span>{segmentRuns.length} attempts in this segment</span>
                </div>
                <div className="history-scroll">
                  <table>
                    <caption className="sr-only">
                      Every valid experiment in recorded source order
                    </caption>
                    <thead>
                      <tr>
                        <th>Experiment</th>
                        <th>
                          {metric?.metricName}
                          {metric?.metricUnit ? ` (${metric.metricUnit})` : ""}
                        </th>
                        <th>Decision</th>
                        <th>Metric result</th>
                        <th>Best kept so far</th>
                        <th>Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {segmentRuns.map((result, index) => (
                        <tr
                          key={result.id}
                          className={result.id === runId ? "selected-row" : ""}
                        >
                          <td>
                            <button
                              aria-label={`Select experiment ${result.run} from history`}
                              aria-pressed={result.id === runId}
                              onClick={() => selectResult(result.id)}
                            >
                              {String(result.run).padStart(2, "0")}{" "}
                              <span aria-hidden="true">↗</span>
                            </button>
                          </td>
                          <td className="mono">{result.metric}</td>
                          <td>
                            <Status status={result.status} />
                          </td>
                          <td>
                            {segment?.attempts[index]?.isBaseline
                              ? "First kept baseline"
                              : segment?.attempts[index]?.isWin
                                ? "New best"
                                : result.status === "keep"
                                  ? "Kept"
                                  : result.status === "discard"
                                    ? "Discarded"
                                    : "Failed · not plotted"}
                          </td>
                          <td className="mono">
                            {segment?.attempts[index]?.bestMetric ??
                              "Unavailable"}
                          </td>
                          <td>
                            {result.description || "No description recorded."}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}
          </div>
          {snapshot ? (
            <footer className="review-footer">
              Read from {snapshot.project.rootPath}
              <span>
                Source revision {snapshot.project.revision.slice(2, 10)}
              </span>
            </footer>
          ) : null}
        </div>
      </main>
    </div>
  );
}
