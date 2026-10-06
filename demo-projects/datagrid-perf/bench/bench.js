/**
 * datagrid-perf benchmark harness.
 *
 * Builds the app with react-dom aliased to the profiling entry, runs it in a
 * headless jsdom environment, wraps it in React.Profiler, exercises a fixed
 * interaction sequence, asserts the DOM, and prints metric lines.
 */
import { build } from "vite";
import { JSDOM } from "jsdom";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import react from "@vitejs/plugin-react";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const srcEntry = resolve(projectRoot, "src/index.jsx");
const outDir = resolve(projectRoot, ".cache/bench-dist");

// Workload definition (harness-owned).
const ROW_COUNT = 2000;
const VIEWPORT = { width: 800, height: 600 };
const TIMED_SEED = 12345;
const VERIFY_SEED = 67890;
const ITERATIONS = 5;
const FILTER_QUERY = "engineer";
const TICKS = 5;

const FIRST_NAMES = [
  "Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace", "Henry", "Ivy", "Jack",
];
const LAST_NAMES = [
  "Smith", "Jones", "Taylor", "Brown", "Williams", "Miller", "Wilson", "Moore", "Clark", "Lee",
];
const ROLES = ["engineer", "designer", "manager", "analyst", "support"];
const DEPTS = ["engineering", "sales", "marketing", "operations", "hr"];
const DOMAINS = ["example.com", "acme.org", "demo.net"];

function createRng(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function generateRows(seed, count) {
  const rng = createRng(seed);
  const rows = [];
  for (let i = 0; i < count; i++) {
    const first = FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)];
    const last = LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)];
    const role = ROLES[Math.floor(rng() * ROLES.length)];
    const dept = DEPTS[Math.floor(rng() * DEPTS.length)];
    const score = Math.floor(rng() * 100);
    const row = { id: `row-${i}`, name: `${first} ${last}`, role, department: dept, score };
    if (rng() > 0.2) {
      row.email = `${first.toLowerCase()}.${last.toLowerCase()}@${DOMAINS[Math.floor(rng() * DOMAINS.length)]}`;
    }
    rows.push(row);
  }
  return rows;
}

function compareCells(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""));
}

