# Local autoresearch session review

From the repository root, install with `pnpm install` (Node >=24), then:

```sh
pnpm dev:visualizer
# Open http://127.0.0.1:5173
pnpm build:visualizer
pnpm start:visualizer
# Open http://127.0.0.1:4310
pnpm check:visualizer
pnpm smoke:visualizer dev
pnpm smoke:visualizer built
pnpm smoke:visualizer:segments
pnpm smoke:visualizer:discovery dev
pnpm smoke:visualizer:discovery built
pnpm smoke:visualizer:sources dev
pnpm smoke:visualizer:sources built
pnpm smoke:visualizer:documents dev
pnpm smoke:visualizer:documents built
pnpm smoke:visualizer:chart dev
pnpm smoke:visualizer:chart built
pnpm smoke:visualizer:comparisons dev
pnpm smoke:visualizer:comparisons built
pnpm smoke:visualizer:live dev
pnpm smoke:visualizer:live built
pnpm smoke:visualizer:recovery dev
pnpm smoke:visualizer:recovery built
pnpm smoke:visualizer:accessibility dev
pnpm smoke:visualizer:accessibility built
pnpm smoke:visualizer:s12 dev
pnpm smoke:visualizer:s12 built
```

The browser smoke checks use installed Google Chrome. Set `VISUALIZER_CHROME_PATH` for another Chromium executable. Checks start and stop their own servers: checksum/segment checks use ports 4311/5174; parent-diff checks use 4312/5175; discovery checks use 4313/5176; source reconciliation checks use 4314/5177; document checks use 4315/5178; chart checks use 4316/5179; comparison checks use 4317/5180; live-update checks use 4318/5181; recovery checks use 4319/5182; accessibility checks use 4320/5183; assembled S12 checks use 4321/5184. Run dev and built checks sequentially when they share ports.

The default config is `apps/visualizer-api/config.example.json`, pointing directly at checksum. The assembled `pnpm smoke:visualizer:s12` checks run the built app with that config against the real `demo-projects/checksum` session and assert its files, repository index, and refs remain unchanged. All other browser checks use fresh temporary fixtures. For an isolated copy, run `pnpm fixture:visualizer`; it prints its config and launch commands. Delete the printed temporary directory when finished.

```sh
VISUALIZER_CONFIG=/absolute/path/config.json pnpm dev:visualizer
pnpm start:visualizer --config /absolute/path/config.json
```

Relative roots resolve against the config file, independent of the process directory. Configure one or more roots; `recursive` defaults to true. Discovery checks the root itself and continues through nested projects, including projects sharing one Git repository. `recursive: false` inspects only the specified root. Explicit roots may be symlinks and are canonicalized; descendant directory symlinks and `.auto` contents are skipped. Default basename exclusions are `node_modules`, `.git`, `.turbo`, `.cache`, `dist`, and `build`. An explicit `exclude` array replaces these defaults (and `.auto` is always skipped). Exclusions are names, not path patterns. Each root pass visits at most 10,000 directories and reports an incomplete-list diagnostic if it reaches that bound.

For example, put this config beside a `projects/` directory:

```json
{
  "roots": [
    { "path": "./projects" },
    { "path": "./other-project", "recursive": false }
  ],
  "exclude": ["node_modules", ".git", ".turbo", ".cache", "dist", "build"],
  "minWinImprovementPct": 0,
  "maxLogBytes": 8388608,
  "maxDocumentBytes": 1048576,
  "watch": true,
  "rescanIntervalMs": 5000
}
```

