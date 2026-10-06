# checksum

A deliberately naive 32-bit checksum, used as an optimization target for the
[autoresearch workshop](../../README.md). The implementation is a
straightforward `i % 4` + `switch` loop: correct, slow, and a clean canvas for
the experiment loop.

## Contract

```
lane_k = sum of bytes at indices k, k+4, k+8, …   (mod 2^32)
result = (lane3 + (lane2 << 8) + (lane1 << 16) + (lane0 << 24)) mod 2^32
```

`checksum(arr)` accepts a `Uint8Array`, `Buffer`, or `number[]` of byte values
and returns an unsigned 32-bit integer. `test/checksum.test.js` pins the
contract, including a 16 MiB vector that fixes modular behavior at scale.

## Commands

```bash
pnpm test    # correctness suite (node:test, zero dependencies)
pnpm bench   # benchmark: emits METRIC lines on stdout
```

The benchmark times one call per distinct 16 MiB buffer (median of 5 runs) so
cross-call caching cannot game the number. Override the workload with
`BENCH_MB` and `BENCH_RUNS`.

## Running autoresearch on it

The `.auto/` session is pre-wired. Open Pi in this directory and run:

```
/autoresearch optimize the checksum hot loop
```

`.auto/prompt.md` states the objective, the frozen contract, and what is off
limits: `bench.js` and `test/` must not change, and `src/index.js` is the only
implementation file in scope. See the root README for Pi and pi-autoresearch
installation.
