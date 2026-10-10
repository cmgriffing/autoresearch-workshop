import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), "visualizer-s01-"));
  const projectPath = join(directory, "checksum-session");
  await mkdir(join(projectPath, ".auto"), { recursive: true });
  await copyFile(
    new URL("../demo-projects/checksum/.auto/log.jsonl", import.meta.url),
    join(projectPath, ".auto/log.jsonl"),
  );
  await writeFile(
    join(projectPath, "benchmark.sh"),
    "#!/bin/sh\nexit 99 # The visualizer must never run this.\n",
  );
  const configPath = join(directory, "config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      roots: [{ path: "./checksum-session", recursive: false }],
    }),
  );
  return { directory, projectPath, configPath };
}

export async function createSegmentFixture() {
  const fixture = await createFixture();
  await writeFile(
    join(fixture.projectPath, ".auto/log.jsonl"),
    [
      {
        type: "config",
        name: "Latency",
        metricName: "latency_ms",
        metricUnit: "ms",
        bestDirection: "lower",
      },
      { run: 1, metric: 0, status: "crash", description: "placeholder" },
      { run: 2, metric: 10, status: "keep", description: "baseline" },
      { run: 3, metric: 8, status: "discard", description: "discarded" },
      { run: 4, metric: 9, status: "keep", description: "latency win" },
      {
        type: "config",
        name: "Throughput",
        metricName: "score",
        metricUnit: "pts",
        bestDirection: "higher",
      },
      { run: 5, metric: 0, status: "keep", description: "zero baseline" },
      { run: 6, metric: 5, status: "keep", description: "zero reference win" },
      { run: 7, metric: 20, status: "discard", description: "ignored best" },
      { run: 8, metric: 10, status: "keep", description: "score win" },
      { type: "config", name: "Future metric" },
    ]
      .map((value) => JSON.stringify(value))
      .join("\n"),
  );
  await writeFile(
    fixture.configPath,
    JSON.stringify({
      roots: [{ path: "./checksum-session", recursive: false }],
      minWinImprovementPct: 1,
    }),
  );
  return fixture;
}

export async function hashFiles(directory) {
  const files = {};
  async function visit(path, prefix = "") {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const relativePath = `${prefix}${entry.name}`;
      if (entry.isDirectory())
        await visit(join(path, entry.name), `${relativePath}/`);
      else
        files[relativePath] = createHash("sha256")
          .update(await readFile(join(path, entry.name)))
          .digest("hex");
    }
  }
  await visit(directory);
  return files;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const fixture = await createFixture();
  console.log(JSON.stringify(fixture, null, 2));
  console.log(`VISUALIZER_CONFIG='${fixture.configPath}' pnpm dev:visualizer`);
  console.log(`pnpm start:visualizer --config '${fixture.configPath}'`);
}
