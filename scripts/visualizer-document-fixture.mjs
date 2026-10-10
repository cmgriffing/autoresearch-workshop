import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createDiscoveryFixture } from "./visualizer-discovery-fixture.mjs";

export async function createDocumentFixture() {
  const fixture = await createDiscoveryFixture();
  const ideas = [
    "# Alpha ideas now",
    "",
    "Try **vectorization** with `batchSize`.",
    "",
    "- Measure allocations",
    "- Review throughput",
    "",
    "> Repeat the measurement.",
    "",
    "```html",
    "<b>Code sample only</b>",
    "```",
    "",
    "[Safe reference](https://example.invalid/reference)",
    "",
    "[Unsafe reference](javascript:alert(1))",
    "",
    "<script>window.__notesExecuted = true</script>",
    '<img src="bad" onerror="window.__notesExecuted = true">',
    '<iframe srcdoc="raw html"></iframe>',
  ].join("\n");
  const ideasPath = join(fixture.alpha, ".auto/ideas.md");
  const promptPath = join(fixture.alpha, ".auto/prompt.md");
  await writeFile(ideasPath, ideas);
  await writeFile(
    promptPath,
    "# Alpha prompt context\n\nKeep **correctness** checks.",
  );
  await mkdir(join(fixture.beta, ".auto/prompt.md"));
  await writeFile(
    join(fixture.uninitialized, ".auto/ideas.md"),
    "# Before the first experiment\n\nCurrent planning notes.",
  );
  await writeFile(
    fixture.configPath,
    JSON.stringify({
      roots: [fixture.alpha, fixture.beta, fixture.uninitialized].map(
        (path) => ({ path, recursive: false }),
      ),
      maxDocumentBytes: 512,
    }),
  );
  return { ...fixture, ideas, ideasPath, promptPath };
}
