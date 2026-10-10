import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  ProjectSnapshotSchema,
  ProjectsResponseSchema,
} from "../packages/visualizar-common/dist/index.js";
import { createSourceFixture } from "./visualizer-source-fixture.mjs";
import { fingerprintDiscoveryFixture } from "./visualizer-discovery-fixture.mjs";

const mode = process.argv[2] ?? "dev";
assert.ok(["dev", "built"].includes(mode), "Use dev or built.");
const repo = fileURLToPath(new URL("../", import.meta.url));
const fixture = await createSourceFixture();
const apiOrigin = "http://127.0.0.1:4314";
const uiOrigin = mode === "dev" ? "http://127.0.0.1:5177" : apiOrigin;
const children = [];
function start(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: repo,
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (data) => {
      output = (output + data).slice(-12000);
    });
  child.on("error", (error) => {
    output += error.message;
  });
  children.push({ child, output: () => output });
}
async function waitReady(url) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    const failed = children.find(({ child }) => child.exitCode !== null);
    if (failed) throw new Error(failed.output());
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(children.map((entry) => entry.output()).join("\n"));
}
let browser;
let before = await fingerprintDiscoveryFixture(fixture.directory);
const assertReadOnly = async () =>
  assert.deepEqual(
    await fingerprintDiscoveryFixture(fixture.directory),
    before,
  );
