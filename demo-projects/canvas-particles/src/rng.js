export function createRng(seed) {
  let s = 0;
  if (typeof seed === 'number') {
    s = seed >>> 0 || 1;
  } else if (typeof seed === 'string') {
    for (const ch of seed) {
      s = (s * 31 + ch.codePointAt(0)) >>> 0;
    }
    s = s || 1;
  } else {
    s = 1;
  }
  return function next() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
