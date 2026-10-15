/** Process-tree helpers for servers started by the harness. */

import { spawn } from 'node:child_process';

/** Spawns a process in its own group so the whole tree can be signalled. */
export function spawnTree(command, args, options = {}) {
  return spawn(command, args, { ...options, detached: true });
}

/** SIGTERMs the process group, escalating to SIGKILL when it lingers. */
export function stopTree(child, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const signalGroup = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          // already gone
        }
      }
    };
    const force = setTimeout(() => {
      signalGroup('SIGKILL');
      resolve();
    }, timeoutMs);
    child.once('exit', () => {
      clearTimeout(force);
      resolve();
    });
    signalGroup('SIGTERM');
  });
}
