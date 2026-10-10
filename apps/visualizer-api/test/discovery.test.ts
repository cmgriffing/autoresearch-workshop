import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_EXCLUDED_DIRECTORIES,
  ProjectsResponseSchema,
  ProjectSnapshotSchema,
  RefreshResponseSchema,
  VisualizerConfigSchema,
} from "visualizar-common";
import {
  createDiscoveryFixture,
  fingerprintDiscoveryFixture,
  writeSession,
} from "../../../scripts/visualizer-discovery-fixture.mjs";
import { createRegistry } from "../src/registry.ts";
import { createApp } from "../src/server.ts";

const origin = "http://127.0.0.1:4310";
const headers = { host: "127.0.0.1:4310", origin };

test("root defaults are recursive with basename exclusions and a zero threshold", () => {
  const config = VisualizerConfigSchema.parse({
    roots: [{ path: "./one" }, { path: "./two", recursive: false }],
  });
  assert.equal(config.roots[0].recursive, true);
  assert.equal(config.roots[1].recursive, false);
  assert.equal(config.minWinImprovementPct, 0);
  assert.equal(config.watch, true);
  assert.deepEqual(config.exclude, DEFAULT_EXCLUDED_DIRECTORIES);
  for (const value of ["a/b", "a\\b", ".", "..", ""])
    assert.equal(
      VisualizerConfigSchema.safeParse({
        roots: [{ path: "x" }],
        exclude: [value],
      }).success,
      false,
    );
});

