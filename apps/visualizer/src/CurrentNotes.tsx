import Markdown from "react-markdown";
import type { CurrentDocument } from "visualizar-common";

export default function CurrentNotes({
  name,
  document,
  projectName,
}: {
  name: "ideas" | "prompt";
  document: CurrentDocument;
  projectName: string;
}) {
  return (
    <section className="document-card" aria-label="Current project notes">
      <p className="eyebrow">CURRENT PROJECT DOCUMENT · {projectName}</p>
      <h2>{name === "ideas" ? "Current ideas" : "Current prompt"}</h2>
      <p className="document-context">
        These notes reflect the files on disk at the latest refresh and may have
        changed since a recorded experiment.
      </p>
      <p className="document-path mono">.auto/{name}.md</p>
      {document.state === "ready" ? (
        document.content.trim() ? (
          <div className="markdown-document">
            <Markdown skipHtml>{document.content}</Markdown>
          </div>
        ) : (
          <p className="document-message" role="status">
            This current document is empty.
          </p>
        )
      ) : (
        <p className="document-message" role="status">
          {document.message}
        </p>
      )}
    </section>
  );
}