function filterAndSort(rows, filter, sortKey, sortDir) {
  let result = rows.filter((row) => {
    if (!filter) return true;
    const term = filter.toLowerCase();
    return Object.values(row).some((v) => String(v ?? "").toLowerCase().includes(term));
  });
  if (sortKey) {
    result = result.slice().sort((a, b) => {
      const cmp = compareCells(a[sortKey], b[sortKey]);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }
  return result;
}

function workloadHash() {
  const payload = JSON.stringify({
    timedSeed: TIMED_SEED,
    verifySeed: VERIFY_SEED,
    rowCount: ROW_COUNT,
    viewport: VIEWPORT,
    filter: FILTER_QUERY,
    ticks: TICKS,
    version: 1,
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

async function buildApp() {
  await build({
    configFile: false,
    root: projectRoot,
    plugins: [react()],
    mode: "production",
    define: { "process.env.NODE_ENV": '"production"' },
    resolve: {
      alias: { "react-dom/client": "react-dom/profiling" },
    },
    build: {
      lib: { entry: srcEntry, formats: ["es"], fileName: "grid" },
      outDir,
      emptyOutDir: true,
      rollupOptions: {
        external: ["react", "react-dom/profiling"],
      },
    },
    logLevel: "silent",
  });
  return resolve(outDir, "grid.js");
}

function defineGlobal(key, value) {
  const desc = Object.getOwnPropertyDescriptor(globalThis, key);
  if (desc && !desc.configurable) return;
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  });
}

const DOM_CONSTRUCTORS = new Set([
  "Element",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLButtonElement",
  "HTMLTableElement",
  "HTMLTableRowElement",
  "HTMLTableCellElement",
  "HTMLTableSectionElement",
  "HTMLDivElement",
  "HTMLSpanElement",
  "HTMLBodyElement",
  "HTMLHtmlElement",
  "Text",
  "Node",
  "Document",
  "DocumentFragment",
  "Comment",
  "DocumentType",
  "Attr",
  "NamedNodeMap",
  "NodeList",
  "HTMLCollection",
  "DOMTokenList",
  "CSSStyleDeclaration",
  "StyleSheet",
  "CSSStyleSheet",
  "MediaList",
  "Screen",
  "History",
  "Location",
  "Storage",
  "CustomEvent",
  "KeyboardEvent",
  "FocusEvent",
  "PointerEvent",
  "WheelEvent",
  "DragEvent",
  "FormData",
  "URL",
  "URLSearchParams",
  "AbortController",
  "AbortSignal",
  "EventTarget",
  "ResizeObserver",
  "IntersectionObserver",
  "MessageChannel",
  "MessagePort",
  "Blob",
  "File",
  "FileReader",
  "XMLHttpRequest",
  "WebSocket",
  "BroadcastChannel",
  "Image",
  "OffscreenCanvas",
]);

function installGlobals(win) {
  defineGlobal("window", win);
  defineGlobal("document", win.document);
  defineGlobal("navigator", win.navigator);
  defineGlobal("location", win.location);
  defineGlobal("MutationObserver", win.MutationObserver);
  defineGlobal("Event", win.Event);
  defineGlobal("InputEvent", win.InputEvent);
  defineGlobal("MouseEvent", win.MouseEvent);
  for (const key of DOM_CONSTRUCTORS) {
    if (win[key] !== undefined) {
      defineGlobal(key, win[key]);
    }
  }
}

function setNativeValue(input, value) {
  const descriptor = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  );
  descriptor.set.call(input, value);
}

async function settle(ReactDOM) {
  await new Promise((r) => queueMicrotask(r));
  ReactDOM.flushSync(() => {});
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => queueMicrotask(r));
}

function typeInto(input, text) {
  for (const char of text) {
    setNativeValue(input, (input.value || "") + char);
    input.dispatchEvent(new window.InputEvent("input", { bubbles: true, data: char }));
  }
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function runIteration(bundlePath, rows) {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "http://localhost",
    pretendToBeVisual: true,
  });
  installGlobals(dom.window);

  // Load React, ReactDOM and the built app inside the jsdom environment.
  const React = await import("react");
  const app = await import(bundlePath);
  const ReactDOM = await import("react-dom/profiling");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  const gridRef = React.createRef();

  let commits = 0;
  let totalDuration = 0;
  const phaseDurations = { mount: 0, interaction: 0, background: 0 };
  let phase = "mount";

  function onRender(_id, phaseName, actualDuration) {
    commits++;
    totalDuration += actualDuration;
    if (phaseName === "mount") {
      phaseDurations.mount += actualDuration;
    } else {
      phaseDurations[phase] += actualDuration;
    }
  }

  let mutations = 0;
  const observer = new window.MutationObserver((records) => {
    mutations += records.length;
  });
  observer.observe(container, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  });

  root.render(
    React.createElement(
      React.Profiler,
      { id: "grid", onRender },
      React.createElement(app.Grid, { ref: gridRef, rows, viewport: VIEWPORT }),
    ),
  );
  await settle(ReactDOM);

  // Interaction phase: type filter, sort, select, clear filter.
  phase = "interaction";
  const input = container.querySelector('[data-testid="filter-input"]');
  if (!input) throw new Error("Oracle failed: filter input not found");

  typeInto(input, FILTER_QUERY);
  await settle(ReactDOM);

  const scoreHeader = container.querySelector('[data-testid="header-score"]');
  if (!scoreHeader) throw new Error("Oracle failed: score header not found");
  scoreHeader.click();
  await settle(ReactDOM);

  const firstVisibleRow = container.querySelector('[data-testid="row"]');
  if (!firstVisibleRow) throw new Error("Oracle failed: no rows to select");
  const selectedId = firstVisibleRow.dataset.rowId;
  firstVisibleRow.click();
  await settle(ReactDOM);

  // Toggle filter off.
  setNativeValue(input, "");
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  await settle(ReactDOM);

  // Background-update phase.
  phase = "background";
  for (let i = 0; i < TICKS; i++) {
    gridRef.current.tick();
    await settle(ReactDOM);
  }

  const nodes = container.querySelectorAll("*").length;

  // Oracle: row count, selected detail, and first sorted row after clearing filter.
  const allSorted = filterAndSort(rows, "", "score", "asc");
  const expectedSelected = filterAndSort(rows, FILTER_QUERY, "score", "asc")[0];

  const renderedRows = Array.from(container.querySelectorAll('[data-testid="row"]'));
  if (renderedRows.length !== ROW_COUNT) {
    throw new Error(
      `Oracle failed: expected ${ROW_COUNT} rows, got ${renderedRows.length}`,
    );
  }

  const detailTitle = container.querySelector('[data-testid="detail-title"]');
  if (!detailTitle || !detailTitle.textContent.includes(expectedSelected.name)) {
    throw new Error("Oracle failed: detail panel does not show selected record");
  }

  const selectedRowEl = container.querySelector(`[data-testid="row"][data-row-id="${selectedId}"]`);
  if (!selectedRowEl) {
    throw new Error("Oracle failed: selected row is not rendered");
  }

  const firstId = renderedRows[0].dataset.rowId;
  if (firstId !== allSorted[0].id) {
    throw new Error(`Oracle failed: first row ${firstId} != expected ${allSorted[0].id}`);
  }

  ReactDOM.flushSync(() => root.unmount());
  observer.disconnect();

  return {
    renderMs: totalDuration,
    commits,
    mutations,
    nodes,
    phaseMountMs: phaseDurations.mount,
    phaseInteractionMs: phaseDurations.interaction,
    phaseBackgroundMs: phaseDurations.background,
  };
}

