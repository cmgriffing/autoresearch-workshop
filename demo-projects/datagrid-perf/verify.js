/**
 * datagrid-perf verification script.
 *
 * Runs the correctness suite, runs the benchmark, and reports observed values
 * only. Exits non-zero if either step fails.
 */
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function main() {
  console.log("=== correctness suite ===");
  const testRun = await run("pnpm", ["test"]);
  if (testRun.stdout) console.log(testRun.stdout);
  if (testRun.stderr) console.error(testRun.stderr);

  console.log("=== benchmark ===");
  const benchRun = await run("pnpm", ["bench"]);
  if (benchRun.stdout) console.log(benchRun.stdout);
  if (benchRun.stderr) console.error(benchRun.stderr);

  if (testRun.code !== 0 || benchRun.code !== 0) {
    console.error("verify failed");
    process.exit(1);
  }
}

main();
