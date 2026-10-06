# slow-api

A minimal SQLite-backed request handler demo. The application maps a request object to a response object; measurement does not require a network socket.

## Objective

Implement the request handler so that the benchmark completes successfully and the primary metric (`scenario_ms`) improves. Correctness is enforced by an oracle that compares every scenario result against expected values derived independently of the application.

## Running

```bash
pnpm test      # correctness suite
pnpm bench     # benchmark with metrics
pnpm verify    # correctness suite + benchmark
pnpm dev       # serve the handler over HTTP (human convenience)
```

The benchmark uses a seeded, cached base database under `.cache/`. If the cache is missing it is generated automatically.

## Handler interface

```js
import { createApp, setupSchema } from './src/index.js';

const db = new DatabaseSync(path);
setupSchema(db);
const handle = createApp(db);

const response = handle({
  method: 'GET',
  path: '/customers',
  query: { page: '1', pageSize: '20', sort: 'name', order: 'asc' },
});
// response = { status: 200, payload: { rows, total, page, pages } }
```

- `createApp(db)` returns a handler function `(request) => response`.
- `request` shape: `{ method, path, query?, body? }`
- `response` shape: `{ status, payload }`
- `setupSchema(db)` creates the application tables.

### Supported routes

| Method | Path | Description |
| --- | --- | --- |
| GET | `/customers` | paginated, filterable, sortable customer list |
| GET | `/customers/:id` | customer detail with their orders |
| GET | `/products` | paginated, searchable, sortable product list |
| GET | `/products/:id` | product detail with reviews |
| GET | `/orders` | paginated, filterable, sortable order list |
| GET | `/orders/:id` | order detail with enriched line items |
| GET | `/reviews/aggregate` | per-product review aggregates |
| POST | `/orders` | create an order with line items |

Query parameters for list routes:

- `page` — 1-based page number (default 1)
- `pageSize` — rows per page, capped at 100 (default 20)
- `sort` — field name to sort by (default `id`)
- `order` — `asc` or `desc` (default `asc`)
- `filter` / `filterField` — substring filter on `filterField`
- `search` — substring search across product name and description

## Metrics

The benchmark prints human summary lines followed by metric lines of the form `METRIC name=value`.

- `scenario_ms` — primary metric; total wall time of the timed scenario suite in milliseconds, lower is better.
- `scenario_<name>_ms` — per-scenario timing in milliseconds.
- `statements` — total SQL statements executed by the application during the timed run.
- `distinct_statements` — number of unique SQL statement texts executed.
- `full_scans` — statements whose query plan reports a scan without an index.
- `workload_hash` — hash of the workload definition, seeds and scenario parameters.

The benchmark exits non-zero if the oracle detects a result mismatch.

## Rules

- Only files under `src/` may be modified during an optimization session.
- The harness owns the workload: dataset sizes, seeds, scenario list and parameters live in `bench/` and are not tuning knobs.
- The benchmark supplies the instrumented database handle; application-side changes cannot affect counting.
- Durability must be preserved: disabling synchronous writes or equivalent durability settings is out of contract.
- Table definitions and query text live in `src/` and are in scope.
