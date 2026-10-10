import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createChartFixture } from "./visualizer-chart-fixture.mjs";

export async function createAccessibilityFixture() {
  const fixture = await createChartFixture();
  const uninitialized = join(fixture.repo, "uninitialized");
  const emptyLog = join(fixture.repo, "empty-log");
  const malformed = join(fixture.repo, "malformed");
  await mkdir(join(uninitialized, ".auto"), { recursive: true });
  await mkdir(join(emptyLog, ".auto"), { recursive: true });
  await writeFile(join(emptyLog, ".auto/log.jsonl"), "");
  await mkdir(join(malformed, ".auto"), { recursive: true });
  await writeFile(
    join(malformed, ".auto/log.jsonl"),
    '{"type":"unknown"}\n{"run":7,"metric":}\n',
  );
  const emptyRoot = join(fixture.directory, "empty-root");
  await mkdir(emptyRoot, { recursive: true });
  await writeFile(
    fixture.configPath,
    JSON.stringify({
      roots: [
        { path: "./empty-root", recursive: false },
        { path: "./repo", recursive: true },
      ],
      minWinImprovementPct: 0,
      rescanIntervalMs: 1000,
    }),
  );
  return { ...fixture, uninitialized, emptyLog, malformed, emptyRoot };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const fixture = await createAccessibilityFixture();
  console.log(JSON.stringify(fixture, null, 2));
  console.log(`VISUALIZER_CONFIG='${fixture.configPath}' pnpm dev:visualizer`);
  console.log(`pnpm start:visualizer --config '${fixture.configPath}'`);
}
