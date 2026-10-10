import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  DiffResponseSchema,
  ProjectSnapshotSchema,
  ProjectsResponseSchema,
} from "../packages/visualizar-common/dist/index.js";
import { createComparisonFixture } from "./visualizer-comparison-fixture.mjs";
import { hashFiles } from "./visualizer-fixture.mjs";

const mode = process.argv[2] ?? "dev";
assert.ok(["dev", "built"].includes(mode), "Use dev or built.");
const workspace = fileURLToPath(new URL("../", import.meta.url));
const fixture = await createComparisonFixture();
const headBefore = await readFile(join(fixture.repo, ".git", "HEAD"), "utf8");
const filesBefore = await hashFiles(fixture.repo);
const linkedBefore = await hashFiles(fixture.linked);
const apiOrigin = "http://127.0.0.1:4317";
const uiOrigin = mode === "dev" ? "http://127.0.0.1:5180" : apiOrigin;
const children = [];
function start(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: workspace,
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (data) => (output = (output + data).slice(-12000)));
  child.stderr.on("data", (data) => (output = (output + data).slice(-12000)));
  children.push({ child, output: () => output });
  return child;
}
async function waitReady(url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    const failed = children.find(({ child }) => child.exitCode !== null);
    if (failed) throw new Error(failed.output());
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(children.map((value) => value.output()).join("\n"));
}

