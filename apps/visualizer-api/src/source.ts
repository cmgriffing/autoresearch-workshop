import { constants } from "node:fs";
import { open } from "node:fs/promises";
import type { CurrentDocument } from "visualizar-common";

export class SourceReadError extends Error {
  code:
    | "LOG_LIMIT"
    | "LOG_CHANGED"
    | "LOG_UNAVAILABLE"
    | "DOCUMENT_LIMIT"
    | "DOCUMENT_CHANGED"
    | "DOCUMENT_UNAVAILABLE";
  state: "missing" | "error" | "limited";
  constructor(
    code: SourceReadError["code"],
    state: SourceReadError["state"],
    message: string,
  ) {
    super(message);
    this.code = code;
    this.state = state;
  }
}

// Read through one handle, checking both the initial size and growing files.
// Nonblocking open plus a regular-file check prevents a FIFO from hanging refresh.
async function readSource(
  path: string,
  maxBytes: number,
  label: string,
  kind: "LOG" | "DOCUMENT",
) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    const before = await file.stat();
    if (!before.isFile()) throw new Error("Source is not a regular file.");
    const limited = () =>
      new SourceReadError(
        `${kind}_LIMIT`,
        "limited",
        `${label} exceeds the ${maxBytes}-byte limit; no partial ${kind === "LOG" ? "history" : "document"} was loaded. Increase ${kind === "LOG" ? "maxLogBytes" : "maxDocumentBytes"} or reduce the source size.`,
      );
    if (before.size > maxBytes) throw limited();
    const chunks: Buffer[] = [];
    let size = 0;
    while (true) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, maxBytes + 1 - size));
      const { bytesRead } = await file.read(buffer);
      if (bytesRead === 0) break;
      size += bytesRead;
      if (size > maxBytes) throw limited();
      chunks.push(buffer.subarray(0, bytesRead));
    }
    const after = await file.stat();
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw new SourceReadError(
        `${kind}_CHANGED`,
        "error",
        `${label} changed during the read; retry refresh for a coherent source.`,
      );
    return Buffer.concat(chunks, size).toString("utf8");
  } catch (error) {
    if (error instanceof SourceReadError) throw error;
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    throw new SourceReadError(
      `${kind}_UNAVAILABLE`,
      missing ? "missing" : "error",
      missing
        ? `This session has no ${label} available.`
        : `Cannot read this session's ${label} as a regular file.`,
    );
  } finally {
    await file?.close();
  }
}

export function readLogSource(path: string, maxBytes: number) {
  return readSource(path, maxBytes, "log.jsonl", "LOG");
}

export async function readCurrentDocument(
  path: string,
  name: "ideas.md" | "prompt.md",
  maxBytes: number,
): Promise<CurrentDocument> {
  try {
    return {
      state: "ready",
      content: await readSource(path, maxBytes, name, "DOCUMENT"),
    };
  } catch (error) {
    if (!(error instanceof SourceReadError)) throw error;
    return { state: error.state, content: null, message: error.message };
  }
}
