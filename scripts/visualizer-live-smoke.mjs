import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createDocumentFixture } from "./visualizer-document-fixture.mjs";

const mode = process.argv[2] ?? "dev";
assert.ok(["dev", "built"].includes(mode), "Use dev or built.");
const repo = fileURLToPath(new URL("../", import.meta.url));
const fixture = await createDocumentFixture();
const apiOrigin = "http://127.0.0.1:4318";
const uiOrigin = mode === "dev" ? "http://127.0.0.1:5181" : apiOrigin;
const logPath = join(fixture.alpha, ".auto/log.jsonl");
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
  const entry = { child, output: () => output };
  children.push(entry);
  return entry;
}

async function stop(entry) {
  if (!entry || entry.child.exitCode !== null) return;
  const exited = once(entry.child, "exit");
  entry.child.kill("SIGTERM");
  await Promise.race([
    exited,
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        entry.child.kill("SIGKILL");
        resolve();
      }, 3000);
    }),
  ]);
}

async function waitReady(url) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    const failed = children.find(
      ({ child }) => child.exitCode !== null && child.exitCode !== 0,
    );
    if (failed) throw new Error(failed.output());
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(children.map((entry) => entry.output()).join("\n"));
}

function startApi() {
  return start(
    process.execPath,
    [
      join(
        repo,
        `apps/visualizer-api/${mode === "dev" ? "src/main.ts" : "dist/main.js"}`,
      ),
      "--config",
      fixture.configPath,
      "--port",
      "4318",
      "--ui-origin",
      uiOrigin,
      ...(mode === "dev" ? ["--dev"] : []),
    ],
    { cwd: fixture.directory },
  );
}

const record = (run, metric, status = "keep") =>
  JSON.stringify({
    run,
    metric,
    status,
    description: `Live result ${run}`,
  });

