import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  DiffResponseSchema,
  ProjectSnapshotSchema,
  ProjectsResponseSchema,
} from "../packages/visualizar-common/dist/index.js";
import { hashFiles } from "./visualizer-fixture.mjs";

const mode = process.argv[2] ?? "built";
assert.ok(["dev", "built"].includes(mode), "Use dev or built.");
const workspace = fileURLToPath(new URL("../", import.meta.url));
const checksumPath = join(workspace, "demo-projects", "checksum");
const configPath = join(
  workspace,
  "apps",
  "visualizer-api",
  "config.example.json",
);
const apiOrigin = "http://127.0.0.1:4321";
const uiOrigin = mode === "dev" ? "http://127.0.0.1:5184" : apiOrigin;

// Read-only Git fingerprint for the real checksum project's repository. The
// example config points at the checked-in session; the assembled app must not
// modify its files, index, or refs.
function gitFingerprint() {
  const git = (...args) =>
    execFileSync("git", ["--no-optional-locks", "-C", checksumPath, ...args], {
      encoding: "utf8",
    }).trim();
  // Supports linked worktrees, where .git is a file rather than a directory.
  const gitDir = git("rev-parse", "--absolute-git-dir");
  return {
    head: git("rev-parse", "HEAD"),
    status: git("status", "--porcelain"),
    refs: git("for-each-ref", "--format=%(refname) %(objectname)"),
    index: createHash("sha256")
      .update(readFileSync(join(gitDir, "index")))
      .digest("hex"),
  };
}

