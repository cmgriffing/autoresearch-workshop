import type { DiffResponse } from "visualizar-common";

export const DEFAULT_DIFF_CACHE_ENTRIES = 64;
export const DEFAULT_DIFF_CACHE_BYTES = 8 * 1024 * 1024;

// App-owned LRU. Only immutable resolved comparisons are stored, never failures.
export function createDiffCache(
  maxEntries = DEFAULT_DIFF_CACHE_ENTRIES,
  maxBytes = DEFAULT_DIFF_CACHE_BYTES,
) {
  const entries = new Map<string, { value: DiffResponse; bytes: number }>();
  let bytes = 0;
  let hits = 0;
  return {
    get(key: string) {
      const entry = entries.get(key);
      if (!entry) return;
      entries.delete(key);
      entries.set(key, entry);
      hits++;
      return structuredClone(entry.value);
    },
    set(key: string, value: DiffResponse) {
      const size =
        Buffer.byteLength(key) + Buffer.byteLength(JSON.stringify(value));
      if (size > maxBytes || maxEntries <= 0) return;
      const previous = entries.get(key);
      if (previous) bytes -= previous.bytes;
      entries.delete(key);
      entries.set(key, { value: structuredClone(value), bytes: size });
      bytes += size;
      while (entries.size > maxEntries || bytes > maxBytes) {
        const oldest = entries.keys().next().value!;
        bytes -= entries.get(oldest)!.bytes;
        entries.delete(oldest);
      }
    },
    clear() {
      entries.clear();
      bytes = 0;
    },
    get stats() {
      return { entries: entries.size, bytes, hits };
    },
  };
}
export type DiffCache = ReturnType<typeof createDiffCache>;
