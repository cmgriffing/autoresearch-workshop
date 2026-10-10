import assert from "node:assert/strict";
import { createServer } from "node:net";
import { test } from "node:test";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  LiveEventSchema,
  ProjectSnapshotSchema,
  ProjectsResponseSchema,
} from "visualizar-common";
import { createDocumentFixture } from "../../../scripts/visualizer-document-fixture.mjs";
import { createRegistry } from "../src/registry.ts";
import { createApp } from "../src/server.ts";

const waitFor = async (check: () => boolean | Promise<boolean>) => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("Timed out waiting for live reconciliation.");
};

const freePort = async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
};

async function nextEvent(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder();
  let source = "";
  for (;;) {
    const { done, value } = await reader.read();
    assert.equal(done, false);
    source += decoder.decode(value, { stream: true });
    const boundary = source.indexOf("\n\n");
    if (boundary < 0) continue;
    const block = source.slice(0, boundary);
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice(6))
      .join("\n");
    if (data) return LiveEventSchema.parse(JSON.parse(data));
    source = source.slice(boundary + 2);
  }
}

test("directory monitoring serializes coherent log and document snapshots", async () => {
  const fixture = await createDocumentFixture();
  const registry = await createRegistry(fixture.configPath);
  const events: unknown[] = [];
  const unsubscribe = registry.subscribe((event) => events.push(event));
  registry.startMonitoring();
  try {
    const project = registry.list.projects.find(
      (candidate) => candidate.rootPath === fixture.alpha,
    )!;
    const initial = registry.projects.get(project.id)!;
    const logPath = join(fixture.alpha, ".auto/log.jsonl");
    const original = await readFile(logPath, "utf8");

    await writeFile(logPath, `${original}{"run":3,"metric":12`);
    await waitFor(
      () =>
        registry.projects.get(project.id)?.project.revision !==
        initial.project.revision,
    );
    assert.equal(registry.projects.get(project.id)?.runs.length, 2);
    await writeFile(
      logPath,
      `${original}{"run":3,"metric":12,"status":"keep"}\n`,
    );
    await waitFor(() => registry.projects.get(project.id)?.runs.length === 3);
    const appended = registry.projects.get(project.id)!;
    assert.deepEqual(
      appended.runs.slice(0, 2).map((run) => run.id),
      initial.runs.map((run) => run.id),
    );

    await writeFile(`${fixture.ideasPath}.new`, "# Live replacement\n");
    await rename(`${fixture.ideasPath}.new`, fixture.ideasPath);
    await waitFor(
      () =>
        registry.projects.get(project.id)?.documents.ideas.state === "ready" &&
        registry.projects
          .get(project.id)
          ?.documents.ideas.content.includes("Live replacement"),
    );

    await writeFile(
      `${logPath}.new`,
      `${original}{"run":9,"metric":7,"status":"keep"}\n`,
    );
    await rename(`${logPath}.new`, logPath);
    await waitFor(
      () => registry.projects.get(project.id)?.runs.at(-1)?.run === 9,
    );
    assert.notDeepEqual(
      registry.projects.get(project.id)?.runs.map((run) => run.id),
      appended.runs.map((run) => run.id),
    );

    await rename(logPath, `${logPath}.saved`);
    await mkdir(logPath);
    await waitFor(
      () => registry.projects.get(project.id)?.project.stale === true,
    );
    const stale = registry.projects.get(project.id)!;
    assert.equal(stale.runs.at(-1)?.run, 9);
    await rm(logPath, { recursive: true });
    await rename(`${logPath}.saved`, logPath);
    await waitFor(
      () => registry.projects.get(project.id)?.project.stale === false,
    );

    const invalidations = events.map((event) => LiveEventSchema.parse(event));
    assert.ok(invalidations.length >= 5);
    assert.ok(
      invalidations.every(
        (event) =>
          event.type === "invalidate" &&
          ["source-change", "discovery"].includes(event.reason),
      ),
    );
    assert.deepEqual(
      invalidations.map((event) => event.indexRevision),
      invalidations
        .map((event) => event.indexRevision)
        .toSorted((a, b) => a - b),
    );
  } finally {
    unsubscribe();
    await registry.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("watch false stays manual and SSE reconnects to the current revision", async () => {
  const fixture = await createDocumentFixture();
  await writeFile(
    fixture.configPath,
    JSON.stringify({
      roots: [{ path: fixture.alpha, recursive: false }],
      watch: false,
    }),
  );
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const app = await createApp({
    configPath: fixture.configPath,
    apiOrigin: origin,
    uiOrigin: origin,
  });
  await app.listen({ host: "127.0.0.1", port });
  try {
    const initial = ProjectsResponseSchema.parse(
      await (await fetch(`${origin}/api/projects`)).json(),
    );
    assert.equal(initial.watchEnabled, false);
    const project = initial.projects[0];
    const before = ProjectSnapshotSchema.parse(
      await (await fetch(`${origin}/api/projects/${project.id}`)).json(),
    );
    const stream = await fetch(`${origin}/api/events`);
    assert.equal(stream.status, 200);
    const reader = stream.body!.getReader();
    assert.deepEqual(await nextEvent(reader), {
      type: "connected",
      indexRevision: initial.indexRevision,
    });
    const logPath = join(fixture.alpha, ".auto/log.jsonl");
    await writeFile(
      logPath,
      `${await readFile(logPath, "utf8")}{"run":3,"metric":8,"status":"keep"}\n`,
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    const unchanged = ProjectSnapshotSchema.parse(
      await (await fetch(`${origin}/api/projects/${project.id}`)).json(),
    );
    assert.equal(unchanged.runs.length, before.runs.length);
    const refreshed = await fetch(`${origin}/api/refresh`, {
      method: "POST",
      headers: { origin },
    });
    assert.equal(refreshed.status, 200);
    const invalidation = await nextEvent(reader);
    assert.equal(invalidation.type, "invalidate");
    assert.equal(invalidation.reason, "manual-refresh");
    assert.equal(invalidation.projects[0]?.id, project.id);
    await reader.cancel();

    const reconnect = await fetch(`${origin}/api/events`);
    const reconnectReader = reconnect.body!.getReader();
    const connected = await nextEvent(reconnectReader);
    assert.equal(connected.type, "connected");
    assert.equal(connected.indexRevision, invalidation.indexRevision);
    await reconnectReader.cancel();
  } finally {
    await app.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
