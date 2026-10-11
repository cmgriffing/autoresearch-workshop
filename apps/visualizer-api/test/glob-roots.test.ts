import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { writeSession } from "../../../scripts/visualizer-discovery-fixture.mjs";
import { createRegistry } from "../src/registry.ts";

async function fixture() {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "visualizer-glob-")),
  );
  const configDirectory = join(directory, "[config]");
  await mkdir(configDirectory);
  const configPath = join(configDirectory, "config.json");
  const configure = async (roots: unknown[], options = {}) =>
    writeFile(configPath, JSON.stringify({ roots, watch: false, ...options }));
  return { directory, configPath, configure };
}

test("relative glob roots expand from the config directory, preserve recursion and deduplicate overlapping projects", async () => {
  const f = await fixture();
  try {
    const worktrees = join(f.directory, "worktrees");
    const direct = join(worktrees, "demo-projects");
    const alpha = join(worktrees, "team/alpha/demo-projects");
    const zeta = join(worktrees, "zeta/demo-projects");
    for (const path of [direct, alpha, zeta])
      await writeSession(path, "Glob session");
    await writeSession(join(alpha, "nested"), "Nested session");
    await writeFile(join(worktrees, "file"), "Not a directory");
    await f.configure([
      { path: "../worktrees/**/demo-projects", recursive: false },
      { path: alpha },
    ]);
    const registry = await createRegistry(f.configPath);
    try {
      assert.deepEqual(
        registry.list.roots.map((root) => root.path),
        [direct, alpha, zeta, alpha],
      );
      assert.equal(registry.list.projects.length, 4);
      assert.equal(registry.list.diagnostics.length, 0);
      const project = registry.list.projects.find(
        (project) => project.rootPath === alpha && project.relativePath === ".",
      )!;
      assert.equal(project.rootAssociations.length, 2);
      const nested = registry.list.projects.find(
        (project) => project.name === "nested",
      )!;
      assert.equal(nested.rootAssociations.length, 1);
      assert.equal(
        nested.rootAssociations[0].rootId,
        registry.list.roots[3].id,
      );
      const roots = registry.list.roots;
      const ids = registry.list.projects.map((project) => project.id);
      await registry.refresh();
      assert.deepEqual(registry.list.roots, roots);
      assert.deepEqual(
        registry.list.projects.map((project) => project.id),
        ids,
      );
    } finally {
      await registry.close();
    }
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("absolute globs support wildcards, character classes and brace alternatives and match only directories", async () => {
  const f = await fixture();
  try {
    for (const name of ["alpha", "beta", "gamma"])
      await writeSession(join(f.directory, "projects", name), name);
    await writeFile(join(f.directory, "projects", "file"), "Not a directory");
    for (const [pattern, expected] of [
      ["*", ["alpha", "beta", "gamma"]],
      ["?eta", ["beta"]],
      ["[ab]*", ["alpha", "beta"]],
      ["{alpha,gamma}", ["alpha", "gamma"]],
    ] as const) {
      await f.configure([
        { path: join(f.directory, "projects", pattern), recursive: false },
      ]);
      const registry = await createRegistry(f.configPath);
      try {
        assert.deepEqual(
          registry.list.projects.map((project) => project.name),
          expected,
          pattern,
        );
        assert.equal(registry.list.diagnostics.length, 0);
      } finally {
        await registry.close();
      }
    }
    const literal = join(f.directory, "projects", "[literal]");
    await writeSession(literal, "Literal path");
    await f.configure([{ path: literal }]);
    const registry = await createRegistry(f.configPath);
    try {
      assert.equal(registry.list.projects[0].rootPath, literal);
      assert.equal(registry.list.projects.length, 1);
    } finally {
      await registry.close();
    }
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("glob expansion skips exclusions, .auto contents and symlinks, and respects custom exclusions", async () => {
  const f = await fixture();
  try {
    const root = join(f.directory, "worktrees");
    for (const name of ["visible", "node_modules", "dist", "custom", ".auto"])
      await writeSession(join(root, name, "demo-projects"), name);
    const outside = join(f.directory, "outside");
    await writeSession(join(outside, "demo-projects"), "Outside");
    await symlink(outside, join(root, "linked"), "dir");
    await symlink(root, join(root, "cycle"), "dir");
    const patterns = [
      "../worktrees/**/demo-projects",
      "../worktrees/*/demo-projects",
    ];
    for (const path of patterns) {
      await f.configure([{ path }]);
      const registry = await createRegistry(f.configPath);
      try {
        assert.deepEqual(
          registry.list.roots.map((root) => root.path),
          [
            join(root, "custom/demo-projects"),
            join(root, "visible/demo-projects"),
          ],
        );
      } finally {
        await registry.close();
      }
      await f.configure([{ path }], { exclude: ["custom"] });
      const customRegistry = await createRegistry(f.configPath);
      try {
        assert.deepEqual(
          customRegistry.list.roots.map((root) => root.path),
          [
            join(root, "dist/demo-projects"),
            join(root, "node_modules/demo-projects"),
            join(root, "visible/demo-projects"),
          ],
        );
      } finally {
        await customRegistry.close();
      }
    }
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("refresh re-expands unmatched patterns, adds and removes roots, and keeps surviving root and project IDs stable", async () => {
  const f = await fixture();
  try {
    await f.configure([{ path: "../worktrees/*/demo-projects" }]);
    const registry = await createRegistry(f.configPath);
    try {
      assert.equal(registry.list.projects.length, 0);
      assert.equal(registry.list.roots[0].state, "error");
      assert.equal(registry.list.diagnostics[0].code, "ROOT_GLOB_NO_MATCH");
      const zeta = join(f.directory, "worktrees/zeta/demo-projects");
      await writeSession(join(zeta, "session"), "Zeta");
      await registry.refresh();
      assert.equal(registry.list.projects.length, 1);
      assert.equal(registry.list.diagnostics.length, 0);
      const rootId = registry.list.roots[0].id;
      const projectId = registry.list.projects[0].id;
      const alpha = join(f.directory, "worktrees/alpha/demo-projects");
      await writeSession(alpha, "Alpha");
      await registry.refresh();
      assert.equal(registry.list.projects.length, 2);
      assert.equal(registry.list.roots[1].id, rootId);
      assert.equal(registry.list.projects[1].id, projectId);
      await rm(alpha, { recursive: true });
      await registry.refresh();
      assert.equal(registry.list.roots[0].id, rootId);
      assert.equal(registry.list.projects[0].id, projectId);
      await rm(zeta, { recursive: true });
      await registry.refresh();
      assert.equal(registry.list.projects.length, 0);
      assert.equal(registry.list.diagnostics[0].code, "ROOT_GLOB_NO_MATCH");
    } finally {
      await registry.close();
    }
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("periodic discovery finds new glob roots without manual refresh", async () => {
  const f = await fixture();
  try {
    await f.configure([{ path: "../worktrees/*/demo-projects" }], {
      watch: true,
      rescanIntervalMs: 25,
    });
    const registry = await createRegistry(f.configPath);
    registry.startMonitoring();
    try {
      await writeSession(
        join(f.directory, "worktrees/new/demo-projects/session"),
        "New worktree",
      );
      const deadline = Date.now() + 5000;
      while (!registry.list.projects.length && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(registry.list.projects.length, 1);
      assert.equal(registry.list.projects[0].name, "session");
      assert.equal(registry.list.diagnostics.length, 0);
    } finally {
      await registry.close();
    }
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});
