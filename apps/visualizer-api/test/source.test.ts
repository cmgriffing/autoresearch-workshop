import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_MAX_LOG_BYTES,
  parseExperimentLog,
  ProjectSnapshotSchema,
  ProjectsResponseSchema,
  VisualizerConfigSchema,
} from "visualizar-common";
import { createFixture } from "../../../scripts/visualizer-fixture.mjs";
import { createRegistry } from "../src/registry.ts";
import { createApp } from "../src/server.ts";
import { readLogSource, SourceReadError } from "../src/source.ts";

const header = JSON.stringify({ type: "config", name: "Resilient history" });
const baseline = JSON.stringify({ run: 1, metric: 10, status: "keep" });
const winner = JSON.stringify({
  run: 1,
  metric: 8,
  status: "keep",
  metrics: { valid: 2, bad: null, text: "3", infinite: 1e309 },
});
const source = [
  header,
  baseline,
  '{"type":"hook","run":20,"metric":0,"status":"keep"}',
  '{"type":"future"}',
  "{broken}",
  '{"run":2,"metric":0,"status":"unknown"}',
  '{"run":3,"status":"keep"}',
  winner,
].join("\n");

test("mixed JSONL retains valid records, omits invalid secondary metrics, and defers only unfinished EOF", () => {
  const parsed = parseExperimentLog(`${source}\n{"run":4,"metric":`);
  assert.deepEqual(
    parsed.records.map(({ record }) => [record.run, record.metric]),
    [
      [1, 10],
      [1, 8],
    ],
  );
  assert.equal(parsed.records[1].record.commit, undefined);
  assert.deepEqual(parsed.records[1].record.metrics, { valid: 2 });
  assert.deepEqual(
    parsed.diagnostics
      .filter((diagnostic) => diagnostic.code === "INVALID_RUN")
      .map((diagnostic) => diagnostic.sourceLine),
    [6, 7],
  );
  assert.equal(
    parsed.diagnostics.find(
      (diagnostic) => diagnostic.code === "INVALID_RECORD",
    )?.sourceLine,
    5,
  );
  assert.equal(parsed.diagnostics.at(-1)?.code, "INCOMPLETE_RECORD");
  for (const tail of [
    '{"run":4',
    '{"description":"unfinished',
    '{"metrics":{"value":',
    "{",
  ])
    assert.equal(
      parseExperimentLog(`${source}\n${tail}`).diagnostics.at(-1)?.code,
      "INCOMPLETE_RECORD",
    );
  for (const tail of ["{broken}", '{"run":!!', '{"run":4\n'])
    assert.equal(
      parseExperimentLog(`${source}\n${tail}`).diagnostics.at(-1)?.code,
      "INVALID_RECORD",
    );
  const complete = parseExperimentLog(
    `${source}\n{"type":"run","run":4,"metric":7,"status":"keep"}`,
  );
  assert.equal(complete.records.length, 3);
  assert.equal(complete.records.at(-1)?.record.metric, 7);
  assert.ok(
    !complete.diagnostics.some(
      (diagnostic) => diagnostic.code === "INCOMPLETE_RECORD",
    ),
  );
  const invalidContainer = parseExperimentLog(
    '{"run":1,"metric":3,"status":"keep","metrics":[]}',
  );
  assert.equal(invalidContainer.records.length, 1);
  assert.equal(invalidContainer.records[0].record.metrics, undefined);
  assert.ok(
    invalidContainer.diagnostics.some(
      (diagnostic) => diagnostic.code === "INVALID_SECONDARY_METRIC",
    ),
  );
});

