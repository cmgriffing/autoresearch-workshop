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
import { createDocumentFixture } from "./visualizer-document-fixture.mjs";
import { fingerprintDiscoveryFixture } from "./visualizer-discovery-fixture.mjs";

const mode = process.argv[2] ?? "dev";
assert.ok(["dev", "built"].includes(mode), "Use dev or built.");
const repo = fileURLToPath(new URL("../", import.meta.url));
const fixture = await createDocumentFixture();
const apiOrigin = "http://127.0.0.1:4315";
const uiOrigin = mode === "dev" ? "http://127.0.0.1:5178" : apiOrigin;
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
      "4315",
      "--ui-origin",
      uiOrigin,
      ...(mode === "dev" ? ["--dev"] : []),
    ],
    { cwd: fixture.directory },
  );
  await waitReady(`${apiOrigin}/api/projects`);
  if (mode === "dev")
    start("pnpm", ["--filter", "visualizer", "dev", "--port", "5178"], {
      env: { ...process.env, VISUALIZER_API_PORT: "4315" },
    });
  await waitReady(uiOrigin);
  const list = ProjectsResponseSchema.parse(
    await (await fetch(`${uiOrigin}/api/projects`)).json(),
  );
  assert.equal(list.projects.length, 3);
  const alpha = list.projects.find(
    (project) => project.rootPath === fixture.alpha,
  );
  const beta = list.projects.find(
    (project) => project.rootPath === fixture.beta,
  );
  assert.deepEqual(alpha.documentStates, { ideas: "ready", prompt: "ready" });
  assert.deepEqual(beta.documentStates, { ideas: "missing", prompt: "error" });
  const snapshot = async () =>
    ProjectSnapshotSchema.parse(
      await (await fetch(`${uiOrigin}/api/projects/${alpha.id}`)).json(),
    );
  const initial = await snapshot();
  assert.equal(initial.documents.ideas.content, fixture.ideas);
  assert.equal(initial.runs.length, 2);
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
    .getByRole("heading", { name: "Alpha session", exact: true })
    .waitFor();
  const baseline = page.getByTestId("attempt-list").getByRole("button", {
    name: /^Select experiment 1 from the attempt list/,
  });
  await baseline.click();
  await page
    .getByRole("heading", { name: "Experiment 01", exact: true })
    .waitFor();
  const ideasButton = page.getByRole("button", {
    name: "Current ideas",
    exact: true,
  });
  const promptButton = page.getByRole("button", {
    name: "Current prompt",
    exact: true,
  });
  const reviewButton = page.getByRole("button", {
    name: "Review results",
    exact: true,
  });
  const notes = page.getByRole("region", {
    name: "Current project notes",
    exact: true,
  });
  await ideasButton.focus();
  await page.keyboard.press("Enter");
  await notes
    .getByRole("heading", { name: "Alpha ideas now", exact: true })
    .waitFor();
  assert.equal(
    await ideasButton.evaluate(
      (button) => getComputedStyle(button).outlineStyle,
    ),
    "solid",
  );
  await notes.getByText(/Current ideas for shared/).waitFor();
  await notes.getByText(/files on disk at the latest refresh/).waitFor();
  assert.equal(await notes.locator("strong").textContent(), "vectorization");
  assert.equal(await notes.getByRole("listitem").count(), 2);
  assert.equal(
    (await notes.locator("blockquote").textContent()).trim(),
    "Repeat the measurement.",
  );
  assert.equal(
    await notes.locator("pre code").textContent(),
    "<b>Code sample only</b>\n",
  );
  assert.equal(
    await notes
      .getByRole("link", { name: "Safe reference", exact: true })
      .getAttribute("href"),
    "https://example.invalid/reference",
  );
  assert.equal(await notes.locator("script, img, iframe").count(), 0);
  assert.ok(!(await page.evaluate(() => window.__notesExecuted)));
  assert.ok(
    !(
      await notes
        .getByRole("link", { name: "Unsafe reference", exact: true })
        .getAttribute("href")
    )?.startsWith("javascript:"),
  );
  await page.keyboard.press("Tab");
  assert.equal(
    await promptButton.evaluate((button) => document.activeElement === button),
    true,
  );
  await page.keyboard.press("Space");
  await notes
    .getByRole("heading", { name: "Alpha prompt context", exact: true })
    .waitFor();
  await ideasButton.click();

  async function refresh() {
    const response = page.waitForResponse(
      (value) => value.url() === `${uiOrigin}/api/projects/${alpha.id}`,
    );
    await page
      .getByRole("button", { name: "Refresh projects", exact: true })
      .click();
    const result = ProjectSnapshotSchema.parse(
      await (await response).json().catch(async () => {
        // A concurrent watcher invalidation can supersede and abort this
        // in-flight refetch; the UI retries it, so read the installed
        // snapshot directly instead of failing the check.
        return await (
          await fetch(`${uiOrigin}/api/projects/${alpha.id}`)
        ).json();
      }),
    );
    await page.waitForFunction(
      (revision) =>
        document
          .querySelector(".review-footer")
          ?.textContent?.includes(`Source revision ${revision.slice(2, 10)}`),
      result.project.revision,
    );
    return result;
  }
  await mutate(async () => {
    await writeFile(
      `${fixture.ideasPath}.new`,
      "# Replaced Alpha ideas\n\nA current **replacement**.",
    );
    await rename(`${fixture.ideasPath}.new`, fixture.ideasPath);
  });
  const changed = await refresh();
  await notes
    .getByRole("heading", { name: "Replaced Alpha ideas", exact: true })
    .waitFor();
  assert.notEqual(changed.project.revision, initial.project.revision);
  assert.equal(changed.logRevision, initial.logRevision);
  assert.deepEqual(changed.runs, initial.runs);
  assert.equal(await baseline.getAttribute("aria-pressed"), "true");
  assert.equal(await ideasButton.getAttribute("aria-pressed"), "true");
  assert.equal(
    (
      await fetch(
        `${uiOrigin}/api/projects/${alpha.id}/runs/${initial.runs[0].id}/diff?revision=${initial.project.revision}`,
      )
    ).status,
    409,
  );
  await reviewButton.click();
  await page
    .getByRole("heading", { name: "Experiment 01", exact: true })
    .waitFor();
  assert.equal(await page.getByTestId("selected-metric").textContent(), "20ms");
  await ideasButton.click();
  if (process.env.VISUALIZER_SCREENSHOT)
    await page.screenshot({
      path: process.env.VISUALIZER_SCREENSHOT,
      fullPage: true,
    });

  for (const state of ["missing", "ready", "limited", "error"]) {
    await mutate(async () => {
      await rm(fixture.ideasPath, { recursive: true, force: true });
      if (state === "ready") await writeFile(fixture.ideasPath, " \n");
      if (state === "limited")
        await writeFile(fixture.ideasPath, "é".repeat(257));
      if (state === "error") {
        await mkdir(fixture.ideasPath);
      }
    });
    const result = await refresh();
    assert.equal(result.documents.ideas.state, state);
    assert.deepEqual(result.runs, initial.runs);
    assert.equal(result.project.stale, false);
    assert.equal(result.documents.prompt.state, "ready");
    await notes
      .getByText(
        state === "ready"
          ? "This current document is empty."
          : result.documents.ideas.message,
        { exact: true },
      )
      .waitFor();
    assert.equal(await baseline.getAttribute("aria-pressed"), "true");
    assert.equal((await refresh()).project.revision, result.project.revision);
  }
  await mutate(async () => {
    await rm(fixture.ideasPath, { recursive: true });
    await writeFile(fixture.ideasPath, "# Recovered ideas");
    await rm(join(fixture.alpha, ".auto/log.jsonl"));
  });
  const stale = await refresh();
  assert.equal(stale.project.stale, true);
  assert.equal(stale.documents.ideas.state, "ready");
  assert.deepEqual(stale.runs, initial.runs);
  await notes
    .getByRole("heading", { name: "Recovered ideas", exact: true })
    .waitFor();
  await page
    .getByText(/Stale data: showing the last successfully read project data/)
    .waitFor();
  await selectProject(page, `shared · . · ${fixture.beta}`);
  await notes
    .getByText("This session has no ideas.md available.", { exact: true })
    .waitFor();
  assert.equal(
    await notes.getByRole("heading", { name: "Recovered ideas" }).count(),
    0,
  );
  await promptButton.click();
  await notes
    .getByText("Cannot read this session's prompt.md as a regular file.", {
      exact: true,
    })
    .waitFor();
  await reviewButton.click();
  assert.equal(
    await page.getByTestId("attempt-list").locator(".attempt-entry").count(),
    2,
  );
  await selectProject(page, `uninitialized · . · ${fixture.uninitialized}`);
  await page.getByText(/Uninitialized session\. No log/).waitFor();
  await ideasButton.click();
  await notes
    .getByRole("heading", { name: "Before the first experiment", exact: true })
    .waitFor();
  assert.deepEqual(errors, []);
  await assertReadOnly();
  console.log(
    `S06 ${mode} document smoke passed: typed current ideas/prompt; Markdown and escaped code; raw HTML and unsafe URLs disabled; keyboard views; historical selection retained; note-only 409; atomic replacement; missing/empty/limited/unreadable/recovered notes; stale log with fresh notes; correct project scoping; uninitialized notes; unchanged files/index/refs; zero browser errors.`,
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
