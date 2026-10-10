import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createDiffFixture } from "./visualizer-diff-fixture.mjs";

export async function createChartFixture() {
  const fixture = await createDiffFixture();
  const records = [
    {
      type: "config",
      name: "Latency",
      metricName: "latency",
      metricUnit: "ms",
      bestDirection: "lower",
    },
    {
      run: 9,
      metric: 0,
      status: "crash",
      description: "Initial crash placeholder",
      asi: "Compiler failed <script>window.asiExecuted=true</script>",
    },
    {
      run: 2,
      metric: 10,
      status: "keep",
      description: "First kept baseline",
      commit: fixture.rootOid,
      timestamp: 1791342240000,
      metrics: { memory_mib: 32, mbps: 100 },
      confidence: 58.25301204819275,
      asi: {
        hypothesis: "Cache work",
        nested: { list: [1, true, null] },
        unsafe: '<img src=x onerror="window.asiExecuted=true">',
      },
    },
    {
      run: 7,
      metric: 1,
      status: "discard",
      description: "Discard beats the kept best",
      commit: fixture.scopedOid,
      confidence: -1,
      asi: ["Discarded context", { reason: "Checks inconclusive" }],
    },
    {
      run: 4,
      metric: 9,
      status: "keep",
      description: "Latency win",
      commit: fixture.scopedOid,
      confidence: 0,
      asi: false,
    },
    {
      run: 4,
      metric: 12,
      status: "keep",
      description: "Worse keep with duplicate display number",
      confidence: null,
      asi: 0,
    },
    {
      run: 6,
      metric: 0,
      status: "checks_failed",
      description: "Checks failure placeholder",
      timestamp: "yesterday",
      confidence: "high",
      asi: null,
    },
    {
      run: 3,
      metric: 8,
      status: "keep",
      description: "Next latency win",
      commit: fixture.scopedOid,
      timestamp: 0,
      confidence: 7.5,
    },
    {
      run: 8,
      metric: -100,
      status: "crash",
      description: "Crash after a best",
      asi: {},
    },
    {
      type: "config",
      name: "Throughput",
      metricName: "score",
      metricUnit: "pts",
      bestDirection: "higher",
    },
    {
      run: 20,
      metric: 0,
      status: "keep",
      description: "Zero baseline",
      asi: null,
    },
    {
      run: 21,
      metric: 5,
      status: "keep",
      description: "Zero reference win",
      confidence: 0.01,
      asi: "Recorded string context",
    },
    {
      run: 22,
      metric: 25,
      status: "discard",
      description: "Higher discard beats best",
      asi: [],
    },
    {
      run: 23,
      metric: 10,
      status: "keep",
      description: "Higher win",
      confidence: 200,
      asi: true,
    },
    {
      run: 24,
      metric: 0,
      status: "checks_failed",
      description: "Higher failure",
    },
    {
      type: "config",
      name: "Empty segment",
      metricName: "empty",
      metricUnit: "",
      bestDirection: "lower",
    },
    {
      type: "config",
      name: "Failures only",
      metricName: "duration",
      metricUnit: "ms",
      bestDirection: "lower",
    },
    { run: 30, metric: 0, status: "crash", description: "All failed crash" },
    {
      run: 31,
      metric: 0,
      status: "checks_failed",
      description: "All failed checks",
    },
    {
      type: "config",
      name: "Single attempt",
      metricName: "duration",
      metricUnit: "ms",
      bestDirection: "lower",
    },
    { run: 40, metric: 3, status: "keep", description: "Single baseline" },
    {
      type: "config",
      name: "Discards only",
      metricName: "duration",
      metricUnit: "ms",
      bestDirection: "lower",
    },
    {
      run: 50,
      metric: 0,
      status: "discard",
      description: "Real discarded zero",
    },
    { run: 51, metric: 2, status: "discard", description: "Another discard" },
  ];
  await writeFile(
    join(fixture.projectPath, ".auto/log.jsonl"),
    records.map((record) => JSON.stringify(record)).join("\n") + "\n",
  );
  await writeFile(
    fixture.configPath,
    JSON.stringify({
      roots: [{ path: "./repo/project", recursive: false }],
      minWinImprovementPct: 0,
    }),
  );
  return { ...fixture, records };
}
