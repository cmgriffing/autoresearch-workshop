import { spawn } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import type {
  ChangedFile,
  DiffComparison,
  DiffResponse,
  RunSnapshot,
} from "visualizar-common";
import { DiffResponseSchema } from "visualizar-common";
import { createDiffCache } from "./diff-cache.ts";
import type { DiffCache } from "./diff-cache.ts";

export const DEFAULT_GIT_TIMEOUT_MS = 5_000;
export const DEFAULT_PATCH_LIMIT_BYTES = 512 * 1024;
const METADATA_LIMIT_BYTES = 64 * 1024;

export type GitDiffOptions = {
  gitBinary?: string;
  timeoutMs?: number;
  maxPatchBytes?: number;
};

export type ComparisonRequest = {
  comparison: DiffComparison;
  includeAuto: boolean;
  revision: string;
  baseline: RunSnapshot | null;
};

class GitCommandError extends Error {
  readonly kind: "timeout" | "output" | "exit" | "spawn";
  readonly stderr: string;

  constructor(
    kind: "timeout" | "output" | "exit" | "spawn",
    message: string,
    stderr = "",
  ) {
    super(message);
    this.kind = kind;
    this.stderr = stderr;
  }
}

function runGit(
  cwd: string,
  args: string[],
  options: GitDiffOptions,
  maxBytes = METADATA_LIMIT_BYTES,
  input?: string,
) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const safeEnvironment = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
    );
    const child = spawn(options.gitBinary ?? "git", args, {
      cwd,
      env: {
        ...safeEnvironment,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
        GIT_NO_REPLACE_OBJECTS: "1",
        GIT_OPTIONAL_LOCKS: "0",
        LC_ALL: "C",
      },
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (error?: GitCommandError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else
        resolve({
          stdout: Buffer.concat(chunks).toString("utf8"),
          stderr: Buffer.concat(errorChunks).toString("utf8"),
        });
    };
    const collect = (chunk: Buffer, target: Buffer[]) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        child.kill("SIGKILL");
        finish(
          new GitCommandError(
            "output",
            `Git output exceeded ${maxBytes} bytes.`,
          ),
        );
        return;
      }
      target.push(chunk);
    };
    child.stdout!.on("data", (chunk: Buffer) => collect(chunk, chunks));
    child.stderr!.on("data", (chunk: Buffer) => collect(chunk, errorChunks));
    child.on("error", (error) =>
      finish(new GitCommandError("spawn", error.message)),
    );
    child.on("close", (code, signal) => {
      if (settled) return;
      const stderr = Buffer.concat(errorChunks).toString("utf8");
      if (code === 0) finish();
      else
        finish(
          new GitCommandError(
            "exit",
            `Git exited with ${code ?? signal ?? "an unknown status"}.`,
            stderr,
          ),
        );
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(
        new GitCommandError(
          "timeout",
          `Git exceeded ${options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS} ms.`,
        ),
      );
    }, options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS);
    timer.unref();
    if (input !== undefined) child.stdin!.end(input);
  });
}
const response = (value: DiffResponse) => DiffResponseSchema.parse(value);
const validCommit = (value: string | undefined) =>
  value !== undefined && /^[0-9a-f]{4,64}$/i.test(value);

async function resolveCommit(
  path: string,
  commit: string,
  options: GitDiffOptions,
) {
  return (
    await runGit(
      path,
      ["rev-parse", "--verify", "--end-of-options", `${commit}^{commit}`],
      options,
    )
  ).stdout.trim();
}

// NUL-delimited Git metadata preserves spaces, tabs, newlines and quoted paths.
function changedFiles(
  names: string,
  stats: string,
  patch: string,
): ChangedFile[] {
  const statusNames: Record<string, ChangedFile["status"]> = {
    A: "added",
    D: "deleted",
    M: "modified",
    R: "renamed",
    C: "copied",
    T: "type-changed",
  };
  const paths = names.split("\0");
  const files: Omit<
    ChangedFile,
    "additions" | "deletions" | "binary" | "patch"
  >[] = [];
  for (let index = 0; index < paths.length - 1;) {
    const code = paths[index++];
    const status = statusNames[code[0]];
    if (!status) throw new Error("Unsupported changed-file metadata.");
    const first = paths[index++];
    const renamed = code[0] === "R" || code[0] === "C";
    files.push({
      status,
      path: renamed ? paths[index++] : first,
      oldPath: renamed ? first : null,
    });
  }
  const counts = stats.split("\0");
  const patches =
    patch.match(/^diff --git [\s\S]*?(?=^diff --git |$(?![\s\S]))/gm) ?? [];
  if (patches.length !== files.length)
    throw new Error("Incomplete file patches.");
  let countIndex = 0;
  return files.map((file, index) => {
    const entry = /^([^\t]+)\t([^\t]+)\t([\s\S]*)$/.exec(counts[countIndex++]);
    if (!entry) throw new Error("Incomplete file statistics.");
    const [, added, deleted, path] = entry;
    if (path === "") {
      if (
        counts[countIndex++] !== file.oldPath ||
        counts[countIndex++] !== file.path
      )
        throw new Error("Mismatched rename statistics.");
    } else if (path !== file.path)
      throw new Error("Mismatched file statistics.");
    const binary = added === "-" || deleted === "-";
    return {
      ...file,
      binary,
      additions: binary ? null : Number(added),
      deletions: binary ? null : Number(deleted),
      patch: patches[index],
    };
  });
}

