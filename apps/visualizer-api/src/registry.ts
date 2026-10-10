import { createHash } from "node:crypto";
import { watch } from "node:fs";
import type { Dirent, FSWatcher } from "node:fs";
import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import {
  calculateSegment,
  parseExperimentLog,
  ProjectSnapshotSchema,
  ProjectsResponseSchema,
} from "visualizar-common";
import type {
  Diagnostic,
  LiveEvent,
  ProjectSnapshot,
  RootAssociation,
  RootSummary,
} from "visualizar-common";
import { loadConfig } from "./config.ts";
import {
  readCurrentDocument,
  readLogSource,
  SourceReadError,
} from "./source.ts";

// Per root, per pass; iterative traversal also avoids a call-stack depth limit.
export const MAX_DISCOVERY_DIRECTORIES = 10_000;
export const WATCH_DEBOUNCE_MS = 75;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

async function readProject(
  path: string,
  root: RootSummary,
  associations: RootAssociation[],
  minWinImprovementPct: number,
  maxLogBytes: number,
  maxDocumentBytes: number,
  previous?: ProjectSnapshot,
) {
  const id = `p_${hash(path)}`;
  const [ideas, prompt] = await Promise.all([
    readCurrentDocument(
      join(path, ".auto", "ideas.md"),
      "ideas.md",
      maxDocumentBytes,
    ),
    readCurrentDocument(
      join(path, ".auto", "prompt.md"),
      "prompt.md",
      maxDocumentBytes,
    ),
  ]);
  const documents = { ideas, prompt };
  const revision = (logRevision: string) =>
    `s_${hash(JSON.stringify([logRevision, documents]))}`;
  let source = "";
  let sourceState: ProjectSnapshot["project"]["sourceState"] = "ready";
  const metadata = {
    id,
    name: basename(path),
    relativePath: associations[0].relativePath,
    rootPath: root.path,
    rootAssociations: associations,
    documentStates: { ideas: ideas.state, prompt: prompt.state },
  };
  const diagnostics: Diagnostic[] = [];
  try {
    source = await readLogSource(join(path, ".auto", "log.jsonl"), maxLogBytes);
  } catch (error) {
    if (!(error instanceof SourceReadError)) throw error;
    sourceState = error.state;
    diagnostics.push({
      code: error.code,
      message:
        sourceState === "missing" &&
        !previous?.project.stale &&
        previous?.project.sourceState !== "ready"
          ? "Uninitialized session: this project has no log.jsonl yet."
          : error.message,
      directory: path,
    });
    if (
      previous &&
      (previous.project.sourceState === "ready" || previous.project.stale)
    )
      return ProjectSnapshotSchema.parse({
        ...previous,
        documents,
        project: {
          ...previous.project,
          ...metadata,
          revision: revision(previous.logRevision),
          sourceState,
          stale: true,
          diagnostics: [
            ...previous.project.diagnostics.filter(
              (diagnostic) => diagnostic.sourceLine,
            ),
            ...diagnostics,
          ],
        },
      });
  }
  if (sourceState === "ready" && !source.trim())
    diagnostics.push({
      code: "EMPTY_LOG",
      message: "log.jsonl is empty; no experiments have been recorded.",
      directory: path,
    });
  const parsed = parseExperimentLog(source);
  const segmentIds = parsed.segments.map(
    (segment) => `g_${hash(`${id}\0${segment.index}`)}`,
  );
  const runs = parsed.records.map(
    ({ record, sourceLine, sourceText, segmentIndex }) => ({
      ...record,
      sourceLine,
      id: `r_${hash(`${id}\0${sourceLine}\0${sourceText}`)}`,
      segmentId: segmentIds[segmentIndex],
    }),
  );
  const segments = parsed.segments.map((segment, index) => {
    const id = segmentIds[index];
    return calculateSegment(
      { ...segment, id },
      runs.filter((run) => run.segmentId === id),
    );
  });
  return ProjectSnapshotSchema.parse({
    project: {
      ...metadata,
      revision: revision(`s_${hash(`${sourceState}\0${source}`)}`),
      sourceState,
      stale: false,
      runCount: runs.length,
      diagnostics: [...diagnostics, ...parsed.diagnostics],
    },
    logRevision: `s_${hash(`${sourceState}\0${source}`)}`,
    documents,
    metricConfig: segments[0]
      ? {
          name: segments[0].name,
          metricName: segments[0].metricName,
          metricUnit: segments[0].metricUnit,
          bestDirection: segments[0].bestDirection,
        }
      : null,
    minWinImprovementPct,
    segments,
    runs,
  });
}