async function mutate(action) {
  await assertReadOnly();
  await action();
  before = await fingerprintDiscoveryFixture(fixture.directory);
}
try {
  start(
    process.execPath,
    [
      join(
        repo,
        `apps/visualizer-api/${mode === "dev" ? "src/main.ts" : "dist/main.js"}`,
      ),
      "--config",
      fixture.configPath,
      "--port",
      "4314",
      "--ui-origin",
      uiOrigin,
      ...(mode === "dev" ? ["--dev"] : []),
    ],
    { cwd: fixture.directory },
  );
  await waitReady(`${apiOrigin}/api/projects`);
  if (mode === "dev")
    start("pnpm", ["--filter", "visualizer", "dev", "--port", "5177"], {
      env: { ...process.env, VISUALIZER_API_PORT: "4314" },
    });
  await waitReady(uiOrigin);
  const list = ProjectsResponseSchema.parse(
    await (await fetch(`${uiOrigin}/api/projects`)).json(),
  );
  assert.equal(list.projects.length, 4);
  const alpha = list.projects.find(
    (project) => project.rootPath === fixture.alpha,
  );
  const limited = list.projects.find((project) => project.name === "oversized");
  assert.equal(limited.sourceState, "limited");
  assert.equal(limited.runCount, 0);
  assert.equal(limited.stale, false);
  assert.equal(
    list.projects.find((project) => project.rootPath === fixture.beta).runCount,
    2,
  );
  const snapshot = async () =>
    ProjectSnapshotSchema.parse(
      await (await fetch(`${uiOrigin}/api/projects/${alpha.id}`)).json(),
    );
  const initial = await snapshot();
  assert.equal(initial.runs.length, 3);
  assert.deepEqual(initial.runs[1].metrics, { valid: 4 });
  assert.notEqual(initial.runs[0].id, initial.runs[1].id);
  assert.equal(initial.segments[0].wins.length, 1);

  browser = await chromium.launch({
    headless: true,
    ...(process.env.VISUALIZER_CHROME_PATH
      ? { executablePath: process.env.VISUALIZER_CHROME_PATH }
      : { channel: "chrome" }),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(uiOrigin);
  await page
    .getByRole("heading", { name: "Resilient source", exact: true })
    .waitFor();
  const table = page.getByRole("table");
  assert.equal(await table.locator("tbody tr").count(), 3);
  await page
    .getByText("Line 5: Invalid JSON record.", { exact: true })
    .waitFor();
  await page.getByText(/Line 8: Secondary metric bad/).waitFor();
  const duplicate = page.getByRole("button", {
    name: "Select experiment 1 from history",
    exact: true,
  });
  assert.equal(await duplicate.count(), 2);
  await duplicate.nth(0).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="selected-metric"]')?.textContent ===
      "10ms",
  );
  await duplicate.nth(1).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="selected-metric"]')?.textContent ===
      "8ms",
  );
  await page
    .getByRole("region", { name: "Historical diff" })
    .getByText(/did not record a commit reference/)
    .waitFor();
  await page
    .getByRole("button", {
      name: "Select experiment 9 from history",
      exact: true,
    })
    .click();
  await page
    .getByRole("region", { name: "Selected experiment" })
    .getByText("Crashed", { exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: /^Win experiment/ }).count(),
    1,
  );
  await duplicate.nth(1).click();

  const refreshButton = page.getByRole("button", {
    name: "Refresh projects",
    exact: true,
  });
  async function refresh() {
    const response = page.waitForResponse(
      (response) => response.url() === `${uiOrigin}/api/projects/${alpha.id}`,
    );
    await refreshButton.click();
    const result = ProjectSnapshotSchema.parse(await (await response).json());
    await page.waitForFunction(
      (revision) =>
        document
          .querySelector(".review-footer")
          ?.textContent?.includes(`Source revision ${revision.slice(2, 10)}`),
      result.project.revision,
    );
    return result;
  }
  await mutate(() =>
    writeFile(fixture.logPath, `${fixture.source}\n{"run":3,"metric":`),
  );
  const partial = await refresh();
  await page.getByText(/Line 10: Trailing record is incomplete/).waitFor();
  assert.deepEqual(partial.runs, initial.runs);
  assert.equal(await table.locator("tbody tr").count(), 3);
  assert.equal(await duplicate.nth(1).getAttribute("aria-pressed"), "true");
  const completedSource = `${fixture.source}\n${JSON.stringify({ type: "run", run: 3, metric: 7, status: "keep", description: "Completed tail" })}`;
  await mutate(() => writeFile(fixture.logPath, completedSource));
  const completed = await refresh();
  await page.getByRole("button", { name: /^Win experiment 3:/ }).waitFor();
  assert.equal(completed.runs.length, 4);
  assert.deepEqual(completed.runs.slice(0, 3), initial.runs);
  assert.equal(await table.locator("tbody tr").count(), 4);
  assert.equal(
    await page.getByText(/Trailing record is incomplete/).count(),
    0,
  );
  assert.equal((await refresh()).runs.length, 4);
  assert.equal(await duplicate.nth(1).getAttribute("aria-pressed"), "true");

  for (const state of ["limited", "missing", "error"]) {
    await mutate(async () => {
      await rm(fixture.logPath, { recursive: true, force: true });
      if (state === "limited")
        await writeFile(fixture.logPath, " ".repeat(2049));
      if (state === "error") await mkdir(fixture.logPath);
    });
    const retained = await refresh();
    await page
      .getByText(/Stale data: showing the last successfully read project data/)
      .waitFor();
    assert.equal(retained.project.sourceState, state);
    assert.equal(retained.project.stale, true);
    assert.equal(retained.project.revision, completed.project.revision);
    assert.deepEqual(retained.runs, completed.runs);
    assert.equal(await table.locator("tbody tr").count(), 4);
    assert.equal(await duplicate.nth(1).getAttribute("aria-pressed"), "true");
    if (state === "limited")
      await page.getByText(/log.jsonl exceeds the 2048-byte limit/).waitFor();
    if (state === "error")
      await page
        .getByText(/Cannot read this session's log.jsonl as a regular file/)
        .waitFor();
    assert.equal(
      await page.getByText(/Uninitialized session\. No log/).count(),
      0,
    );
    assert.equal((await refresh()).runs.length, 4);
  }
  if (process.env.VISUALIZER_SCREENSHOT)
    await page.screenshot({
      path: process.env.VISUALIZER_SCREENSHOT,
      fullPage: true,
    });
  await mutate(async () => {
    await rm(fixture.logPath, { recursive: true });
    await writeFile(
      `${fixture.logPath}.replacement`,
      completedSource.replace('"metric":8', '"metric":6'),
    );
    await rename(`${fixture.logPath}.replacement`, fixture.logPath);
  });
  const rewritten = await refresh();
  await page
    .getByText(
      "The selected experiment is no longer in this source. Select another experiment.",
      { exact: true },
    )
    .waitFor();
  assert.equal(rewritten.project.stale, false);
  assert.notEqual(rewritten.runs[1].id, initial.runs[1].id);
  assert.equal(rewritten.runs[0].id, initial.runs[0].id);
  assert.equal(await page.getByTestId("selected-metric").count(), 0);
  assert.equal(await page.getByText(/Stale data: showing/).count(), 0);
  for (const [run, status] of [
    [initial.runs[1], 404],
    [initial.runs[0], 409],
  ]) {
    const response = await fetch(
      `${uiOrigin}/api/projects/${alpha.id}/runs/${run.id}/diff?revision=${completed.project.revision}`,
    );
    assert.equal(response.status, status);
  }
  await page.getByRole("button", { name: /^Win experiment 1:/ }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="selected-metric"]')?.textContent ===
      "6ms",
  );
  await mutate(() =>
    writeFile(
      fixture.logPath,
      `${JSON.stringify({ run: 1, status: "keep" })}\n`,
    ),
  );
  await refresh();
  await page
    .getByText("No valid experiments in this session.", { exact: true })
    .waitFor();
  assert.equal(await table.count(), 0);
  assert.equal(await page.getByTestId("selected-metric").count(), 0);
  await mutate(() => writeFile(fixture.logPath, ""));
  await refresh();
  await page.getByText("This log is empty.", { exact: true }).waitFor();
  await page
    .getByText("log.jsonl is empty; no experiments have been recorded.", {
      exact: true,
    })
    .waitFor();
  assert.equal((await snapshot()).project.stale, false);
  await page
    .getByRole("button", {
      name: `oversized · . · ${fixture.limited}`,
      exact: true,
    })
    .click();
  await page
    .getByText("Log exceeds the size limit. No history is available yet.", {
      exact: true,
    })
    .waitFor();
  assert.equal(await table.count(), 0);
  await page
    .getByRole("button", {
      name: `uninitialized · . · ${fixture.uninitialized}`,
      exact: true,
    })
    .click();
  await page.getByText(/Uninitialized session\. No log/).waitFor();
  await page
    .getByRole("button", { name: `shared · . · ${fixture.beta}`, exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Beta session", exact: true })
    .waitFor();
  assert.equal(await table.locator("tbody tr").count(), 2);
  assert.deepEqual(errors, []);
  await assertReadOnly();
  console.log(
    `S05 ${mode} source smoke passed: malformed/unknown records; duplicate selection; secondary-metric diagnostics; missing commits; failed placeholders; partial-tail completion without newline; repeated refresh; stale retention through limits/missing/non-file sources; atomic rewrite clears selection; 404/409 invalidation; empty/no-valid/uninitialized states; isolated healthy project; unchanged files/index/refs; zero browser errors.`,
  );
} finally {
  await browser?.close();
  for (const { child } of children.reverse()) {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await Promise.race([
        exited,
        new Promise((resolve) => {
          const timer = setTimeout(() => {
            child.kill("SIGKILL");
            resolve();
          }, 3000);
          timer.unref();
        }),
      ]);
    }
  }
  await rm(fixture.directory, { recursive: true, force: true });
}
