import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checksum } from "../src/index.js";

const hex = (n) => `0x${n.toString(16).padStart(8, "0")}`;

/** Deterministic xorshift bytes — keeps every vector reproducible. */
function pattern(length, seed = 0x12345678) {
  const out = new Uint8Array(length);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    s = (s ^ (s << 13)) >>> 0;
    s = (s ^ (s >>> 17)) >>> 0;
    s = (s ^ (s << 5)) >>> 0;
    out[i] = s & 0xff;
  }
  return out;
}

/**
 * The contract, written the way the spec reads:
 *   lane_k = sum of bytes at k, k+4, … (mod 2^32)
 *   result = (lane3 + lane2<<8 + lane1<<16 + lane0<<24) mod 2^32
 */
function referenceBigInt(bytes) {
  const lanes = [0n, 0n, 0n, 0n];
  for (let i = 0; i < bytes.length; i++) {
    lanes[i & 3] = (lanes[i & 3] + BigInt(bytes[i])) & 0xffffffffn;
  }
  const combined =
    lanes[3] + (lanes[2] << 8n) + (lanes[1] << 16n) + (lanes[0] << 24n);
  return Number(combined & 0xffffffffn);
}

/** Same contract in integer arithmetic, for inputs where BigInt is too slow. */
function referenceInt(bytes) {
  const lanes = [0, 0, 0, 0];
  for (let i = 0; i < bytes.length; i++) {
    lanes[i & 3] = (lanes[i & 3] + bytes[i]) >>> 0;
  }
  return (
    (lanes[3] +
      ((lanes[2] << 8) >>> 0) +
      ((lanes[1] << 16) >>> 0) +
      ((lanes[0] << 24) >>> 0)) >>>
    0
  );
}

describe("golden vectors", () => {
  const vectors = [
    [[], 0x00000000],
    [[0], 0x00000000],
    [[1], 0x01000000], // index 0 is the most significant byte
    [[255], 0xff000000],
    [[1, 2], 0x01020000],
    [[1, 2, 3], 0x01020300],
    [[1, 2, 3, 4], 0x01020304],
    [[255, 255, 255, 255], 0xffffffff],
    [[1, 0, 0, 0, 255], 0x00000000], // lane 0: 1 + 255 = 256 ≡ 0 (mod 256)
    [[1, 2, 3, 4, 5, 6, 7, 8], 0x06080a0c],
  ];

  for (const [input, expected] of vectors) {
    it(`${JSON.stringify(input)} -> ${hex(expected)}`, () => {
      assert.equal(checksum(input), expected);
    });
  }

  it('ASCII "123456789" -> 0x9f686a6c', () => {
    assert.equal(checksum(new TextEncoder().encode("123456789")), 0x9f686a6c);
  });

  it("empty Uint8Array -> 0", () => {
    assert.equal(checksum(new Uint8Array(0)), 0);
  });
});

describe("semantics", () => {
  it("places byte i in result byte 3 - (i % 4)", () => {
    for (let i = 0; i < 12; i++) {
      for (const b of [1, 7, 255]) {
        const input = new Uint8Array(i + 1);
        input[i] = b;
        const expected = (b << (8 * (3 - (i % 4)))) >>> 0;
        assert.equal(checksum(input), expected, `byte ${b} at index ${i}`);
      }
    }
  });

  it("does not mutate its input", () => {
    const list = [1, 2, 3, 4, 5, 6, 7];
    checksum(list);
    assert.deepEqual(list, [1, 2, 3, 4, 5, 6, 7]);

    const u8 = pattern(257);
    const copy = u8.slice();
    checksum(u8);
    assert.deepEqual(u8, copy);
  });

  it("is deterministic", () => {
    const input = pattern(1000);
    assert.equal(checksum(input), checksum(input));
    assert.equal(checksum([...input]), checksum(input));
  });

  it("returns an unsigned 32-bit integer", () => {
    for (const n of [0, 1, 2, 3, 4, 5, 255, 256, 1000, 65536]) {
      const result = checksum(pattern(n, 0xabc + n));
      assert.ok(Number.isInteger(result), `not an integer for length ${n}`);
      assert.ok(
        result >= 0 && result <= 0xffffffff,
        `out of range for length ${n}`,
      );
    }
  });

  it("changes when any single byte changes", () => {
    const base = pattern(16);
    const original = checksum(base);
    for (let i = 0; i < base.length; i++) {
      const mutated = base.slice();
      mutated[i] ^= 0xff;
      assert.notEqual(
        checksum(mutated),
        original,
        `flipping byte ${i} did not change the result`,
      );
    }
  });

  it("recomputes after the input is mutated (no stale caching)", () => {
    const input = pattern(4096);
    const before = checksum(input);
    input[0] ^= 0xff;
    assert.notEqual(checksum(input), before);
  });

  it("agrees across number[], Uint8Array, and Buffer", () => {
    const bytes = pattern(257);
    assert.equal(checksum([...bytes]), checksum(bytes));
    assert.equal(checksum(Buffer.from(bytes)), checksum(bytes));
  });
});

describe("reference cross-check", () => {
  it("matches the spec reference for every length 0..33", () => {
    for (let n = 0; n <= 33; n++) {
      const input = pattern(n, 0xabc000 + n);
      assert.equal(checksum(input), referenceBigInt(input), `length ${n}`);
    }
  });

  it("matches the spec reference at boundary sizes", () => {
    for (const n of [63, 64, 65, 255, 256, 257, 1023, 1024, 4096, 65536]) {
      const input = pattern(n, 0x5eed + n);
      assert.equal(checksum(input), referenceBigInt(input), `size ${n}`);
    }
  });

  it("integer and spec references agree", () => {
    const input = pattern(5000, 0xfeed);
    assert.equal(referenceInt(input), referenceBigInt(input));
  });

  it("matches the integer reference on a 1 MiB pattern", () => {
    const input = pattern(1 << 20);
    assert.equal(checksum(input), referenceInt(input));
  });
});

describe("scale", () => {
  it("holds at 16 MiB of 0xff (modular lane arithmetic)", () => {
    // Every lane sums 2^22 × 0xff = 0x3fc00000. Only lane 2 contributes low
    // bits: 0x3fc00000 + (0xc00000 << 8) = 0xffc00000.
    const input = new Uint8Array(16 * 1024 * 1024).fill(0xff);
    assert.equal(checksum(input), 0xffc00000);
  });
});