One rail holds the review session: the brand, the project selector, **Refresh projects**, the selected project's metadata, the improvement filter, the attempt list, and the connection state, and it stays visible while the review pane scrolls. The project selector lists every discovered session grouped by configured root with relative paths, experiment counts, and uninitialized/stale/limited/error states; open it with the keyboard, type to filter, and press Enter to select, and the rail keeps the selected project's name, root, relative path, and source state visible while the selector is closed. A session found through overlapping roots has one ID and appears in each associated group. Missing or unreadable roots have separate diagnostics; projects without an initially readable `log.jsonl` remain selectable as uninitialized or unavailable sessions. Use **Refresh projects** to rediscover sessions and reload logs and current documents. Existing valid result selection stays open. If a selected project or record is removed or rewritten, its selection clears with an explanation. Configuration is validated at startup; restart after editing the config.

Automatic monitoring is enabled by default. The API watches each discovered `.auto` directory for `log.jsonl`, `ideas.md`, and `prompt.md`, debounces replacement/write bursts, installs one coherent snapshot at a time, then sends a revisioned invalidation through `GET /api/events`. The browser refetches the project list and selected project after connecting, reconnecting, or receiving a newer invalidation. Existing valid project/segment/result selection and scroll position remain in place; a rewritten selected record clears with an explanation. The rail footer reports connected, reconnecting, or manual mode without claiming an autoresearch process is running. Configured roots are also rediscovered periodically, defaulting to every five seconds (`rescanIntervalMs`, a positive integer up to 2,147,483,647). Each pass checks source identity/size/mode/timestamps, reloads changed projects, and retries stale or failed reads. New nested sessions and confirmed removals update navigation without manual refresh. Watcher setup/runtime failures produce a project diagnostic while periodic reconciliation continues and retries the watcher. Replacing a `.auto` directory reinstalls its watcher. Set `"watch": false` to disable both watchers and periodic discovery; **Refresh projects** remains available. Automatic index revisions change only for observed registry/snapshot changes, so idle scans do not invalidate the browser. The interval is measured after the preceding scan completes; slow filesystem scans can delay updates.

Logs default to an 8 MiB (8,388,608-byte) limit, configurable with the positive integer `maxLogBytes`. The API checks size before and during reads and accepts only regular files. It reports a limit rather than loading truncated history. A missing, unreadable, oversized, or concurrently changing log retains the last successfully read snapshot when available, with a **Stale data** label and a project diagnostic. Recovery clears that label; a successfully read empty file replaces old history with an explicit empty state. A failed initial read has no retained history. A failed or incomplete root scan retains undiscovered known projects and current notes as stale with root/project diagnostics, including descendant-directory failures and the discovery limit. A project disappears only when all its remaining root associations successfully scan and confirm absence. Healthy roots remain usable. Recovery restores the same canonical IDs and clears stale discovery state after the data is read again.

**Current ideas** and **Current prompt** display optional `.auto/ideas.md` and `.auto/prompt.md` for the selected project. These are current files at the latest refresh and may have changed since a recorded experiment. Opening documents preserves the selected result; **Review results** or an attempt in the rail returns to its review. Documents remain accessible before the first experiment and while a log is stale.

Each document defaults to a 1 MiB (1,048,576-byte) limit, configurable with positive integer `maxDocumentBytes`. The bounded regular-file reader is shared with logs. Missing, unreadable, concurrently changing, and oversized documents have explicit individual states; an empty readable file has an empty-document message. Document failures preserve experiment history and the other document. Unavailable document content is `null`; the view shows its availability message until a successful refresh. Markdown uses lazy-loaded `react-markdown` 10.1.0 with `skipHtml`, no raw-HTML plugin, and the renderer's default safe URL handling. Basic Markdown headings, lists, links, blockquotes, and code render; raw HTML is omitted and fenced HTML remains escaped code. No historical notes or idea-to-run associations are inferred.

Malformed interior records have line diagnostics; valid records before and after them remain available. Unknown event types do not become experiments. An unfinished final object without a newline waits for completion on refresh; a valid newline-free final record is accepted. Required run numbers, finite primary metrics, and known statuses are validated without coercion. Invalid optional secondary metric values are omitted with diagnostics. Missing commits preserve results and report unavailable diffs. Duplicate display numbers use separate opaque IDs derived from canonical project identity, source line, and raw record text. Appends preserve existing IDs; rewriting a record changes its ID and source revision.

