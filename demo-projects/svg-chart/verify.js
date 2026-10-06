import { spawnSync } from 'node:child_process';
import process from 'node:process';

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: false,
  });
  return result.status ?? 1;
}

const testStatus = run('node', ['--test']);
if (testStatus !== 0) {
  process.exit(testStatus);
}

const benchStatus = run('node', ['bench/bench.js']);
process.exit(benchStatus);
