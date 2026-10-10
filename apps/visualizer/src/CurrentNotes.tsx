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
      <h2>{name === "ideas" ? "Current ideas" : "Current prompt"}</h2>
      <p className="document-context">
        Current {name === "ideas" ? "ideas" : "prompt"} for {projectName}. These
        reflect the files on disk at the latest refresh and may have changed
        since a recorded experiment.
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