test("recursive multi-root registry deduplicates nested sessions, skips cycles/exclusions, and isolates root failures", async () => {
  const fixture = await createDiscoveryFixture();
  const before = await fingerprintDiscoveryFixture(fixture.directory);
  try {
    const registry = await createRegistry(fixture.configPath);
    const list = ProjectsResponseSchema.parse(registry.list);
    assert.equal(list.projects.length, 5);
    assert.equal(new Set(list.projects.map((project) => project.id)).size, 5);
    assert.deepEqual(
      list.projects.map((project) => project.relativePath),
      [".", "a/shared", "a/shared/child", "b/shared", "uninitialized"],
    );
    const [parent, alpha, child, beta, uninitialized] = list.projects;
    assert.equal(alpha.name, beta.name);
    assert.notEqual(alpha.id, beta.id);
    assert.equal(alpha.rootAssociations.length, 3);
    assert.equal(child.rootAssociations.length, 2);
    assert.equal(list.roots[2].recursive, false);
    assert.equal(
      list.projects.some((project) =>
        project.rootAssociations.some(
          (association) => association.rootId === list.roots[2].id,
        ),
      ),
      false,
    );
    assert.equal(list.roots[3].canonicalPath, fixture.alpha);
    assert.equal(alpha.rootAssociations[2].relativePath, ".");
    assert.equal(uninitialized.sourceState, "missing");
    assert.equal(registry.projects.get(uninitialized.id)?.runs.length, 0);
    assert.match(uninitialized.diagnostics[0].message, /Uninitialized/);
    assert.equal(
      registry.projects.get(parent.id)?.segments[0].name,
      "Parent session",
    );
    assert.equal(
      registry.projects.get(alpha.id)?.segments[0].name,
      "Alpha session",
    );
    assert.equal(
      registry.projects.get(beta.id)?.segments[0].name,
      "Beta session",
    );
    assert.equal(list.diagnostics.length, 2);
    assert.ok(
      list.diagnostics.every(
        (diagnostic) =>
          diagnostic.code === "ROOT_UNAVAILABLE" &&
          diagnostic.rootId &&
          diagnostic.directory,
      ),
    );
    assert.deepEqual(
      await fingerprintDiscoveryFixture(fixture.directory),
      before,
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("refresh coalesces passes and installs list/snapshots atomically with stable IDs", async () => {
  const fixture = await createDiscoveryFixture();
  try {
    const registry = await createRegistry(fixture.configPath);
    const alpha = registry.list.projects.find(
      (project) => project.relativePath === "a/shared",
    )!;
    const beforeSnapshot = registry.projects.get(alpha.id)!;
    const oldList = registry.list;
    const oldProjects = registry.projects;
    await writeSession(join(fixture.workspace, "new-session"), "New session");
    await writeFile(
      join(fixture.alpha, ".auto/log.jsonl"),
      (await readFile(join(fixture.alpha, ".auto/log.jsonl"), "utf8")) +
        JSON.stringify({ run: 3, metric: 14, status: "keep" }) +
        "\n",
    );
    const before = await fingerprintDiscoveryFixture(fixture.directory);
    const first = registry.refresh();
    const concurrent = registry.refresh();
    assert.equal(first, concurrent);
    assert.equal(registry.list, oldList);
    assert.equal(registry.projects, oldProjects);
    assert.equal((await first).indexRevision, 2);
    assert.equal(registry.list.projects.length, 6);
    assert.equal(registry.projects.get(alpha.id)?.runs.length, 3);
    assert.deepEqual(
      registry.projects
        .get(alpha.id)
        ?.runs.slice(0, 2)
        .map((run) => run.id),
      beforeSnapshot.runs.map((run) => run.id),
    );
    assert.notEqual(
      registry.projects.get(alpha.id)?.project.revision,
      beforeSnapshot.project.revision,
    );
    assert.deepEqual(
      await fingerprintDiscoveryFixture(fixture.directory),
      before,
    );
    assert.equal((await registry.refresh()).indexRevision, 3);
    await rm(join(fixture.workspace, "new-session", ".auto"), {
      recursive: true,
    });
    await registry.refresh();
    assert.equal(registry.list.projects.length, 5);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("manual refresh API reloads logs/discovery, rejects external inputs/origins, and invalidates old diff revisions", async () => {
  const fixture = await createDiscoveryFixture();
  const app = await createApp({
    configPath: fixture.configPath,
    apiOrigin: origin,
    uiOrigin: origin,
  });
  try {
    const list = ProjectsResponseSchema.parse(
      (await app.inject({ url: "/api/projects", headers })).json(),
    );
    const alpha = list.projects.find(
      (project) => project.relativePath === "a/shared",
    )!;
    const getSnapshot = async () =>
      ProjectSnapshotSchema.parse(
        (
          await app.inject({ url: `/api/projects/${alpha.id}`, headers })
        ).json(),
      );
    const snapshot = await getSnapshot();
    for (const originValue of [undefined, "https://example.com"]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/refresh",
        headers: {
          host: headers.host,
          ...(originValue ? { origin: originValue } : {}),
        },
      });
      assert.equal(response.statusCode, 403);
    }
    for (const request of [
      { url: "/api/refresh?path=/tmp" },
      { url: "/api/refresh", payload: { path: "/tmp" } },
    ])
      assert.equal(
        (await app.inject({ method: "POST", headers, ...request })).statusCode,
        400,
      );
    await writeFile(
      join(fixture.alpha, ".auto/log.jsonl"),
      (await readFile(join(fixture.alpha, ".auto/log.jsonl"), "utf8")) +
        JSON.stringify({ run: 3, metric: 14, status: "keep" }) +
        "\n",
    );
    const added = join(fixture.workspace, "new-session");
    await mkdir(join(added, ".auto"), { recursive: true });
    const before = await fingerprintDiscoveryFixture(fixture.directory);
    const response = await app.inject({
      method: "POST",
      url: "/api/refresh",
      headers,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(RefreshResponseSchema.parse(response.json()).indexRevision, 2);
    const refreshed = await getSnapshot();
    assert.equal(refreshed.runs.length, 3);
    assert.notEqual(refreshed.project.revision, snapshot.project.revision);
    const stale = await app.inject({
      url: `/api/projects/${alpha.id}/runs/${snapshot.runs[1].id}/diff?revision=${snapshot.project.revision}`,
      headers,
    });
    assert.equal(stale.statusCode, 409);
    const current = ProjectsResponseSchema.parse(
      (await app.inject({ url: "/api/projects", headers })).json(),
    );
    assert.equal(current.projects.length, 6);
    assert.equal(current.indexRevision, 2);
    const newlyDiscovered = current.projects.find(
      (project) => project.relativePath === "new-session",
    )!;
    assert.equal(newlyDiscovered.sourceState, "missing");
    assert.deepEqual(
      await fingerprintDiscoveryFixture(fixture.directory),
      before,
    );
  } finally {
    await app.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
