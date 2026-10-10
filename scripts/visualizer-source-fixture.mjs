import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createDiscoveryFixture } from "./visualizer-discovery-fixture.mjs";

export async function createSourceFixture() {
  const fixture = await createDiscoveryFixture();
  const limited = join(fixture.workspace, "oversized");
  await mkdir(join(limited, ".auto"), { recursive: true });
  await writeFile(join(limited, ".auto/log.jsonl"), " ".repeat(2049));
  const source = [
    JSON.stringify({
      type: "config",
      name: "Resilient source",
      metricName: "latency",
      metricUnit: "ms",
      bestDirection: "lower",
    }),
    JSON.stringify({
      run: 1,
      metric: 10,
      status: "keep",
      description: "First kept baseline",
    }),
    JSON.stringify({ type: "hook", run: 2, metric: 0, status: "keep" }),
    JSON.stringify({ type: "future", run: 2, metric: 0, status: "keep" }),
    "{broken}",
    JSON.stringify({ run: 2, metric: 0, status: "unknown" }),
    JSON.stringify({ run: 2, status: "keep" }),
    JSON.stringify({
      run: 1,
      metric: 8,
      status: "keep",
      description: "Repeated number win",
      metrics: { valid: 4, bad: null },
    }),
    JSON.stringify({
      run: 9,
      metric: 0,
      status: "crash",
      description: "Failed placeholder",
    }),
  ].join("\n");
  const logPath = join(fixture.alpha, ".auto/log.jsonl");
  await writeFile(logPath, source);
  await writeFile(
    fixture.configPath,
    JSON.stringify({
      roots: [fixture.alpha, fixture.beta, limited, fixture.uninitialized].map(
        (path) => ({ path, recursive: false }),
      ),
      maxLogBytes: 2048,
    }),
  );
  return { ...fixture, source, logPath, limited };
}
