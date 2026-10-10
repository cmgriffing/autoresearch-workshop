import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  ApiErrorSchema,
  ProjectSnapshotSchema,
  ProjectsResponseSchema,
} from "../packages/visualizar-common/dist/index.js";
import {
  createFixture,
  createSegmentFixture,
  hashFiles,
} from "./visualizer-fixture.mjs";

const mode = process.argv[2] ?? "dev";
assert.ok(["dev", "built"].includes(mode), "Use dev or built.");
const fixtureKind = process.argv[3] ?? "checksum";
assert.ok(
  ["checksum", "segments"].includes(fixtureKind),
  "Use checksum or segments.",
);
const repo = fileURLToPath(new URL("../", import.meta.url));
const fixture =
  fixtureKind === "segments"
    ? await createSegmentFixture()
    : await createFixture();
const before = await hashFiles(fixture.directory);
const demoBefore = await readFile(
  new URL("../demo-projects/checksum/.auto/log.jsonl", import.meta.url),
);
const apiOrigin = "http://127.0.0.1:4311";
const uiOrigin = mode === "dev" ? "http://127.0.0.1:5174" : apiOrigin;
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
  return child;
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
  throw new Error(
    `Server did not become ready: ${children.map((value) => value.output()).join("\n")}`,
  );
}
let browser;
try {
  const entry = join(
    repo,
    `apps/visualizer-api/${mode === "dev" ? "src/main.ts" : "dist/main.js"}`,
  );
  const invalidConfig = join(fixture.directory, "invalid.json");
  await writeFile(invalidConfig, '{"roots":[]}');
  const invalid = start(process.execPath, [
    entry,
    "--config",
    invalidConfig,
    "--port",
    "4311",
  ]);
  assert.equal((await once(invalid, "exit"))[0], 1);
  assert.match(children.at(-1).output(), /Invalid visualizer config/);
  children.pop();
  await rm(invalidConfig);
  start(
    process.execPath,
    [
      entry,
      "--config",
      fixture.configPath,
      "--port",
      "4311",
      "--ui-origin",
      uiOrigin,
      ...(mode === "dev" ? ["--dev"] : []),
    ],
    { cwd: fixture.directory },
  );
  await waitReady(`${apiOrigin}/api/projects`);
  if (mode === "dev")
    start("pnpm", ["--filter", "visualizer", "dev", "--port", "5174"], {
      env: { ...process.env, VISUALIZER_API_PORT: "4311" },
    });
  await waitReady(uiOrigin);
  const list = ProjectsResponseSchema.parse(
    await (await fetch(`${uiOrigin}/api/projects`)).json(),
  );
  assert.equal(list.projects.length, 1);
  const projectId = list.projects[0].id;
  const snapshot = ProjectSnapshotSchema.parse(
    await (await fetch(`${uiOrigin}/api/projects/${projectId}`)).json(),
  );
  assert.equal(snapshot.runs.length, fixtureKind === "checksum" ? 23 : 8);
  assert.equal(snapshot.segments.length, fixtureKind === "checksum" ? 1 : 3);
  const missing = await fetch(`${uiOrigin}/api/projects/unknown`);
  assert.equal(missing.status, 404);
  assert.equal(
    ApiErrorSchema.parse(await missing.json()).error.code,
    "PROJECT_NOT_FOUND",
  );
  const blocked = await fetch(`${uiOrigin}/api/projects`, {
    headers: { Origin: "https://example.com" },
  });
  assert.equal(blocked.status, 403);
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
  const apiRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      apiRequests.push(request.url());
  });
  await page.goto(uiOrigin);
  const projectButton = page.getByRole("button", { name: /checksum-session/ });
  await projectButton.waitFor();
  await projectButton.focus();
  await page.keyboard.press("Enter");
  if (fixtureKind === "segments") {
    const segmentSelect = page.getByRole("combobox", {
      name: "Metric segment",
    });
    await segmentSelect.waitFor();
    assert.equal(await segmentSelect.inputValue(), snapshot.segments[0].id);
    await segmentSelect.selectOption(snapshot.segments[1].id);
    await page.getByText("Higher is better", { exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("complementary", { name: "Wins" })
        .getByRole("button", { name: /Win experiment/ })
        .count(),
      1,
    );
    const threshold = page.getByRole("spinbutton", {
      name: "Minimum win improvement percentage",
    });
    assert.equal(await threshold.inputValue(), "1");
    await threshold.fill("0");
    const zeroReference = page.getByRole("button", {
      name: /Win experiment 6: Percentage unavailable; absolute improvement 5/,
    });
    await zeroReference.click();
    await page
      .getByRole("heading", { name: "Experiment 06", exact: true })
      .waitFor();
    assert.equal(
      (await page.getByTestId("selected-metric").innerText()).replace(
        /\s/g,
        "",
      ),
      "5pts",
    );
    await segmentSelect.selectOption(snapshot.segments[2].id);
    await page
      .getByText("No post-baseline wins are recorded in this segment.")
      .waitFor();
    assert.equal(await page.getByRole("table").count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      `S03 ${mode} segment smoke passed: segment switching; higher-is-better; configured 1% default; zero-reference unavailable percentage at 0%; empty segment; zero browser errors.`,
    );
  } else {
    assert.equal(snapshot.runs[1].metric, 4.569);
    assert.equal(snapshot.segments[0].wins.length, 7);
    const experiment = page.getByRole("button", {
      name: /Win experiment 2:/,
    });
    await experiment.waitFor();
    await experiment.focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("heading", { name: "Experiment 02", exact: true })
      .waitFor();
    assert.equal(
      (await page.getByTestId("selected-metric").innerText()).replace(
        /\s/g,
        "",
      ),
      "4.569ms",
    );
    assert.match(
      await page
        .getByRole("region", { name: "Selected experiment" })
        .innerText(),
      /unroll/i,
    );
    assert.equal(await experiment.getAttribute("aria-pressed"), "true");
    const threshold = page.getByRole("spinbutton", {
      name: "Minimum win improvement percentage",
    });
    await threshold.fill("1");
    assert.equal(
      await page
        .getByRole("complementary", { name: "Wins" })
        .getByRole("button", { name: /Win experiment/ })
        .count(),
      3,
    );
    assert.equal(
      await page.getByRole("button", { name: /Win experiment 7:/ }).count(),
      0,
    );
    const filteredHistoryButton = page.getByRole("button", {
      name: "Select experiment 7 from history",
      exact: true,
    });
    await filteredHistoryButton.click();
    await page
      .getByRole("heading", { name: "Experiment 07", exact: true })
      .waitFor();
    await page
      .getByText("Selected win remains open outside the current filter.")
      .waitFor();
    const historyButton = page.getByRole("button", {
      name: "Select experiment 3 from history",
      exact: true,
    });
    await historyButton.focus();
    await page.keyboard.press("Space");
    await page
      .getByRole("heading", { name: "Experiment 03", exact: true })
      .waitFor();
    assert.equal(await historyButton.getAttribute("aria-pressed"), "true");
    assert.equal(await page.getByRole("table").locator("tbody tr").count(), 23);
    assert.equal(
      await historyButton.evaluate((element) =>
        element.matches(":focus-visible"),
      ),
      true,
    );
    assert.deepEqual(errors, []);
    console.log(
      `S03 ${mode} checksum smoke passed: 23 real runs; baseline plus 7 wins; 1% filter shows runs 2/4/8; outside-filter and history selection remain readable; typed APIs; unchanged fixture and demo log; zero browser errors.`,
    );
  }
  assert.ok(apiRequests.length >= 2);
  assert.ok(apiRequests.every((url) => new URL(url).origin === uiOrigin));
  assert.ok(apiRequests.every((url) => !url.includes(fixture.directory)));
  if (process.env.VISUALIZER_SCREENSHOT)
    await page.screenshot({
      path: process.env.VISUALIZER_SCREENSHOT,
      fullPage: true,
    });
  assert.deepEqual(await hashFiles(fixture.directory), before);
  assert.deepEqual(
    await readFile(
      new URL("../demo-projects/checksum/.auto/log.jsonl", import.meta.url),
    ),
    demoBefore,
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
