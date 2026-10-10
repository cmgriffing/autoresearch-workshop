import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { useAtomValue } from "jotai";
import {
  attemptCountsAtom,
  liveConnectionAtom,
  projectListAtom,
  selectedProjectIdAtom,
} from "./state";
import { projectStateLabel } from "./ProjectSelector";
import { connectionLabel } from "./Rail";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function Drawer({
  id,
  label,
  closeLabel,
  onClose,
  trigger,
  children,
}: {
  id: string;
  label: string;
  closeLabel: string;
  onClose: () => void;
  trigger: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = panel.current;
    if (!node) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => element.getClientRects().length > 0,
      );
    const initial = focusable()[0];
    if (initial) initial.focus();
    else node.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        node.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === node)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    node.addEventListener("keydown", handleKeyDown);
    return () => {
      node.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      const target = trigger.current;
      if (target?.isConnected) target.focus();
    };
  }, [onClose, trigger]);
  return (
    <>
      <div
        className="drawer-backdrop"
        data-testid="session-drawer-backdrop"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        className="drawer-panel"
        id={id}
        data-testid="session-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        ref={panel}
        tabIndex={-1}
      >
        <div className="drawer-header">
          <h2>{label}</h2>
          <button
            type="button"
            className="drawer-close"
            aria-label={closeLabel}
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="drawer-content">{children}</div>
      </div>
    </>
  );
}

export default function CompactNavigation({
  renderRail,
}: {
  renderRail: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const connection = useAtomValue(liveConnectionAtom);
  const list = useAtomValue(projectListAtom);
  const selectedId = useAtomValue(selectedProjectIdAtom);
  const counts = useAtomValue(attemptCountsAtom);
  const project = list?.projects.find((value) => value.id === selectedId);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <header className="compact-bar">
        <div className="compact-identity">
          <p className="compact-project">
            {project ? project.name : "No project selected"}
          </p>
          <p className="compact-status" role="status">
            <span
              className={`source-dot source-dot-${connection}`}
              aria-hidden="true"
            />
            {connectionLabel(connection)}
          </p>
          {project && (project.stale || project.sourceState !== "ready") ? (
            <p className="compact-source">{projectStateLabel(project)}</p>
          ) : null}
        </div>
        <button
          type="button"
          className="compact-trigger"
          ref={trigger}
          aria-expanded={open}
          aria-controls={open ? "compact-session-drawer" : undefined}
          onClick={() => setOpen((value) => !value)}
        >
          Session <span className="compact-count">{counts.all}</span>
        </button>
      </header>
      {open ? (
        <Drawer
          id="compact-session-drawer"
          label="Session"
          closeLabel="Close session"
          onClose={close}
          trigger={trigger}
        >
          {renderRail(close)}
        </Drawer>
      ) : null}
    </>
  );
}
