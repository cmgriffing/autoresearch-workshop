import { useAtomValue, useSetAtom } from "jotai";
import {
  liveConnectionAtom,
  projectListAtom,
  projectListErrorAtom,
  selectedProjectIdAtom,
  selectProjectAtom,
} from "./state";

export default function ProjectPane({
  refresh,
  refreshing,
  refreshError,
  onNavigate,
  showConnection = true,
}: {
  refresh: () => void;
  refreshing: boolean;
  refreshError: string | null;
  onNavigate?: () => void;
  showConnection?: boolean;
}) {
  const list = useAtomValue(projectListAtom);
  const listError = useAtomValue(projectListErrorAtom);
  const connection = useAtomValue(liveConnectionAtom);
  const selectedProjectId = useAtomValue(selectedProjectIdAtom);
  const selectProject = useSetAtom(selectProjectAtom);
  const choose = (id: string) => {
    selectProject(id);
    onNavigate?.();
  };
  return (
    <aside className="project-pane" aria-label="Projects">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          a/
        </span>
        <span>
          autoresearch<span className="brand-sub">LOCAL SESSION REVIEW</span>
        </span>
      </div>
      <div className="nav-heading">
        Projects <span>{list?.projects.length ?? "—"}</span>
      </div>
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
      {list?.roots.map((root) => {
        const projects = list.projects.flatMap((project) => {
          const association = project.rootAssociations.find(
            (value) => value.rootId === root.id,
          );
          return association
            ? [{ project, relativePath: association.relativePath }]
            : [];
        });
        return (
          <section
            className="root-group"
            aria-label={`Root ${root.path}`}
            key={root.id}
          >
            <h2 className="root-heading" title={root.path}>
              {root.path}
            </h2>
            <p className="root-mode">
              {root.recursive ? "Recursive" : "Direct root"}
            </p>
            {projects.map(({ project, relativePath }) => (
              <button
                key={project.id}
                className="project-button"
                aria-label={`${project.name} · ${relativePath} · ${root.path}`}
                aria-pressed={project.id === selectedProjectId}
                onClick={() => choose(project.id)}
              >
                <span className="project-icon" aria-hidden="true">
                  ⌘
                </span>
                <span>
                  <strong>{project.name}</strong>
                  <small className="project-path">{relativePath}</small>
                  <small>
                    {project.stale
                      ? `${project.runCount} experiments · Stale data`
                      : project.sourceState === "missing"
                        ? "Uninitialized session"
                        : project.sourceState === "limited"
                          ? "Log exceeds size limit"
                          : project.sourceState === "error"
                            ? "Log unavailable"
                            : `${project.runCount} experiments`}
                  </small>
                </span>
              </button>
            ))}
            {root.state === "available" && projects.length === 0 ? (
              <p className="pane-message">No sessions found in this root.</p>
            ) : null}
            {root.diagnostics.map((diagnostic, index) => (
              <p
                className="pane-message root-diagnostic"
                role="status"
                key={index}
              >
                {diagnostic.message}
              </p>
            ))}
          </section>
        );
      })}
      {listError ? (
        <p role="alert" className="pane-message">
          {listError}
        </p>
      ) : !list ? (
        <p className="pane-message" role="status">
          Loading projects…
        </p>
      ) : list.projects.length === 0 ? (
        <p className="pane-message">
          No projects found. Configure roots containing .auto sessions, then
          refresh projects.
        </p>
      ) : null}
      {list?.diagnostics
        .filter((diagnostic) => !diagnostic.rootId)
        .map((diagnostic, index) => (
          <p className="pane-message" role="status" key={index}>
            {diagnostic.message}
          </p>
        ))}
      {showConnection ? (
        <div className="source-footer">
          <span
            className={`source-dot source-dot-${connection}`}
            aria-hidden="true"
          />
          <span role="status">
            {connection === "connected"
              ? "Live updates connected"
              : connection === "disconnected"
                ? "Live updates disconnected"
                : connection === "manual"
                  ? "Manual updates"
                  : "Connecting live updates"}
          </span>
          <p>
            {connection === "manual"
              ? "Use Refresh projects to reload local files"
              : connection === "disconnected"
                ? "Showing recorded data while reconnecting"
                : "Recorded session data"}
          </p>
        </div>
      ) : null}
    </aside>
  );
}
