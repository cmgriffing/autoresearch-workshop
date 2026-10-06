import { spawnSync } from 'node:child_process';

function run(label, args) {
  console.log(`\n[verify] ${label}`);
  const result = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    cwd: process.cwd(),
  });
  if (result.status !== 0) {
    console.error(`[verify] ${label} failed (exit ${result.status ?? result.signal})`);
    process.exit(1);
  }
}

run('tests', ['--test', 'test/']);
run('benchmark', ['bench/bench.js']);

console.log('\n[verify] all checks passed');
