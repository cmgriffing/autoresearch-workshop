import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const steps = [
  ['node', ['--test', 'test/*.test.js']],
  ['node', ['bench/bench.js']],
];

for (const [cmd, args] of steps) {
  const result = spawnSync(cmd, args, {
    cwd: __dirname,
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
