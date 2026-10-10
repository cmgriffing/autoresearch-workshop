import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { VisualizerConfigSchema } from "visualizar-common";

export async function loadConfig(configPath: string) {
  const absolutePath = resolve(configPath);
  try {
    const config = VisualizerConfigSchema.parse(
      JSON.parse(await readFile(absolutePath, "utf8")),
    );
    return {
      config,
      roots: config.roots.map((root) => ({
        ...root,
        path: resolve(dirname(absolutePath), root.path),
      })),
    };
  } catch (error) {
    throw new Error(
      `Invalid visualizer config at ${absolutePath}: ${error instanceof Error ? error.message : String(error)}. Supply one or more roots with directory paths and optional boolean recursive flags.`,
      { cause: error },
    );
  }
}
