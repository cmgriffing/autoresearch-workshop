import assert from "node:assert/strict";
import { test } from "node:test";
import { rm } from "node:fs/promises";
import {
  AttemptPlotPointSchema,
  parseExperimentLog,
  ProjectSnapshotSchema,
  ProjectsResponseSchema,
  RunRecordSchema,
} from "visualizar-common";
import { createChartFixture } from "../../../scripts/visualizer-chart-fixture.mjs";
import { hashFiles } from "../../../scripts/visualizer-fixture.mjs";
import { createApp } from "../src/server.ts";

test("advisory confidence and arbitrary ASI JSON survive parsing without probability coercion", () => {
  const values = [
    { nested: [1, true, null, { message: "<script>" }] },
    ["context", 0],
    "text",
    0,
    false,
    null,
  ];
  const parsed = parseExperimentLog(
    values
      .map((asi, index) =>
        JSON.stringify({
          run: index + 1,
          metric: 10 - index,
          status: "keep",
          confidence: [0, -1, 200, 0.01, null, 42][index],
          asi,
        }),
      )
      .join("\n"),
  );
  assert.deepEqual(
    parsed.records.map(({ record }) => record.asi),
    values,
  );
  assert.deepEqual(
    parsed.records.map(({ record }) => record.confidence),
    [0, -1, 200, 0.01, null, 42],
  );
  assert.equal(parsed.records.length, 6);
  assert.equal(
    RunRecordSchema.safeParse({
      run: 1,
      metric: 1,
      status: "keep",
      confidence: Infinity,
    }).success,
    false,
  );
  assert.equal(
    AttemptPlotPointSchema.safeParse({ metric: Infinity }).success,
    false,
  );
});

test("invalid optional timestamp, confidence, ASI and secondary metrics retain otherwise valid runs", () => {
  const parsed = parseExperimentLog(
    [
      '{"run":1,"metric":4,"status":"keep","confidence":"high","timestamp":"today","asi":{"nonfinite":1e400},"metrics":{"good":3,"bad":null}}',
      '{"run":2,"metric":3,"status":"keep","timestamp":8640000000000001}',
      '{"run":3,"metric":2,"status":"keep","timestamp":null,"confidence":null,"asi":null}',
      '{"run":4,"metric":1,"status":"keep","timestamp":0}',
    ].join("\n"),
  );
  assert.equal(parsed.records.length, 4);
  const first = parsed.records[0].record;
  assert.equal(first.timestamp, undefined);
  assert.equal(first.confidence, undefined);
  assert.equal(first.asi, undefined);
  assert.deepEqual(first.metrics, { good: 3 });
  assert.equal(parsed.records[1].record.timestamp, undefined);
  assert.equal(parsed.records[2].record.timestamp, null);
  assert.equal(parsed.records[2].record.asi, null);
  assert.equal(parsed.records[3].record.timestamp, 0);
  for (const code of [
    "INVALID_TIMESTAMP",
    "INVALID_CONFIDENCE",
    "INVALID_ASI",
    "INVALID_SECONDARY_METRIC",
  ])
    assert.ok(
      parsed.diagnostics.some(
        (diagnostic) => diagnostic.code === code && diagnostic.sourceLine === 1,
      ),
    );
});

test("typed API exposes source-ordered segment attempts and a kept-only trajectory without source writes", async () => {
  const fixture = await createChartFixture();
  const before = await hashFiles(fixture.directory);
  const origin = "http://127.0.0.1:4310";
  const headers = { host: "127.0.0.1:4310" };
  const app = await createApp({
    configPath: fixture.configPath,
    apiOrigin: origin,
    uiOrigin: origin,
  });
  try {
    const list = ProjectsResponseSchema.parse(
      (await app.inject({ url: "/api/projects", headers })).json(),
    );
    const snapshot = ProjectSnapshotSchema.parse(
      (
        await app.inject({
          url: `/api/projects/${list.projects[0].id}`,
          headers,
        })
      ).json(),
    );
    const [lower, higher, empty, failures, single, discards] =
      snapshot.segments;
    assert.deepEqual(
      lower.attempts.map((point) => point.run),
      [9, 2, 7, 4, 4, 6, 3, 8],
    );
    assert.deepEqual(
      lower.attempts.map((point) => point.attempt),
      [1, 2, 3, 4, 5, 6, 7, 8],
    );
    assert.deepEqual(
      lower.attempts.map((point) => point.metric),
      [null, 10, 1, 9, 12, null, 8, null],
    );
    assert.deepEqual(
      lower.attempts.map((point) => point.bestMetric),
      [null, 10, 10, 9, 9, 9, 8, 8],
    );
    assert.equal(lower.attempts.filter((point) => point.isBaseline).length, 1);
    assert.deepEqual(
      lower.attempts
        .filter((point) => point.isWin)
        .map((point) => point.attempt),
      [4, 7],
    );
    assert.notEqual(lower.attempts[3].runId, lower.attempts[4].runId);
    assert.deepEqual(
      lower.attempts.map((point) => point.runId),
      lower.runIds,
    );
    assert.equal(lower.attempts[3].bestRunId, lower.attempts[3].runId);
    assert.equal(lower.attempts[4].bestRunId, lower.attempts[3].runId);
    assert.equal(snapshot.runs[0].metric, 0);
    assert.equal(snapshot.runs[7].metric, -100);
    assert.equal(snapshot.runs[1].confidence, 58.25301204819275);
    assert.deepEqual(snapshot.runs[1].metrics, { memory_mib: 32, mbps: 100 });
    assert.equal(snapshot.runs[1].timestamp, 1791342240000);
    assert.deepEqual(snapshot.runs[1].asi, fixture.records[2].asi);
    assert.deepEqual(
      higher.attempts.map((point) => point.bestMetric),
      [0, 5, 5, 10, 10],
    );
    assert.deepEqual(
      higher.wins.map((win) => win.incremental.percentage),
      [null, 100],
    );
    assert.equal(higher.attempts[0].metric, 0);
    assert.deepEqual(empty.attempts, []);
    assert.ok(
      failures.attempts.every(
        (point) =>
          point.metric === null &&
          point.bestMetric === null &&
          !point.isWin &&
          !point.isBaseline,
      ),
    );
    assert.equal(single.attempts[0].isBaseline, true);
    assert.ok(
      discards.attempts.every(
        (point) => point.bestMetric === null && !point.isWin,
      ),
    );
    assert.equal(discards.attempts[0].metric, 0);
    assert.deepEqual(await hashFiles(fixture.directory), before);
  } finally {
    await app.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
