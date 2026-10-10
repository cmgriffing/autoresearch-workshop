import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApiErrorSchema,
  DiffResponseSchema,
  ProjectSnapshotSchema,
  ProjectsResponseSchema,
} from "visualizar-common";
import { hashFiles } from "../../../scripts/visualizer-fixture.mjs";
import { resolveParentDiff } from "../src/git-diff.ts";
import { createApp } from "../src/server.ts";

const exec = promisify(execFile);
const origin = "http://127.0.0.1:4310";
const headers = { host: "127.0.0.1:4310" };

async function git(repo: string, ...args: string[]) {
  return (await exec("git", ["-C", repo, ...args])).stdout.trim();
}

async function createGitFixture() {
  const directory = await mkdtemp(join(tmpdir(), "visualizer-s02-"));
  const repo = join(directory, "repo");
  const projectPath = join(repo, "project");
  await mkdir(join(projectPath, ".auto"), { recursive: true });
  await mkdir(join(repo, "sibling"));
  await git(repo, "init", "-q");
  await git(repo, "config", "user.name", "Visualizer Test");
  await git(repo, "config", "user.email", "visualizer@example.test");
  await writeFile(join(projectPath, "root.txt"), "root\n");
  await writeFile(join(repo, "sibling", "root.txt"), "sibling root\n");
  await git(repo, "add", "--all");
  await git(repo, "commit", "-qm", "root");
  const rootOid = await git(repo, "rev-parse", "HEAD");

  await writeFile(join(projectPath, "code.ts"), "export const answer = 42;\n");
  await writeFile(
    join(repo, "sibling", "outside.ts"),
    "export const outside = true;\n",
  );
  await git(repo, "add", "--all");
  await git(repo, "commit", "-qm", "project and sibling");
  const targetOid = await git(repo, "rev-parse", "HEAD");

  await writeFile(join(projectPath, ".auto", "trace.txt"), "session only\n");
  await git(repo, "add", "--all");
  await git(repo, "commit", "-qm", "session artifact only");
  const logsOnlyOid = await git(repo, "rev-parse", "HEAD");

  await writeFile(join(projectPath, "large.txt"), "x".repeat(8_192));
  await git(repo, "add", "--all");
  await git(repo, "commit", "-qm", "large patch");
  const largeOid = await git(repo, "rev-parse", "HEAD");

  const header = {
    type: "config",
    name: "diff fixture",
    metricName: "duration",
    metricUnit: "ms",
    bestDirection: "lower",
  };
  const runs = [
    { run: 1, metric: 10, status: "keep", commit: rootOid },
    { run: 2, metric: 9, status: "keep", commit: targetOid },
    { run: 3, metric: 8, status: "keep", commit: logsOnlyOid },
    { run: 4, metric: 7, status: "keep", commit: "deadbeef" },
    { run: 5, metric: 6, status: "keep", commit: "not-a-hash" },
    { run: 6, metric: 5, status: "keep" },
    { run: 7, metric: 4, status: "keep", commit: largeOid },
  ];
  await writeFile(
    join(projectPath, ".auto", "log.jsonl"),
    [header, ...runs].map((value) => JSON.stringify(value)).join("\n") + "\n",
  );
  const configPath = join(directory, "config.json");
  await writeFile(
    configPath,
    JSON.stringify({ roots: [{ path: "./repo/project", recursive: false }] }),
  );
  return {
    directory,
    repo,
    projectPath,
    configPath,
    rootOid,
    targetOid,
  };
}

