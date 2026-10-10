import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ApiErrorSchema,
  parseSingleSegmentLog,
  ProjectSnapshotSchema,
  ProjectsResponseSchema,
  RunRecordSchema,
} from "visualizar-common";
import {
  createFixture,
  hashFiles,
} from "../../../scripts/visualizer-fixture.mjs";
import { createApp, validateUiOrigin } from "../src/server.ts";
import { createRegistry } from "../src/registry.ts";
import { loadConfig } from "../src/config.ts";

const origin = "http://127.0.0.1:4310";
const headers = { host: "127.0.0.1:4310" };

test("config-relative source -> typed APIs is read-only and uses opaque IDs", async () => {
  const fixture = await createFixture();
  const before = await hashFiles(fixture.directory);
  const app = await createApp({
    configPath: fixture.configPath,
    apiOrigin: origin,
    uiOrigin: origin,
  });
  try {
    const listResponse = await app.inject({ url: "/api/projects", headers });
    assert.equal(listResponse.statusCode, 200);
    const list = ProjectsResponseSchema.parse(listResponse.json());
    assert.equal(list.projects.length, 1);
    assert.match(list.projects[0].id, /^p_[0-9a-f]{64}$/);
    assert.equal(list.projects[0].runCount, 23);
    const response = await app.inject({
      url: `/api/projects/${list.projects[0].id}`,
      headers,
    });
    const snapshot = ProjectSnapshotSchema.parse(response.json());
    assert.equal(snapshot.metricConfig?.metricName, "checksum_ms");
    assert.equal(snapshot.runs[1].metric, 4.569);
    assert.equal(snapshot.runs[1].status, "keep");
    assert.match(snapshot.runs[1].description, /unroll/i);
    const missing = await app.inject({
      url: "/api/projects/p_unknown",
      headers,
    });
    assert.equal(missing.statusCode, 404);
    assert.equal(
      ApiErrorSchema.parse(missing.json()).error.code,
      "PROJECT_NOT_FOUND",
    );
    assert.deepEqual(await hashFiles(fixture.directory), before);
  } finally {
    await app.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("foreign origin, fetch-site, and host requests cannot read local snapshots", async () => {
  const fixture = await createFixture();
  const app = await createApp({
    configPath: fixture.configPath,
    apiOrigin: origin,
    uiOrigin: "http://127.0.0.1:5173",
  });
  try {
    for (const requestHeaders of [
      { ...headers, origin: "https://example.com" },
      { ...headers, "sec-fetch-site": "cross-site" },
      { host: "example.com" },
    ]) {
      const response = await app.inject({
        url: "/api/projects",
        headers: requestHeaders,
      });
      assert.equal(response.statusCode, 403);
      ApiErrorSchema.parse(response.json());
    }
    assert.equal(
      (
        await app.inject({
          url: "/api/projects",
          headers: {
            ...headers,
            origin: "http://127.0.0.1:5173",
            "sec-fetch-site": "same-origin",
          },
        })
      ).statusCode,
      200,
    );
    assert.throws(() => validateUiOrigin("http://0.0.0.0:5173"));
    assert.throws(() => validateUiOrigin("http://127.0.0.1:5173/path"));
    assert.throws(() => validateUiOrigin("https://example.com"));
  } finally {
    await app.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("config validation reports invalid syntax and fields clearly", async () => {
  const fixture = await createFixture();
  try {
    for (const source of [
      "{",
      "{}",
      '{"roots":[]}',
      '{"roots":[{"path":"x","recursive":"true"}]}',
      '{"roots":[{"path":"x"}],"exclude":["a/b"]}',
      '{"roots":[{"path":"x"}],"minWinImprovementPct":-1}',
    ]) {
      await writeFile(fixture.configPath, source);
      await assert.rejects(
        loadConfig(fixture.configPath),
        /Invalid visualizer config/,
      );
    }
    await writeFile(
      fixture.configPath,
      JSON.stringify({ roots: [{ path: "./absent", recursive: false }] }),
    );
    const registry = await createRegistry(fixture.configPath);
    assert.equal(registry.list.projects.length, 0);
    assert.equal(registry.list.diagnostics[0].code, "ROOT_UNAVAILABLE");
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("invalid metrics/statuses are diagnosed without fabricated results", () => {
  const header = JSON.stringify({
    type: "config",
    name: "test",
    metricName: "ms",
    metricUnit: "ms",
    bestDirection: "lower",
  });
  const records = [
    { run: 1, status: "keep" },
    { run: 2, metric: "0", status: "keep" },
    { run: 3, metric: 0, status: "unknown" },
    { run: 4, metric: 12, status: "discard" },
  ];
  const parsed = parseSingleSegmentLog(
    [header, ...records.map((value) => JSON.stringify(value))].join("\n"),
  );
  assert.deepEqual(
    parsed.records.map((value) => value.record.run),
    [4],
  );
  assert.equal(parsed.diagnostics.length, 3);
  assert.equal(
    RunRecordSchema.safeParse({ run: 1, metric: Infinity, status: "keep" })
      .success,
    false,
  );
  assert.equal(
    parseSingleSegmentLog(`${header}\n${header}`).segments.length,
    2,
  );
});

test("checksum history derives first-kept baseline and filter-independent wins", async () => {
  const fixture = await createFixture();
  try {
    const snapshot = [
      ...(await createRegistry(fixture.configPath)).projects.values(),
    ][0];
    assert.equal(snapshot.segments.length, 1);
    const segment = snapshot.segments[0];
    const runById = new Map(snapshot.runs.map((run) => [run.id, run]));
    assert.equal(runById.get(segment.baselineRunId!)?.run, 1);
    assert.equal(runById.get(segment.bestRunId!)?.run, 15);
    assert.equal(segment.baselineMetric, 18.35);
    assert.equal(segment.bestMetric, 3.84);
    assert.deepEqual(
      segment.wins.map((win) => runById.get(win.runId)?.run),
      [2, 4, 7, 8, 11, 14, 15],
    );
    assert.deepEqual(
      segment.wins
        .filter((win) => (win.incremental.percentage ?? -1) >= 1)
        .map((win) => runById.get(win.runId)?.run),
      [2, 4, 8],
    );
    assert.ok(
      Math.abs(segment.wins[0].incremental.percentage! - 75.1008174) < 0.000001,
    );
    assert.equal(
      snapshot.runs.filter((run) => run.status === "keep").length,
      10,
    );
    assert.equal(snapshot.minWinImprovementPct, 0);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("segments isolate directions, defaults, zero references, failures, and empty headers", async () => {
  const fixture = await createFixture();
  const logPath = join(fixture.projectPath, ".auto", "log.jsonl");
  try {
    await writeFile(
      logPath,
      [
        {
          type: "config",
          name: "Latency",
          metricName: "ms",
          metricUnit: "ms",
          bestDirection: "lower",
        },
        { run: 1, metric: 0, status: "crash", description: "placeholder" },
        { run: 2, metric: 10, status: "keep" },
        { run: 3, metric: 8, status: "discard" },
        { run: 4, metric: 9, status: "keep" },
        {
          type: "config",
          name: "Score",
          metricName: "score",
          metricUnit: "pts",
          bestDirection: "higher",
        },
        { run: 5, metric: 0, status: "keep" },
        { run: 6, metric: 5, status: "keep" },
        { run: 7, metric: 20, status: "discard" },
        { run: 8, metric: 10, status: "keep" },
        { type: "config" },
      ]
        .map((value) => JSON.stringify(value))
        .join("\n"),
    );
    const snapshot = [
      ...(await createRegistry(fixture.configPath)).projects.values(),
    ][0];
    assert.equal(snapshot.segments.length, 3);
    const [lower, higher, empty] = snapshot.segments;
    assert.equal(
      snapshot.runs.find((run) => run.run === 1)?.segmentId,
      lower.id,
    );
    assert.equal(lower.baselineMetric, 10);
    assert.equal(lower.bestMetric, 9);
    assert.equal(lower.wins.length, 1);
    assert.equal(higher.baselineMetric, 0);
    assert.deepEqual(
      higher.wins.map((win) => win.incremental.percentage),
      [null, 100],
    );
    assert.deepEqual(
      higher.wins.map((win) => win.incremental.absolute),
      [5, 5],
    );
    assert.equal(empty.metadataSource, "header");
    assert.deepEqual(empty.defaultedFields, [
      "name",
      "metricName",
      "metricUnit",
      "bestDirection",
    ]);
    assert.equal(empty.baselineRunId, null);
    assert.equal(empty.bestMetric, null);
    assert.ok(
      snapshot.project.diagnostics.some(
        (diagnostic) => diagnostic.code === "CONFIG_DEFAULTS_APPLIED",
      ),
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("headerless histories use an explicit lower-is-better fallback segment", () => {
  const parsed = parseSingleSegmentLog(
    JSON.stringify({ run: 1, metric: 3, status: "keep" }),
  );
  assert.equal(parsed.segments[0].metadataSource, "fallback");
  assert.equal(parsed.segments[0].metricName, "metric");
  assert.equal(parsed.segments[0].metricUnit, "");
  assert.equal(parsed.segments[0].bestDirection, "lower");
  assert.equal(parsed.records[0].segmentIndex, 0);
  assert.equal(parsed.diagnostics[0].code, "FALLBACK_METRIC_CONFIG");
});

test("source identities are append-stable, distinct for repeats, and content-sensitive", async () => {
  const fixture = await createFixture();
  const logPath = join(fixture.projectPath, ".auto", "log.jsonl");
  try {
    const first = [
      ...(await createRegistry(fixture.configPath)).projects.values(),
    ][0];
    const source = await readFile(logPath, "utf8");
    const repeated = source.split("\n")[2];
    await writeFile(logPath, `${source.trimEnd()}\n${repeated}\n`);
    const appended = [
      ...(await createRegistry(fixture.configPath)).projects.values(),
    ][0];
    assert.deepEqual(appended.runs.slice(0, 23), first.runs);
    assert.notEqual(appended.runs.at(-1)?.id, first.runs[1].id);
    assert.notEqual(appended.project.revision, first.project.revision);
    await writeFile(
      logPath,
      source.replace('"metric":4.569', '"metric":4.568'),
    );
    const rewritten = [
      ...(await createRegistry(fixture.configPath)).projects.values(),
    ][0];
    assert.notEqual(rewritten.runs[1].id, first.runs[1].id);
    assert.equal(rewritten.project.id, first.project.id);
    assert.notEqual(rewritten.project.revision, first.project.revision);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("direct-root discovery ignores child sessions", async () => {
  const fixture = await createFixture();
  try {
    await mkdir(join(fixture.directory, ".auto"));
    await writeFile(
      fixture.configPath,
      JSON.stringify({ roots: [{ path: ".", recursive: false }] }),
    );
    const registry = await createRegistry(fixture.configPath);
    assert.equal(registry.list.projects.length, 1);
    assert.equal(registry.list.projects[0].sourceState, "missing");
    assert.equal(registry.list.projects[0].runCount, 0);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