async function selectProject(page, name) {
  const selector = page.getByRole("combobox", { name: /^Project/ });
  await selector.click();
  await page
    .getByRole("option", {
      name,
      ...(typeof name === "string" ? { exact: true } : {}),
    })
    .first()
    .click();
}
let browser;
try {
  const entry = join(
    workspace,
    `apps/visualizer-api/${mode === "dev" ? "src/main.ts" : "dist/main.js"}`,
  );
  start(process.execPath, [
    entry,
    "--config",
    fixture.configPath,
    "--port",
    "4317",
    "--ui-origin",
    uiOrigin,
    ...(mode === "dev" ? ["--dev"] : []),
  ]);
  await waitReady(`${apiOrigin}/api/projects`);
  if (mode === "dev")
    start("pnpm", ["--filter", "visualizer", "dev", "--port", "5180"], {
      env: { ...process.env, VISUALIZER_API_PORT: "4317" },
    });
  await waitReady(uiOrigin);
  const list = ProjectsResponseSchema.parse(
    await (await fetch(`${uiOrigin}/api/projects`)).json(),
  );
  const summary = list.projects.find(
    (project) => project.rootPath === fixture.projectPath,
  );
  const snapshot = ProjectSnapshotSchema.parse(
    await (await fetch(`${uiOrigin}/api/projects/${summary.id}`)).json(),
  );
  const run = (n) => snapshot.runs.find((run) => run.run === n);
  const diffUrl = (n, extra = "") =>
    `${uiOrigin}/api/projects/${summary.id}/runs/${run(n).id}/diff?revision=${summary.revision}${extra}`;
  const cumulative = DiffResponseSchema.parse(
    await (await fetch(diffUrl(3, "&comparison=baseline"))).json(),
  );
  assert.equal(cumulative.state, "available");
  assert.equal(cumulative.base.oid, fixture.rootOid);
  assert.match(cumulative.patch, /export const value = 2/);

  browser = await chromium.launch({
    headless: true,
    ...(process.env.VISUALIZER_CHROME_PATH
      ? { executablePath: process.env.VISUALIZER_CHROME_PATH }
      : { channel: "chrome" }),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  const errors = [];
  const warnings = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning")
      warnings.push(message.text());
  });
  page.on("request", (request) => {
    if (request.url().includes("/diff?")) requests.push(request.url());
  });
  await page.goto(uiOrigin);
  await selectProject(page, `project · . · ${fixture.projectPath}`);
  const select = async (n) =>
    page
      .getByRole("button", {
        name: new RegExp(`^Select experiment ${n} from the attempt list`),
      })
      .first()
      .click();
  const region = page.getByRole("region", {
    name: "Historical diff",
    exact: true,
  });
  const comparison = region.getByRole("combobox", { name: "Diff comparison" });
  const presentation = region.getByRole("combobox", {
    name: "Diff presentation",
  });
  const artifacts = region.getByRole("checkbox", {
    name: "Include .auto session artifacts",
  });
  const navigation = region.getByRole("navigation", { name: "Changed files" });
  const patch = region.locator(".unified-diff");
  const metric = page.getByTestId("selected-metric");
  await page.getByRole("button", { name: /First kept baseline/ }).click();
  await region.getByText(/Empty tree/).waitFor();
  assert.match(await patch.innerText(), /project\/code.ts/);
  await select(3);
  await region.getByText(/No project files changed/).waitFor();
  await comparison.focus();
  assert.ok(
    await comparison.evaluate((element) => element.matches(":focus-visible")),
  );
  await comparison.selectOption("baseline");
  await region
    .getByRole("heading", { name: "Baseline diff", exact: true })
    .waitFor();
  await patch.waitFor();
  for (const width of [1280, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await patch.waitFor();
    await page.waitForFunction(() => {
      const pane = document.querySelector(".review-pane");
      const chart = document.querySelector(".recharts-wrapper");
      if (!pane || !chart) return true;
      return (
        chart.getBoundingClientRect().right <=
        pane.getBoundingClientRect().right + 1
      );
    });
    const patchOverflow = await patch.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    );
    assert.ok(
      patchOverflow <= 1,
      `unified patch scrolls horizontally at ${width}px by ${patchOverflow}px`,
    );
    const paneOverflow = await page
      .locator(".review-pane")
      .evaluate((element) => element.scrollWidth - element.clientWidth);
    assert.ok(
      paneOverflow <= 1,
      `review pane scrolls horizontally at ${width}px by ${paneOverflow}px`,
    );
  }
  await page.setViewportSize({ width: 1440, height: 1050 });
  assert.match(await patch.innerText(), /-export const value = 1/);
  assert.match(await patch.innerText(), /\+export const value = 2/);
  assert.equal(await metric.innerText(), "8ms");
  assert.match(await region.innerText(), new RegExp(fixture.rootOid));
  assert.match(
    await region.innerText(),
    /Metric improvement uses the preceding best measurement separately/,
  );
  await artifacts.check();
  await navigation
    .getByRole("button", {
      name: "View file project/.auto/trace.txt",
      exact: true,
    })
    .waitFor();
  await navigation
    .getByRole("button", {
      name: "View file project/.auto/trace.txt",
      exact: true,
    })
    .click();
  assert.match(await patch.innerText(), /second trace/);
  assert.doesNotMatch(await patch.innerText(), /code.ts/);
  await artifacts.uncheck();
  await navigation
    .getByRole("button", { name: "View file project/code.ts", exact: true })
    .waitFor();
  await presentation.selectOption("split");
  const splitCode = region.getByRole("region", {
    name: "Split patch for project/code.ts",
    exact: true,
  });
  await splitCode.waitFor();
  assert.match(await splitCode.innerText(), /export const value = 1/);
  assert.match(await splitCode.innerText(), /export const value = 2/);
  assert.ok(await splitCode.locator(".diff-split").count());
  const requestCount = requests.length;
  await presentation.selectOption("unified");
  await patch.waitFor();
  assert.equal(
    requests.length,
    requestCount,
    "presentation switches must not request another Git diff",
  );

  await comparison.selectOption("parent");
  await select(4);
  await region.getByText(/Only binary files changed/).waitFor();
  assert.equal(await metric.innerText(), "7ms");
  assert.equal(await patch.count(), 0);
  await comparison.selectOption("baseline");
  await navigation
    .getByRole("button", { name: "View file project/asset.bin", exact: true })
    .waitFor();
  await navigation
    .getByRole("button", { name: "View file project/asset.bin", exact: true })
    .click();
  assert.equal(await patch.count(), 0);
  await region.getByText(/Binary file:/).waitFor();
  await navigation
    .getByRole("button", { name: "View file project/code.ts", exact: true })
    .click();
  await patch.waitFor();
  assert.doesNotMatch(await patch.innerText(), /asset.bin/);

  await comparison.selectOption("parent");
  await select(5);
  const renameButton = navigation.getByRole("button", {
    name: /View file project\/notes renamed/,
  });
  await renameButton.waitFor();
  await renameButton.focus();
  await renameButton.press("Enter");
  assert.match(await patch.innerText(), /rename from project\/notes.md/);
  await presentation.selectOption("split");
  await region.getByText(/File metadata changed without a text hunk/).waitFor();
  const oddButton = navigation.getByRole("button", {
    name: /View file project\/odd name/,
  });
  await oddButton.click();
  const oddSplit = region.getByRole("region", {
    name: /Split patch for project\/odd name/,
  });
  await oddSplit.waitFor();
  assert.match(
    await oddSplit.innerText(),
    /<script>window.patchExecuted = true<\/script>/,
  );
  assert.equal(await page.evaluate(() => window.patchExecuted), undefined);
  assert.equal(await oddSplit.locator("script").count(), 0);
  await presentation.selectOption("unified");
  await patch.waitFor();
  assert.match(await patch.innerText(), /No newline at end of file/);
  await navigation
    .getByRole("button", {
      name: "View file project/benchmark.sh",
      exact: true,
    })
    .click();
  assert.match(await patch.innerText(), /new mode 100755/);

  await select(6);
  await region.getByText(/Merge commit/).waitFor();
  assert.match(await region.innerText(), new RegExp(fixture.firstParentOid));
  assert.match(await patch.innerText(), /merged feature/);
  assert.doesNotMatch(await patch.innerText(), /export const value/);
  await comparison.selectOption("baseline");
  await navigation
    .getByRole("button", { name: "View file project/code.ts", exact: true })
    .waitFor();
  await navigation
    .getByRole("button", { name: "View file project/code.ts", exact: true })
    .click();
  assert.match(await patch.innerText(), /\+export const value = 3/);
  assert.doesNotMatch(await region.innerText(), /sibling\/code.ts/);
  if (process.env.VISUALIZER_SCREENSHOT) {
    await region.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: process.env.VISUALIZER_SCREENSHOT,
      fullPage: true,
    });
    await presentation.selectOption("split");
    await splitCode.waitFor();
    await region.screenshot({
      path: process.env.VISUALIZER_SCREENSHOT.replace(/\.png$/, "-split.png"),
    });
    await presentation.selectOption("unified");
    await patch.waitFor();
  }

  await comparison.selectOption("parent");
  await select(7);
  await region.getByText(/Git comparison exceeded an output limit/).waitFor();
  assert.equal(await metric.innerText(), "4ms");
  assert.equal(await patch.count(), 0);
  assert.match(await region.innerText(), new RegExp(fixture.largeOid));
  const segments = page.getByRole("combobox", {
    name: "Metric segment",
    exact: true,
  });
  for (const [segmentIndex, n, message] of [
    [1, 102, /first-kept baseline commit is not available/],
    [2, 202, /first-kept baseline did not record a commit/],
    [3, 302, /first-kept baseline reference is invalid/],
    [4, 401, /no first-kept baseline/],
  ]) {
    await segments.selectOption(snapshot.segments[segmentIndex].id);
    await select(n);
    await comparison.selectOption("baseline");
    await region.getByText(message).waitFor();
    assert.equal(await metric.innerText(), n === 401 ? "100ms" : "99ms");
    assert.equal(await patch.count(), 0);
  }
  await selectProject(page, `project · . · ${join(fixture.linked, "project")}`);
  await select(6);
  await region.getByText(/Git worktree resolved through a .git file/).waitFor();
  await comparison.selectOption("parent");
  await patch.waitFor();
  assert.match(await patch.innerText(), /merged feature/);

  // Hold a fully fetched old comparison while controls/project selection change.
  await selectProject(page, `project · . · ${fixture.projectPath}`);
  let held = false;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/projects/*/runs/*/diff?**", async (route) => {
    if (
      !held &&
      route.request().url().includes(run(3).id) &&
      route.request().url().includes("comparison=baseline")
    ) {
      const response = await route.fetch();
      held = true;
      await gate;
      try {
        await route.fulfill({ response });
      } catch {}
    } else await route.continue();
  });
  await select(3);
  await comparison.selectOption("baseline");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="Historical diff"]')
        ?.getAttribute("aria-busy") === "true",
  );
  const holdDeadline = Date.now() + 5_000;
  while (!held && Date.now() < holdDeadline)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(held);
  await comparison.selectOption("parent");
  await region.getByText(/No project files changed/).waitFor();
  release();
  await page.waitForTimeout(200);
  assert.equal(await patch.count(), 0);
  assert.equal(await metric.innerText(), "8ms");
  await page.unroute("**/api/projects/*/runs/*/diff?**");
  // Exercise a second fetched response across project selection.
  let fetched;
  let releaseProject;
  const projectGate = new Promise((resolve) => {
    releaseProject = resolve;
  });
  await page.route("**/api/projects/*/runs/*/diff?**", async (route) => {
    if (
      route.request().url().includes(summary.id) &&
      route.request().url().includes(run(2).id)
    ) {
      const response = await route.fetch();
      fetched = true;
      await projectGate;
      try {
        await route.fulfill({ response });
      } catch {}
    } else await route.continue();
  });
  await select(2);
  const fetchDeadline = Date.now() + 5_000;
  while (!fetched && Date.now() < fetchDeadline)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(fetched);
  await selectProject(page, `sibling · . · ${join(fixture.repo, "sibling")}`);
  await select(2);
  await patch.waitFor();
  releaseProject();
  await page.waitForTimeout(200);
  assert.match(await patch.innerText(), /sibling changed/);
  assert.doesNotMatch(await patch.innerText(), /project\/code.ts/);
  await page.unroute("**/api/projects/*/runs/*/diff?**");

  assert.deepEqual(await hashFiles(fixture.repo), filesBefore);
  assert.deepEqual(await hashFiles(fixture.linked), linkedBefore);
  // A note-only revision rejects the old request and refresh keeps source selection.
  await selectProject(page, `project · . · ${fixture.projectPath}`);
  await select(2);
  await patch.waitFor();
  await writeFile(
    join(fixture.projectPath, ".auto", "ideas.md"),
    "Current changed note\n",
  );
  const afterMutation = await hashFiles(fixture.repo);
  const refreshed = page.waitForResponse((response) =>
    response.url().endsWith(`/api/projects/${summary.id}`),
  );
  await page
    .getByRole("button", { name: "Refresh projects", exact: true })
    .click();
  await refreshed;
  await patch.waitFor();
  assert.equal(await metric.innerText(), "9ms");
  assert.equal((await fetch(diffUrl(2, "&comparison=baseline"))).status, 409);
  await page
    .getByTestId("attempt-list")
    .getByRole("button", { name: /First kept baseline/ })
    .click();
  await region.getByText(/Empty tree/).waitFor();
  assert.deepEqual(await hashFiles(fixture.repo), afterMutation);
  assert.deepEqual(await hashFiles(fixture.linked), linkedBefore);
  assert.equal(
    await readFile(join(fixture.repo, ".git", "HEAD"), "utf8"),
    headBefore,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  console.log(
    `S08 ${mode} smoke passed: parent/baseline/artifact/file/unified/split/binary/limited/missing/merge/worktree review; stale controls/projects/revisions; unchanged sources/index/objects/refs; zero browser errors or warnings.`,
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
          }, 3_000);
          timer.unref();
        }),
      ]);
    }
  }
  await rm(fixture.directory, { recursive: true, force: true });
}