The rail's attempt list is the single textual history: it lists the selected segment's attempts in recorded source order with attempt and run numbers, the recorded metric and decision (first-kept baseline, new best, kept, discarded, or failed), the best-kept-so-far value, and the recorded description, and its scope filter switches between all attempts, wins (baseline plus new bests), and failed attempts with counts. The minimum-improvement slider uses logarithmic stops that include 0 (every win, including wins whose percentage is unavailable) and extend just above the segment's largest win, seeded from the configured `minWinImprovementPct` with a reset control; it hides only new-best wins below the threshold, and its readout states the threshold, the wins that pass, and the attempts currently listed. Selecting a result loads its bounded project-scoped historical diff; unavailable history preserves recorded metrics.

**Historical diff** defaults to the recorded commit against its first parent, or the empty tree for a root commit. **First kept baseline** compares against the recorded first valid kept commit in the selected run's segment. Missing, invalid, or ambiguous baseline references remain unavailable; a later keep, parent, or current working tree is never substituted. Full actual base/target object IDs are shown independently of the preceding-best metric reference. Merge commits report their parent count; parent mode always uses the first parent. Linked worktrees whose `.git` is a file are supported.

Changed-file buttons show repository-relative paths, rename origins, change types, and insertion/deletion counts. Select one file or **All changed files**. Project siblings are excluded; **Include .auto session artifacts** toggles only the selected project's session directory. Ordinary documentation remains visible. A logs-only parent diff is empty by default and becomes visible with artifacts included. Baseline selected against itself is empty. Binary-only comparisons have a `binary` state with unavailable text/counts; mixed comparisons retain text patches and label their binary files individually. Limited/error states retain the selected result's metrics and never present a partial patch as complete.

**Unified** shows the complete escaped Git patch for the selected files. **Split** lazy-loads `react-diff-view` 3.3.3 to show base/target hunks with line numbers. Pure renames and mode-only changes show their metadata patch; unsupported split parsing falls back to the complete unified patch. No syntax-highlighting, full-file expansion, or binary preview is provided. Presentation and file changes do not request Git again; comparison/artifact changes do. Native controls and file buttons have visible keyboard focus. On narrow screens the compact bar shows the selected project and connection state and opens one keyboard-operable session drawer containing the project selector, improvement filter, attempt list, and connection state; the skip link, segment/filter controls, chart markers, current documents, and diff controls remain reachable with visible focus, and closing the drawer restores focus to its trigger.

`GET /api/projects/:projectId/runs/:runId/diff` requires `revision` and accepts only `comparison=parent|baseline` (default parent) and `includeAuto=true|false` (default false). It rejects other query keys and returns 409 if the source revision changes before or during Git work. Patches are limited to 512 KiB, each metadata command to 64 KiB, and each Git command to five seconds. Git uses argument arrays, disables external diff/text conversion, and does not run session scripts or write files/index/refs. The API owns an in-memory LRU of at most 64 resolved comparisons and 8 MiB of serialized payload/key bytes. Keys include canonical repository/project scope, full resolved base/target objects, comparison/artifact mode, and aggregate source revision; missing, invalid, limited, and failure states are not cached. Closing the app clears it. Git references are resolved again before cache lookup.

**Metric trajectory** plots attempts in source order within the selected segment, independently of display run numbers and the rail's threshold and scope filters. The first kept baseline is a square, new bests are diamonds, other keeps are filled circles, and discards are hollow circles. The stepped best-so-far line changes only for kept improvements. Crashes and checks failures appear as selectable buttons below the plot; their recorded metrics remain in history/details but are excluded from the metric axis. Successful or discarded zero values remain real plotted values. Empty, failure-only, single-attempt, and discard-only segments have explicit presentations.

