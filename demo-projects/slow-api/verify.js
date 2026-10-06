import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
    child.on('error', reject);
  });
}

async function main() {
  const testResult = await run('node', ['--test', 'test/test.js']);
  const testPassed = testResult.code === 0;
  console.log(`tests: ${testPassed ? 'PASS' : 'FAIL'}`);

  const benchResult = await run('node', ['bench/bench.js']);
  const benchPassed = benchResult.code === 0;
  console.log(`benchmark: ${benchPassed ? 'PASS' : 'FAIL'}`);

  const metricLines = benchResult.stdout
    .split('\n')
    .filter((line) => line.startsWith('METRIC '));
  for (const line of metricLines) {
    console.log(line);
  }

  if (!testPassed) {
    console.error(testResult.stderr || testResult.stdout);
  }
  if (!benchPassed) {
    console.error(benchResult.stderr || benchResult.stdout);
  }

  process.exit(testPassed && benchPassed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