export async function resolveHistoricalDiff(
  projectPath: string,
  run: RunSnapshot,
  request: ComparisonRequest,
  options: GitDiffOptions = {},
  cache?: DiffCache,
): Promise<DiffResponse> {
  const { comparison, includeAuto } = request;
  const context = { comparison, includeAuto };
  if (!run.commit)
    return response({
      ...context,
      state: "missing",
      reason: "commit-not-recorded",
      message: "This experiment did not record a commit reference.",
    });
  if (!validCommit(run.commit))
    return response({
      ...context,
      state: "invalid",
      reason: "commit-format",
      recordedCommit: run.commit,
      message: "The recorded commit is not a hexadecimal Git object ID.",
    });

  let repository: string;
  let gitDirectoryKind: "file" | "directory";
  try {
    repository = await realpath(
      (
        await runGit(projectPath, ["rev-parse", "--show-toplevel"], options)
      ).stdout.replace(/\r?\n$/, ""),
    );
    projectPath = await realpath(projectPath);
    gitDirectoryKind = (await lstat(join(repository, ".git"))).isFile()
      ? "file"
      : "directory";
  } catch (error) {
    if (
      error instanceof GitCommandError &&
      (error.kind === "timeout" || error.kind === "output")
    )
      return response({
        ...context,
        state: "limited",
        reason: error.kind,
        message: "Git repository discovery exceeded its limit.",
      });
    return response({
      ...context,
      state: "missing",
      reason: "repository-unavailable",
      recordedCommit: run.commit,
      message: "This project is not inside an available Git worktree.",
    });
  }

  let targetOid: string;
  try {
    targetOid = await resolveCommit(projectPath, run.commit, options);
  } catch (error) {
    if (
      error instanceof GitCommandError &&
      (error.kind === "timeout" || error.kind === "output")
    )
      return response({
        ...context,
        state: "limited",
        reason: error.kind,
        message: "Commit resolution exceeded its limit.",
      });
    if (
      error instanceof GitCommandError &&
      /ambiguous|short object ID/i.test(error.stderr)
    )
      return response({
        ...context,
        state: "invalid",
        reason: "commit-ambiguous",
        recordedCommit: run.commit,
        message: "The recorded commit abbreviation is ambiguous.",
      });
    return response({
      ...context,
      state: "missing",
      reason: "commit-unavailable",
      recordedCommit: run.commit,
      message: "The recorded commit is not available in this Git worktree.",
    });
  }

  const target = { kind: "commit" as const, oid: targetOid };
  const resolvedContext = { ...context, target, gitDirectoryKind };
  let comparisonContext: typeof resolvedContext & {
    base?: { kind: "commit" | "empty-tree"; oid: string };
    targetParentCount?: number;
  } = resolvedContext;
  try {
    const parentLine = (
      await runGit(
        projectPath,
        ["rev-list", "--parents", "-n", "1", targetOid],
        options,
      )
    ).stdout.trim();
    const parents = parentLine.split(/\s+/).slice(1);
    const targetParentCount = parents.length;
    const metadata = { ...resolvedContext, targetParentCount };
    comparisonContext = metadata;
    let base: { kind: "commit" | "empty-tree"; oid: string };
    if (comparison === "baseline") {
      const baseline = request.baseline;
      if (!baseline)
        return response({
          ...metadata,
          state: "missing",
          reason: "baseline-not-recorded",
          message:
            "This segment has no first-kept baseline for a historical comparison.",
        });
      if (!baseline.commit)
        return response({
          ...metadata,
          state: "missing",
          reason: "baseline-commit-not-recorded",
          message:
            "The first-kept baseline did not record a commit. No alternative base was substituted.",
        });
      if (!validCommit(baseline.commit))
        return response({
          ...metadata,
          state: "missing",
          reason: "baseline-unavailable",
          recordedBaseline: baseline.commit,
          message:
            "The first-kept baseline reference is invalid. No alternative base was substituted.",
        });
      try {
        base = {
          kind: "commit",
          oid: await resolveCommit(projectPath, baseline.commit, options),
        };
      } catch (error) {
        if (
          error instanceof GitCommandError &&
          (error.kind === "timeout" || error.kind === "output")
        )
          throw error;
        return response({
          ...metadata,
          state: "missing",
          reason: "baseline-unavailable",
          recordedBaseline: baseline.commit,
          message:
            "The recorded first-kept baseline commit is not available or is ambiguous. No alternative base was substituted.",
        });
      }
    } else {
      base = parents[0]
        ? { kind: "commit", oid: parents[0] }
        : {
            kind: "empty-tree",
            oid: (
              await runGit(
                projectPath,
                ["hash-object", "-t", "tree", "--stdin"],
                options,
                METADATA_LIMIT_BYTES,
                "",
              )
            ).stdout.trim(),
          };
    }
    const references = { ...metadata, base };
    comparisonContext = references;
    const key = JSON.stringify([
      repository,
      projectPath,
      base.kind,
      base.oid,
      targetOid,
      comparison,
      includeAuto,
      request.revision,
    ]);
    const cached = cache?.get(key);
    if (cached) return cached;
    const args = [
      "--no-pager",
      "-c",
      "core.quotePath=true",
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--no-relative",
      "--find-renames=50%",
      "--diff-algorithm=myers",
      "--no-indent-heuristic",
      "--ignore-submodules=none",
      "--submodule=short",
      "--src-prefix=a/",
      "--dst-prefix=b/",
    ];
    const scope = [
      base.oid,
      targetOid,
      "--",
      ".",
      ...(includeAuto ? [] : [":(exclude).auto/**"]),
    ];
    // Each output is independently bounded; no partial result is installed.
    const names = (
      await runGit(
        projectPath,
        [...args, "--name-status", "-z", ...scope],
        options,
      )
    ).stdout;
    if (!names) {
      const empty = response({
        ...references,
        state: "empty",
        files: [],
        message: includeAuto
          ? "No project files changed between these historical references."
          : "No project files changed after excluding this project's .auto session artifacts.",
      });
      cache?.set(key, empty);
      return empty;
    }
    const stats = (
      await runGit(projectPath, [...args, "--numstat", "-z", ...scope], options)
    ).stdout;
    const patch = (
      await runGit(
        projectPath,
        [...args, "--patch", "--unified=3", ...scope],
        options,
        options.maxPatchBytes ?? DEFAULT_PATCH_LIMIT_BYTES,
      )
    ).stdout;
    const files = changedFiles(names, stats, patch);
    const containsBinary = files.some((file) => file.binary);
    const value = files.every((file) => file.binary)
      ? response({
          ...references,
          state: "binary",
          files,
          patch,
          containsBinary: true,
          message:
            "Only binary files changed. Their historical contents cannot be rendered as a text patch.",
        })
      : response({
          ...references,
          state: "available",
          files,
          patch,
          containsBinary,
        });
    cache?.set(key, value);
    return value;
  } catch (error) {
    if (
      error instanceof GitCommandError &&
      (error.kind === "timeout" || error.kind === "output")
    )
      return response({
        ...comparisonContext,
        state: "limited",
        reason: error.kind,
        message:
          error.kind === "timeout"
            ? "Git comparison exceeded the time limit."
            : `Git comparison exceeded an output limit (patch: ${options.maxPatchBytes ?? DEFAULT_PATCH_LIMIT_BYTES} bytes; metadata: ${METADATA_LIMIT_BYTES} bytes).`,
      });
    return response({
      ...comparisonContext,
      state: "failure",
      message: "Git could not produce this historical comparison.",
    });
  }
}

export function createDiffService(options: GitDiffOptions = {}) {
  const cache = createDiffCache();
  return {
    cache,
    resolve: (path: string, run: RunSnapshot, request: ComparisonRequest) =>
      resolveHistoricalDiff(path, run, request, options, cache),
  };
}

// S02 compatibility seam; callers needing caching supply a revision through the service.
export function resolveParentDiff(
  projectPath: string,
  run: RunSnapshot,
  options: GitDiffOptions = {},
) {
  return resolveHistoricalDiff(
    projectPath,
    run,
    { comparison: "parent", includeAuto: false, baseline: null, revision: "" },
    options,
  );
}
