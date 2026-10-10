import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { FSWatcher, watch } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { LiveEventSchema, VisualizerConfigSchema } from "visualizar-common";
import type { LiveEvent } from "visualizar-common";
import { writeSession } from "../../../scripts/visualizer-discovery-fixture.mjs";
import { createRegistry } from "../src/registry.ts";

const delay = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (check: () => boolean) => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(15);
  }
  assert.fail("Timed out waiting for periodic recovery.");
};
const fixture = async (config = {}) => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "visualizer-s10-test-")),
  );
  const root = join(directory, "root");
  const alpha = join(root, "alpha");
  await writeSession(alpha, "Recovery session");
  await writeFile(join(alpha, ".auto/ideas.md"), "# Original ideas\n");
  const configPath = join(directory, "config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      roots: [{ path: root }],
      rescanIntervalMs: 40,
      ...config,
    }),
  );
  return { directory, root, alpha, configPath };
};
const inertWatchers = () => {
  const entries: { watcher: FSWatcher; closed: boolean }[] = [];
  const watchDirectory = (() => {
    const entry = { watcher: new EventEmitter() as FSWatcher, closed: false };
    entry.watcher.close = () => {
      if (entry.closed) return;
      entry.closed = true;
      entry.watcher.emit("close");
    };
    entries.push(entry);
    return entry.watcher;
  }) as typeof watch;
  return { entries, watchDirectory };
};

test("rescan interval defaults to five seconds and rejects unsafe timer values", () => {
  const config = { roots: [{ path: "." }] };
  assert.equal(VisualizerConfigSchema.parse(config).rescanIntervalMs, 5000);
  for (const value of [0, -1, 1.5, "5000", Infinity, 2_147_483_648])
    assert.equal(
      VisualizerConfigSchema.safeParse({ ...config, rescanIntervalMs: value })
        .success,
      false,
    );
});

