import { Component, useMemo } from "react";
import type { ReactNode } from "react";
import { Diff, Hunk, Decoration, parseDiff } from "react-diff-view";
import type { ChangedFile } from "visualizar-common";
import "react-diff-view/style/index.css";

function RawFallback({ patch }: { patch: string }) {
  return (
    <>
      <p className="diff-message">
        Split presentation is unavailable for this patch. The complete unified
        patch follows.
      </p>
      <pre className="unified-diff" tabIndex={0} aria-label="Unified patch">
        <code>{patch}</code>
      </pre>
    </>
  );
}
class PatchBoundary extends Component<
  { patch: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <RawFallback patch={this.props.patch} />
    ) : (
      this.props.children
    );
  }
}
function SplitFile({ file }: { file: ChangedFile }) {
  const parsed = useMemo(() => {
    try {
      return parseDiff(file.patch)[0] ?? null;
    } catch {
      return null;
    }
  }, [file.patch]);
  if (!parsed) return <RawFallback patch={file.patch} />;
  if (!parsed.hunks.length)
    return (
      <>
        <p className="diff-message">
          File metadata changed without a text hunk.
        </p>
        <pre className="unified-diff" tabIndex={0}>
          <code>{file.patch}</code>
        </pre>
      </>
    );
  return (
    <div
      className="split-diff"
      role="region"
      aria-label={`Split patch for ${file.path}`}
      tabIndex={0}
    >
      <div className="split-labels">
        <span>Base · before</span>
        <span>Target · after</span>
      </div>
      <Diff viewType="split" diffType={parsed.type} hunks={parsed.hunks}>
        {(hunks) =>
          hunks.flatMap((hunk, index) => [
            <Decoration key={`header-${index}`}>{hunk.content}</Decoration>,
            <Hunk key={index} hunk={hunk} />,
          ])
        }
      </Diff>
    </div>
  );
}
export default function SplitPatch({ files }: { files: ChangedFile[] }) {
  return (
    <div>
      {files.map((file) => (
        <section className="split-file" key={file.path}>
          <h3 className="mono">{file.path}</h3>
          <PatchBoundary key={file.patch} patch={file.patch}>
            <SplitFile file={file} />
          </PatchBoundary>
        </section>
      ))}
    </div>
  );
}
