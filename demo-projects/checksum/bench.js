/**
 * Benchmark harness for the checksum demo project.
 *
 * Contract with pi-autoresearch: stdout carries only `METRIC name=value`
 * lines. Human-readable diagnostics go to stderr.
 *
 * Guards against benchmark gaming:
 *   G1  smoke goldens — a wrong implementation exits 1 (crash) before any
 *       timing happens
 *   G2  one warmup call — JIT is warm before timing
 *   G3  one timed call per distinct buffer — cross-call caching cannot help
 *   G4  every result must be a uint32 — catches stateful/aliased returns
 *   G5  generation is untimed and pre-touches pages
 *   G6  every timed result is compared against an independently accumulated
 *       golden — a wrong-but-fast implementation that passes the smoke
 *       vectors (e.g. correct up to the suite's 1 MiB anchor, wrong above it)
 *       still crashes before any METRIC line is printed
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
  { input: new Uint8Array([1, 0, 0, 0, 255]), expected: 0x00000000 }, // lane 0: 1 + 255 = 256, and (256 << 24) truncates to 0
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

/**
 * G3 + G5 + G6: deterministic, aperiodic input generation.
 *
 * Tiling a repeated 64 KiB buffer via .set() is ~8x cheaper, but it makes
 * every timed buffer periodic, so a correct tile-detecting implementation
 * could shortcut the workload without reflecting real checksum speed. The
 * xorshift stream therefore runs across the whole buffer, and the expected
 * result is accumulated from the same bytes in the same untimed pass, so
 * G6's golden costs no extra run. Byte writes keep it endian-independent.
 */
function generateInput(size, seed) {
  const buffer = new Uint8Array(size);
  const lanes = [0, 0, 0, 0];
  let s = seed >>> 0 || 1;
  const quads = size - (size % 4);
  for (let i = 0; i < quads; i += 4) {
    s = (s ^ (s << 13)) >>> 0;
    s = (s ^ (s >>> 17)) >>> 0;
    s = (s ^ (s << 5)) >>> 0;
    const b0 = s & 0xff;
    const b1 = (s >>> 8) & 0xff;
    const b2 = (s >>> 16) & 0xff;
    const b3 = (s >>> 24) & 0xff;
    buffer[i] = b0;
    buffer[i + 1] = b1;
    buffer[i + 2] = b2;
    buffer[i + 3] = b3;
    lanes[0] = (lanes[0] + b0) >>> 0;
    lanes[1] = (lanes[1] + b1) >>> 0;
    lanes[2] = (lanes[2] + b2) >>> 0;
    lanes[3] = (lanes[3] + b3) >>> 0;
  }
  for (let i = quads; i < size; i++) {
    s = (s ^ (s << 13)) >>> 0;
    s = (s ^ (s >>> 17)) >>> 0;
    s = (s ^ (s << 5)) >>> 0;
    const b = s & 0xff;
    buffer[i] = b;
    lanes[i & 3] = (lanes[i & 3] + b) >>> 0;
  }
  const expected =
    (lanes[3] + (lanes[2] << 8) + (lanes[1] << 16) + (lanes[0] << 24)) >>> 0;
  return { buffer, expected };
}

// G5: build all inputs up front, outside the timed region. Distinct seeds make
// every buffer's contents unique, which closes the cross-call caching loophole.
const inputs = Array.from({ length: runs }, (_, i) =>
  generateInput(bytes, 0x9e3779b9 + i),
);

// G2: one warmup call so the timed runs measure steady-state code.
checksum(inputs[0].buffer);

// G3 + G4 + G6: one timed call per distinct buffer; every result must be a
// uint32 and must match the golden accumulated during generation.
const times = [];
for (const { buffer, expected } of inputs) {
  const start = process.hrtime.bigint();
  const result = checksum(buffer);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

  // G4: a checksum must be a uint32 for every input.
  if (!Number.isInteger(result) || result < 0 || result > 0xffffffff) {
    console.error(`bench: checksum returned a non-uint32 value: ${result}`);
    process.exit(1);
  }
  // G6: crash before any METRIC line if the fast path is also wrong.
  if (result !== expected) {
    console.error(
      `bench: result validation failed — checksum returned ${result}, expected ${expected}`,
    );
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