Chart points accept Enter/Space, and arrow navigation on the chart exposes a readable tooltip. The rail attempt list is the textual chart equivalent with every recorded metric, decision, baseline/win role, and best-kept value. Chart and attempt list select the same opaque run ID. Selecting a point or entry retains focus and loads the existing lazy diff; a filtered-out selection remains open with an outside-filter notice. Recharts 3.10.1 is lazy-loaded only for the results chart, and chart animations are disabled to keep observed data and selection stable.

Result details show secondary metric names/values without inferred units, previous best and first-kept metric references, separate incremental/cumulative win improvements, and recorded timestamps in UTC. A missing/null timestamp displays **Not recorded**; zero means the Unix epoch. Invalid optional timestamps, confidence, and ASI are omitted with line diagnostics while preserving valid runs. Timestamps must be finite nonnegative epoch milliseconds within the JavaScript Date range. Confidence is shown exactly as a finite recorded advisory number with no probability conversion or effect on wins. ASI accepts any valid JSON, including objects, arrays, strings, numbers, booleans, and null; formatted escaped JSON preserves its structure and falsy values.

Segment snapshots add `attempts: AttemptPlotPoint[]`: one entry per valid run, with `runId`, one-based segment-local `attempt`, display `run`, `sourceLine`, reported `status`, nullable plotted `metric`, nullable `bestMetric`/`bestRunId`, and `isBaseline`/`isWin`. Entries match `runIds` in source order. Failed metrics are null only on these plot entries; raw run metrics are preserved. Run snapshots add optional `confidence: number | null` and `asi: JSON`; existing revision and opaque identity rules are unchanged.

`POST /api/refresh` accepts no body or query parameters and requires the exact configured UI `Origin`. It returns `{ "indexRevision": N }` after installing the rebuilt registry. Concurrent refreshes share a pass; index revisions increase on each installed pass, including unchanged passes. `GET /api/projects` includes root summaries/diagnostics and project root associations. Project IDs remain tied to canonical session directories, with compatibility `rootPath`/`relativePath` fields describing the first association.

`GET /api/events` is a same-origin server-sent event stream. A connection event reports the current index revision; invalidations report their reason, monotonically increasing index revision, affected project IDs/revisions/stale states, and removed project IDs. Events are cache-disabled invalidation hints rather than snapshots. The stream sends heartbeats, caps concurrent clients and event bytes, drops backpressured clients, and releases subscriptions on disconnect or server close. Reconnecting clients reload current API state instead of replaying events.

Project summaries include log `sourceState` (`ready`, `missing`, `error`, or `limited`), `stale` (retained log or discovery data), and independent `documentStates` for ideas/prompt. Snapshots add `documents: { ideas, prompt }`, each `{ state: "ready", content: string }` or `{ state: "missing" | "error" | "limited", content: null, message: string }`, plus `logRevision`. Stale logs retain their successful `logRevision`, run IDs, metrics, and segment calculations; the new diagnostic/state describes the attempted log read. `project.revision` hashes that log revision together with current document states/content/messages. Note edits, removals, failures, and recovery change it even while the log is stale; identical reads preserve it. Diff requests for an existing run with an old project revision return 409; rewritten/removed run IDs return 404.

Both apps consume `visualizar-common`; its compiled ESM exports contain only Zod schemas and pure parsing. The API binds to `127.0.0.1`. Production serves the Vite build on that API origin; development proxies `/api` through Vite. `--port` changes the API port and `--ui-origin` sets its permitted exact loopback origin. For custom dev ports, also set `VISUALIZER_API_PORT` for Vite and pass its chosen origin to the API.

For package-level development, build `visualizar-common` first, then use `pnpm --filter visualizar-common dev`, `pnpm --filter visualizer-api dev`, and `pnpm --filter visualizer dev`. Root scripts coordinate these defaults. The shared package must be built before running API tests or either app directly.
