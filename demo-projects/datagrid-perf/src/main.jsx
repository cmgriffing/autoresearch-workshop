/**
 * Dev-server entry for manual inspection.
 *
 * The harness (bench/, test/) supplies its own datasets, viewport and
 * interaction script. This file exists only so `pnpm dev` can render the grid
 * in a browser with sample data; nothing here participates in the benchmark.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { Grid } from "./index.jsx";

const FIRST = ["Ava", "Liam", "Maya", "Noah", "Zoe", "Ethan", "Iris", "Kai"];
const LAST = ["Chen", "Patel", "Garcia", "Kim", "Novak", "Silva", "Okafor", "Ross"];
const DEPARTMENTS = ["engineering", "design", "marketing", "sales", "support"];
const ROLES = ["engineer", "designer", "analyst", "manager", "intern"];

const SAMPLE_ROWS = Array.from({ length: 200 }, (_, i) => {
  const first = FIRST[i % FIRST.length];
  const last = LAST[(i * 3) % LAST.length];
  return {
    id: `r${i + 1}`,
    name: `${first} ${last}`,
    role: ROLES[(i * 5) % ROLES.length],
    department: DEPARTMENTS[(i * 7) % DEPARTMENTS.length],
    score: (i * 17) % 100,
    email: `${first.toLowerCase()}.${last.toLowerCase()}${i + 1}@example.com`,
  };
});

const VIEWPORT = { width: 960, height: 640 };

function DemoApp() {
  const gridRef = React.useRef(null);
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 16 }}>
      <h1 style={{ fontSize: 18, margin: "0 0 4px" }}>datagrid-perf — dev demo</h1>
      <p style={{ fontSize: 13, color: "#555", margin: "0 0 12px" }}>
        Sample data for manual inspection. The harness supplies its own dataset
        and viewport during test/bench runs.
      </p>
      <button onClick={() => gridRef.current?.tick()} style={{ marginBottom: 8 }}>
        Tick (background update)
      </button>
      <Grid ref={gridRef} rows={SAMPLE_ROWS} viewport={VIEWPORT} />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<DemoApp />);