async function main() {
  const bundlePath = await buildApp();
  const timedRows = generateRows(TIMED_SEED, ROW_COUNT);
  const verifyRows = generateRows(VERIFY_SEED, ROW_COUNT);

  // Run correctness oracle with a different seed before reporting metrics.
  await runIteration(bundlePath, verifyRows);

  const results = [];
  for (let i = 0; i < ITERATIONS; i++) {
    results.push(await runIteration(bundlePath, timedRows));
  }

  const renderMs = median(results.map((r) => r.renderMs));
  const commits = Math.round(median(results.map((r) => r.commits)));
  const mutations = Math.round(median(results.map((r) => r.mutations)));
  const nodes = Math.round(median(results.map((r) => r.nodes)));
  const phaseMountMs = median(results.map((r) => r.phaseMountMs));
  const phaseInteractionMs = median(results.map((r) => r.phaseInteractionMs));
  const phaseBackgroundMs = median(results.map((r) => r.phaseBackgroundMs));

  if (commits === 0 || renderMs === 0) {
    throw new Error(
      "Profiler reported no render work; is the profiling build selected?",
    );
  }

  console.log("datagrid-perf benchmark");
  console.log(`iterations=${ITERATIONS} rows=${ROW_COUNT} viewport=${VIEWPORT.width}x${VIEWPORT.height}`);
  console.log(`median render_ms=${renderMs.toFixed(3)} commits=${commits} mutations=${mutations} nodes=${nodes}`);

  console.log(`METRIC commits=${commits}`);
  console.log(`METRIC mutations=${mutations}`);
  console.log(`METRIC nodes=${nodes}`);
  console.log(`METRIC phase_mount_ms=${phaseMountMs.toFixed(3)}`);
  console.log(`METRIC phase_interaction_ms=${phaseInteractionMs.toFixed(3)}`);
  console.log(`METRIC phase_background_ms=${phaseBackgroundMs.toFixed(3)}`);
  console.log(`METRIC render_ms=${renderMs.toFixed(3)}`);
  console.log(`METRIC workload_hash=${workloadHash()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