const before = {
  tree: await hashFiles(checksumPath),
  git: gitFingerprint(),
};
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
  child.on("error", (error) => (output += error.message));
  children.push({ child, output: () => output });
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
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 3000);
    void exited.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function setThreshold(page, prefix, limit = 40) {
  const slider = page.getByRole("slider", {
    name: "Minimum win improvement percentage",
  });
  await slider.focus();
  await page.keyboard.press("Home");
  for (let step = 0; step <= limit; step += 1) {
    const text = await page.getByTestId("threshold-readout").innerText();
    if (text.startsWith(prefix)) return;
    await page.keyboard.press("ArrowRight");
  }
  throw new Error(`Threshold never reached ${prefix}`);
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
    configPath,
    "--port",
    "4321",
    "--ui-origin",
    uiOrigin,
    ...(mode === "dev" ? ["--dev"] : []),
  ]);
  await waitReady(`${apiOrigin}/api/projects`);
  if (mode === "dev")
    start("pnpm", ["--filter", "visualizer", "dev", "--port", "5184"], {
      env: { ...process.env, VISUALIZER_API_PORT: "4321" },
    });
  await waitReady(uiOrigin);

  // ---- Documented example config and typed API contracts ----
  const list = ProjectsResponseSchema.parse(
    await (await fetch(`${apiOrigin}/api/projects`)).json(),
  );
  assert.equal(list.watchEnabled, true);
  assert.equal(list.minWinImprovementPct, 0);
  assert.equal(list.projects.length, 1);
  const summary = list.projects[0];
  assert.equal(summary.name, "checksum");
  assert.equal(summary.relativePath, ".");
  assert.equal(summary.runCount, 23);
  assert.equal(summary.sourceState, "ready");
  assert.deepEqual(summary.documentStates, { ideas: "ready", prompt: "ready" });
  const snapshot = ProjectSnapshotSchema.parse(
    await (await fetch(`${apiOrigin}/api/projects/${summary.id}`)).json(),
  );
  assert.equal(snapshot.runs.length, 23);
  assert.equal(snapshot.segments.length, 1);
  const segment = snapshot.segments[0];
  assert.equal(segment.name, "Optimize checksum hot loop");
  assert.equal(segment.metricName, "checksum_ms");
  assert.equal(segment.metricUnit, "ms");
  assert.equal(segment.bestDirection, "lower");
  assert.equal(segment.baselineMetric, 18.35);
  assert.equal(segment.bestMetric, 3.84);
  const runByNumber = (run) => {
    const value = snapshot.runs.find((candidate) => candidate.run === run);
    assert.ok(value, `run ${run} is present`);
    return value;
  };
  const runById = (runId) => {
    const value = snapshot.runs.find((candidate) => candidate.id === runId);
    assert.ok(value, `run ID ${runId} is present`);
    return value;
  };
  assert.deepEqual(
    segment.wins.map((win) => runById(win.runId).run),
    [2, 4, 7, 8, 11, 14, 15],
  );
  assert.deepEqual(
    segment.wins
      .filter(
        (win) =>
          win.incremental.percentage !== null &&
          win.incremental.percentage >= 1,
      )
      .map((win) => runById(win.runId).run),
    [2, 4, 8],
  );

  const diffUrl = (run, query) =>
    `${apiOrigin}/api/projects/${summary.id}/runs/${runByNumber(run).id}/diff?revision=${snapshot.project.revision}${query}`;
  const parentTwo = DiffResponseSchema.parse(
    await (await fetch(diffUrl(2, "&comparison=parent"))).json(),
  );
  assert.equal(parentTwo.state, "available");
  assert.equal(parentTwo.comparison, "parent");
  assert.equal(parentTwo.includeAuto, false);
  assert.match(parentTwo.target.oid, new RegExp(`^${runByNumber(2).commit}`));
  assert.ok(
    parentTwo.files.every((file) =>
      file.path.startsWith("demo-projects/checksum/"),
    ),
  );
  assert.ok(
    parentTwo.files.every((file) => !file.path.includes("/.auto/")),
    "session artifacts are excluded by default",
  );
  assert.ok(parentTwo.files.some((file) => file.path.endsWith("src/index.js")));
  const parentOne = DiffResponseSchema.parse(
    await (await fetch(diffUrl(1, "&comparison=parent"))).json(),
  );
  assert.equal(parentOne.state, "empty");
  assert.match(
    parentOne.message,
    /excluding this project's \.auto session artifacts/,
  );
  const parentOneArtifacts = DiffResponseSchema.parse(
    await (
      await fetch(diffUrl(1, "&comparison=parent&includeAuto=true"))
    ).json(),
  );
  assert.equal(parentOneArtifacts.state, "available");
  assert.ok(
    parentOneArtifacts.files.some((file) =>
      file.path.endsWith(".auto/log.jsonl"),
    ),
  );
  const stale = await fetch(
    `${apiOrigin}/api/projects/${summary.id}/runs/${runByNumber(2).id}/diff?revision=s_stale`,
  );
  assert.equal(stale.status, 409);
  const unknownRun = await fetch(
    `${apiOrigin}/api/projects/${summary.id}/runs/r_unknown/diff?revision=${snapshot.project.revision}`,
  );
  assert.equal(unknownRun.status, 404);

  // ---- Assembled browser review of the checksum session ----
  browser = await chromium.launch({
    headless: true,
    ...(process.env.VISUALIZER_CHROME_PATH
      ? { executablePath: process.env.VISUALIZER_CHROME_PATH }
      : { channel: "chrome" }),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  page.setDefaultTimeout(10_000);
  const errors = [];
  const apiRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type()))
      errors.push(`${message.text()} (${message.location().url})`);
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      apiRequests.push(request.url());
  });
  await page.goto(uiOrigin);
  const projectSelector = page.getByRole("combobox", { name: /^Project/ });
  await projectSelector.waitFor();
  await projectSelector.click();
  await page.getByRole("option", { name: /^checksum · \./ }).click();
  await page
    .getByRole("heading", { name: "Optimize checksum hot loop", exact: true })
    .waitFor();
  await page.getByText("Live updates connected").waitFor();

  const summaryRegion = page.getByRole("region", { name: "Metric segment" });
  const summaryText = await summaryRegion.innerText();
  assert.match(summaryText, /first kept baseline\s+18\.35 ms/i);
  assert.match(summaryText, /best\s+3\.84 ms/i);
  assert.match(summaryText, /79\.07%/);

  const attemptList = page.getByTestId("attempt-list");
  await attemptList
    .getByRole("button", {
      name: /^Select experiment 2 from the attempt list.*New best/,
    })
    .waitFor();
  assert.equal(
    await attemptList.getByRole("button", { name: /New best/ }).count(),
    7,
  );
  assert.equal(
    await attemptList
      .getByRole("button", { name: /First kept baseline/ })
      .count(),
    1,
  );
  await setThreshold(page, "1.0%");
  assert.equal(
    await attemptList.getByRole("button", { name: /New best/ }).count(),
    3,
  );
  for (const run of [2, 4, 8])
    assert.equal(
      await attemptList
        .getByRole("button", {
          name: new RegExp(`^Select experiment ${run} from the attempt list`),
        })
        .count(),
      1,
    );
  assert.equal(
    await attemptList
      .getByRole("button", {
        name: /^Select experiment 7 from the attempt list/,
      })
      .count(),
    0,
  );

  // Chart selection synchronizes one selected result.
  const chart = page.getByRole("region", { name: "Metric trajectory" });
  await chart.locator(`[data-run-id="${runByNumber(8).id}"]`).click();
  await page
    .getByRole("heading", { name: "Experiment 08", exact: true })
    .waitFor();
  const details = page.getByRole("region", { name: "Selected experiment" });
  assert.match(await details.innerText(), /New best/);
  assert.equal(
    await attemptList
      .locator(`.attempt-entry[data-run-id="${runByNumber(8).id}"]`)
      .getAttribute("aria-pressed"),
    "true",
  );

  // Attempt-list selection exposes a discarded attempt without labeling it a win.
  await attemptList
    .getByRole("button", {
      name: /^Select experiment 3 from the attempt list/,
    })
    .click();
  await page
    .getByRole("heading", { name: "Experiment 03", exact: true })
    .waitFor();
  const discardedText = await details.innerText();
  assert.match(discardedText, /Discarded/);
  assert.doesNotMatch(discardedText, /New best/);
  assert.match(discardedText, /Previous best kept metric\s+4\.569 ms/i);

  // Parent and baseline comparisons with actual resolved references.
  await attemptList
    .getByRole("button", {
      name: /^Select experiment 2 from the attempt list.*New best/,
    })
    .click();
  await page
    .getByRole("heading", { name: "Experiment 02", exact: true })
    .waitFor();
  const diff = page.getByRole("region", { name: "Historical diff" });
  await diff.getByRole("heading", { name: "Parent diff" }).waitFor();
  await diff
    .getByRole("button", {
      name: "View file demo-projects/checksum/src/index.js",
    })
    .waitFor();
  assert.equal(await diff.locator(".changed-files button").count(), 2);
  assert.equal(await diff.getByRole("button", { name: /\.auto\// }).count(), 0);
  assert.match(
    await diff.locator(".unified-diff").innerText(),
    /src\/index\.js/,
  );
  const parentRefs = await diff.locator(".diff-references").innerText();
  assert.match(parentRefs, /base[\s\S]*[0-9a-f]{40}/i);
  assert.match(
    parentRefs,
    new RegExp(`target[\\s\\S]*${runByNumber(2).commit}`, "i"),
  );
  const comparison = diff.getByRole("combobox", { name: "Diff comparison" });
  await comparison.selectOption("baseline");
  await diff.getByRole("heading", { name: "Baseline diff" }).waitFor();
  assert.match(await diff.innerText(), /first kept commit/);
  assert.match(
    await diff.locator(".diff-references").innerText(),
    new RegExp(`base[\\s\\S]*${runByNumber(1).commit}`, "i"),
  );
  await comparison.selectOption("parent");
  await diff.getByRole("heading", { name: "Parent diff" }).waitFor();

  // Logs-only parent comparison: empty by default, visible with artifacts.
  await attemptList
    .getByRole("button", { name: /First kept baseline/ })
    .click();
  await page
    .getByRole("heading", { name: "Experiment 01", exact: true })
    .waitFor();
  await diff.getByText(/No project files changed after excluding/).waitFor();
  const artifact = diff.getByRole("checkbox", {
    name: "Include .auto session artifacts",
  });
  await artifact.check();
  await diff
    .getByRole("button", {
      name: "View file demo-projects/checksum/.auto/log.jsonl",
    })
    .waitFor();
  const presentation = diff.getByRole("combobox", {
    name: "Diff presentation",
  });
  await presentation.selectOption("split");
  await diff.locator(".split-diff").waitFor();
  await artifact.uncheck();
  await diff.getByText(/No project files changed after excluding/).waitFor();

  // Current notes are rendered as current documents.
  await page
    .getByRole("button", { name: "Current ideas", exact: true })
    .click();
  const notes = page.getByRole("region", { name: "Current project notes" });
  await notes.getByRole("heading", { name: "Current ideas" }).waitFor();
  assert.match(await notes.innerText(), /Optimization Ideas for checksum/);
  assert.match(await notes.innerText(), /Current ideas for checksum/);
  await page
    .getByRole("button", { name: "Current prompt", exact: true })
    .click();
  await notes.getByRole("heading", { name: "Current prompt" }).waitFor();
  assert.match(await notes.innerText(), /optimize the checksum hot loop/);
  await page
    .getByRole("button", { name: "Review results", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Experiment 01", exact: true })
    .waitFor();

  assert.ok(
    apiRequests.some((url) => new URL(url).pathname === "/api/events"),
    "the browser used the SSE route",
  );
  assert.ok(apiRequests.every((url) => new URL(url).origin === uiOrigin));
  assert.ok(apiRequests.every((url) => !url.includes(checksumPath)));
  assert.deepEqual(errors, []);
  if (process.env.VISUALIZER_SCREENSHOT)
    await page.screenshot({
      path: process.env.VISUALIZER_SCREENSHOT,
      fullPage: true,
    });

  // No writes to the real session, repository index, or refs.
  assert.deepEqual(await hashFiles(checksumPath), before.tree);
  assert.deepEqual(gitFingerprint(), before.git);
  console.log(
    `S12 ${mode} smoke passed: documented example config; checksum discovery; baseline 18.35 ms / best 3.84 ms / 79.07%; 1% filter runs 2/4/8; chart/attempt-list selection; parent/baseline/artifact/split diffs; current ideas and prompt; SSE connected; unchanged checksum files/index/refs; zero browser errors.`,
  );
} finally {
  await browser?.close();
  for (const { child } of children.reverse()) await stop(child);
}
