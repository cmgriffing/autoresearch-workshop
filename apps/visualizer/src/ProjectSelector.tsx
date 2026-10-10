import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import type { ProjectSummary, RootSummary } from "visualizar-common";
import {
  projectListAtom,
  projectListErrorAtom,
  selectedProjectIdAtom,
  selectProjectAtom,
} from "./state";

const PAGE_SIZE = 5;
const LISTBOX_ID = "project-selector-listbox";
const optionId = (index: number) => `project-option-${index}`;

interface SelectorOption {
  project: ProjectSummary;
  relativePath: string;
  root: RootSummary;
}
interface RootGroup {
  root: RootSummary;
  items: SelectorOption[];
}

export function projectStateLabel(project: ProjectSummary): string {
  if (project.stale) return `${project.runCount} experiments · Stale data`;
  switch (project.sourceState) {
    case "missing":
      return "Uninitialized session";
    case "limited":
      return "Log exceeds size limit";
    case "error":
      return "Log unavailable";
    default:
      return `${project.runCount} experiments`;
  }
}

function buildGroups(
  roots: RootSummary[],
  projects: ProjectSummary[],
  query: string,
): RootGroup[] {
  const needle = query.toLowerCase();
  const groups = roots.map((root) => ({
    root,
    items: projects.flatMap((project) => {
      const association = project.rootAssociations.find(
        (value) => value.rootId === root.id,
      );
      if (!association) return [];
      if (
        query &&
        !`${project.name} ${association.relativePath} ${root.path}`
          .toLowerCase()
          .includes(needle)
      )
        return [];
      return [{ project, relativePath: association.relativePath, root }];
    }),
  }));
  return query ? groups.filter((group) => group.items.length > 0) : groups;
}

function optionLabel(option: SelectorOption): string {
  return `${option.project.name} · ${option.relativePath} · ${option.root.path}`;
}

function OptionState({ project }: { project: ProjectSummary }) {
  return (
    <small
      className={
        project.stale
          ? "selector-state selector-state-stale"
          : project.sourceState === "missing"
            ? "selector-state selector-state-missing"
            : project.sourceState === "limited" ||
                project.sourceState === "error"
              ? "selector-state selector-state-unavailable"
              : "selector-state"
      }
    >
      {projectStateLabel(project)}
    </small>
  );
}

