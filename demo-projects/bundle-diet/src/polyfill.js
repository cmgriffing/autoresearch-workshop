// Unused polyfill imported by the entry point. It is intentionally kept on the
// critical path so that builds configured without it show a real size win.
globalThis.__bundleDietPolyfill = (function buildPolyfill() {
  const table = [];
  for (let i = 0; i < 800; i++) {
    table.push({
      index: i,
      label: `polyfill-slot-${i}`,
      flags: [i & 1, i & 2, i & 4, i & 8],
      payload:
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
    });
  }
  return table;
})();
