import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Grid, ROW_HEIGHT } from "../src/index.jsx";

// React 19's act from the react package requires this flag in test environments.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const VIEWPORT = { width: 800, height: 600 };

const SAMPLE_ROWS = [
  { id: "r1", name: "Alice Smith", role: "engineer", department: "engineering", score: 42, email: "alice@example.com" },
  { id: "r2", name: "Bob Jones", role: "designer", department: "design", score: 17, email: "bob@example.com" },
  { id: "r3", name: "Carol Taylor", role: "manager", department: "engineering", score: 88 },
  { id: "r4", name: "Dave Brown", role: "engineer", department: "sales", score: 33, email: "dave@example.com" },
];

function render(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return { container, root };
}

function cleanup(root, container) {
  act(() => root.unmount());
  container.remove();
}

function getRows(container) {
  return Array.from(container.querySelectorAll('[data-testid="row"]'));
}

function getInput(container) {
  return container.querySelector('[data-testid="filter-input"]');
}

function setNativeValue(input, value) {
  // Bypass React's input value tracker in jsdom so synthetic onChange fires.
  const descriptor = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  );
  descriptor.set.call(input, value);
}

function type(input, text) {
  for (const char of text) {
    setNativeValue(input, (input.value ?? "") + char);
    act(() => {
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: char }));
    });
  }
}

function clear(input) {
  setNativeValue(input, "");
  act(() => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function click(el) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("Grid", () => {
  let root, container;

  beforeEach(() => {
    ({ root, container } = render(<Grid rows={SAMPLE_ROWS} viewport={VIEWPORT} />));
  });

  afterEach(() => {
    cleanup(root, container);
  });

  it("renders all rows initially", () => {
    expect(getRows(container).length).toBe(SAMPLE_ROWS.length);
  });

  it("filters rows by typing a query", () => {
    const input = getInput(container);
    type(input, "Alice");
    const visible = getRows(container);
    expect(visible.length).toBe(1);
    expect(visible[0].dataset.rowId).toBe("r1");
  });

  it("sorts rows when a column header is clicked", () => {
    click(container.querySelector('[data-testid="header-score"]'));
    const idsAsc = getRows(container).map((r) => r.dataset.rowId);
    expect(idsAsc).toEqual(["r2", "r4", "r1", "r3"]);

    click(container.querySelector('[data-testid="header-score"]'));
    const idsDesc = getRows(container).map((r) => r.dataset.rowId);
    expect(idsDesc).toEqual(["r3", "r1", "r4", "r2"]);
  });

  it("selects a row and shows its details", () => {
    const row = getRows(container)[1];
    click(row);
    expect(container.querySelector('[data-testid="detail-title"]').textContent).toContain("Bob Jones");
    expect(container.querySelector('[data-testid="detail-score"]').textContent).toBe("score: 17");
  });

  it("renders an empty result set without crashing", () => {
    const input = getInput(container);
    type(input, "zzzzz");
    expect(getRows(container).length).toBe(0);
    expect(container.querySelector('[data-testid="detail-empty"]')).not.toBeNull();
  });

  it("renders records with missing optional fields", () => {
    const row = getRows(container).find((r) => r.dataset.rowId === "r3");
    expect(row).not.toBeNull();
    click(row);
    // Carol has no email cell content.
    const cells = Array.from(row.querySelectorAll("td"));
    const emailIndex = Array.from(container.querySelectorAll("th")).findIndex(
      (th) => th.textContent.trim().startsWith("email"),
    );
    expect(cells[emailIndex].textContent).toBe("");
    expect(container.querySelector('[data-testid="detail-email"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="detail-email"]').textContent).toBe("email: ");
  });

  it("exports a fixed row height constant", () => {
    expect(typeof ROW_HEIGHT).toBe("number");
    expect(ROW_HEIGHT).toBeGreaterThan(0);
  });
});
