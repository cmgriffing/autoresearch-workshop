import { lazy, Suspense } from "react";
import { useAtom } from "jotai";
import type { DiffLoadState } from "./state";
import {
  diffComparisonAtom,
  diffPresentationAtom,
  includeAutoAtom,
  selectedDiffFileAtom,
} from "./state";

const SplitPatch = lazy(() => import("./SplitPatch"));

export default function DiffPanel({ diff }: { diff: DiffLoadState | null }) {
  const [comparison, setComparison] = useAtom(diffComparisonAtom);
  const [includeAuto, setIncludeAuto] = useAtom(includeAutoAtom);
  const [presentation, setPresentation] = useAtom(diffPresentationAtom);
  const [selection, setSelection] = useAtom(selectedDiffFileAtom);
  const value = diff?.status === "loaded" ? diff.value : null;
  const files = value && "files" in value ? value.files : [];
  const selectedPath =
    selection &&
    selection.key === diff?.key &&
    files.some((file) => file.path === selection.path)
      ? selection.path
      : null;
  const visibleFiles = selectedPath
    ? files.filter((file) => file.path === selectedPath)
    : files;
  const patch = visibleFiles.map((file) => file.patch).join("");
  const textFiles = visibleFiles.filter((file) => !file.binary);
  return (
    <section
      className="diff-card"
      aria-label="Historical diff"
      aria-busy={!diff || diff.status === "loading"}
    >
      <div className="diff-heading">
        <h2>{comparison === "parent" ? "Parent diff" : "Baseline diff"}</h2>
        {value ? (
          <span className={`diff-state diff-state-${value.state}`}>
            {value.state}
          </span>
        ) : null}
      </div>
      <div className="diff-controls">
        <label>
          Compare against
          <select
            aria-label="Diff comparison"
            value={comparison}
            onChange={(event) =>
              setComparison(event.target.value as "parent" | "baseline")
            }
          >
            <option value="parent">First parent (empty tree for root)</option>
            <option value="baseline">First kept baseline</option>
          </select>
        </label>
        <label className="artifact-control">
          <input
            type="checkbox"
            checked={includeAuto}
            onChange={(event) => setIncludeAuto(event.target.checked)}
          />
          Include .auto session artifacts
        </label>
        <label>
          Presentation
          <select
            aria-label="Diff presentation"
            value={presentation}
            onChange={(event) =>
              setPresentation(event.target.value as "unified" | "split")
            }
          >
            <option value="unified">Unified</option>
            <option value="split">Split</option>
          </select>
        </label>
      </div>
      <p className="diff-semantics">
        {comparison === "parent"
          ? "Git compares the recorded commit with its first parent."
          : "Git compares the recorded commit with this segment’s first kept commit."}{" "}
        Metric improvement uses the preceding best measurement separately.
      </p>
      {!diff || diff.status === "loading" ? (
        <p role="status">Loading the recorded commit comparison…</p>
      ) : diff.status === "error" ? (
        <p className="diff-message diff-error" role="alert">
          {diff.message}
        </p>
      ) : value ? (
        <>
          {value.base || value.target ? (
            <dl className="diff-references">
              <div>
                <dt>Base</dt>
                <dd className="mono">
                  {value.base
                    ? `${value.base.kind === "empty-tree" ? "Empty tree · " : ""}${value.base.oid}`
                    : "Unavailable"}
                </dd>
              </div>
              <div>
                <dt>Target</dt>
                <dd className="mono">{value.target?.oid ?? "Unavailable"}</dd>
              </div>
            </dl>
          ) : null}
          {value.targetParentCount !== undefined &&
          value.targetParentCount > 1 ? (
            <p className="diff-message">
              Merge commit · {value.targetParentCount} parents. Parent mode uses
              the first parent.
            </p>
          ) : null}
          {value.gitDirectoryKind === "file" ? (
            <p className="diff-semantics">
              Git worktree resolved through a .git file.
            </p>
          ) : null}
          {"message" in value ? (
            <p
              className={`diff-message ${value.state === "failure" ? "diff-error" : ""}`}
              role="status"
            >
              {value.message}
            </p>
          ) : null}
          {files.length ? (
            <>
              <nav className="changed-files" aria-label="Changed files">
                <button
                  aria-pressed={!selectedPath}
                  onClick={() => setSelection(null)}
                >
                  All changed files · {files.length}
                </button>
                {files.map((file) => (
                  <button
                    key={file.path}
                    aria-label={`View file ${file.path}`}
                    aria-pressed={selectedPath === file.path}
                    onClick={() =>
                      setSelection({ key: diff!.key, path: file.path })
                    }
                  >
                    <span className="mono">
                      {file.oldPath ? `${file.oldPath} → ` : ""}
                      {file.path}
                    </span>
                    <span>
                      {file.status} ·{" "}
                      {file.binary
                        ? "Binary"
                        : `+${file.additions} −${file.deletions}`}
                    </span>
                  </button>
                ))}
              </nav>
              {visibleFiles
                .filter((file) => file.binary)
                .map((file) => (
                  <p className="diff-message" role="status" key={file.path}>
                    Binary file: <span className="mono">{file.path}</span>. Text
                    content is unavailable.
                  </p>
                ))}
              {textFiles.length ? (
                presentation === "unified" ? (
                  <pre
                    className="unified-diff"
                    tabIndex={0}
                    aria-label="Unified patch"
                  >
                    <code>{patch}</code>
                  </pre>
                ) : (
                  <Suspense
                    fallback={<p role="status">Loading split presentation…</p>}
                  >
                    <SplitPatch files={textFiles} />
                  </Suspense>
                )
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
