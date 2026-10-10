import assert from "node:assert/strict";
import { test } from "node:test";
import { chmod, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DiffResponseSchema,
  ProjectSnapshotSchema,
  ProjectsResponseSchema,
} from "visualizar-common";
import type { ProjectSnapshot } from "visualizar-common";
import { createComparisonFixture } from "../../../scripts/visualizer-comparison-fixture.mjs";
import { hashFiles } from "../../../scripts/visualizer-fixture.mjs";
import { createDiffService } from "../src/git-diff.ts";
import { createDiffCache } from "../src/diff-cache.ts";
import { createApp } from "../src/server.ts";

const origin = "http://127.0.0.1:4310";
const headers = { host: "127.0.0.1:4310", origin };
async function snapshots(app: Awaited<ReturnType<typeof createApp>>) {
  const list = ProjectsResponseSchema.parse(
    (await app.inject({ url: "/api/projects", headers })).json(),
  );
  return Promise.all(
    list.projects.map(async (project) =>
      ProjectSnapshotSchema.parse(
        (
          await app.inject({ url: `/api/projects/${project.id}`, headers })
        ).json(),
      ),
    ),
  );
}
function requestDiff(
  app: Awaited<ReturnType<typeof createApp>>,
  snapshot: ProjectSnapshot,
  run: number,
  query = "",
) {
  return app.inject({
    url: `/api/projects/${snapshot.project.id}/runs/${snapshot.runs.find((value) => value.run === run)!.id}/diff?revision=${snapshot.project.revision}${query}`,
    headers,
  });
}

