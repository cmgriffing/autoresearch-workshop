/**
 * datagrid-perf application entry.
 *
 * Interface contract (stable):
 * - Grid: forwardRef component accepting { rows: Row[], viewport: { width, height } }
 * - ROW_HEIGHT: fixed row height in pixels (the grid must not measure layout)
 * - Grid ref exposes { tick() } to advance background updates under controlled time.
 */
import React, {
  createContext,
  forwardRef,
  useContext,
  useImperativeHandle,
  useState,
} from "react";

export const ROW_HEIGHT = 40;

export const GridContext = createContext(null);

function compareCells(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""));
}

export const Grid = forwardRef(function Grid({ rows: initialRows, viewport }, ref) {
  // Internal mutable copy so the background update can mutate rows without
  // requiring the harness to supply new props each tick.
  const [rows, setRows] = useState(initialRows);
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc");
  const [selectedId, setSelectedId] = useState(null);

  useImperativeHandle(ref, () => ({
    tick() {
      setRows((prev) => {
        if (prev.length === 0) return prev;
        // Deterministic midpoint mutation.
        const idx = Math.floor(prev.length / 2);
        return prev.map((r, i) =>
          i === idx ? { ...r, score: (r.score ?? 0) + 1 } : r,
        );
      });
    },
  }));

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  const filteredSortedRows = rows
    .filter((row) => {
      if (!filter) return true;
      const term = filter.toLowerCase();
      return Object.values(row).some((v) =>
        String(v ?? "").toLowerCase().includes(term),
      );
    })
    .sort((a, b) => {
      if (!sortKey) return 0;
      const cmp = compareCells(a[sortKey], b[sortKey]);
      return sortDir === "asc" ? cmp : -cmp;
    });

  const selectedRow = rows.find((r) => r.id === selectedId) ?? null;

  const contextValue = {
    viewport,
    columns,
    rows: filteredSortedRows,
    filter,
    setFilter: (value) => setFilter(value),
    sortKey,
    sortDir,
    setSort: (key) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("asc");
      }
    },
    selectedId,
    setSelectedId: (id) => setSelectedId(id),
    selectedRow,
  };

  return (
    <GridContext.Provider value={contextValue}>
      <div
        data-testid="grid-root"
        style={{
          width: viewport.width,
          height: viewport.height,
          overflow: "auto",
        }}
      >
        <FilterInput />
        <table style={{ width: "100%" }}>
          <thead>
            <tr>
              <HeaderCells />
            </tr>
          </thead>
          <tbody>
            <RowList />
          </tbody>
        </table>
        <DetailPanel />
      </div>
    </GridContext.Provider>
  );
});

function FilterInput() {
  const { filter, setFilter } = useContext(GridContext);
  return (
    <input
      data-testid="filter-input"
      type="text"
      value={filter}
      placeholder="Filter rows..."
      onChange={(e) => setFilter(e.target.value)}
      style={{ marginBottom: 8 }}
    />
  );
}

function HeaderCells() {
  const { columns, sortKey, sortDir, setSort } = useContext(GridContext);
  return columns.map((col) => (
    <th key={col}>
      <button data-testid={`header-${col}`} onClick={() => setSort(col)}>
        {col}
        {sortKey === col ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
      </button>
    </th>
  ));
}

function RowList() {
  const { rows, selectedId, setSelectedId } = useContext(GridContext);
  return rows.map((row, index) => (
    <RowItem
      key={index}
      row={row}
      selected={selectedId === row.id}
      onClick={() => setSelectedId(row.id)}
    />
  ));
}

function RowItem({ row, selected, onClick }) {
  const { columns } = useContext(GridContext);
  return (
    <tr
      data-testid="row"
      data-row-id={row.id}
      onClick={onClick}
      style={{
        height: ROW_HEIGHT,
        background: selected ? "#e6f0ff" : undefined,
      }}
    >
      {columns.map((col) => (
        <td key={col}>{row[col] ?? ""}</td>
      ))}
    </tr>
  );
}

function DetailPanel() {
  const { selectedRow, columns } = useContext(GridContext);
  return (
    <div data-testid="detail-panel" style={{ marginTop: 8 }}>
      {selectedRow ? (
        <div>
          <div data-testid="detail-title">
            Selected: {selectedRow.name ?? selectedRow.id}
          </div>
          {columns.map((col) => (
            <div key={col} data-testid={`detail-${col}`}>
              {col}: {selectedRow[col] ?? ""}
            </div>
          ))}
        </div>
      ) : (
        <div data-testid="detail-empty">No selection</div>
      )}
    </div>
  );
}
