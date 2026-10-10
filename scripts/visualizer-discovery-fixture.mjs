import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  readlink,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function writeSession(path, name, metrics = [10, 9]) {
  await mkdir(join(path, ".auto"), { recursive: true });
  await writeFile(
    join(path, ".auto", "log.jsonl"),
    [
      {
        type: "config",
        name,
        metricName: "latency",
        metricUnit: "ms",
        bestDirection: "lower",
      },
      ...metrics.map((metric, index) => ({
        run: index + 1,
        metric,
        status: "keep",
        description: `${name} result ${index + 1}`,
      })),
    ]
      .map((record) => JSON.stringify(record))
      .join("\n") + "\n",
  );
}

export async function createDiscoveryFixture() {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "visualizer-s04-")),
  );
  const workspace = join(directory, "workspace");
  const alpha = join(workspace, "a", "shared");
  const beta = join(workspace, "b", "shared");
  const child = join(alpha, "child");
  const uninitialized = join(workspace, "uninitialized");
  await writeSession(workspace, "Parent session");
  await writeSession(alpha, "Alpha session", [20, 15]);
  await writeSession(beta, "Beta session", [30, 27]);
  await writeSession(child, "Nested session", [3, 2]);
  await mkdir(join(uninitialized, ".auto"), { recursive: true });
  for (const skipped of ["node_modules", "dist", "custom-skip", ".auto"])
    await writeSession(join(workspace, skipped, "hidden"), "Excluded session");
  const outside = join(directory, "outside");
  await writeSession(outside, "External session");
  await symlink(workspace, join(workspace, "cycle"), "dir");
  await symlink(outside, join(workspace, "external-link"), "dir");
  await mkdir(join(workspace, "symlink-session"));
  await symlink(
    join(outside, ".auto"),
    join(workspace, "symlink-session", ".auto"),
    "dir",
  );
  await symlink(alpha, join(directory, "direct-link"), "dir");
  await mkdir(join(directory, "empty"));
  await writeFile(
    join(directory, "not-directory"),
    "A root must be a directory.\n",
  );
  await writeFile(
    join(workspace, "benchmark.sh"),
    "#!/bin/sh\nexit 99 # Never execute source scripts.\n",
  );
  // Fixture setup only. Reading/scanning starts after recording the Git state.
  const git = (args) =>
    execFileSync("git", ["-C", workspace, ...args], { stdio: "pipe" });
  git(["init", "--quiet"]);
  git(["add", "."]);
  git([
    "-c",
    "user.name=Visualizer fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "Discovery fixture",
  ]);
  const configPath = join(directory, "config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      roots: [
        { path: "./workspace" },
        { path: "./workspace/a" },
        { path: "./workspace/b", recursive: false },
        { path: "./direct-link", recursive: false },
        { path: "./missing" },
        { path: "./empty" },
        { path: "./not-directory" },
      ],
      exclude: [
        "node_modules",
        ".git",
        ".turbo",
        ".cache",
        "dist",
        "build",
        "custom-skip",
      ],
    }),
  );
  return {
    directory,
    workspace,
    alpha,
    beta,
    child,
    uninitialized,
    configPath,
  };
}

// Include Git index/refs and symlink targets; never follow fixture cycles.
export async function fingerprintDiscoveryFixture(directory) {
  const files = {};
  async function visit(path, prefix = "") {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const relative = `${prefix}${entry.name}`;
      const fullPath = join(path, entry.name);
      if (entry.isSymbolicLink())
        files[relative] = `symlink:${await readlink(fullPath)}`;
      else if (entry.isDirectory()) await visit(fullPath, `${relative}/`);
      else
        files[relative] = createHash("sha256")
          .update(await readFile(fullPath))
          .digest("hex");
    }
  }
  await visit(directory);
  return files;
}
