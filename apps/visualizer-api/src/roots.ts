import { glob, lstat } from "node:fs/promises";
import { join, parse, relative, resolve, sep } from "node:path";

type ConfiguredRoot = {
  path: string;
  recursive: boolean;
  glob?: { cwd: string; pattern: string };
};
export type ScanRoot = ConfiguredRoot & {
  index: number;
  diagnostic?: { code: string; message: string };
};

const hasGlob = (path: string) => /[*?\[\]{}]|[+@!]\(/.test(path);

export function resolveRoot(root: ConfiguredRoot, configDirectory: string) {
  const path = resolve(configDirectory, root.path);
  const filesystemRoot = parse(root.path).root;
  const parts = root.path.slice(filesystemRoot.length).split(/[\\/]/);
  const firstPattern = parts.findIndex(hasGlob);
  if (firstPattern < 0) return { ...root, path };
  return {
    ...root,
    path,
    glob: {
      cwd: resolve(
        configDirectory,
        join(filesystemRoot || ".", ...parts.slice(0, firstPattern)),
      ),
      pattern: parts.slice(firstPattern).join("/"),
    },
  };
}

export async function expandRoots(
  configuredRoots: ConfiguredRoot[],
  excluded: Set<string>,
  previousRoots: ScanRoot[] = [],
): Promise<ScanRoot[]> {
  const roots: ScanRoot[] = [];
  for (const [index, root] of configuredRoots.entries()) {
    if (!root.glob) {
      roots.push({ ...root, index });
      continue;
    }
    // Existing literal paths retain their behavior even if a directory name
    // happens to contain glob characters.
    try {
      await lstat(root.path);
      roots.push({ ...root, index });
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        roots.push({ ...root, index });
        continue;
      }
    }
    const paths = new Set<string>();
    const { cwd, pattern } = root.glob;
    let diagnostic: ScanRoot["diagnostic"];
    try {
      for await (const entry of glob(pattern, {
        cwd,
        withFileTypes: true,
        exclude: (entry) => entry.isSymbolicLink() || excluded.has(entry.name),
      })) {
        const path = join(entry.parentPath, entry.name);
        if (
          entry.isDirectory() &&
          !relative(cwd, path)
            .split(sep)
            .some((name) => excluded.has(name))
        )
          paths.add(path);
      }
    } catch (error) {
      diagnostic = {
        code: "ROOT_GLOB_UNAVAILABLE",
        message: `Cannot expand root pattern ${root.path}: ${error instanceof Error ? error.message : error}`,
      };
    }
    // Glob implementations can omit unreadable directories. A previously
    // matched root still belongs to this unchanged pattern until removed;
    // scanning it preserves the registry's stale-data recovery behavior.
    for (const previous of previousRoots.filter(
      (candidate) => candidate.index === index && !candidate.diagnostic,
    )) {
      if (paths.has(previous.path)) continue;
      try {
        if ((await lstat(previous.path)).isDirectory())
          paths.add(previous.path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          paths.add(previous.path);
      }
    }
    roots.push(...[...paths].sort().map((path) => ({ ...root, path, index })));
    if (diagnostic || !paths.size)
      roots.push({
        ...root,
        index,
        diagnostic: diagnostic ?? {
          code: "ROOT_GLOB_NO_MATCH",
          message: `Root pattern ${root.path} matched no directories.`,
        },
      });
  }
  return roots;
}
