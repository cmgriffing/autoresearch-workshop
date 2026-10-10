import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  DiffResponseSchema,
  ProjectSnapshotSchema,
  ProjectsResponseSchema,
} from "../packages/visualizar-common/dist/index.js";
import { createDiffFixture } from "./visualizer-diff-fixture.mjs";
import { hashFiles } from "./visualizer-fixture.mjs";

const mode = process.argv[2] ?? "dev";
assert.ok(["dev", "built"].includes(mode), "Use dev or built.");
const workspace = fileURLToPath(new URL("../", import.meta.url));
const fixture = await createDiffFixture();
const headBefore = await readFile(join(fixture.repo, ".git", "HEAD"), "utf8");
const filesBefore = await hashFiles(fixture.repo);
const apiOrigin = "http://127.0.0.1:4312";
const uiOrigin = mode === "dev" ? "http://127.0.0.1:5175" : apiOrigin;
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
    "4312",
    "--ui-origin",
    uiOrigin,
    ...(mode === "dev" ? ["--dev"] : []),
  ]);
  await waitReady(`${apiOrigin}/api/projects`);
  if (mode === "dev")
    start("pnpm", ["--filter", "visualizer", "dev", "--port", "5175"], {
      env: { ...process.env, VISUALIZER_API_PORT: "4312" },
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
  const apiDiff = DiffResponseSchema.parse(
    await (
      await fetch(
        `${uiOrigin}/api/projects/${snapshot.project.id}/runs/${snapshot.runs[1].id}/diff?revision=${snapshot.project.revision}`,
      )
    ).json(),
  );
  assert.equal(apiDiff.state, "available");
  if (apiDiff.state === "available") {
    assert.match(apiDiff.patch, /project\/code\.ts/);
    assert.doesNotMatch(apiDiff.patch, /sibling\/outside\.ts/);
  }

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
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/projects/*/runs/*/diff?**", async (route) => {
    if (route.request().url().includes(snapshot.runs[1].id))
      await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue();
  });
  await page.goto(uiOrigin);
  await page
    .getByRole("button", {
      name: /^Select experiment 2 from the attempt list/,
    })
    .click();
  await page
    .getByRole("button", {
      name: /^Select experiment 1 from the attempt list/,
    })
    .click();
  const diffRegion = page.getByRole("region", { name: "Historical diff" });
  await diffRegion.getByText(/Empty tree/).waitFor();
  assert.doesNotMatch(await diffRegion.innerText(), /project\/code\.ts/);

  await page
    .getByRole("button", {
      name: /^Select experiment 2 from the attempt list/,
    })
    .click();
  const patch = page.getByRole("code");
  await patch.waitFor();
  assert.match(await patch.innerText(), /project\/code\.ts/);
  assert.doesNotMatch(await patch.innerText(), /sibling\/outside\.ts/);

  await page
    .getByRole("button", {
      name: /^Select experiment 3 from the attempt list/,
    })
    .click();
  await diffRegion.getByText(/No project files changed/).waitFor();
  assert.equal(await page.getByTestId("selected-metric").innerText(), "8ms");

  await page
    .getByRole("button", {
      name: /^Select experiment 4 from the attempt list/,
    })
    .click();
  await diffRegion.getByText(/not available/).waitFor();
  assert.equal(await page.getByTestId("selected-metric").innerText(), "7ms");
  assert.deepEqual(errors, []);
  assert.equal(
    await readFile(join(fixture.repo, ".git", "HEAD"), "utf8"),
    headBefore,
  );
  assert.deepEqual(await hashFiles(fixture.repo), filesBefore);
  console.log(
    `S02 ${mode} smoke passed: scoped/root/empty/missing diffs; stale selection protection; metrics retained; unchanged source repository; zero browser errors.`,
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
