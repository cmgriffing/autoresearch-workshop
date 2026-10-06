/**
 * Benchmark harness for the checksum demo project.
 *
 * Contract with pi-autoresearch: stdout carries only `METRIC name=value`
 * lines. Human-readable diagnostics go to stderr.
 *
 * Guards against benchmark gaming:
 *   G1  smoke goldens — a wrong-but-fast implementation exits 1 (crash)
 *       before any timing happens
 *   G2  one warmup call — JIT is warm before timing
 *   G3  one timed call per distinct buffer — cross-call caching cannot help
 *   G4  every result must be a uint32 — catches stateful/aliased returns
 *   G5  generation is untimed and pre-touches pages
 *
 * V8 footgun, do not "simplify": every call before the timed loop must pass a
 * plain Uint8Array. Calling checksum with number[] or Buffer first makes the
 * following 16 MiB Uint8Array calls ~1.4x slower (element-kind polymorphism),
 * which silently poisons the baseline. Tests cover number[]/Buffer instead.
 *
 * Env:
 *   BENCH_MB    workload size in MiB (default 16)
 *   BENCH_RUNS  number of timed runs / distinct buffers (default 5)
 */
import { checksum } from "./src/index.js";

const MIB = 1024 * 1024;

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    console.error(`bench: ${name} must be a positive integer, got "${raw}"`);
    process.exit(2);
  }
  return value;
}

const mb = envInt("BENCH_MB", 16);
const runs = envInt("BENCH_RUNS", 5);
const bytes = mb * MIB;

// G1: smoke goldens. These mirror the test suite's contract; if they fail the
// implementation is wrong, so crash instead of reporting a bogus fast time.
// Uint8Array-only on purpose — see the V8 footgun note above.
const SMOKE_CHECKS = [
  { input: new Uint8Array([1, 2, 3, 4]), expected: 0x01020304 },
  { input: new Uint8Array([1, 0, 0, 0, 255]), expected: 0x00000000 }, // lane 0: 1 + 255 = 256 ≡ 0 (mod 256)
  { input: new TextEncoder().encode("123456789"), expected: 0x9f686a6c },
];
for (const { input, expected } of SMOKE_CHECKS) {
  const actual = checksum(input);
  if (actual !== expected) {
    console.error(
      `bench: smoke check failed — checksum([${input.join(",")}]) = ${actual}, expected ${expected}`,
    );
    process.exit(1);
  }
}

/** 64 KiB of deterministic xorshift bytes, tiled to fill a buffer. */
function fillBuffer(size, seed) {
  const tile = new Uint8Array(64 * 1024);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < tile.length; i++) {
    s = (s ^ (s << 13)) >>> 0;
    s = (s ^ (s >>> 17)) >>> 0;
    s = (s ^ (s << 5)) >>> 0;
    tile[i] = s & 0xff;
  }
  const buffer = new Uint8Array(size);
  for (let offset = 0; offset < size; offset += tile.length) {
    buffer.set(tile.subarray(0, Math.min(tile.length, size - offset)), offset);
  }
  return buffer;
}

// G5: build all inputs up front, outside the timed region. Distinct seeds make
// every buffer's contents unique, which is what closes the caching loophole.
const buffers = Array.from({ length: runs }, (_, i) =>
  fillBuffer(bytes, 0x9e3779b9 + i),
);

// G2: one warmup call so the timed runs measure steady-state code.
checksum(buffers[0]);

// G3: one timed call per distinct buffer.
const times = [];
for (const buffer of buffers) {
  const start = process.hrtime.bigint();
  const result = checksum(buffer);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

  // G4: a checksum must be a uint32 for every input.
  if (!Number.isInteger(result) || result < 0 || result > 0xffffffff) {
    console.error(`bench: checksum returned a non-uint32 value: ${result}`);
    process.exit(1);
  }
  times.push(elapsedMs);
}

times.sort((a, b) => a - b);
const middle = times.length >> 1;
const median =
  times.length % 2 ? times[middle] : (times[middle - 1] + times[middle]) / 2;
// Relative median absolute deviation: robust to a single scheduling outlier.
const deviations = times
  .map((t) => Math.abs(t - median))
  .sort((a, b) => a - b);
const mad =
  deviations.length % 2
    ? deviations[middle]
    : (deviations[middle - 1] + deviations[middle]) / 2;
const spreadPct = (mad / median) * 100;
const mbPerSecond = mb / (median / 1000);

console.log(`METRIC checksum_ms=${median.toFixed(3)}`);
console.log(`METRIC mbps=${mbPerSecond.toFixed(1)}`);
console.log(`METRIC spread_pct=${spreadPct.toFixed(2)}`);
console.log(`METRIC bytes=${bytes}`);
console.log(`METRIC runs=${runs}`);
