import assert from "node:assert/strict";
import { test } from "node:test";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CurrentDocumentSchema,
  DEFAULT_MAX_DOCUMENT_BYTES,
  ProjectSnapshotSchema,
  ProjectsResponseSchema,
  VisualizerConfigSchema,
} from "visualizar-common";
import { createFixture } from "../../../scripts/visualizer-fixture.mjs";
import { createRegistry } from "../src/registry.ts";
import { createApp } from "../src/server.ts";
import { readCurrentDocument } from "../src/source.ts";

test("optional document reads distinguish missing, empty, unreadable and byte-limited sources", async () => {
  assert.equal(
    VisualizerConfigSchema.parse({ roots: [{ path: "." }] }).maxDocumentBytes,
    DEFAULT_MAX_DOCUMENT_BYTES,
  );
  for (const maxDocumentBytes of [0, -1, 1.5, "10"])
    assert.equal(
      VisualizerConfigSchema.safeParse({
        roots: [{ path: "." }],
        maxDocumentBytes,
      }).success,
      false,
    );
  const fixture = await createFixture();
  const path = join(fixture.projectPath, ".auto/ideas.md");
  try {
    assert.equal(
      (await readCurrentDocument(path, "ideas.md", 10)).state,
      "missing",
    );
    await writeFile(path, "");
    assert.deepEqual(await readCurrentDocument(path, "ideas.md", 10), {
      state: "ready",
      content: "",
    });
    const content = "é".repeat(65536);
    await writeFile(path, content);
    assert.deepEqual(
      await readCurrentDocument(path, "ideas.md", Buffer.byteLength(content)),
      { state: "ready", content },
    );
    const limited = await readCurrentDocument(
      path,
      "ideas.md",
      Buffer.byteLength(content) - 1,
    );
    assert.equal(limited.state, "limited");
    assert.equal(limited.content, null);
    CurrentDocumentSchema.parse(limited);
    await chmod(path, 0);
    assert.equal(
      (await readCurrentDocument(path, "ideas.md", 10)).state,
      "error",
    );
    await chmod(path, 0o600);
    await rm(path);
    await mkdir(path);
    assert.equal(
      (await readCurrentDocument(path, "ideas.md", 10)).state,
      "error",
    );
    assert.equal(
      CurrentDocumentSchema.safeParse({ state: "ready", content: null })
        .success,
      false,
    );
    assert.equal(
      CurrentDocumentSchema.safeParse({
        state: "missing",
        content: "old notes",
        message: "Missing",
      }).success,
      false,
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("document changes revise snapshots independently of log failures and preserve experiment identities", async () => {
  const fixture = await createFixture();
  const ideasPath = join(fixture.projectPath, ".auto/ideas.md");
  const promptPath = join(fixture.projectPath, ".auto/prompt.md");
  const logPath = join(fixture.projectPath, ".auto/log.jsonl");
  try {
    const registry = await createRegistry(fixture.configPath);
    const first = [...registry.projects.values()][0];
    assert.deepEqual(first.project.documentStates, {
      ideas: "missing",
      prompt: "missing",
    });
    await writeFile(ideasPath, "# Current ideas\n\nA **new** idea.");
    await writeFile(promptPath, "Current prompt context");
    await registry.refresh();
    const present = registry.projects.get(first.project.id)!;
    assert.equal(present.documents.ideas.state, "ready");
    assert.equal(present.documents.prompt.state, "ready");
    assert.equal(present.logRevision, first.logRevision);
    assert.notEqual(present.project.revision, first.project.revision);
    assert.deepEqual(present.runs, first.runs);
    assert.deepEqual(present.segments, first.segments);
    await registry.refresh();
    assert.equal(
      registry.projects.get(first.project.id)?.project.revision,
      present.project.revision,
    );
    await rm(logPath);
    await writeFile(`${ideasPath}.new`, "# Replaced current ideas");
    await rename(`${ideasPath}.new`, ideasPath);
    await registry.refresh();
    const retained = registry.projects.get(first.project.id)!;
    assert.equal(retained.project.stale, true);
    assert.equal(retained.logRevision, first.logRevision);
    assert.notEqual(retained.project.revision, present.project.revision);
    assert.deepEqual(retained.runs, first.runs);
    assert.deepEqual(retained.documents.ideas, {
      state: "ready",
      content: "# Replaced current ideas",
    });
    await registry.refresh();
    assert.equal(
      registry.projects.get(first.project.id)?.project.revision,
      retained.project.revision,
    );
    await rm(promptPath);
    await mkdir(promptPath);
    await registry.refresh();
    assert.equal(
      registry.projects.get(first.project.id)?.documents.prompt.state,
      "error",
    );
    assert.deepEqual(registry.projects.get(first.project.id)?.runs, first.runs);
    ProjectSnapshotSchema.parse(registry.projects.get(first.project.id));
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("document-only refresh invalidates old diff revisions without hiding experiments or projects", async () => {
  const fixture = await createFixture();
  const origin = "http://127.0.0.1:4310";
  const headers = { host: "127.0.0.1:4310", origin };
  let app;
  try {
    await writeFile(
      fixture.configPath,
      JSON.stringify({ roots: [{ path: "." }], maxDocumentBytes: 32 }),
    );
    const healthy = join(fixture.directory, "healthy/.auto");
    await mkdir(healthy, { recursive: true });
    await writeFile(join(healthy, "ideas.md"), "# Healthy notes");
    await writeFile(
      join(fixture.projectPath, ".auto/ideas.md"),
      "x".repeat(33),
    );
    app = await createApp({
      configPath: fixture.configPath,
      apiOrigin: origin,
      uiOrigin: origin,
    });
    const list = ProjectsResponseSchema.parse(
      (await app.inject({ url: "/api/projects", headers })).json(),
    );
    const project = list.projects.find(
      (value) => value.name === "checksum-session",
    )!;
    assert.equal(project.documentStates.ideas, "limited");
    assert.equal(project.runCount, 23);
    const uninitialized = list.projects.find(
      (value) => value.name === "healthy",
    )!;
    assert.equal(uninitialized.sourceState, "missing");
    assert.equal(uninitialized.documentStates.ideas, "ready");
    const snapshot = async () =>
      ProjectSnapshotSchema.parse(
        (
          await app!.inject({ url: `/api/projects/${project.id}`, headers })
        ).json(),
      );
    const first = await snapshot();
    await writeFile(
      join(fixture.projectPath, ".auto/ideas.md"),
      "# New current ideas",
    );
    assert.equal(
      (await app.inject({ method: "POST", url: "/api/refresh", headers }))
        .statusCode,
      200,
    );
    const next = await snapshot();
    assert.deepEqual(next.runs, first.runs);
    assert.equal(next.documents.ideas.state, "ready");
    assert.equal(
      (
        await app.inject({
          url: `/api/projects/${project.id}/runs/${first.runs[0].id}/diff?revision=${first.project.revision}`,
          headers,
        })
      ).statusCode,
      409,
    );
  } finally {
    await app?.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
