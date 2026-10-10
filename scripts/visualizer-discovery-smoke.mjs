import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  ProjectsResponseSchema,
  ProjectSnapshotSchema,
} from "../packages/visualizar-common/dist/index.js";
import {
  createDiscoveryFixture,
  fingerprintDiscoveryFixture,
  writeSession,
} from "./visualizer-discovery-fixture.mjs";

const mode = process.argv[2] ?? "dev";
assert.ok(["dev", "built"].includes(mode), "Use dev or built.");
const repo = fileURLToPath(new URL("../", import.meta.url));
const fixture = await createDiscoveryFixture();
const apiOrigin = "http://127.0.0.1:4313";
const uiOrigin = mode === "dev" ? "http://127.0.0.1:5176" : apiOrigin;
const children = [];
function start(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: repo,
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (data) => {
    output = (output + data).slice(-12000);
  });
  child.stderr.on("data", (data) => {
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
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let browser;
let before = await fingerprintDiscoveryFixture(fixture.directory);
const assertReadOnly = async () =>
  assert.deepEqual(
    await fingerprintDiscoveryFixture(fixture.directory),
    before,
  );
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
      "4313",
      "--ui-origin",
      uiOrigin,
      ...(mode === "dev" ? ["--dev"] : []),
    ],
    { cwd: fixture.directory },
  );
  await waitReady(`${apiOrigin}/api/projects`);
  if (mode === "dev")
    start("pnpm", ["--filter", "visualizer", "dev", "--port", "5176"], {
      env: { ...process.env, VISUALIZER_API_PORT: "4313" },
    });
  await waitReady(uiOrigin);
  const list = ProjectsResponseSchema.parse(
    await (await fetch(`${uiOrigin}/api/projects`)).json(),
  );
  assert.equal(list.projects.length, 5);
  const alpha = list.projects.find(
    (project) => project.relativePath === "a/shared",
  );
  const beta = list.projects.find(
    (project) => project.relativePath === "b/shared",
  );
  const alphaSnapshot = ProjectSnapshotSchema.parse(
    await (await fetch(`${uiOrigin}/api/projects/${alpha.id}`)).json(),
  );
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
    .getByRole("heading", { name: "Parent session", exact: true })
    .waitFor();
  const group = page.getByRole("region", {
    name: `Root ${fixture.workspace}`,
    exact: true,
  });
  const alphaButton = group.getByRole("button", {
    name: `shared · a/shared · ${fixture.workspace}`,
    exact: true,
  });
  const betaButton = group.getByRole("button", {
    name: `shared · b/shared · ${fixture.workspace}`,
    exact: true,
  });
  assert.equal(await page.locator(".root-group").count(), 7);
  assert.equal(await group.getByRole("button").count(), 5);
  assert.equal(
    await page
      .getByText("No sessions found in this root.", { exact: true })
      .count(),
    2,
  );
  assert.equal(await page.getByText(/Cannot open root/).count(), 2);
  assert.equal(
    await page.getByRole("button", { name: /hidden|external|cycle/ }).count(),
    0,
  );
  await alphaButton.focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("heading", { name: "Alpha session", exact: true })
    .waitFor();
  assert.equal(await alphaButton.getAttribute("aria-pressed"), "true");
  assert.equal(await page.getByRole("table").locator("tbody tr").count(), 2);

  // Hold a real API response until after switching to another project's result.
  const diffStarted = deferred();
  const releaseDiff = deferred();
  const diffFinished = deferred();
  await page.route(
    `**/api/projects/${alpha.id}/runs/${alphaSnapshot.runs[1].id}/diff?**`,
    async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.message += " Delayed Alpha diff.";
      diffStarted.resolve();
      await releaseDiff.promise;
      await route.fulfill({ response, json: body });
      diffFinished.resolve();
    },
  );
  await page.getByRole("button", { name: /Win experiment 2:/ }).click();
  await diffStarted.promise;
  await betaButton.click();
  await page
    .getByRole("heading", { name: "Beta session", exact: true })
    .waitFor();
  await page.getByRole("button", { name: /Win experiment 2:/ }).click();
  const metric = page.getByTestId("selected-metric");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="selected-metric"]')?.textContent ===
      "27ms",
  );
  const diff = page.getByRole("region", { name: "Historical diff" });
  await diff.getByText(/did not record a commit reference/).waitFor();
  releaseDiff.resolve();
  await diffFinished.promise;
  assert.doesNotMatch(await diff.innerText(), /Delayed Alpha/);
  assert.equal((await metric.innerText()).replace(/\s/g, ""), "27ms");
  await page.unroute(
    `**/api/projects/${alpha.id}/runs/${alphaSnapshot.runs[1].id}/diff?**`,
  );

  const snapshotStarted = deferred();
  const releaseSnapshot = deferred();
  const snapshotFinished = deferred();
  await page.route(`**/api/projects/${alpha.id}`, async (route) => {
    const response = await route.fetch();
    snapshotStarted.resolve();
    await releaseSnapshot.promise;
    await route.fulfill({ response });
    snapshotFinished.resolve();
  });
  await alphaButton.click();
  await snapshotStarted.promise;
  await betaButton.click();
  await page
    .getByRole("heading", { name: "Beta session", exact: true })
    .waitFor();
  releaseSnapshot.resolve();
  await snapshotFinished.promise;
  assert.equal(
    await page
      .getByRole("heading", { name: "Alpha session", exact: true })
      .count(),
    0,
  );
  assert.equal(await betaButton.getAttribute("aria-pressed"), "true");
  await page.unroute(`**/api/projects/${alpha.id}`);
  await group.getByRole("button", { name: /^child ·/ }).click();
  await page
    .getByRole("heading", { name: "Nested session", exact: true })
    .waitFor();
  await group.getByRole("button", { name: /^uninitialized ·/ }).click();
  await page.getByText(/Uninitialized session\. No log/).waitFor();
  assert.equal(await page.getByRole("table").count(), 0);
  await assertReadOnly();

  // Test-owned changes happen only between read-only fingerprints.
  const added = join(fixture.workspace, "new-session");
  await mkdir(join(added, ".auto"), { recursive: true });
  before = await fingerprintDiscoveryFixture(fixture.directory);
  const refresh = page.getByRole("button", {
    name: "Refresh projects",
    exact: true,
  });
  await refresh.click();
  const newButton = group.getByRole("button", { name: /^new-session ·/ });
  await newButton.waitFor();
  await newButton.click();
  await page.getByText(/Uninitialized session\. No log/).waitFor();
  await assertReadOnly();
  await writeSession(added, "New initialized session", [5, 4]);
  before = await fingerprintDiscoveryFixture(fixture.directory);
  await refresh.click();
  await page
    .getByRole("heading", { name: "New initialized session", exact: true })
    .waitFor();
  await page.getByRole("button", { name: /Win experiment 2:/ }).click();
  await page
    .getByRole("heading", { name: "Experiment 02", exact: true })
    .waitFor();
  await assertReadOnly();
  await writeFile(
    join(added, ".auto/log.jsonl"),
    (await readFile(join(added, ".auto/log.jsonl"), "utf8")) +
      JSON.stringify({ run: 3, metric: 3, status: "keep" }) +
      "\n",
  );
  before = await fingerprintDiscoveryFixture(fixture.directory);
  await refresh.click();
  await page.getByRole("button", { name: /Win experiment 3:/ }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: /Win experiment 2:/ })
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(
    await page
      .getByRole("heading", { name: "Experiment 02", exact: true })
      .count(),
    1,
  );
  assert.equal(await page.getByRole("table").locator("tbody tr").count(), 3);
  await assertReadOnly();
  if (process.env.VISUALIZER_SCREENSHOT)
    await page.screenshot({
      path: process.env.VISUALIZER_SCREENSHOT,
      fullPage: true,
    });
  await rm(join(added, ".auto"), { recursive: true });
  before = await fingerprintDiscoveryFixture(fixture.directory);
  await refresh.click();
  await page
    .getByText(
      "The selected project is no longer discovered. Choose an available project.",
      { exact: true },
    )
    .waitFor();
  await page
    .getByRole("heading", { name: "Parent session", exact: true })
    .waitFor();
  assert.equal(await newButton.count(), 0);
  await assertReadOnly();

  // A fresh browser load verifies the global no-project state after rediscovery.
  await rm(join(fixture.workspace, ".auto"), { recursive: true });
  await rm(join(fixture.alpha, ".auto"), { recursive: true });
  await rm(join(fixture.beta, ".auto"), { recursive: true });
  await rm(join(fixture.child, ".auto"), { recursive: true });
  await rm(join(fixture.uninitialized, ".auto"), { recursive: true });
  before = await fingerprintDiscoveryFixture(fixture.directory);
  await refresh.click();
  await page
    .getByText(
      "No projects found. Configure roots containing .auto sessions, then refresh projects.",
      { exact: true },
    )
    .waitFor();
  await page.reload();
  await page
    .getByText(
      "No projects found. Configure roots containing .auto sessions, then refresh projects.",
      { exact: true },
    )
    .waitFor();
  assert.equal(await page.getByRole("table").count(), 0);
  assert.deepEqual(errors, []);
  await assertReadOnly();
  console.log(
    `S04 ${mode} discovery smoke passed: 5 canonical nested projects in one Git repository; 7 root groups; overlap/symlink/exclusion/missing-root states; keyboard navigation; late snapshot/diff protection; manual discovery/log reload/selection retention/removal; empty state; unchanged source files/index/refs; zero browser errors.`,
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
