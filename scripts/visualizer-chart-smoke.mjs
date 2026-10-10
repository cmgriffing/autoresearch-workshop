import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  ProjectSnapshotSchema,
  ProjectsResponseSchema,
} from "../packages/visualizar-common/dist/index.js";
import { createChartFixture } from "./visualizer-chart-fixture.mjs";
import { hashFiles } from "./visualizer-fixture.mjs";

const mode = process.argv[2] ?? "dev";
assert.ok(["dev", "built"].includes(mode), "Use dev or built.");
const workspace = fileURLToPath(new URL("../", import.meta.url));
const fixture = await createChartFixture();
const before = await hashFiles(fixture.directory);
const apiOrigin = "http://127.0.0.1:4316";
const uiOrigin = mode === "dev" ? "http://127.0.0.1:5179" : apiOrigin;
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
async function setThresholdMax(page) {
  const slider = page.getByRole("slider", {
    name: "Minimum win improvement percentage",
  });
  await slider.focus();
  await page.keyboard.press("End");
}

let browser;
let releaseDiff;
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
    "4316",
    "--ui-origin",
    uiOrigin,
    ...(mode === "dev" ? ["--dev"] : []),
  ]);
  await waitReady(`${apiOrigin}/api/projects`);
  if (mode === "dev")
    start("pnpm", ["--filter", "visualizer", "dev", "--port", "5179"], {
      env: { ...process.env, VISUALIZER_API_PORT: "4316" },
    });
  await waitReady(uiOrigin);
  const list = ProjectsResponseSchema.parse(
    await (await fetch(`${uiOrigin}/api/projects`)).json(),
  );
  const snapshot = ProjectSnapshotSchema.parse(
    await (
      await fetch(`${uiOrigin}/api/projects/${list.projects[0].id}`)
    ).json(),
  );
  const [lower, higher, empty, failures, single, discards] = snapshot.segments;
  assert.deepEqual(
    lower.attempts.map((point) => point.bestMetric),
    [null, 10, 10, 9, 9, 9, 8, 8],
  );
  assert.deepEqual(
    lower.attempts.map((point) => point.metric),
    [null, 10, 1, 9, 12, null, 8, null],
  );
  browser = await chromium.launch({
    headless: true,
    ...(process.env.VISUALIZER_CHROME_PATH
      ? { executablePath: process.env.VISUALIZER_CHROME_PATH }
      : { channel: "chrome" }),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const errors = [];
  const warnings = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type()))
      warnings.push(`${message.text()} (${message.location().url})`);
  });
  await page.goto(uiOrigin);
  const chart = page.getByRole("region", { name: "Metric trajectory" });
  const details = page.getByRole("region", { name: "Selected experiment" });
  const attemptList = page.getByTestId("attempt-list");
  const marker = (point) => chart.locator(`[data-run-id="${point.runId}"]`);
  const listEntry = (point) =>
    attemptList.locator(`.attempt-entry[data-run-id="${point.runId}"]`);
  const rows = () => attemptList.locator(".attempt-entry");
  const pressed = () =>
    attemptList.locator('.attempt-entry[aria-pressed="true"]');
  async function selected(point, listed = true) {
    await page
      .getByRole("heading", {
        name: `Experiment ${String(point.run).padStart(2, "0")}`,
        exact: true,
      })
      .waitFor();
    assert.equal(await marker(point).getAttribute("aria-pressed"), "true");
    if (listed)
      assert.equal(await listEntry(point).getAttribute("aria-pressed"), "true");
    assert.equal(await chart.locator('[aria-pressed="true"]').count(), 1);
  }
  await marker(lower.attempts[1]).waitFor();
  assert.equal(await chart.locator("g.attempt-marker").count(), 5);
  assert.equal(
    await chart
      .getByRole("group", { name: "Failed attempts" })
      .getByRole("button")
      .count(),
    3,
  );
  assert.equal(await rows().count(), 8);
  const xs = await chart
    .locator("g.attempt-marker")
    .evaluateAll((elements) =>
      elements.map((element) =>
        Number(element.querySelector("circle").getAttribute("cx")),
      ),
    );
  assert.ok(
    xs.every((x, index) => index === 0 || x > xs[index - 1]),
    "Source order controls x positions, including duplicate/unordered run numbers",
  );

  // An initial failure is inspectable but establishes neither baseline nor best.
  await marker(lower.attempts[0]).focus();
  await page.keyboard.press("Space");
  await selected(lower.attempts[0]);
  assert.equal(
    (await page.getByTestId("selected-metric").innerText()).replace(/\s/g, ""),
    "0ms",
  );
  assert.match(
    await details.innerText(),
    /Failed attempt · recorded metric excluded from the chart/,
  );
  assert.match(await listEntry(lower.attempts[0]).innerText(), /Unavailable/);
  assert.equal(await details.locator("script").count(), 0);

  // Keyboard point selection, source values, and escaped arbitrary JSON.
  await marker(lower.attempts[1]).focus();
  await page.keyboard.press("Enter");
  await selected(lower.attempts[1]);
  assert.equal(
    await listEntry(lower.attempts[1]).getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(
    await marker(lower.attempts[1]).getAttribute("data-marker"),
    "baseline",
  );
  assert.equal(
    await marker(lower.attempts[1]).evaluate((element) =>
      element.matches(":focus-visible"),
    ),
    true,
    JSON.stringify(
      await marker(lower.attempts[1]).evaluate((element) => ({
        active: document.activeElement?.outerHTML.slice(0, 200),
        focused: element === document.activeElement,
      })),
    ),
  );
  const baselineText = await details.innerText();
  assert.match(baselineText, /58\.25301204819275/);
  assert.match(baselineText, /memory_mib\s+32/);
  assert.match(baselineText, /mbps\s+100/);
  assert.match(baselineText, /Session-reported context/);
  assert.equal(
    await details.locator("time").getAttribute("datetime"),
    new Date(1791342240000).toISOString(),
  );
  assert.deepEqual(
    JSON.parse(await details.getByRole("code").innerText()),
    fixture.records[2].asi,
  );
  assert.equal(await details.locator("img, script").count(), 0);
  assert.equal(await page.evaluate(() => window.asiExecuted), undefined);
  const diff = page.getByRole("region", { name: "Historical diff" });
  await diff.getByText(/Empty tree/).waitFor();

  // The chart's native arrow navigation exposes a screen-readable tooltip.
  await chart.locator("svg.recharts-surface").focus();
  await page.keyboard.press("ArrowRight");
  await chart.locator(".attempt-tooltip").waitFor();
  assert.match(
    await chart.locator(".attempt-tooltip").innerText(),
    /Attempt \d+ · Experiment \d+/,
  );

  // A better discarded value never becomes the kept trajectory or a win.
  await marker(lower.attempts[2]).click();
  await selected(lower.attempts[2]);
  assert.match(await details.innerText(), /Discarded/);
  assert.match(await listEntry(lower.attempts[2]).innerText(), /Discarded/);
  assert.match(
    await listEntry(lower.attempts[2]).innerText(),
    /Best kept so far 10 ms/,
  );
  assert.equal(await pressed().count(), 1);
  assert.equal(
    await listEntry(lower.attempts[2]).getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(
    await details.getByRole("code").innerText(),
    JSON.stringify(fixture.records[3].asi, null, 2),
  );
  await diff.locator(".unified-diff").waitFor();
  assert.match(await diff.innerText(), /project\/code\.ts/);
  assert.doesNotMatch(await diff.innerText(), /sibling\/outside\.ts/);

  // Win, duplicate kept number, and falsy confidence/ASI retain separate identity.
  await marker(lower.attempts[3]).click();
  await selected(lower.attempts[3]);
  assert.equal(
    await attemptList
      .getByRole("button", {
        name: /^Select experiment 4 from the attempt list.*New best/,
      })
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(
    await marker(lower.attempts[3]).getAttribute("data-marker"),
    "win",
  );
  assert.match(await details.innerText(), /New best/);
  assert.match(await details.innerText(), /Reported confidence\s+0/);
  assert.match(await details.innerText(), /1 ms · 10\.00%/);
  assert.equal(await details.getByRole("code").innerText(), "false");
  await listEntry(lower.attempts[4]).focus();
  await page.keyboard.press("Space");
  await selected(lower.attempts[4]);
  assert.match(
    await details.innerText(),
    /Worse keep with duplicate display number/,
  );
  assert.match(await details.innerText(), /Decision\s+Kept/i);
  assert.match(
    await details.innerText(),
    /Recorded timestamp \(UTC\)\s+Not recorded/i,
  );
  assert.equal(await details.getByRole("code").innerText(), "0");
  assert.equal(await pressed().count(), 1);
  assert.equal(
    await listEntry(lower.attempts[4]).getAttribute("aria-pressed"),
    "true",
  );

  await setThresholdMax(page);
  await marker(lower.attempts[6]).click();
  await selected(lower.attempts[6], false);
  await page
    .getByText("Selected experiment remains open outside the current filter.")
    .waitFor();
  assert.equal(await chart.locator('g[data-marker="win"]').count(), 2);
  assert.equal(
    await details.locator("time").getAttribute("datetime"),
    "1970-01-01T00:00:00.000Z",
  );
  await setThreshold(page, "0%");
  assert.equal(
    await listEntry(lower.attempts[6]).getAttribute("aria-pressed"),
    "true",
  );
  await marker(lower.attempts[5]).click();
  await selected(lower.attempts[5]);
  assert.match(await details.innerText(), /Checks failure placeholder/);
  assert.match(await details.innerText(), /Reported confidence\s+Not recorded/);
  assert.equal(await details.getByRole("code").innerText(), "null");

  // A late chart-selected diff cannot replace a newer baseline selection.
  let held = false;
  let fetched;
  const gotDiff = new Promise((resolve) => {
    fetched = resolve;
  });
  const gate = new Promise((resolve) => {
    releaseDiff = resolve;
  });
  await page.route("**/api/projects/*/runs/*/diff?**", async (route) => {
    if (!held && route.request().url().includes(lower.attempts[3].runId)) {
      held = true;
      const response = await route.fetch();
      fetched();
      await gate;
      await route.fulfill({ response }).catch(() => {});
    } else await route.continue();
  });
  await marker(lower.attempts[3]).click();
  await gotDiff;
  await marker(lower.attempts[1]).click();
  await diff.getByText(/Empty tree/).waitFor();
  releaseDiff();
  await page.unrouteAll({ behavior: "wait" });
  assert.match(await diff.innerText(), new RegExp(fixture.rootOid));
  assert.doesNotMatch(await diff.innerText(), /project\/code\.ts/);
  await selected(lower.attempts[1]);

  const segmentSelect = page.getByRole("combobox", { name: "Metric segment" });
  await segmentSelect.selectOption(higher.id);
  await marker(higher.attempts[0]).waitFor();
  assert.equal(await chart.locator("g.attempt-marker").count(), 4);
  assert.equal(
    await chart.locator(`[data-run-id="${lower.attempts[1].runId}"]`).count(),
    0,
  );
  assert.equal(await details.count(), 0);
  await marker(higher.attempts[1]).click();
  await selected(higher.attempts[1]);
  assert.match(
    await details.innerText(),
    /percentage unavailable \(zero reference\)/,
  );
  assert.match(await details.innerText(), /Reported confidence\s+0\.01/);
  await setThreshold(page, "1.0%");
  await page
    .getByText("Selected experiment remains open outside the current filter.")
    .waitFor();
  assert.equal(
    await marker(higher.attempts[1]).getAttribute("aria-pressed"),
    "true",
  );
  await marker(higher.attempts[3]).click();
  await selected(higher.attempts[3]);
  assert.match(await details.innerText(), /Reported confidence\s+200/);
  assert.equal(await details.getByRole("code").innerText(), "true");
  assert.match(
    await listEntry(higher.attempts[2]).innerText(),
    /Best kept so far 5 pts/,
  );

  await segmentSelect.selectOption(empty.id);
  await chart.getByText("No attempts recorded in this segment.").waitFor();
  assert.equal(await page.getByRole("table").count(), 0);
  assert.equal(await chart.locator("svg").count(), 0);
  await segmentSelect.selectOption(failures.id);
  await chart
    .getByText(
      "No measured kept or discarded attempts. Failed attempts remain selectable below.",
    )
    .waitFor();
  assert.equal(await chart.locator("svg").count(), 0);
  await marker(failures.attempts[1]).focus();
  await page.keyboard.press("Enter");
  await selected(failures.attempts[1]);
  assert.match(
    await listEntry(failures.attempts[1]).innerText(),
    /Unavailable/,
  );
  await segmentSelect.selectOption(single.id);
  await marker(single.attempts[0]).click();
  await selected(single.attempts[0]);
  assert.equal(await chart.locator("g.attempt-marker").count(), 1);
  await segmentSelect.selectOption(discards.id);
  await marker(discards.attempts[0]).click();
  await selected(discards.attempts[0]);
  assert.equal(await chart.locator("g.attempt-marker").count(), 2);
  assert.equal(
    await attemptList
      .getByRole("button", { name: /First kept baseline/ })
      .count(),
    0,
  );
  assert.match(await listEntry(discards.attempts[0]).innerText(), /Discarded/);
  assert.match(
    await listEntry(discards.attempts[0]).innerText(),
    /Best kept so far Unavailable/,
  );

  // Project-view changes and unchanged refreshes reuse the same selected-run state.
  await segmentSelect.selectOption(lower.id);
  await setThreshold(page, "0%");
  await marker(lower.attempts[1]).click();
  await page
    .getByRole("button", { name: "Current ideas", exact: true })
    .click();
  assert.equal(await chart.count(), 0);
  await attemptList
    .getByRole("button", {
      name: /^Select experiment 4 from the attempt list.*New best/,
    })
    .click();
  await selected(lower.attempts[3]);
  await page
    .getByRole("button", { name: "Refresh projects", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Refresh projects", exact: true })
    .waitFor();
  await selected(lower.attempts[3]);
  await marker(lower.attempts[1]).click();
  await selected(lower.attempts[1]);
  await page.mouse.move(10, 10);
  await page.evaluate(() => window.scrollTo(0, 0));
  if (process.env.VISUALIZER_SCREENSHOT)
    await page.screenshot({
      path: process.env.VISUALIZER_SCREENSHOT,
      fullPage: true,
    });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.deepEqual(await hashFiles(fixture.directory), before);
  console.log(
    `S07 ${mode} smoke passed: source-ordered chart; baseline/win/discard/duplicate/failure selection; kept-only trajectory; six isolated segments; advisory JSON/secondary metrics/timestamps; keyboard chart/attempt list; scoped and stale diffs; unchanged files/index/refs; zero browser errors or warnings.`,
  );
} finally {
  releaseDiff?.();
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