export type RegistryOptions = {
  watchDirectory?: typeof watch;
  scanDirectory?: (path: string) => Promise<Dirent[]>;
};

export async function createRegistry(
  configPath: string,
  options: RegistryOptions = {},
) {
  const { config, roots: configuredRoots } = await loadConfig(configPath);
  const excluded = new Set([...config.exclude, ".auto"]);
  const watchDirectory = options.watchDirectory ?? watch;
  const scanDirectory =
    options.scanDirectory ??
    ((path: string) => readdir(path, { withFileTypes: true }));
  const sourceSignatures = new Map<string, string>();
  const signature = async (path: string) =>
    JSON.stringify(
      await Promise.all(
        ["log.jsonl", "ideas.md", "prompt.md"].map(async (name) => {
          try {
            const value = await stat(join(path, ".auto", name), {
              bigint: true,
            });
            return [
              value.dev,
              value.ino,
              value.mode,
              value.size,
              value.mtimeNs,
              value.ctimeNs,
            ].map(String);
          } catch (error) {
            return (error as NodeJS.ErrnoException).code ?? "error";
          }
        }),
      ),
    );
  const loadProject = async (
    path: string,
    root: RootSummary,
    associations: RootAssociation[],
    previous?: ProjectSnapshot,
    changedOnly = false,
  ) => {
    const before = await signature(path);
    const reusable =
      previous &&
      !previous.project.stale &&
      previous.project.sourceState !== "error" &&
      !Object.values(previous.documents).some(
        (document) => document.state === "error",
      );
    if (changedOnly && reusable && sourceSignatures.get(path) === before)
      return ProjectSnapshotSchema.parse({
        ...previous,
        project: {
          ...previous.project,
          rootAssociations: associations,
          rootPath: root.path,
          relativePath: associations[0].relativePath,
        },
      });
    const snapshot = await readProject(
      path,
      root,
      associations,
      config.minWinImprovementPct,
      config.maxLogBytes,
      config.maxDocumentBytes,
      previous,
    );
    // Never cache a signature from a file that changed while its snapshot loaded.
    if (before === (await signature(path))) sourceSignatures.set(path, before);
    else sourceSignatures.delete(path);
    return snapshot;
  };

  async function discover(
    indexRevision: number,
    previousProjects = new Map<string, ProjectSnapshot>(),
    changedOnly = false,
  ) {
    const roots: RootSummary[] = [];
    const discovered = new Map<string, RootAssociation[]>();
    for (const [index, configuredRoot] of configuredRoots.entries()) {
      const root: RootSummary = {
        id: `d_${hash(`${index}\0${configuredRoot.path}`)}`,
        path: configuredRoot.path,
        recursive: configuredRoot.recursive,
        state: "available",
        diagnostics: [],
      };
      roots.push(root);
      const diagnose = (code: string, directory: string, message: string) => {
        root.state = "error";
        root.diagnostics.push({ code, message, rootId: root.id, directory });
      };
      try {
        root.canonicalPath = await realpath(root.path);
        if (!(await stat(root.canonicalPath)).isDirectory())
          throw new Error("Root is not a directory");
      } catch (error) {
        root.state = "error";
        diagnose(
          "ROOT_UNAVAILABLE",
          root.path,
          `Cannot open root ${root.path}: ${error instanceof Error ? error.message : error}`,
        );
        continue;
      }
      const pending = [root.canonicalPath];
      let visited = 0;
      while (pending.length) {
        if (visited++ >= MAX_DISCOVERY_DIRECTORIES) {
          diagnose(
            "DISCOVERY_LIMIT",
            root.path,
            `Discovery stopped after ${MAX_DISCOVERY_DIRECTORIES} directories. Narrow this root or add exclusions; the project list is incomplete.`,
          );
          break;
        }
        const directory = pending.pop()!;
        try {
          // lstat deliberately rejects descendant symlinks, including .auto.
          if ((await lstat(join(directory, ".auto"))).isDirectory()) {
            const path = await realpath(directory);
            const associations = discovered.get(path) ?? [];
            associations.push({
              rootId: root.id,
              relativePath: relative(root.canonicalPath, path) || ".",
            });
            discovered.set(path, associations);
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT")
            diagnose(
              "SESSION_UNAVAILABLE",
              directory,
              `Cannot inspect .auto in ${directory}.`,
            );
        }
        if (!root.recursive) continue;
        try {
          const entries = await scanDirectory(directory);
          const children = entries
            .filter((entry) => entry.isDirectory() && !excluded.has(entry.name))
            .map((entry) => entry.name)
            .sort();
          for (const name of children.reverse())
            pending.push(join(directory, name));
        } catch (error) {
          if (directory === root.canonicalPath) root.state = "error";
          diagnose(
            "DIRECTORY_UNAVAILABLE",
            directory,
            `Cannot scan directory ${directory}: ${error instanceof Error ? error.message : error}`,
          );
        }
      }
    }
    const projects = new Map<string, ProjectSnapshot>();
    const projectPaths = new Map<string, string>();
    const rootsById = new Map(roots.map((root) => [root.id, root]));
    // An incomplete root pass cannot prove absence, including descendant errors
    // and traversal limits. Keep its known associations until a complete pass.
    for (const previous of previousProjects.values()) {
      const path = current.projectPaths.get(previous.project.id)!;
      const failedAssociations = previous.project.rootAssociations.filter(
        (association) => rootsById.get(association.rootId)?.state === "error",
      );
      const associations = discovered.get(path);
      if (associations) {
        for (const association of failedAssociations)
          if (
            !associations.some((value) => value.rootId === association.rootId)
          )
            associations.push(association);
      } else if (failedAssociations.length) {
        const firstRoot = rootsById.get(failedAssociations[0].rootId)!;
        const snapshot = ProjectSnapshotSchema.parse({
          ...previous,
          project: {
            ...previous.project,
            rootAssociations: failedAssociations,
            rootPath: firstRoot.path,
            relativePath: failedAssociations[0].relativePath,
            stale: true,
            diagnostics: [
              ...previous.project.diagnostics.filter(
                (diagnostic) => diagnostic.code !== "ROOT_SCAN_FAILED",
              ),
              ...failedAssociations.map((association) => ({
                code: "ROOT_SCAN_FAILED",
                rootId: association.rootId,
                directory: path,
                message:
                  "Discovery could not confirm this session. Showing the last successfully read project data until its root can be scanned.",
              })),
            ],
          },
        });
        projects.set(snapshot.project.id, snapshot);
        projectPaths.set(snapshot.project.id, path);
      }
    }
    for (const [path, associations] of discovered) {
      const snapshot = await loadProject(
        path,
        rootsById.get(associations[0].rootId)!,
        associations,
        previousProjects.get(`p_${hash(path)}`),
        changedOnly,
      );
      projects.set(snapshot.project.id, snapshot);
      projectPaths.set(snapshot.project.id, path);
    }
    const list = ProjectsResponseSchema.parse({
      indexRevision,
      watchEnabled: config.watch,
      minWinImprovementPct: config.minWinImprovementPct,
      roots,
      projects: [...projects.values()].map((value) => value.project),
      diagnostics: roots.flatMap((root) => root.diagnostics),
    });
    return { list, projects, projectPaths };
  }

  let current = await discover(1);
  let inFlight: Promise<{ indexRevision: number }> | null = null;
  let mutationTail = Promise.resolve();
  let monitoring = false;
  let closed = false;
  const watchers = new Map<string, { watcher: FSWatcher; identity: string }>();
  const watchDiagnostics = new Map<string, Diagnostic>();
  let rescanTimer: NodeJS.Timeout | undefined;
  const debounceTimers = new Map<string, NodeJS.Timeout>();
  const listeners = new Set<(event: LiveEvent) => void>();

  const enqueue = <T>(operation: () => Promise<T>) => {
    const result = mutationTail.then(operation, operation);
    mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const publish = (event: LiveEvent) => {
    for (const listener of listeners) listener(event);
  };
  const changedProjects = (
    previous: Map<string, ProjectSnapshot>,
    next: Map<string, ProjectSnapshot>,
  ) =>
    [...next.values()]
      .filter(
        (snapshot) =>
          JSON.stringify(snapshot) !==
          JSON.stringify(previous.get(snapshot.project.id)),
      )
      .map((snapshot) => ({
        id: snapshot.project.id,
        revision: snapshot.project.revision,
        stale: snapshot.project.stale,
      }));
  const removedProjectIds = (
    previous: Map<string, ProjectSnapshot>,
    next: Map<string, ProjectSnapshot>,
  ) => [...previous.keys()].filter((id) => !next.has(id));
  const scheduleProject = (projectId: string) => {
    const existing = debounceTimers.get(projectId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      debounceTimers.delete(projectId);
      void reconcileProject(projectId).catch(() => {
        /* Periodic scan retries. */
      });
    }, WATCH_DEBOUNCE_MS);
    timer.unref();
    debounceTimers.set(projectId, timer);
  };
  const withWatchDiagnostics = (next: typeof current) => {
    const projects = new Map(
      [...next.projects].map(([id, snapshot]) => {
        const diagnostic = watchDiagnostics.get(id);
        return [
          id,
          ProjectSnapshotSchema.parse({
            ...snapshot,
            project: {
              ...snapshot.project,
              diagnostics: [
                ...snapshot.project.diagnostics.filter(
                  (value) => value.code !== "WATCH_UNAVAILABLE",
                ),
                ...(diagnostic ? [diagnostic] : []),
              ],
            },
          }),
        ] as const;
      }),
    );
    return {
      ...next,
      projects,
      list: ProjectsResponseSchema.parse({
        ...next.list,
        projects: [...projects.values()].map((snapshot) => snapshot.project),
      }),
    };
  };
  const watchFailed = (projectId: string, projectPath: string) => {
    watchDiagnostics.set(projectId, {
      code: "WATCH_UNAVAILABLE",
      directory: projectPath,
      message:
        "Session watcher unavailable; periodic reconciliation continues and retries monitoring.",
    });
  };
  const syncWatchers = async (next: typeof current) => {
    if (!monitoring || closed) return next;
    for (const [projectId, entry] of watchers)
      if (!next.projectPaths.has(projectId)) {
        watchers.delete(projectId);
        entry.watcher.close();
      }
    for (const projectId of watchDiagnostics.keys())
      if (!next.projectPaths.has(projectId)) watchDiagnostics.delete(projectId);
    for (const [projectId, projectPath] of next.projectPaths) {
      try {
        const session = await lstat(join(projectPath, ".auto"));
        if (closed) return next;
        if (!session.isDirectory())
          throw new Error("Session is not a directory");
        const identity = `${session.dev}:${session.ino}`;
        const existing = watchers.get(projectId);
        if (existing?.identity === identity) continue;
        if (existing) {
          watchers.delete(projectId);
          existing.watcher.close();
        }
        const watcher = watchDirectory(
          join(projectPath, ".auto"),
          { persistent: false },
          (_event, filename) => {
            const name = filename?.toString();
            if (!name || ["log.jsonl", "ideas.md", "prompt.md"].includes(name))
              scheduleProject(projectId);
          },
        );
        watchers.set(projectId, { watcher, identity });
        watchDiagnostics.delete(projectId);
        const failed = () => {
          if (closed || watchers.get(projectId)?.watcher !== watcher) return;
          watchers.delete(projectId);
          watcher.close();
          watchFailed(projectId, projectPath);
          void enqueue(async () => {
            if (closed) return;
            await install(
              {
                ...current,
                list: {
                  ...current.list,
                  indexRevision: current.list.indexRevision + 1,
                },
              },
              "discovery",
              false,
            );
          }).catch(() => {});
        };
        watcher.on("error", failed);
        watcher.on("close", failed);
      } catch {
        const existing = watchers.get(projectId);
        watchers.delete(projectId);
        existing?.watcher.close();
        watchFailed(projectId, projectPath);
      }
    }
    return withWatchDiagnostics(next);
  };
  const install = async (
    next: typeof current,
    reason: Extract<LiveEvent, { type: "invalidate" }>["reason"],
    retryWatchers = true,
  ) => {
    const previous = current;
    next = retryWatchers
      ? await syncWatchers(next)
      : withWatchDiagnostics(next);
    if (closed) return;
    current = next;
    const retainedPaths = new Set(next.projectPaths.values());
    for (const path of sourceSignatures.keys())
      if (!retainedPaths.has(path)) sourceSignatures.delete(path);
    for (const [projectId, timer] of debounceTimers)
      if (!next.projects.has(projectId)) {
        clearTimeout(timer);
        debounceTimers.delete(projectId);
      }
    publish({
      type: "invalidate",
      reason,
      indexRevision: next.list.indexRevision,
      projects: changedProjects(previous.projects, next.projects),
      removedProjectIds: removedProjectIds(previous.projects, next.projects),
    });
  };
  const reconcileProject = (projectId: string) =>
    enqueue(async () => {
      if (closed) return { indexRevision: current.list.indexRevision };
      const previous = current.projects.get(projectId);
      const path = current.projectPaths.get(projectId);
      if (!previous || !path)
        return { indexRevision: current.list.indexRevision };
      // Session/root disappearance is a discovery decision. Do not replace
      // current documents with missing states before a scan can confirm it.
      try {
        if (!(await lstat(join(path, ".auto"))).isDirectory())
          return { indexRevision: current.list.indexRevision };
      } catch {
        return { indexRevision: current.list.indexRevision };
      }
      const root = current.list.roots.find(
        (candidate) =>
          candidate.id === previous.project.rootAssociations[0]?.rootId,
      );
      if (!root) return { indexRevision: current.list.indexRevision };
      if (
        previous.project.diagnostics.some(
          (value) => value.code === "ROOT_SCAN_FAILED",
        )
      )
        return { indexRevision: current.list.indexRevision };
      const snapshot = await loadProject(
        path,
        root,
        previous.project.rootAssociations,
        previous,
      );
      if (JSON.stringify(snapshot) === JSON.stringify(previous))
        return { indexRevision: current.list.indexRevision };
      const projects = new Map(current.projects);
      projects.set(projectId, snapshot);
      const list = ProjectsResponseSchema.parse({
        ...current.list,
        indexRevision: current.list.indexRevision + 1,
        projects: current.list.projects.map((project) =>
          project.id === projectId ? snapshot.project : project,
        ),
      });
      await install(
        { list, projects, projectPaths: new Map(current.projectPaths) },
        "source-change",
      );
      return { indexRevision: list.indexRevision };
    });

  const rescan = () =>
    enqueue(async () => {
      if (closed) return { indexRevision: current.list.indexRevision };
      let next = await discover(
        current.list.indexRevision + 1,
        current.projects,
        true,
      );
      next = await syncWatchers(next);
      const unchanged =
        JSON.stringify({
          ...next.list,
          indexRevision: current.list.indexRevision,
        }) === JSON.stringify(current.list);
      if (!unchanged) await install(next, "discovery", false);
      return { indexRevision: current.list.indexRevision };
    });
  const scheduleRescan = () => {
    if (!monitoring || closed) return;
    // Schedule after completion: slow scans cannot accumulate timer work.
    rescanTimer = setTimeout(() => {
      rescanTimer = undefined;
      void rescan()
        .catch(() => {})
        .finally(scheduleRescan);
    }, config.rescanIntervalMs);
    rescanTimer.unref();
  };
  const registry = {
    get list() {
      return current.list;
    },
    get projects() {
      return current.projects;
    },
    get projectPaths() {
      return current.projectPaths;
    },
    refresh() {
      // Concurrent callers share one pass; GETs see only installed snapshots.
      if (!inFlight) {
        inFlight = enqueue(async () => {
          if (closed) return { indexRevision: current.list.indexRevision };
          const next = await discover(
            current.list.indexRevision + 1,
            current.projects,
          );
          await install(next, "manual-refresh");
          return { indexRevision: next.list.indexRevision };
        }).finally(() => {
          inFlight = null;
        });
      }
      return inFlight;
    },
    reconcileProject,
    subscribe(listener: (event: LiveEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    startMonitoring() {
      if (!config.watch || monitoring || closed) return;
      monitoring = true;
      void rescan()
        .catch(() => {})
        .finally(scheduleRescan);
    },
    async close() {
      if (closed) return;
      closed = true;
      monitoring = false;
      if (rescanTimer) clearTimeout(rescanTimer);
      rescanTimer = undefined;
      for (const timer of debounceTimers.values()) clearTimeout(timer);
      debounceTimers.clear();
      for (const { watcher } of watchers.values()) watcher.close();
      watchers.clear();
      watchDiagnostics.clear();
      sourceSignatures.clear();
      listeners.clear();
      await mutationTail;
      sourceSignatures.clear();
    },
  };
  return registry;
}