let api;
let browser;
try {
  api = startApi();
  await waitReady(`${apiOrigin}/api/projects`);
  if (mode === "dev")
    start("pnpm", ["--filter", "visualizer", "dev", "--port", "5181"], {
      env: { ...process.env, VISUALIZER_API_PORT: "4318" },
    });
  await waitReady(uiOrigin);

  browser = await chromium.launch({
    headless: true,
    ...(process.env.VISUALIZER_CHROME_PATH
      ? { executablePath: process.env.VISUALIZER_CHROME_PATH }
      : { channel: "chrome" }),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(uiOrigin);
  await page.getByText("Live updates connected", { exact: true }).waitFor();
  const baseline = page.getByRole("button", {
    name: "Baseline experiment 1",
    exact: true,
  });
  await baseline.click();
  await page
    .getByRole("heading", { name: "Experiment 01", exact: true })
    .waitFor();
  await page.evaluate(() => window.scrollTo(0, 400));
  const scrollBefore = await page.evaluate(() => window.scrollY);

  const initialLog = await readFile(logPath, "utf8");
  await writeFile(logPath, `${initialLog}${record(3, 12)}\n`);
  await page
    .getByRole("button", {
      name: "Select experiment 3 from history",
      exact: true,
    })
    .waitFor();
  assert.equal(await baseline.getAttribute("aria-pressed"), "true");
  assert.equal(await page.evaluate(() => window.scrollY), scrollBefore);

  await writeFile(
    logPath,
    `${await readFile(logPath, "utf8")}{"run":4,"metric":11`,
  );
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(
    await page.getByRole("button", { name: /Select experiment 4/ }).count(),
    0,
  );
  await writeFile(
    logPath,
    `${await readFile(logPath, "utf8")},"status":"keep","description":"Completed tail"}\n`,
  );
  await page
    .getByRole("button", {
      name: "Select experiment 4 from history",
      exact: true,
    })
    .waitFor();
  assert.equal(await baseline.getAttribute("aria-pressed"), "true");

  await page
    .getByRole("button", {
      name: "Select experiment 4 from history",
      exact: true,
    })
    .click();
  await writeFile(
    `${logPath}.new`,
    (await readFile(logPath, "utf8")).replace(
      "Completed tail",
      "Rewritten tail",
    ),
  );
  await rename(`${logPath}.new`, logPath);
  await page
    .getByText(/selected experiment is no longer in this source/i)
    .waitFor();
  await baseline.click();

  await page
    .getByRole("button", { name: "Current ideas", exact: true })
    .click();
  await writeFile(`${fixture.ideasPath}.new`, "# Live ideas replacement\n");
  await rename(`${fixture.ideasPath}.new`, fixture.ideasPath);
  await page
    .getByRole("heading", { name: "Live ideas replacement", exact: true })
    .waitFor();
  assert.equal(await baseline.getAttribute("aria-pressed"), "true");

  await page
    .getByRole("button", { name: "Review results", exact: true })
    .click();
  const list = await (await fetch(`${uiOrigin}/api/projects`)).json();
  const projectId = list.projects.find(
    (project) => project.rootPath === fixture.alpha,
  ).id;
  let releaseHeld;
  const release = new Promise((resolve) => {
    releaseHeld = resolve;
  });
  let heldReady;
  const held = new Promise((resolve) => {
    heldReady = resolve;
  });
  let shouldHold = true;
  await page.route(`**/api/projects/${projectId}`, async (route) => {
    if (!shouldHold) return route.continue();
    shouldHold = false;
    const response = await route.fetch();
    heldReady();
    await release;
    await route.fulfill({ response });
  });
  await writeFile(
    logPath,
    `${await readFile(logPath, "utf8")}${record(5, 10)}\n`,
  );
  await held;
  await writeFile(
    logPath,
    `${await readFile(logPath, "utf8")}${record(6, 9)}\n`,
  );
  await page
    .getByRole("button", {
      name: "Select experiment 6 from history",
      exact: true,
    })
    .waitFor();
  releaseHeld();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(
    await page
      .getByRole("button", {
        name: "Select experiment 6 from history",
        exact: true,
      })
      .count(),
    1,
  );
  assert.equal(await baseline.getAttribute("aria-pressed"), "true");
  await page.unroute(`**/api/projects/${projectId}`);

  await page.context().setOffline(true);
  await stop(api);
  await page
    .getByText("Live updates disconnected", { exact: true })
    .waitFor({ timeout: 20_000 });
  await writeFile(
    logPath,
    `${await readFile(logPath, "utf8")}${record(7, 8)}\n`,
  );
  api = startApi();
  await waitReady(`${apiOrigin}/api/projects`);
  await page.context().setOffline(false);
  await page.getByText("Live updates connected", { exact: true }).waitFor();
  await page
    .getByRole("button", {
      name: "Select experiment 7 from history",
      exact: true,
    })
    .waitFor();
  assert.equal(await baseline.getAttribute("aria-pressed"), "true");

  await stop(api);
  await writeFile(
    fixture.configPath,
    JSON.stringify({
      roots: [{ path: fixture.alpha, recursive: false }],
      watch: false,
    }),
  );
  api = startApi();
  await waitReady(`${apiOrigin}/api/projects`);
  await page.reload();
  await page.getByText("Manual updates", { exact: true }).waitFor();
  await baseline.click();
  await writeFile(
    logPath,
    `${await readFile(logPath, "utf8")}${record(8, 7)}\n`,
  );
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(
    await page.getByRole("button", { name: /Select experiment 8/ }).count(),
    0,
  );
  await page
    .getByRole("button", { name: "Refresh projects", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Select experiment 8 from history",
      exact: true,
    })
    .waitFor();
  assert.equal(await baseline.getAttribute("aria-pressed"), "true");
  assert.deepEqual(errors, []);
  console.log(
    `S09 ${mode} live smoke passed: append, partial-tail completion, atomic notes, stale-response rejection, disconnect/reconnect catch-up, manual-only refresh, retained result/scroll, and zero page errors.`,
  );
} finally {
  await browser?.close();
  for (const entry of children.reverse()) await stop(entry);
  await rm(fixture.directory, { recursive: true, force: true });
}
