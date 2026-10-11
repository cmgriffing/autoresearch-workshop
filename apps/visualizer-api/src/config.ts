import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { VisualizerConfigSchema } from "visualizar-common";
import { resolveRoot } from "./roots.ts";

export async function loadConfig(configPath: string) {
  const absolutePath = resolve(configPath);
  try {
    const config = VisualizerConfigSchema.parse(
      JSON.parse(await readFile(absolutePath, "utf8")),
    );
    return {
      config,
      roots: config.roots.map((root) =>
        resolveRoot(root, dirname(absolutePath)),
      ),
    };
  } catch (error) {
    throw new Error(
      `Invalid visualizer config at ${absolutePath}: ${error instanceof Error ? error.message : String(error)}. Supply one or more roots with directory paths or glob patterns and optional boolean recursive flags.`,
      { cause: error },
    );
  }
}
