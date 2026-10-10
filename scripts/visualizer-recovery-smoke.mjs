import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import {
  createDiscoveryFixture,
  fingerprintDiscoveryFixture,
  writeSession,
} from "./visualizer-discovery-fixture.mjs";

const mode = process.argv[2] ?? "dev";
assert.ok(["dev", "built"].includes(mode), "Use dev or built.");
const repo = fileURLToPath(new URL("../", import.meta.url));
const fixture = await createDiscoveryFixture();
const root = dirname(fixture.alpha);
const healthyRoot = dirname(fixture.beta);
const apiOrigin = "http://127.0.0.1:4319";
const uiOrigin = mode === "dev" ? "http://127.0.0.1:5182" : apiOrigin;
const controlsPath = join(fixture.directory, "recovery-controls.json");
const runnerPath = join(fixture.directory, "recovery-server.mjs");
const controls = { failRoot: null, failWatch: true, dropEvents: true };
const setControls = async (changes) => {
  Object.assign(controls, changes);
  await writeFile(`${controlsPath}.new`, JSON.stringify(controls));
  await rename(`${controlsPath}.new`, controlsPath);
};
await setControls({});
await writeFile(
  fixture.configPath,
  JSON.stringify({
    roots: [{ path: root }, { path: healthyRoot }],
    rescanIntervalMs: 200,
  }),
);
// Test-only injection controls real local watchers and discovery. Production CLI
// never exposes these controls, paths or arbitrary callbacks over HTTP.
await writeFile(
  runnerPath,
  `
import { readFileSync, watch } from "node:fs";
import { readdir } from "node:fs/promises";
import { createApp } from ${JSON.stringify(pathToFileURL(join(repo, `apps/visualizer-api/${mode === "dev" ? "src/server.ts" : "dist/server.js"}`)).href)};
const controls = () => JSON.parse(readFileSync(${JSON.stringify(controlsPath)}, "utf8"));
const app = await createApp({
  configPath: ${JSON.stringify(fixture.configPath)}, apiOrigin: ${JSON.stringify(apiOrigin)}, uiOrigin: ${JSON.stringify(uiOrigin)},
  ${mode === "built" ? `staticRoot: ${JSON.stringify(join(repo, "apps/visualizer/dist"))},` : ""}
  registryOptions: {
    scanDirectory: async (path) => {
      if (controls().failRoot === path) throw new Error("Controlled unreadable root");
      return readdir(path, { withFileTypes: true });
    },
    watchDirectory: (path, options, listener) => {
      if (controls().failWatch) throw new Error("Controlled watcher setup failure");
      return watch(path, options, (event, filename) => {
        if (!controls().dropEvents) listener(event, filename);
      });
    },
  },
});
await app.listen({ host: "127.0.0.1", port: 4319 });
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
  void app.close().then(() => process.exit(0));
});
`,
);

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
  let timer;
  await Promise.race([
    exited,
    new Promise((resolve) => {
      timer = setTimeout(() => {
        entry.child.kill("SIGKILL");
        resolve();
      }, 3000);
    }),
  ]);
  clearTimeout(timer);
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
const startApi = () => start(process.execPath, [runnerPath]);
let api;
let browser;
try {
  const before = await fingerprintDiscoveryFixture(fixture.workspace);
  api = startApi();
  await waitReady(`${apiOrigin}/api/projects`);
  if (mode === "dev")
    start("pnpm", ["--filter", "visualizer", "dev", "--port", "5182"], {
      env: { ...process.env, VISUALIZER_API_PORT: "4319" },
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
  const alphaButton = page.getByRole("button", {
    name: `shared · shared · ${root}`,
    exact: true,
  });
  await alphaButton.click();
  await page
    .getByRole("heading", { name: "Alpha session", exact: true })
    .waitFor();
  await page.getByText(/Session watcher unavailable; periodic/).waitFor();
  const baseline = page.getByRole("button", {
    name: "Baseline experiment 1",
    exact: true,
  });
  await baseline.click();
  assert.deepEqual(
    await fingerprintDiscoveryFixture(fixture.workspace),
    before,
  );

  const log = join(fixture.alpha, ".auto/log.jsonl");
  await writeFile(
    log,
    `${await readFile(log, "utf8")}{"run":3,"metric":12,"status":"keep","description":"Recovered without watcher"}\n`,
  );
  let fingerprint = await fingerprintDiscoveryFixture(fixture.workspace);
  await page
    .getByRole("button", {
      name: "Select experiment 3 from history",
      exact: true,
    })
    .waitFor();
  assert.equal(await baseline.getAttribute("aria-pressed"), "true");
  assert.deepEqual(
    await fingerprintDiscoveryFixture(fixture.workspace),
    fingerprint,
  );
  await setControls({ failWatch: false });
  await page
    .getByText(/Session watcher unavailable; periodic/)
    .waitFor({ state: "detached" });

  const newProject = join(fixture.alpha, "new-session");
  await mkdir(join(newProject, ".auto"), { recursive: true });
  const newButton = page.getByRole("button", {
    name: `new-session · shared/new-session · ${root}`,
    exact: true,
  });
  await newButton.waitFor();
  assert.equal(await baseline.getAttribute("aria-pressed"), "true");
  await newButton.click();
  await page.getByText(/Uninitialized session. No log.jsonl/).waitFor();
  await writeSession(newProject, "New periodic session", [8, 6]);
  await page
    .getByRole("heading", { name: "New periodic session", exact: true })
    .waitFor();
  await page.getByRole("button", { name: /^Win experiment 2:/ }).click();
  await rm(join(newProject, ".auto"), { recursive: true });
  await newButton.waitFor({ state: "detached" });
  await page.getByText(/selected project is no longer discovered/i).waitFor();
  await page
    .getByRole("heading", { name: "Experiment 02", exact: true })
    .waitFor({ state: "detached" });
  await alphaButton.click();
  await page
    .getByRole("heading", { name: "Alpha session", exact: true })
    .waitFor();
  await baseline.click();

  await page
    .getByRole("button", { name: "Current ideas", exact: true })
    .click();
  await writeFile(
    join(fixture.alpha, ".auto/ideas.md"),
    "# Notes recovered by polling\n",
  );
  await page
    .getByRole("heading", { name: "Notes recovered by polling", exact: true })
    .waitFor();
  await setControls({ failRoot: root });
  await page
    .getByText(/Stale data: showing the last successfully read project data/)
    .waitFor();
  await page.getByText(/Controlled unreadable root/).waitFor();
  assert.equal(await alphaButton.getAttribute("aria-pressed"), "true");
  assert.equal(await baseline.getAttribute("aria-pressed"), "true");
  await page
    .getByRole("heading", { name: "Notes recovered by polling", exact: true })
    .waitFor();
  fingerprint = await fingerprintDiscoveryFixture(fixture.workspace);
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.deepEqual(
    await fingerprintDiscoveryFixture(fixture.workspace),
    fingerprint,
  );
  const healthy = page.getByRole("button", {
    name: `shared · shared · ${healthyRoot}`,
    exact: true,
  });
  await healthy.click();
  await page
    .getByRole("heading", { name: "Beta session", exact: true })
    .waitFor();
  assert.equal(await page.getByText(/Stale data: showing/).count(), 0);
  await alphaButton.click();
  await baseline.click();
  await setControls({ failRoot: null });
  await page.getByText(/Stale data: showing/).waitFor({ state: "detached" });
  assert.equal(await baseline.getAttribute("aria-pressed"), "true");

  // An actually missing root also retains known data. Restore the pathname to
  // recover, then delete the session while the root scans successfully.
  await rename(root, `${root}.away`);
  await page.getByText(/Stale data: showing/).waitFor();
  assert.equal(await alphaButton.count(), 1);
  await rename(`${root}.away`, root);
  await page.getByText(/Stale data: showing/).waitFor({ state: "detached" });
  assert.equal(await baseline.getAttribute("aria-pressed"), "true");

  await page
    .getByRole("button", { name: "Review results", exact: true })
    .click();
  await page.context().setOffline(true);
  await stop(api);
  await page
    .getByText("Live updates disconnected", { exact: true })
    .waitFor({ timeout: 20000 });
  await writeFile(
    log,
    `${await readFile(log, "utf8")}{"run":4,"metric":10,"status":"keep","description":"Reconnect recovery"}\n`,
  );
  api = startApi();
  await waitReady(`${apiOrigin}/api/projects`);
  await page.context().setOffline(false);
  await page.getByText("Live updates connected", { exact: true }).waitFor();
  await page
    .getByRole("button", {
      name: "Select experiment 4 from history",
      exact: true,
    })
    .waitFor();
  assert.equal(await baseline.getAttribute("aria-pressed"), "true");

  const snapshot = await (await fetch(`${uiOrigin}/api/projects`)).json();
  const alpha = snapshot.projects.find(
    (project) => project.rootPath === root && project.relativePath === "shared",
  );
  await rm(join(fixture.alpha, ".auto"), { recursive: true });
  await alphaButton.waitFor({ state: "detached" });
  await page.getByText(/selected project is no longer discovered/i).waitFor();
  assert.equal(
    (await fetch(`${uiOrigin}/api/projects/${alpha.id}`)).status,
    404,
  );
  assert.equal(
    await page
      .getByRole("heading", { name: "Experiment 01", exact: true })
      .count(),
    0,
  );
  if (process.env.VISUALIZER_SCREENSHOT)
    await page.screenshot({
      path: process.env.VISUALIZER_SCREENSHOT,
      fullPage: true,
    });
  assert.deepEqual(errors, []);
  console.log(
    `S10 ${mode} recovery smoke passed: watcher fallback/retry, dropped events, new/nested/removed sessions, stale root retention/recovery, notes, reconnect, preserved selection, read-only source/Git fingerprints, and zero page errors.`,
  );
} finally {
  await browser?.close();
  for (const entry of children.reverse()) await stop(entry);
  await rm(fixture.directory, { recursive: true, force: true });
}