export default function ProjectSelector({
  onNavigate,
}: {
  onNavigate?: () => void;
}) {
  const list = useAtomValue(projectListAtom);
  const listError = useAtomValue(projectListErrorAtom);
  const selectedId = useAtomValue(selectedProjectIdAtom);
  const selectProject = useSetAtom(selectProjectAtom);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const queryTimer = useRef<number | null>(null);
  const groups = useMemo(
    () => buildGroups(list?.roots ?? [], list?.projects ?? [], query),
    [list, query],
  );
  const options = useMemo(
    () => groups.flatMap((group) => group.items),
    [groups],
  );
  const allOptions = useMemo(
    () =>
      buildGroups(list?.roots ?? [], list?.projects ?? [], "").flatMap(
        (group) => group.items,
      ),
    [list],
  );
  const selected = allOptions.find(
    (option) => option.project.id === selectedId,
  );
  const active = Math.min(activeIndex, Math.max(0, options.length - 1));
  useEffect(
    () => () => {
      if (queryTimer.current !== null) window.clearTimeout(queryTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (!open) return;
    const handle = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", handle);
    return () => document.removeEventListener("pointerdown", handle);
  }, [open]);
  useEffect(() => {
    if (!open || options.length === 0) return;
    document
      .getElementById(optionId(active))
      ?.scrollIntoView({ block: "nearest" });
  }, [open, active, options.length]);
  const openList = (initial?: number) => {
    const selectedIndex = allOptions.findIndex(
      (option) => option.project.id === selectedId,
    );
    setOpen(true);
    setQuery("");
    setActiveIndex(initial ?? (selectedIndex >= 0 ? selectedIndex : 0));
  };
  const closeList = () => {
    setOpen(false);
    setQuery("");
    if (queryTimer.current !== null) {
      window.clearTimeout(queryTimer.current);
      queryTimer.current = null;
    }
  };
  const choose = (option: SelectorOption) => {
    selectProject(option.project.id);
    closeList();
    triggerRef.current?.focus();
    onNavigate?.();
  };
  const move = (next: number) => {
    if (options.length === 0) return;
    setActiveIndex(((next % options.length) + options.length) % options.length);
  };
  const typeAhead = (key: string) => {
    const next = query + key;
    setQuery(next);
    setActiveIndex(0);
    if (queryTimer.current !== null) window.clearTimeout(queryTimer.current);
    queryTimer.current = window.setTimeout(() => {
      setQuery("");
      queryTimer.current = null;
    }, 800);
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        closeList();
      }
      return;
    }
    if (event.key === "Tab") {
      if (open) closeList();
      return;
    }
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        openList(event.key === "ArrowUp" ? options.length - 1 : 0);
      }
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(active + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(active - 1);
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(Math.max(0, options.length - 1));
        break;
      case "PageDown":
        event.preventDefault();
        move(active + PAGE_SIZE);
        break;
      case "PageUp":
        event.preventDefault();
        move(active - PAGE_SIZE);
        break;
      case "Enter":
        event.preventDefault();
        if (options[active]) choose(options[active]);
        break;
      default:
        if (
          event.key.length === 1 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey
        )
          typeAhead(event.key);
    }
  };
  return (
    <div className="selector" ref={rootRef}>
      <span className="selector-label" id="project-selector-label">
        Project
      </span>
      <button
        type="button"
        className="selector-trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? LISTBOX_ID : undefined}
        aria-labelledby="project-selector-label project-selector-value"
        aria-activedescendant={
          open && options.length > 0 ? optionId(active) : undefined
        }
        ref={triggerRef}
        onClick={() => (open ? closeList() : openList())}
        onKeyDown={onKeyDown}
      >
        <span className="selector-value" id="project-selector-value">
          {selected ? selected.project.name : "Select a project"}
        </span>
        <span className="selector-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div
          className="selector-popup"
          id={LISTBOX_ID}
          role="listbox"
          aria-label="Projects"
        >
          {groups.map((group: RootGroup) => (
            <div
              role="group"
              aria-label={`Root ${group.root.path}`}
              key={group.root.id}
            >
              <div className="selector-root" role="presentation">
                <span className="selector-root-path">{group.root.path}</span>
                <span className="selector-root-mode">
                  {group.root.recursive ? "Recursive" : "Direct root"}
                </span>
              </div>
              {group.items.map((option: SelectorOption) => {
                const index = options.indexOf(option);
                return (
                  <div
                    role="option"
                    id={optionId(index)}
                    aria-label={optionLabel(option)}
                    aria-selected={option.project.id === selectedId}
                    className={
                      index === active
                        ? "selector-option selector-option-active"
                        : "selector-option"
                    }
                    key={`${option.project.id}:${group.root.id}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(option)}
                  >
                    <span className="selector-option-main">
                      <strong>{option.project.name}</strong>
                      <small className="selector-path mono">
                        {option.relativePath}
                      </small>
                    </span>
                    <OptionState project={option.project} />
                  </div>
                );
              })}
              {group.root.state === "available" && group.items.length === 0 ? (
                <p className="selector-empty-root" role="status">
                  No sessions found in this root.
                </p>
              ) : null}
              {group.root.diagnostics.map((diagnostic, index) => (
                <p
                  className="pane-message root-diagnostic"
                  role="status"
                  key={index}
                >
                  {diagnostic.message}
                </p>
              ))}
            </div>
          ))}
          {!list ? (
            <p className="selector-empty" role="status">
              Loading projects…
            </p>
          ) : !query && options.length === 0 ? (
            <p className="selector-empty" role="status">
              No projects discovered. Check the configured roots and refresh.
            </p>
          ) : null}
          {query && options.length === 0 ? (
            <p className="selector-empty" role="status">
              No projects match “{query}”.
            </p>
          ) : null}
        </div>
      ) : null}
      {listError ? (
        <p role="alert" className="pane-message">
          {listError}
        </p>
      ) : null}
    </div>
  );
}

export function ProjectMetadata() {
  const list = useAtomValue(projectListAtom);
  const selectedId = useAtomValue(selectedProjectIdAtom);
  const project = list?.projects.find((value) => value.id === selectedId);
  if (!project)
    return (
      <div className="project-meta">
        <p className="project-meta-empty" role="status">
          {list && list.projects.length === 0
            ? "No projects found. Configure roots containing .auto sessions, then refresh projects."
            : "No project selected. Choose one from the project selector."}
        </p>
      </div>
    );
  return (
    <div className="project-meta">
      <p className="project-meta-name">{project.name}</p>
      <dl className="project-meta-facts">
        <div>
          <dt>Root</dt>
          <dd className="mono">{project.rootPath}</dd>
        </div>
        <div>
          <dt>Session</dt>
          <dd className="mono">{project.relativePath}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{projectStateLabel(project)}</dd>
        </div>
      </dl>
    </div>
  );
}
