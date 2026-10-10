import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { appendFile, chmod, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  ProjectSnapshotSchema,
  ProjectsResponseSchema,
} from "../packages/visualizar-common/dist/index.js";
import { createAccessibilityFixture } from "./visualizer-accessibility-fixture.mjs";
import { hashFiles } from "./visualizer-fixture.mjs";

const mode = process.argv[2] ?? "dev";
assert.ok(["dev", "built"].includes(mode), "Use dev or built.");
const workspace = fileURLToPath(new URL("../", import.meta.url));
const fixture = await createAccessibilityFixture();
const logPath = join(fixture.projectPath, ".auto", "log.jsonl");
const logMode = (await stat(logPath)).mode;
const before = await hashFiles(fixture.directory);
const apiOrigin = "http://127.0.0.1:4320";
const uiOrigin = mode === "dev" ? "http://127.0.0.1:5183" : apiOrigin;
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
async function assertKeyboardFocus(locator, label) {
  assert.equal(
    await locator.evaluate((element) => element === document.activeElement),
    true,
    `${label} should have focus`,
  );
  assert.equal(
    await locator.evaluate((element) => element.matches(":focus-visible")),
    true,
    `${label} should match :focus-visible`,
  );
  const outline = await locator.evaluate(
    (element) => getComputedStyle(element).outlineWidth,
  );
  assert.notEqual(outline, "0px", `${label} should show a visible outline`);
}
async function tabUntil(page, locator, label, limit = 60) {
  await locator.first().waitFor({ state: "attached", timeout: 10_000 });
  for (let step = 1; step <= limit; step += 1) {
    await page.keyboard.press("Tab");
    if ((await locator.count()) === 0) continue;
    const reached = await locator
      .first()
      .evaluate((element) => element === document.activeElement)
      .catch(() => false);
    if (reached) return step;
  }
  throw new Error(`Tab order never reached ${label}`);
}
async function selectProject(page, name) {
  await page.getByRole("combobox", { name: /^Project/ }).click();
  await page
    .getByRole("option", {
      name,
      ...(typeof name === "string" ? { exact: true } : {}),
    })
    .first()
    .click();
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
async function assertRenderedContrast(page, label) {
  const failures = await page.evaluate(() => {
    const parse = (value) => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const parts = match[1]
        .split(",")
        .map((part) => Number.parseFloat(part.trim()));
      return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
    };
    const luminance = ({ r, g, b }) => {
      const channel = (value) => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const contrast = (foreground, background) => {
      const [high, low] = [luminance(foreground), luminance(background)].sort(
        (a, b) => b - a,
      );
      return (high + 0.05) / (low + 0.05);
    };
    const failures = [];
    for (const element of document.querySelectorAll("body *")) {
      if (element.closest("[disabled]")) continue;
      if (element.closest('[aria-hidden="true"]')) continue;
      if (!element.getClientRects().length) continue;
      const rect = element.getBoundingClientRect();
      if (rect.bottom < 0 || rect.right < 0) continue;
      const style = getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none") continue;
      if (Number.parseFloat(style.opacity) < 1) continue;
      const hasText = [...element.childNodes].some(
        (node) =>
          node.nodeType === Node.TEXT_NODE &&
          node.textContent.trim().length > 0,
      );
      if (!hasText) continue;
      const isSvgText =
        element.namespaceURI === "http://www.w3.org/2000/svg" &&
        element.tagName.toLowerCase() === "text";
      const foreground = parse(isSvgText ? style.fill : style.color);
      let node = element.parentElement;
      let background = parse(style.backgroundColor);
      if (!background || background.a < 1) {
        while (node && node !== document.documentElement) {
          const candidate = parse(getComputedStyle(node).backgroundColor);
          if (candidate && candidate.a === 1) {
            background = candidate;
            break;
          }
          node = node.parentElement;
        }
      }
      if (!foreground || !background) continue;
      const fontSize = Number.parseFloat(style.fontSize);
      const weight = Number(style.fontWeight) || 400;
      const large = fontSize >= 24 || (fontSize >= 18.66 && weight >= 700);
      const required = large ? 3 : 4.5;
      const ratio = contrast(foreground, background);
      if (ratio + 0.005 < required)
        failures.push({
          text: element.textContent.trim().slice(0, 60),
          selector: `${element.tagName.toLowerCase()}.${element.className}`,
          html: element.outerHTML.slice(0, 200),
          ratio: Number(ratio.toFixed(2)),
          required,
          color: style.color,
          fill: style.fill,
          background: `rgb(${background.r}, ${background.g}, ${background.b})`,
        });
    }
    return failures;
  });
  assert.deepEqual(
    failures,
    [],
    `${label}: rendered text must meet AA contrast`,
  );
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
    "4320",
    "--ui-origin",
    uiOrigin,
    ...(mode === "dev" ? ["--dev"] : []),
  ]);
  await waitReady(`${apiOrigin}/api/projects`);
  if (mode === "dev")
    start("pnpm", ["--filter", "visualizer", "dev", "--port", "5183"], {
      env: { ...process.env, VISUALIZER_API_PORT: "4320" },
    });
  await waitReady(uiOrigin);

  const list = ProjectsResponseSchema.parse(
    await (await fetch(`${uiOrigin}/api/projects`)).json(),
  );
  const projectSummary = list.projects.find(
    (project) => project.name === "project",
  );
  assert.ok(projectSummary, "fixture project is discovered");
  const snapshot = ProjectSnapshotSchema.parse(
    await (
      await fetch(`${apiOrigin}/api/projects/${projectSummary.id}`)
    ).json(),
  );
  const [latency, throughput] = snapshot.segments;
  assert.equal(latency.runIds.length, 8);

  browser = await chromium.launch({
    headless: true,
    ...(process.env.VISUALIZER_CHROME_PATH
      ? { executablePath: process.env.VISUALIZER_CHROME_PATH }
      : { channel: "chrome" }),
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  page.setDefaultTimeout(10_000);
  const errors = [];
  let expectingFailure = false;
  let expectingDisconnect = false;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (!["error", "warning"].includes(message.type())) return;
    if (expectingFailure && message.text().includes("Failed to load resource"))
      return;
    if (
      expectingDisconnect &&
      (message.text().includes("/api/events") ||
        message.text().includes("ERR_INCOMPLETE_CHUNKED_ENCODING"))
    )
      return;
    errors.push(`${message.text()} (${message.location().url})`);
  });
  await page.goto(uiOrigin);
  const projectSelector = page.getByRole("combobox", { name: /^Project/ });
  await projectSelector.waitFor();

  // ---- Wide layout and keyboard-only journey ----
  assert.equal(
    await page.getByRole("complementary", { name: "Session rail" }).count(),
    1,
  );
  assert.equal(await page.locator(".compact-bar").count(), 0);
  const skipLink = page.getByRole("link", { name: "Skip to result review" });
  await page.keyboard.press("Tab");
  await assertKeyboardFocus(skipLink, "skip link");
  assert.equal(await skipLink.isVisible(), true);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.activeElement?.id === "review");

  await tabUntil(page, projectSelector, "project selector");
  await assertKeyboardFocus(projectSelector, "project selector");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("project");
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Latency", exact: true }).waitFor();
  assert.equal(
    await projectSelector.evaluate(
      (element) => element === document.activeElement,
    ),
    true,
    "selection returns focus to the project selector",
  );
  const attemptList = page.getByTestId("attempt-list");

  // Discovery states remain available from the selector.
  await projectSelector.click();
  const listbox = page.getByRole("listbox", { name: "Projects" });
  assert.equal(
    await listbox.getByText("Uninitialized session", { exact: true }).count(),
    1,
  );
  assert.equal(
    await listbox.getByText("0 experiments", { exact: true }).count(),
    2,
  );
  await page.keyboard.press("Escape");
  await page.getByRole("region", { name: "Metric trajectory" }).waitFor();
  await assertRenderedContrast(page, "wide state");

  // Win selection, outside-filter retention, and a scoped-commit run.
  const winThree = attemptList.getByRole("button", {
    name: /^Select experiment 3 from the attempt list/,
  });
  await tabUntil(page, winThree, "win experiment 3");
  await assertKeyboardFocus(winThree, "win experiment 3");
  await page.keyboard.press("Enter");
  await page
    .getByRole("heading", { name: "Experiment 03", exact: true })
    .waitFor();
  await setThresholdMax(page);
  await page
    .getByText("Selected experiment remains open outside the current filter.")
    .waitFor();
  await setThreshold(page, "0%");
  await page
    .getByText("Selected experiment remains open outside the current filter.")
    .waitFor({ state: "detached" });
  const winFour = attemptList.getByRole("button", {
    name: /^Select experiment 4 from the attempt list.*New best/,
  });
  await tabUntil(page, winFour, "win experiment 4");
  await assertKeyboardFocus(winFour, "win experiment 4");
  await page.keyboard.press("Enter");
  await page
    .getByRole("heading", { name: "Experiment 04", exact: true })
    .waitFor();

  // Current notes via keyboard, then back to results with Shift+Tab.
  const ideasButton = page.getByRole("button", {
    name: "Current ideas",
    exact: true,
  });
  await tabUntil(page, ideasButton, "current ideas");
  await assertKeyboardFocus(ideasButton, "current ideas");
  await page.keyboard.press("Enter");
  await page.getByText("This session has no ideas.md available.").waitFor();
  assert.match(
    await page.locator(".document-card").innerText(),
    /Current ideas for project/i,
  );
  const resultsButton = page.getByRole("button", {
    name: "Review results",
    exact: true,
  });
  await page.keyboard.press("Shift+Tab");
  await assertKeyboardFocus(resultsButton, "review results");
  await page.keyboard.press("Enter");

  // Segment selection by native type-ahead, with the chart following it.
  const segmentSelect = page.getByRole("combobox", {
    name: "Metric segment",
  });
  await tabUntil(page, segmentSelect, "segment select");
  await assertKeyboardFocus(segmentSelect, "segment select");
  await page.waitForTimeout(1300);
  await page.keyboard.press("T");
  await page
    .getByRole("heading", { name: "Throughput", exact: true })
    .waitFor();
  assert.equal(await segmentSelect.inputValue(), throughput.id);
  await page.waitForTimeout(1300);
  await page.keyboard.press("L");
  await page.getByRole("heading", { name: "Latency", exact: true }).waitFor();
  assert.equal(await segmentSelect.inputValue(), latency.id);

  // Chart focus and arrow tooltip without a pointer.
  const chart = page.getByRole("region", { name: "Metric trajectory" });
  const marker = chart.locator("g.attempt-marker[data-run-id]").first();
  await tabUntil(page, marker, "first chart marker");
  assert.equal(
    await marker.evaluate((element) => element.matches(":focus-visible")),
    true,
  );
  assert.equal(
    await marker
      .locator(".marker-ring")
      .evaluate((element) => getComputedStyle(element).opacity),
    "1",
    "focused chart marker shows its ring",
  );
  await chart.locator("svg.recharts-surface").focus();
  await page.keyboard.press("ArrowRight");
  await chart.locator(".attempt-tooltip").waitFor();

  // Re-select run 4 from the attempt list, then sweep forward through the diff controls.
  const historyFour = attemptList
    .getByRole("button", {
      name: /^Select experiment 4 from the attempt list.*New best/,
    })
    .first();
  await tabUntil(page, historyFour, "history experiment 4");
  await page.keyboard.press("Space");
  await page
    .getByRole("heading", { name: "Experiment 04", exact: true })
    .waitFor();

  // Diff comparison, artifacts, and split presentation for run 4.
  const diff = page.getByRole("region", { name: "Historical diff" });
  const comparison = page.getByRole("combobox", { name: "Diff comparison" });
  await segmentSelect.focus();
  await tabUntil(page, comparison, "diff comparison select");
  await assertKeyboardFocus(comparison, "diff comparison select");
  await page.waitForTimeout(1300);
  await page.keyboard.press("f");
  await page.getByRole("heading", { name: "Baseline diff" }).waitFor();
  assert.equal(await comparison.inputValue(), "baseline");
  assert.match(await diff.innerText(), /first kept commit/);
  await page.keyboard.press("f");
  await page.getByRole("heading", { name: "Parent diff" }).waitFor();
  assert.equal(await comparison.inputValue(), "parent");
  const artifact = page.getByRole("checkbox", {
    name: /Include .auto session artifacts/,
  });
  await tabUntil(page, artifact, "artifact checkbox");
  await page.keyboard.press("Space");
  assert.equal(await artifact.isChecked(), true);
  await page.keyboard.press("Space");
  assert.equal(await artifact.isChecked(), false);
  const presentation = page.getByRole("combobox", {
    name: "Diff presentation",
  });
  await tabUntil(page, presentation, "diff presentation select");
  await assertKeyboardFocus(presentation, "diff presentation select");
  await page.keyboard.press("s");
  await page.getByRole("heading", { name: "Parent diff" }).waitFor();
  assert.equal(await presentation.inputValue(), "split");
  await diff.locator(".split-diff").waitFor();
  assert.match(await diff.innerText(), /code\.ts/);

  // Attempt selection is the textual chart equivalent.
  const historyThree = attemptList.getByRole("button", {
    name: /^Select experiment 3 from the attempt list/,
  });
  await tabUntil(page, historyThree, "attempt list experiment 3");
  await assertKeyboardFocus(historyThree, "attempt list experiment 3");
  await page.keyboard.press("Space");
  await page
    .getByRole("heading", { name: "Experiment 03", exact: true })
    .waitFor();

  // Stale state keeps data and selection, then recovers.
  const refresh = page.getByRole("button", {
    name: "Refresh projects",
    exact: true,
  });
  await chmod(logPath, 0o000);
  await refresh.focus();
  await page.keyboard.press("Enter");
  await page
    .getByText(/Stale data: showing the last successfully read project data/)
    .waitFor();
  await assertRenderedContrast(page, "stale state");
  assert.equal(
    await page
      .getByRole("heading", { name: "Experiment 03", exact: true })
      .count(),
    1,
  );
  await chmod(logPath, logMode);
  await refresh.focus();
  await page.keyboard.press("Enter");
  await page.getByText(/Stale data: showing/).waitFor({ state: "detached" });

  // No-project discovery remains distinct and explains the empty result.
  await page.route(
    (url) => url.pathname === "/api/projects",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          indexRevision: 999,
          watchEnabled: false,
          minWinImprovementPct: 0,
          roots: [],
          projects: [],
          diagnostics: [],
        }),
      }),
  );
  await page.reload();
  await page
    .getByText(
      "No projects found. Configure roots containing .auto sessions, then refresh projects.",
    )
    .waitFor();
  await page.unrouteAll({ behavior: "wait" });
  await page.reload();
  await projectSelector.waitFor();
  await page.locator(".project-meta-name").waitFor();

  // Read-only applications leave every fixture file, including Git data,
  // untouched before the controlled mutations below.
  assert.deepEqual(await hashFiles(fixture.directory), before);
  if (process.env.VISUALIZER_SCREENSHOT)
    await page.screenshot({
      path: `${process.env.VISUALIZER_SCREENSHOT}-wide.png`,
      fullPage: true,
    });

  // ---- Narrow layout, drawers, and states ----
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  assert.equal(await page.locator(".compact-bar").isVisible(), true);
  assert.equal(
    await page.getByRole("complementary", { name: "Session rail" }).count(),
    0,
  );
  assert.equal(
    await page
      .locator(".app-shell")
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns),
    "390px",
  );
  assert.equal(
    await page.getByText("Live updates connected", { exact: true }).count(),
    1,
  );
  const sessionTrigger = page.getByRole("button", { name: /^Session/ });
  const sessionDialog = page.getByRole("dialog", { name: "Session" });
  async function openSessionDrawer() {
    await sessionTrigger.focus();
    await page.keyboard.press("Enter");
    await sessionDialog.waitFor();
  }
  async function chooseProject(pattern) {
    await openSessionDrawer();
    await sessionDialog.getByRole("combobox", { name: /^Project/ }).click();
    await sessionDialog.getByRole("option", { name: pattern }).first().click();
    await sessionDialog.waitFor({ state: "detached" });
  }

  await page.keyboard.press("Tab");
  await sessionTrigger.focus();
  await assertKeyboardFocus(sessionTrigger, "compact session trigger");
  await page.keyboard.press("Enter");
  await sessionDialog.waitFor();
  const closeSession = page.getByRole("button", { name: "Close session" });
  await assertKeyboardFocus(closeSession, "session drawer close");
  await assertRenderedContrast(page, "narrow drawer state");
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() =>
        Boolean(document.activeElement?.closest('[role="dialog"]')),
      ),
      true,
      "Tab stays inside the session drawer",
    );
  }
  await page.keyboard.press("Shift+Tab");
  assert.equal(
    await page.evaluate(() =>
      Boolean(document.activeElement?.closest('[role="dialog"]')),
    ),
    true,
    "Shift+Tab wraps inside the session drawer",
  );
  const drawerSelector = sessionDialog.getByRole("combobox", {
    name: /^Project/,
  });
  await tabUntil(page, drawerSelector, "drawer project selector");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("project");
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Latency", exact: true }).waitFor();
  assert.equal(await sessionDialog.count(), 0);
  assert.equal(
    await sessionTrigger.evaluate(
      (element) => element === document.activeElement,
    ),
    true,
    "closing the drawer restores the session trigger",
  );

  // Attempt selection and Escape restoration inside the drawer.
  await openSessionDrawer();
  await assertKeyboardFocus(closeSession, "session drawer close again");
  await page.keyboard.press("Escape");
  assert.equal(await sessionDialog.count(), 0);
  assert.equal(
    await sessionTrigger.evaluate(
      (element) => element === document.activeElement,
    ),
    true,
    "Escape restores the session trigger",
  );
  await openSessionDrawer();
  const drawerWinFour = sessionDialog.getByRole("button", {
    name: /^Select experiment 4 from the attempt list.*New best/,
  });
  await tabUntil(page, drawerWinFour, "drawer win 4");
  await page.keyboard.press("Enter");
  await page
    .getByRole("heading", { name: "Experiment 04", exact: true })
    .waitFor();
  assert.equal(await sessionDialog.count(), 0);
  assert.equal(
    await sessionTrigger.evaluate(
      (element) => element === document.activeElement,
    ),
    true,
    "attempt selection restores the session trigger",
  );

  // Held diff keeps the loading state while navigation stays usable.
  const gate = new Promise((resolve) => {
    releaseDiff = resolve;
  });
  await page.route(
    (url) => url.pathname.endsWith("/diff"),
    async (route) => {
      await gate;
      await route.continue().catch(() => {});
    },
  );
  await openSessionDrawer();
  const historyEight = sessionDialog.getByRole("button", {
    name: /^Select experiment 8 from the attempt list/,
  });
  await historyEight.focus();
  await page.keyboard.press("Space");
  await page.getByText("Loading the recorded commit comparison…").waitFor();
  await openSessionDrawer();
  assert.equal(
    await sessionDialog
      .getByRole("button", {
        name: /^Select experiment 4 from the attempt list.*New best/,
      })
      .count(),
    1,
  );
  await page.keyboard.press("Escape");
  releaseDiff();
  releaseDiff = undefined;
  await page
    .getByText("Loading the recorded commit comparison…")
    .waitFor({ state: "detached" });
  await page.unrouteAll({ behavior: "wait" });

  // Failed diff requests stay readable and keep the metric visible.
  expectingFailure = true;
  await page.route(
    (url) => url.pathname.endsWith("/diff"),
    (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "SIMULATED", message: "Simulated diff failure." },
        }),
      }),
  );
  await openSessionDrawer();
  const historyNine = sessionDialog.getByRole("button", {
    name: /^Select experiment 9 from the attempt list/,
  });
  await historyNine.focus();
  await page.keyboard.press("Space");
  await page
    .getByRole("alert")
    .filter({ hasText: "Simulated diff failure." })
    .waitFor();
  assert.equal(
    (await page.getByTestId("selected-metric").innerText()).replace(/\s/g, ""),
    "0ms",
  );
  await page.unrouteAll({ behavior: "wait" });
  expectingFailure = false;

  // Empty, malformed, uninitialized, and no-valid-history states.
  await chooseProject(/^empty-log · empty-log ·/);
  await page.getByText("No experiments available").waitFor();
  await openSessionDrawer();
  await sessionDialog.getByText("This log is empty.").waitFor();
  await assertRenderedContrast(page, "empty state");
  await page.keyboard.press("Escape");
  await chooseProject(/^malformed · malformed ·/);
  await page.getByText("No experiments available").waitFor();
  assert.match(
    await page.locator(".diagnostic").first().innerText(),
    /Line 2: Invalid JSON record\./,
  );
  await openSessionDrawer();
  await sessionDialog
    .getByText("No valid experiments in this session.")
    .waitFor();
  await page.keyboard.press("Escape");
  await chooseProject(/^uninitialized · uninitialized ·/);
  await page
    .getByText(/Uninitialized session\. No log\.jsonl has been recorded/)
    .waitFor();
  await openSessionDrawer();
  await sessionDialog
    .getByText("This session has not produced a log yet.")
    .waitFor();
  await page.keyboard.press("Escape");

  // Missing current notes and unavailable Git preserve result details.
  await chooseProject(/^project · project ·/);
  await openSessionDrawer();
  await tabUntil(
    page,
    sessionDialog.getByRole("button", {
      name: /^Select experiment 4 from the attempt list.*New best/,
    }),
    "drawer win 4 again",
  );
  await page.keyboard.press("Enter");
  await page
    .getByRole("heading", { name: "Experiment 04", exact: true })
    .waitFor();
  const ideasButtonNarrow = page.getByRole("button", {
    name: "Current ideas",
    exact: true,
  });
  await ideasButtonNarrow.focus();
  await page.keyboard.press("Enter");
  await page.getByText("This session has no ideas.md available.").waitFor();
  await page
    .getByRole("button", { name: "Review results", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await openSessionDrawer();
  const duplicateFour = sessionDialog.getByRole("button", {
    name: /Select experiment 4 from the attempt list: attempt 5/,
  });
  await duplicateFour.focus();
  await page.keyboard.press("Space");
  await page
    .getByText("This experiment did not record a commit reference.")
    .waitFor();
  assert.equal(
    (await page.getByTestId("selected-metric").innerText()).replace(/\s/g, ""),
    "12ms",
  );
  assert.match(
    (await page.locator(".diff-state").innerText()).toLowerCase(),
    /missing/,
  );

  // No-filtered-win keeps the baseline and outside-filter selection.
  await openSessionDrawer();
  await tabUntil(
    page,
    sessionDialog.getByRole("button", {
      name: /^Select experiment 3 from the attempt list/,
    }),
    "drawer win 3",
  );
  await page.keyboard.press("Enter");
  await page
    .getByRole("heading", { name: "Experiment 03", exact: true })
    .waitFor();
  await openSessionDrawer();
  await setThresholdMax(page);
  await sessionDialog.getByText("No wins meet this threshold.").waitFor();
  assert.equal(
    await sessionDialog
      .getByRole("button", {
        name: /^Select experiment 9 from the attempt list/,
      })
      .count(),
    1,
    "failed attempts survive a strict threshold",
  );
  await sessionDialog
    .getByRole("button", { name: /First kept baseline/ })
    .waitFor();
  await page
    .getByText("Selected experiment remains open outside the current filter.")
    .waitFor();
  await setThreshold(page, "0%");
  await page.keyboard.press("Escape");

  // Live append updates navigation without stealing the selected result.
  await openSessionDrawer();
  await appendFile(
    logPath,
    `${JSON.stringify({
      type: "config",
      name: "Live segment",
      metricName: "ops",
      metricUnit: "ops/s",
      bestDirection: "higher",
    })}\n${JSON.stringify({
      run: 52,
      metric: 42,
      status: "keep",
      description: "Live appended result",
    })}\n`,
  );
  await sessionDialog.getByText("19 experiments").waitFor({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await page
    .getByRole("heading", { name: "Experiment 03", exact: true })
    .waitFor();
  assert.equal(
    await page.getByText("Live updates connected", { exact: true }).count(),
    1,
  );
  const liveSegmentSelect = page.getByRole("combobox", {
    name: "Metric segment",
  });
  assert.equal(
    await liveSegmentSelect
      .locator("option", { hasText: "Live segment · ops" })
      .count(),
    1,
  );

  // Compact navigation stays reachable while the review pane scrolls.
  await page.locator(".review-pane").evaluate((element) => {
    element.scrollTop = 1500;
  });
  await page.waitForTimeout(150);
  assert.equal(
    await page
      .locator(".compact-bar")
      .evaluate((element) => element.getBoundingClientRect().top),
    0,
  );
  assert.equal(await page.locator(".compact-bar").isVisible(), true);
  if (process.env.VISUALIZER_SCREENSHOT)
    await page.screenshot({
      path: process.env.VISUALIZER_SCREENSHOT,
      fullPage: true,
    });

  // Wide and narrow layouts swap without losing the selected result.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(200);
  assert.equal(
    await page.getByRole("complementary", { name: "Session rail" }).count(),
    1,
  );
  assert.equal(await page.locator(".compact-bar").count(), 0);
  await page
    .getByRole("heading", { name: "Experiment 03", exact: true })
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);

  // A disconnected stream retains readable data and reports the state.
  expectingDisconnect = true;
  await page.context().setOffline(true);
  await stop(children[0].child);
  await page
    .getByText("Live updates disconnected", { exact: true })
    .waitFor({ timeout: 20_000 });
  await page
    .getByRole("heading", { name: "Experiment 03", exact: true })
    .waitFor();
  assert.match(await page.getByTestId("selected-metric").innerText(), /8/);

  const after = await hashFiles(fixture.directory);
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((keyPath) => before[keyPath] !== after[keyPath])
    .sort();
  assert.deepEqual(changed, ["repo/project/.auto/log.jsonl"]);
  assert.deepEqual(errors, []);
  console.log(
    `S11 ${mode} smoke passed: keyboard-only wide review; drawer/focus restoration and trap; empty/malformed/uninitialized/no-filtered-win/missing-note/unavailable-Git/stale/loading/error/disconnected states; outside-filter retention; live append without selection loss; read-only source/Git files; zero browser errors or warnings.`,
  );
} finally {
  releaseDiff?.();
  await browser?.close();
  await chmod(logPath, logMode).catch(() => {});
  for (const { child } of children.reverse()) {
    await stop(child);
  }
  await rm(fixture.directory, { recursive: true, force: true });
}
