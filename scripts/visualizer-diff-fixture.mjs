import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const exec = promisify(execFile);
async function git(repo, ...args) {
  return (await exec("git", ["-C", repo, ...args])).stdout.trim();
}

export async function createDiffFixture() {
  const directory = await mkdtemp(join(tmpdir(), "visualizer-s02-browser-"));
  const repo = join(directory, "repo");
  const projectPath = join(repo, "project");
  await mkdir(join(projectPath, ".auto"), { recursive: true });
  await mkdir(join(repo, "sibling"));
  await git(repo, "init", "-q");
  await git(repo, "config", "user.name", "Visualizer Browser Test");
  await git(repo, "config", "user.email", "visualizer@example.test");
  await writeFile(join(projectPath, "root.txt"), "root content\n");
  await writeFile(join(repo, "sibling", "root.txt"), "sibling root\n");
  await git(repo, "add", "--all");
  await git(repo, "commit", "-qm", "root result");
  const rootOid = await git(repo, "rev-parse", "HEAD");

  await writeFile(join(projectPath, "code.ts"), "export const answer = 42;\n");
  await writeFile(
    join(repo, "sibling", "outside.ts"),
    "export const outside = true;\n",
  );
  await git(repo, "add", "--all");
  await git(repo, "commit", "-qm", "scoped result");
  const scopedOid = await git(repo, "rev-parse", "HEAD");

  await writeFile(join(projectPath, ".auto", "trace.txt"), "session only\n");
  await git(repo, "add", "--all");
  await git(repo, "commit", "-qm", "session artifact only");
  const logsOnlyOid = await git(repo, "rev-parse", "HEAD");

  const records = [
    {
      type: "config",
      name: "Scoped diff fixture",
      metricName: "duration",
      metricUnit: "ms",
      bestDirection: "lower",
    },
    {
      run: 1,
      metric: 10,
      status: "keep",
      commit: rootOid,
      description: "Root result",
    },
    {
      run: 2,
      metric: 9,
      status: "keep",
      commit: scopedOid,
      description: "Project and sibling changed",
    },
    {
      run: 3,
      metric: 8,
      status: "keep",
      commit: logsOnlyOid,
      description: "Only session artifacts changed",
    },
    {
      run: 4,
      metric: 7,
      status: "keep",
      commit: "deadbeef",
      description: "Unavailable historical object",
    },
  ];
  await writeFile(
    join(projectPath, ".auto", "log.jsonl"),
    records.map((value) => JSON.stringify(value)).join("\n") + "\n",
  );
  const configPath = join(directory, "config.json");
  await writeFile(
    configPath,
    JSON.stringify({ roots: [{ path: "./repo/project", recursive: false }] }),
  );
  return { directory, repo, projectPath, configPath, rootOid, scopedOid };
}
