import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import type { LiveConnection } from "./state";

type DrawerKind = "projects" | "wins";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function connectionLabel(connection: LiveConnection): string {
  return connection === "connected"
    ? "Live updates connected"
    : connection === "disconnected"
      ? "Live updates disconnected"
      : connection === "manual"
        ? "Manual updates"
        : "Connecting live updates";
}

function Drawer({
  kind,
  id,
  label,
  closeLabel,
  onClose,
  trigger,
  children,
}: {
  kind: DrawerKind;
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
        data-testid={`${kind}-drawer-backdrop`}
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        className={`drawer-panel drawer-${kind}`}
        id={id}
        data-testid={`${kind}-drawer`}
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
  projectsCount,
  winsCount,
  connection,
  renderProjects,
  renderWins,
}: {
  projectsCount: number;
  winsCount: number;
  connection: LiveConnection;
  renderProjects: (close: () => void) => ReactNode;
  renderWins: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState<DrawerKind | null>(null);
  const projectsTrigger = useRef<HTMLButtonElement | null>(null);
  const winsTrigger = useRef<HTMLButtonElement | null>(null);
  const close = useCallback(() => setOpen(null), []);
  return (
    <>
      <header className="compact-bar">
        <p className="compact-status" role="status">
          <span
            className={`source-dot source-dot-${connection}`}
            aria-hidden="true"
          />
          {connectionLabel(connection)}
        </p>
        <nav className="compact-controls" aria-label="Session navigation">
          <button
            type="button"
            ref={projectsTrigger}
            aria-expanded={open === "projects"}
            aria-controls={
              open === "projects" ? "compact-projects-drawer" : undefined
            }
            onClick={() => setOpen(open === "projects" ? null : "projects")}
          >
            Projects <span className="compact-count">{projectsCount}</span>
          </button>
          <button
            type="button"
            ref={winsTrigger}
            aria-expanded={open === "wins"}
            aria-controls={open === "wins" ? "compact-wins-drawer" : undefined}
            onClick={() => setOpen(open === "wins" ? null : "wins")}
          >
            Wins <span className="compact-count">{winsCount}</span>
          </button>
        </nav>
      </header>
      {open === "projects" ? (
        <Drawer
          kind="projects"
          id="compact-projects-drawer"
          label="Projects"
          closeLabel="Close projects"
          onClose={close}
          trigger={projectsTrigger}
        >
          {renderProjects(close)}
        </Drawer>
      ) : null}
      {open === "wins" ? (
        <Drawer
          kind="wins"
          id="compact-wins-drawer"
          label="Wins"
          closeLabel="Close wins"
          onClose={close}
          trigger={winsTrigger}
        >
          {renderWins(close)}
        </Drawer>
      ) : null}
    </>
  );
}