test("periodic passes recover dropped events, nested sessions, notes and confirmed removals without idle invalidations", async () => {
  const f = await fixture();
  const watches = inertWatchers();
  const registry = await createRegistry(f.configPath, watches);
  const events: LiveEvent[] = [];
  registry.subscribe((event) => {
    events.push(LiveEventSchema.parse(event));
    assert.equal(registry.list.indexRevision, event.indexRevision);
    if (event.type === "invalidate")
      for (const project of event.projects)
        assert.equal(
          registry.projects.get(project.id)?.project.revision,
          project.revision,
        );
  });
  registry.startMonitoring();
  try {
    await waitFor(() => watches.entries.length === 1);
    const project = registry.list.projects[0];
    const original = registry.projects.get(project.id)!;
    await delay(150);
    assert.equal(registry.list.indexRevision, 1);
    assert.equal(events.length, 0);
    const log = join(f.alpha, ".auto/log.jsonl");
    await writeFile(
      log,
      `${await readFile(log, "utf8")}{"run":3,"metric":8,"status":"keep"}\n`,
    );
    await waitFor(() => registry.projects.get(project.id)?.runs.length === 3);
    assert.deepEqual(
      registry.projects
        .get(project.id)!
        .runs.slice(0, 2)
        .map((run) => run.id),
      original.runs.map((run) => run.id),
    );
    await writeFile(join(f.alpha, ".auto/ideas.md"), "# Missed notes event\n");
    await waitFor(
      () =>
        registry.projects.get(project.id)?.documents.ideas.content ===
        "# Missed notes event\n",
    );
    const nested = join(f.alpha, "nested");
    await writeSession(nested, "New nested session");
    await waitFor(() => registry.list.projects.length === 2);
    const nestedId = registry.list.projects.find(
      (value) => value.name === "nested",
    )!.id;
    await waitFor(
      () => watches.entries.filter((entry) => !entry.closed).length === 2,
    );
    await rm(join(nested, ".auto"), { recursive: true });
    await waitFor(() => !registry.projects.has(nestedId));
    assert.ok(
      events.some(
        (event) =>
          event.type === "invalidate" &&
          event.removedProjectIds.includes(nestedId),
      ),
    );
    assert.ok(
      events.every(
        (event) => event.type === "invalidate" && event.reason === "discovery",
      ),
    );
    assert.equal(watches.entries.filter((entry) => !entry.closed).length, 1);
    await registry.close();
    const finalRevision = registry.list.indexRevision;
    await writeFile(log, "");
    await delay(150);
    assert.equal(registry.list.indexRevision, finalRevision);
    assert.ok(watches.entries.every((entry) => entry.closed));
  } finally {
    await registry.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("watcher setup/runtime failures publish diagnostics, keep polling and retry, including session directory replacement", async () => {
  const f = await fixture();
  const watches = inertWatchers();
  let failWatch = true;
  const registry = await createRegistry(f.configPath, {
    watchDirectory: ((...args: Parameters<typeof watch>) => {
      if (failWatch) throw new Error("Controlled watcher setup failure");
      return watches.watchDirectory(...args);
    }) as typeof watch,
  });
  registry.startMonitoring();
  try {
    const id = registry.list.projects[0].id;
    const hasDiagnostic = () =>
      registry.projects
        .get(id)!
        .project.diagnostics.some(
          (value) => value.code === "WATCH_UNAVAILABLE",
        );
    await waitFor(hasDiagnostic);
    const log = join(f.alpha, ".auto/log.jsonl");
    await writeFile(
      log,
      `${await readFile(log, "utf8")}{"run":3,"metric":8,"status":"keep"}\n`,
    );
    await waitFor(() => registry.projects.get(id)?.runs.length === 3);
    assert.equal(hasDiagnostic(), true);
    failWatch = false;
    await waitFor(() => !hasDiagnostic());
    failWatch = true;
    watches.entries
      .at(-1)!
      .watcher.emit("error", new Error("Controlled runtime watcher failure"));
    await waitFor(hasDiagnostic);
    failWatch = false;
    await waitFor(() => !hasDiagnostic());
    const old = watches.entries.at(-1)!;
    await rename(join(f.alpha, ".auto"), join(f.alpha, "saved-session"));
    await writeSession(f.alpha, "Replaced session", [5]);
    await waitFor(() => registry.projects.get(id)?.runs.length === 1);
    await waitFor(() => old.closed && watches.entries.at(-1) !== old);
  } finally {
    await registry.close();
    assert.ok(watches.entries.every((entry) => entry.closed));
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("failed root and descendant scans retain stale projects and current notes until a complete pass confirms actual removals", async () => {
  const f = await fixture();
  const beta = join(f.directory, "healthy/beta");
  await writeSession(beta, "Healthy root");
  await writeFile(
    f.configPath,
    JSON.stringify({
      roots: [{ path: f.root }, { path: join(f.directory, "healthy") }],
      rescanIntervalMs: 40,
    }),
  );
  let failedPath: string | null = null;
  const registry = await createRegistry(f.configPath, {
    ...inertWatchers(),
    scanDirectory: async (path) => {
      if (path === failedPath) throw new Error("Controlled permission failure");
      return readdir(path, { withFileTypes: true });
    },
  });
  registry.startMonitoring();
  try {
    const initial = registry.list.projects.find(
      (value) => value.name === "alpha",
    )!;
    const before = registry.projects.get(initial.id)!;
    failedPath = f.root;
    await waitFor(
      () => registry.projects.get(initial.id)?.project.stale === true,
    );
    const stale = registry.projects.get(initial.id)!;
    assert.deepEqual(stale.runs, before.runs);
    assert.deepEqual(stale.documents, before.documents);
    assert.equal(stale.project.revision, before.project.revision);
    assert.ok(
      registry.list.diagnostics.some(
        (value) => value.code === "DIRECTORY_UNAVAILABLE",
      ),
    );
    assert.equal(
      registry.list.projects.find((value) => value.name === "beta")!.stale,
      false,
    );
    await rm(join(f.alpha, ".auto"), { recursive: true });
    await delay(100);
    assert.equal(registry.projects.has(initial.id), true);
    await registry.refresh();
    assert.equal(registry.projects.has(initial.id), true);
    failedPath = null;
    await waitFor(() => !registry.projects.has(initial.id));
    await writeSession(f.alpha, "Recovered session");
    await waitFor(() => registry.projects.has(initial.id));
    assert.equal(registry.projects.get(initial.id)!.project.stale, false);
    const child = join(f.alpha, "blocked/child");
    await writeSession(child, "Child session");
    await waitFor(() => registry.list.projects.length === 3);
    const childId = registry.list.projects.find(
      (value) => value.name === "child",
    )!.id;
    failedPath = join(f.alpha, "blocked");
    await waitFor(() => registry.projects.get(childId)?.project.stale === true);
    await rm(join(child, ".auto"), { recursive: true });
    await delay(100);
    assert.equal(registry.projects.has(childId), true);
    failedPath = null;
    await waitFor(() => !registry.projects.has(childId));
  } finally {
    await registry.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("source reconciliation cannot erase notes when the session/root pathname disappears before discovery", async () => {
  const f = await fixture();
  const registry = await createRegistry(f.configPath);
  try {
    const project = registry.list.projects[0];
    const initial = registry.projects.get(project.id)!;
    await rename(f.root, `${f.root}.away`);
    await registry.reconcileProject(project.id);
    assert.deepEqual(
      registry.projects.get(project.id)!.documents,
      initial.documents,
    );
    await registry.refresh();
    assert.equal(registry.projects.get(project.id)!.project.stale, true);
    assert.deepEqual(
      registry.projects.get(project.id)!.documents,
      initial.documents,
    );
    await rename(`${f.root}.away`, f.root);
    await registry.refresh();
    assert.equal(registry.projects.get(project.id)!.project.stale, false);
    assert.deepEqual(
      registry.projects.get(project.id)!.documents,
      initial.documents,
    );
  } finally {
    await registry.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("manual-only mode skips watchers and periodic scans; close waits for one bounded scan and installs no late data", async () => {
  const f = await fixture({ watch: false });
  const watches = inertWatchers();
  let scans = 0;
  const registry = await createRegistry(f.configPath, {
    ...watches,
    scanDirectory: async (path) => {
      scans++;
      return readdir(path, { withFileTypes: true });
    },
  });
  try {
    const initialScans = scans;
    registry.startMonitoring();
    await writeSession(join(f.root, "new"), "Manual discovery");
    await delay(150);
    assert.equal(scans, initialScans);
    assert.equal(watches.entries.length, 0);
    assert.equal(registry.list.projects.length, 1);
    await registry.refresh();
    assert.equal(registry.list.projects.length, 2);
  } finally {
    await registry.close();
    await rm(f.directory, { recursive: true, force: true });
  }
  const slow = await fixture();
  let started = false;
  let release = () => {};
  let scanning = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const slowWatches = inertWatchers();
  const slowRegistry = await createRegistry(slow.configPath, {
    ...slowWatches,
    scanDirectory: async (path) => {
      if (scanning) {
        started = true;
        await gate;
      }
      return readdir(path, { withFileTypes: true });
    },
  });
  scanning = true;
  slowRegistry.startMonitoring();
  await waitFor(() => started);
  const closing = slowRegistry.close();
  release();
  await closing;
  await delay(100);
  assert.equal(slowRegistry.list.indexRevision, 1);
  assert.ok(slowWatches.entries.every((entry) => entry.closed));
  await rm(slow.directory, { recursive: true, force: true });
});
