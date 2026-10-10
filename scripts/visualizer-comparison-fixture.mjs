import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const exec = promisify(execFile);
export async function fixtureGit(repo, ...args) {
  return (await exec("git", ["-C", repo, ...args])).stdout.trim();
}
export async function createComparisonFixture() {
  const directory = await mkdtemp(join(tmpdir(), "visualizer-s08-"));
  const repo = join(directory, "repo");
  const projectPath = join(repo, "project");
  const linked = join(directory, "linked");
  try {
    await mkdir(join(projectPath, ".auto"), { recursive: true });
    await mkdir(join(repo, "sibling", ".auto"), { recursive: true });
    const git = (...args) => fixtureGit(repo, ...args);
    await git("init", "-q", "--initial-branch=main");
    await git("config", "user.name", "Visualizer Comparison Test");
    await git("config", "user.email", "visualizer@example.test");
    // These tools must never be executed by the application.
    await writeFile(
      join(projectPath, "benchmark.sh"),
      "#!/bin/sh\ntouch SHOULD_NOT_EXIST\n",
    );
    await writeFile(
      join(projectPath, "code.ts"),
      "export const value = 1;\n// unchanged context\n",
    );
    await writeFile(join(projectPath, "notes.md"), "project documentation\n");
    await writeFile(join(projectPath, "remove.txt"), "removed later\n");
    await writeFile(join(repo, "sibling", "code.ts"), "sibling baseline\n");
    const commit = async (message) => {
      await git("add", "--all");
      await git("commit", "-qm", message);
      return git("rev-parse", "HEAD");
    };
    const rootOid = await commit("first kept baseline");
    await writeFile(
      join(projectPath, "code.ts"),
      "export const value = 2;\n// unchanged context\n",
    );
    await writeFile(join(projectPath, ".auto", "trace.txt"), "first trace\n");
    await writeFile(join(repo, "sibling", "code.ts"), "sibling changed\n");
    const scopedOid = await commit("code and session and sibling");
    await writeFile(join(projectPath, ".auto", "trace.txt"), "second trace\n");
    const logsOnlyOid = await commit("only session artifacts");
    await writeFile(
      join(projectPath, "asset.bin"),
      Buffer.from([0, 1, 2, 255, 0]),
    );
    const binaryOid = await commit("only binary content");
    const renamedPath = "notes renamed\t雪.md";
    const unusualPath = "odd\nname.txt";
    await rename(join(projectPath, "notes.md"), join(projectPath, renamedPath));
    await writeFile(
      join(projectPath, unusualPath),
      "<script>window.patchExecuted = true</script>\nno final newline",
    );
    await rm(join(projectPath, "remove.txt"));
    await chmod(join(projectPath, "benchmark.sh"), 0o755);
    const metadataOid = await commit("rename deletion mode and unusual paths");
    await git("checkout", "-qb", "feature", binaryOid);
    await writeFile(join(projectPath, "feature.txt"), "merged feature\n");
    await commit("feature branch");
    await git("checkout", "-q", "main");
    await writeFile(
      join(projectPath, "code.ts"),
      "export const value = 3;\n// unchanged context\n",
    );
    const firstParentOid = await commit("main branch code");
    await git("merge", "-q", "--no-ff", "feature", "-m", "merge result");
    const mergeOid = await git("rev-parse", "HEAD");
    await git("worktree", "add", "-q", "--detach", linked, mergeOid);
    await writeFile(
      join(projectPath, "large.txt"),
      "line of patch output\n".repeat(30_000),
    );
    const largeOid = await commit("over production patch limit");
    const header = (name) => ({
      type: "config",
      name,
      metricName: "duration",
      metricUnit: "ms",
      bestDirection: "lower",
    });
    const run = (n, metric, commit, status = "keep") => ({
      run: n,
      metric,
      commit,
      status,
      description: `Comparison result ${n}`,
    });
    const records = [
      header("Historical comparisons"),
      run(1, 10, rootOid),
      run(2, 9, scopedOid),
      run(3, 8, logsOnlyOid),
      run(4, 7, binaryOid),
      run(5, 6, metadataOid),
      run(6, 5, mergeOid),
      run(7, 4, largeOid),
      header("Missing recorded baseline"),
      run(101, 100, "deadbeef"),
      run(102, 99, scopedOid),
      header("Unrecorded baseline"),
      run(201, 100, undefined),
      run(202, 99, scopedOid),
      header("Invalid baseline"),
      run(301, 100, "not-a-hash"),
      run(302, 99, scopedOid),
      header("No kept baseline"),
      run(401, 100, scopedOid, "discard"),
    ];
    const source =
      records.map((value) => JSON.stringify(value)).join("\n") + "\n";
    await writeFile(join(projectPath, ".auto", "log.jsonl"), source);
    await writeFile(join(linked, "project", ".auto", "log.jsonl"), source);
    await writeFile(
      join(repo, "sibling", ".auto", "log.jsonl"),
      [header("Sibling"), run(1, 10, rootOid), run(2, 9, scopedOid)]
        .map((value) => JSON.stringify(value))
        .join("\n") + "\n",
    );
    const configPath = join(directory, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        roots: ["./repo/project", "./repo/sibling", "./linked/project"].map(
          (path) => ({ path, recursive: false }),
        ),
      }),
    );
    return {
      directory,
      repo,
      projectPath,
      linked,
      configPath,
      rootOid,
      scopedOid,
      logsOnlyOid,
      binaryOid,
      metadataOid,
      mergeOid,
      firstParentOid,
      largeOid,
      renamedPath,
      unusualPath,
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