test("lazy diff API resolves root and parent commits and scopes project paths", async () => {
  const fixture = await createGitFixture();
  const before = await hashFiles(fixture.repo);
  const beforeHead = await git(fixture.repo, "rev-parse", "HEAD");
  const beforeStatus = await git(fixture.repo, "status", "--porcelain=v1");
  const app = await createApp({
    configPath: fixture.configPath,
    apiOrigin: origin,
    uiOrigin: origin,
  });
  try {
    const list = ProjectsResponseSchema.parse(
      (await app.inject({ url: "/api/projects", headers })).json(),
    );
    const projectId = list.projects[0].id;
    const snapshot = ProjectSnapshotSchema.parse(
      (await app.inject({ url: `/api/projects/${projectId}`, headers })).json(),
    );
    const request = (index: number, revision = snapshot.project.revision) =>
      app.inject({
        url: `/api/projects/${projectId}/runs/${snapshot.runs[index].id}/diff?revision=${revision}`,
        headers,
      });

    const root = DiffResponseSchema.parse((await request(0)).json());
    assert.equal(root.state, "available");
    if (root.state === "available") {
      assert.equal(root.base.kind, "empty-tree");
      assert.equal(root.target.oid, fixture.rootOid);
      assert.match(root.patch, /project\/root\.txt/);
      assert.doesNotMatch(root.patch, /sibling\/root\.txt/);
      assert.doesNotMatch(root.patch, /\.auto/);
    }

    const parent = DiffResponseSchema.parse((await request(1)).json());
    assert.equal(parent.state, "available");
    if (parent.state === "available") {
      assert.equal(parent.base.oid, fixture.rootOid);
      assert.equal(parent.target.oid, fixture.targetOid);
      assert.match(parent.patch, /project\/code\.ts/);
      assert.doesNotMatch(parent.patch, /sibling\/outside\.ts/);
    }
    const empty = DiffResponseSchema.parse((await request(2)).json());
    assert.equal(empty.state, "empty");
    const missing = DiffResponseSchema.parse((await request(3)).json());
    assert.deepEqual(
      missing.state === "missing" && missing.reason,
      "commit-unavailable",
    );
    const invalid = DiffResponseSchema.parse((await request(4)).json());
    assert.deepEqual(
      invalid.state === "invalid" && invalid.reason,
      "commit-format",
    );
    const unrecorded = DiffResponseSchema.parse((await request(5)).json());
    assert.deepEqual(
      unrecorded.state === "missing" && unrecorded.reason,
      "commit-not-recorded",
    );

    const unknownRun = await app.inject({
      url: `/api/projects/${projectId}/runs/r_unknown/diff?revision=${snapshot.project.revision}`,
      headers,
    });
    assert.equal(unknownRun.statusCode, 404);
    assert.equal(
      ApiErrorSchema.parse(unknownRun.json()).error.code,
      "RUN_NOT_FOUND",
    );
    const stale = await request(1, "s_stale");
    assert.equal(stale.statusCode, 409);
    assert.equal(
      ApiErrorSchema.parse(stale.json()).error.code,
      "STALE_REVISION",
    );
    const withoutRevision = await app.inject({
      url: `/api/projects/${projectId}/runs/${snapshot.runs[1].id}/diff`,
      headers,
    });
    assert.equal(withoutRevision.statusCode, 400);
    assert.equal(
      ApiErrorSchema.parse(withoutRevision.json()).error.code,
      "REVISION_REQUIRED",
    );

    assert.equal(await git(fixture.repo, "rev-parse", "HEAD"), beforeHead);
    assert.equal(
      await git(fixture.repo, "status", "--porcelain=v1"),
      beforeStatus,
    );
    assert.deepEqual(await hashFiles(fixture.repo), before);
  } finally {
    await app.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("diff output and execution time are bounded with explicit states", async () => {
  const fixture = await createGitFixture();
  const app = await createApp({
    configPath: fixture.configPath,
    apiOrigin: origin,
    uiOrigin: origin,
    gitDiffOptions: { maxPatchBytes: 1_024 },
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
    const limited = DiffResponseSchema.parse(
      (
        await app.inject({
          url: `/api/projects/${snapshot.project.id}/runs/${snapshot.runs[6].id}/diff?revision=${snapshot.project.revision}`,
          headers,
        })
      ).json(),
    );
    assert.deepEqual(limited.state === "limited" && limited.reason, "output");

    const slowGit = join(fixture.directory, "slow-git");
    await writeFile(slowGit, "#!/bin/sh\nsleep 1\n");
    await chmod(slowGit, 0o755);
    const timedOut = await resolveParentDiff(
      fixture.projectPath,
      snapshot.runs[1],
      { gitBinary: slowGit, timeoutMs: 20 },
    );
    assert.deepEqual(
      timedOut.state === "limited" && timedOut.reason,
      "timeout",
    );

    const failingGit = join(fixture.directory, "failing-git");
    await writeFile(
      failingGit,
      `#!/bin/sh
if [ "$1" = "rev-parse" ] && [ "$2" = "--show-toplevel" ]; then cd ..; pwd; exit 0; fi
if [ "$1" = "rev-parse" ]; then printf '%040d\n' 1; exit 0; fi
if [ "$1" = "rev-list" ]; then printf '%040d %040d\n' 1 2; exit 0; fi
exit 7
`,
    );
    await chmod(failingGit, 0o755);
    const failed = await resolveParentDiff(
      fixture.projectPath,
      snapshot.runs[1],
      { gitBinary: failingGit },
    );
    assert.equal(failed.state, "failure");
  } finally {
    await app.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("project snapshots do not invoke Git until a diff is requested", async () => {
  const fixture = await createGitFixture();
  const app = await createApp({
    configPath: fixture.configPath,
    apiOrigin: origin,
    uiOrigin: origin,
    gitDiffOptions: { gitBinary: join(fixture.directory, "missing-git") },
  });
  try {
    const listResponse = await app.inject({ url: "/api/projects", headers });
    assert.equal(listResponse.statusCode, 200);
    const list = ProjectsResponseSchema.parse(listResponse.json());
    const snapshotResponse = await app.inject({
      url: `/api/projects/${list.projects[0].id}`,
      headers,
    });
    assert.equal(snapshotResponse.statusCode, 200);
    ProjectSnapshotSchema.parse(snapshotResponse.json());
  } finally {
    await app.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