test("log reads enforce byte limits without truncation and reject non-files", async () => {
  assert.equal(
    VisualizerConfigSchema.parse({ roots: [{ path: "." }] }).maxLogBytes,
    DEFAULT_MAX_LOG_BYTES,
  );
  for (const maxLogBytes of [0, -1, 1.5, "10"])
    assert.equal(
      VisualizerConfigSchema.safeParse({ roots: [{ path: "." }], maxLogBytes })
        .success,
      false,
    );
  const fixture = await createFixture();
  const path = join(fixture.directory, "bounded.jsonl");
  try {
    const value = "é".repeat(65536);
    await writeFile(path, value);
    assert.equal(await readLogSource(path, Buffer.byteLength(value)), value);
    await assert.rejects(
      readLogSource(path, Buffer.byteLength(value) - 1),
      (error) => error instanceof SourceReadError && error.code === "LOG_LIMIT",
    );
    await rm(path);
    await mkdir(path);
    await assert.rejects(
      readLogSource(path, 100),
      (error) => error instanceof SourceReadError && error.state === "error",
    );
    await rm(path, { recursive: true });
    await assert.rejects(
      readLogSource(path, 100),
      (error) => error instanceof SourceReadError && error.state === "missing",
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("refresh retains last successful snapshots through repeated failures, limits, and recovery", async () => {
  const fixture = await createFixture();
  const path = join(fixture.projectPath, ".auto/log.jsonl");
  try {
    await writeFile(path, source);
    await writeFile(
      fixture.configPath,
      JSON.stringify({
        roots: [{ path: "./checksum-session", recursive: false }],
        maxLogBytes: 2048,
      }),
    );
    const registry = await createRegistry(fixture.configPath);
    const first = [...registry.projects.values()][0];
    assert.equal(first.runs.length, 2);
    assert.notEqual(first.runs[0].id, first.runs[1].id);
    assert.equal(first.segments[0].wins.length, 1);
    assert.equal(first.segments[0].bestMetric, 8);
    for (const state of ["missing", "error", "limited"] as const) {
      await rm(path, { recursive: true, force: true });
      if (state === "error") await mkdir(path);
      if (state === "limited") await writeFile(path, " ".repeat(2049));
      for (let attempt = 0; attempt < 2; attempt++) {
        await registry.refresh();
        const retained = registry.projects.get(first.project.id)!;
        assert.equal(retained.project.stale, true);
        assert.equal(retained.project.sourceState, state);
        assert.equal(retained.project.revision, first.project.revision);
        assert.deepEqual(retained.runs, first.runs);
        assert.deepEqual(retained.segments, first.segments);
        assert.equal(
          retained.project.diagnostics.filter(
            (diagnostic) => !diagnostic.sourceLine,
          ).length,
          1,
        );
        assert.equal(registry.list.projects[0].runCount, 2);
        ProjectSnapshotSchema.parse(retained);
      }
    }
    await writeFile(path, `${source}\n{"run":4,"metric":7`);
    await registry.refresh();
    const partial = registry.projects.get(first.project.id)!;
    assert.equal(partial.project.stale, false);
    assert.deepEqual(partial.runs, first.runs);
    await writeFile(path, `${source}\n{"run":4,"metric":7,"status":"keep"}`);
    await registry.refresh();
    const completed = registry.projects.get(first.project.id)!;
    assert.equal(completed.runs.length, 3);
    assert.deepEqual(completed.runs.slice(0, 2), first.runs);
    await registry.refresh();
    assert.deepEqual(
      registry.projects.get(first.project.id)?.runs,
      completed.runs,
    );
    await writeFile(
      `${path}.replacement`,
      source.replace('"metric":8', '"metric":6'),
    );
    await rename(`${path}.replacement`, path);
    await registry.refresh();
    const rewritten = registry.projects.get(first.project.id)!;
    assert.equal(rewritten.runs[0].id, first.runs[0].id);
    assert.notEqual(rewritten.runs[1].id, first.runs[1].id);
    assert.notEqual(rewritten.project.revision, completed.project.revision);
    await writeFile(path, "");
    await registry.refresh();
    assert.equal(registry.projects.get(first.project.id)?.runs.length, 0);
    assert.equal(registry.projects.get(first.project.id)?.project.stale, false);
    assert.equal(
      registry.projects.get(first.project.id)?.project.diagnostics[0].code,
      "EMPTY_LOG",
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("first-load limits isolate projects and API revisions reject replaced identities", async () => {
  const fixture = await createFixture();
  const path = join(fixture.projectPath, ".auto/log.jsonl");
  const origin = "http://127.0.0.1:4310";
  const headers = { host: "127.0.0.1:4310", origin };
  let app;
  try {
    const healthy = join(fixture.directory, "healthy/.auto");
    await mkdir(healthy, { recursive: true });
    await writeFile(join(healthy, "log.jsonl"), `${header}\n${baseline}`);
    await writeFile(path, " ".repeat(2049));
    await writeFile(
      fixture.configPath,
      JSON.stringify({ roots: [{ path: "." }], maxLogBytes: 2048 }),
    );
    app = await createApp({
      configPath: fixture.configPath,
      apiOrigin: origin,
      uiOrigin: origin,
    });
    const list = ProjectsResponseSchema.parse(
      (await app.inject({ url: "/api/projects", headers })).json(),
    );
    const limited = list.projects.find(
      (project) => project.name === "checksum-session",
    )!;
    assert.equal(limited.sourceState, "limited");
    assert.equal(limited.stale, false);
    assert.equal(limited.runCount, 0);
    assert.equal(
      list.projects.find((project) => project.name === "healthy")?.runCount,
      1,
    );
    const refresh = () =>
      app!.inject({ method: "POST", url: "/api/refresh", headers });
    const snapshot = async () =>
      ProjectSnapshotSchema.parse(
        (
          await app!.inject({ url: `/api/projects/${limited.id}`, headers })
        ).json(),
      );
    await writeFile(path, source);
    assert.equal((await refresh()).statusCode, 200);
    const first = await snapshot();
    const diff = (runId: string, revision: string) =>
      app!.inject({
        url: `/api/projects/${limited.id}/runs/${runId}/diff?revision=${revision}`,
        headers,
      });
    assert.equal(
      (await diff(first.runs[1].id, first.project.revision)).json().reason,
      "commit-not-recorded",
    );
    await writeFile(path, source.replace('"metric":8', '"metric":6'));
    await refresh();
    assert.equal(
      (await diff(first.runs[1].id, first.project.revision)).statusCode,
      404,
    );
    assert.equal(
      (await diff(first.runs[0].id, first.project.revision)).statusCode,
      409,
    );
    assert.notEqual(
      (await snapshot()).project.revision,
      first.project.revision,
    );
    assert.equal(
      await readFile(join(healthy, "log.jsonl"), "utf8"),
      `${header}\n${baseline}`,
    );
  } finally {
    await app?.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