test("historical comparisons expose real parent/baseline/artifact patches, metadata, binary and linked worktrees without writes", async () => {
  const fixture = await createComparisonFixture();
  const beforeRepo = await hashFiles(fixture.repo);
  const beforeLinked = await hashFiles(fixture.linked);
  const app = await createApp({
    configPath: fixture.configPath,
    apiOrigin: origin,
    uiOrigin: origin,
  });
  try {
    const all = await snapshots(app);
    const project = all.find(
      (value) => value.project.rootPath === fixture.projectPath,
    )!;
    const diff = async (n: number, query = "") =>
      DiffResponseSchema.parse(
        (await requestDiff(app, project, n, query)).json(),
      );
    const parent = await diff(3);
    assert.equal(parent.state, "empty");
    const baseline = await diff(3, "&comparison=baseline");
    assert.equal(baseline.state, "available");
    if (baseline.state === "available") {
      assert.equal(baseline.base.oid, fixture.rootOid);
      assert.equal(baseline.target.oid, fixture.logsOnlyOid);
      assert.deepEqual(
        baseline.files.map((file) => file.path),
        ["project/code.ts"],
      );
      assert.match(baseline.patch, /-export const value = 1/);
      assert.match(baseline.patch, /\+export const value = 2/);
      assert.doesNotMatch(baseline.patch, /sibling|\.auto/);
    }
    const artifacts = await diff(3, "&includeAuto=true");
    assert.equal(artifacts.state, "available");
    if (artifacts.state === "available")
      assert.deepEqual(
        artifacts.files.map((file) => file.path),
        ["project/.auto/trace.txt"],
      );
    assert.equal((await diff(1, "&comparison=baseline")).state, "empty");
    const root = await diff(1);
    assert.equal(root.base?.kind, "empty-tree");
    const binary = await diff(4);
    assert.equal(binary.state, "binary");
    if (binary.state === "binary") {
      assert.equal(binary.files[0].binary, true);
      assert.equal(binary.files[0].additions, null);
      assert.equal(binary.files[0].deletions, null);
    }
    const mixed = await diff(4, "&comparison=baseline");
    assert.equal(mixed.state, "available");
    if (mixed.state === "available") assert.equal(mixed.containsBinary, true);
    const metadata = await diff(5);
    assert.equal(metadata.state, "available");
    if (metadata.state === "available") {
      assert.equal(
        metadata.files.find(
          (file) => file.path === `project/${fixture.renamedPath}`,
        )?.oldPath,
        "project/notes.md",
      );
      assert.equal(
        metadata.files.find(
          (file) => file.path === `project/${fixture.renamedPath}`,
        )?.status,
        "renamed",
      );
      assert.equal(
        metadata.files.find(
          (file) => file.path === `project/${fixture.unusualPath}`,
        )?.additions,
        2,
      );
      assert.match(metadata.patch, /No newline at end of file/);
      assert.match(
        metadata.files.find((file) => file.path === "project/benchmark.sh")!
          .patch,
        /old mode 100644\nnew mode 100755/,
      );
      assert.equal(
        metadata.files.find((file) => file.path === "project/remove.txt")
          ?.status,
        "deleted",
      );
    }
    const merge = await diff(6);
    assert.equal(merge.state, "available");
    if (merge.state === "available") {
      assert.equal(merge.targetParentCount, 2);
      assert.equal(merge.base.oid, fixture.firstParentOid);
      assert.deepEqual(
        merge.files.map((file) => file.path),
        ["project/feature.txt"],
      );
    }
    const linked = all.find(
      (value) => value.project.rootPath === join(fixture.linked, "project"),
    )!;
    const linkedDiff = DiffResponseSchema.parse(
      (await requestDiff(app, linked, 6, "&comparison=baseline")).json(),
    );
    assert.equal(linkedDiff.state, "available");
    assert.equal(linkedDiff.gitDirectoryKind, "file");
    if (linkedDiff.state === "available")
      assert.match(linkedDiff.patch, /\+export const value = 3/);
    assert.equal((await diff(7)).state, "limited");
    for (const query of [
      "&comparison=head",
      "&includeAuto=1",
      "&path=outside",
      "&includeAuto=true&includeAuto=false",
    ]) {
      assert.equal((await requestDiff(app, project, 2, query)).statusCode, 400);
    }
    assert.deepEqual(await hashFiles(fixture.repo), beforeRepo);
    assert.deepEqual(await hashFiles(fixture.linked), beforeLinked);
  } finally {
    await app.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("missing first-kept baseline commits remain unavailable without parent or later-keep substitution", async () => {
  const fixture = await createComparisonFixture();
  const app = await createApp({
    configPath: fixture.configPath,
    apiOrigin: origin,
    uiOrigin: origin,
  });
  try {
    const project = (await snapshots(app)).find(
      (value) => value.project.rootPath === fixture.projectPath,
    )!;
    for (const [n, reason] of [
      [102, "baseline-unavailable"],
      [202, "baseline-commit-not-recorded"],
      [302, "baseline-unavailable"],
      [401, "baseline-not-recorded"],
    ] as const) {
      assert.equal(
        DiffResponseSchema.parse((await requestDiff(app, project, n)).json())
          .state,
        "available",
      );
      const diff = DiffResponseSchema.parse(
        (await requestDiff(app, project, n, "&comparison=baseline")).json(),
      );
      assert.equal(diff.state, "missing");
      if (diff.state === "missing") assert.equal(diff.reason, reason);
      assert.equal(diff.base, undefined);
      assert.equal(diff.target?.oid, fixture.scopedOid);
      assert.equal(
        project.runs.find((run) => run.run === n)?.metric,
        n === 401 ? 100 : 99,
      );
    }
  } finally {
    await app.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("resolved comparison cache separates revisions, bases, targets, paths, repositories and artifacts and enforces LRU bounds", async () => {
  const fixture = await createComparisonFixture();
  const app = await createApp({
    configPath: fixture.configPath,
    apiOrigin: origin,
    uiOrigin: origin,
  });
  try {
    const all = await snapshots(app);
    const snapshot = all.find(
      (value) => value.project.rootPath === fixture.projectPath,
    )!;
    const baseline = snapshot.runs[0];
    const service = createDiffService();
    const request = {
      baseline,
      revision: snapshot.project.revision,
      comparison: "parent" as const,
      includeAuto: false,
    };
    const first = await service.resolve(
      fixture.projectPath,
      snapshot.runs[1],
      request,
    );
    assert.equal(first.state, "available");
    const second = await service.resolve(
      fixture.projectPath,
      snapshot.runs[1],
      request,
    );
    assert.deepEqual(second, first);
    assert.equal(service.cache.stats.hits, 1);
    assert.equal(service.cache.stats.entries, 1);
    if (second.state === "available")
      second.files[0].path = "mutated by client";
    assert.deepEqual(
      await service.resolve(fixture.projectPath, snapshot.runs[1], request),
      first,
    );
    const hits = service.cache.stats.hits;
    await service.resolve(fixture.projectPath, snapshot.runs[1], {
      ...request,
      revision: "another",
    });
    await service.resolve(fixture.projectPath, snapshot.runs[1], {
      ...request,
      includeAuto: true,
    });
    await service.resolve(fixture.projectPath, snapshot.runs[2], request);
    await service.resolve(fixture.projectPath, snapshot.runs[2], {
      ...request,
      comparison: "baseline",
    });
    await service.resolve(fixture.projectPath, snapshot.runs[2], {
      ...request,
      comparison: "baseline",
      baseline: snapshot.runs[1],
    });
    await service.resolve(
      join(fixture.repo, "sibling"),
      snapshot.runs[1],
      request,
    );
    await service.resolve(
      join(fixture.linked, "project"),
      snapshot.runs[1],
      request,
    );
    assert.equal(service.cache.stats.hits, hits);
    assert.equal(service.cache.stats.entries, 8);
    await service.resolve(fixture.projectPath, snapshot.runs[6], request);
    assert.equal(
      service.cache.stats.entries,
      8,
      "limited results are not cached",
    );
    const cache = createDiffCache(2, 10_000);
    cache.set("a", first);
    cache.set("b", first);
    cache.get("a");
    cache.set("c", first);
    assert.equal(cache.get("b"), undefined);
    assert.ok(cache.get("a"));
    assert.ok(cache.get("c"));
    assert.equal(cache.stats.entries, 2);
    assert.ok(cache.stats.bytes <= 10_000);
    const tiny = createDiffCache(64, 1);
    tiny.set("a", first);
    assert.equal(tiny.stats.entries, 0);
    const byteBound = createDiffCache(
      64,
      Buffer.byteLength(JSON.stringify(first)) + 10,
    );
    byteBound.set("a", first);
    byteBound.set("b", first);
    assert.equal(byteBound.stats.entries, 1);
    service.cache.clear();
    assert.equal(service.cache.stats.bytes, 0);
  } finally {
    await app.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("refresh while a comparison is running rejects its old revision after Git completes", async () => {
  const fixture = await createComparisonFixture();
  const marker = join(fixture.directory, "patch-started");
  const wrapper = join(fixture.directory, "slow-patch-git");
  await writeFile(
    wrapper,
    `#!/bin/sh\ncase " $* " in *" --patch "*) touch '${marker}'; sleep 0.3;; esac\nexec git "$@"\n`,
  );
  await chmod(wrapper, 0o755);
  const app = await createApp({
    configPath: fixture.configPath,
    apiOrigin: origin,
    uiOrigin: origin,
    gitDiffOptions: { gitBinary: wrapper },
  });
  try {
    const snapshot = (await snapshots(app)).find(
      (value) => value.project.rootPath === fixture.projectPath,
    )!;
    const pending = requestDiff(app, snapshot, 2).then((result) => result);
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      try {
        await readFile(marker);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    await readFile(marker);
    await writeFile(
      join(fixture.projectPath, ".auto", "ideas.md"),
      "changed current notes\n",
    );
    assert.equal(
      (await app.inject({ method: "POST", url: "/api/refresh", headers }))
        .statusCode,
      200,
    );
    assert.equal((await pending).statusCode, 409);
    assert.equal(
      (await requestDiff(app, snapshot, 2, "&comparison=baseline")).statusCode,
      409,
    );
    const fresh = (await snapshots(app)).find(
      (value) => value.project.id === snapshot.project.id,
    )!;
    assert.equal(
      (await requestDiff(app, fresh, 2, "&comparison=baseline")).statusCode,
      200,
    );
  } finally {
    await app.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
