// PROTOTYPE — throwaway. Three structurally different answers to:
// "What is the smallest coherent capture → Inbox triage → Current work → review interface?"
//
//   A — Topbar capture + Current work as its own page (Inbox triage on the Inbox board)
//   B — Home page: capture bar, Inbox triage list and Current work on one landing page
//   C — Left rail: capture palette, keyboard triage mode, Current work as a side drawer

import { useEffect, useRef, useState } from 'react';
import {
  archiveTask,
  boardTasks,
  fileTask,
  inboxOf,
  orderedProjects,
  useCapture,
  useCurrentWork,
  useStore,
  useTaskAction,
  type Task,
} from './store.js';
import {
  ActionError,
  CaptureForm,
  CurrentWorkList,
  MoveTo,
  ProjectName,
  SearchButton,
  StateSelect,
  StubBoard,
  StubEditor,
  StubSearch,
  Topbar,
  useProtoShortcuts,
} from './parts.js';

type Route =
  | { kind: 'current' }
  | { kind: 'home' }
  | { kind: 'triage' }
  | { kind: 'board'; projectId: string }
  | { kind: 'task'; taskId: string; back: Route };

function backLabel(r: Route): string {
  switch (r.kind) {
    case 'board':
      return 'Back to board';
    case 'current':
      return 'Back to Current work';
    case 'home':
      return 'Back to Home';
    case 'triage':
      return 'Back to Inbox triage';
    default:
      return 'Back';
  }
}

/** Inline "Add task" at the top of To do: captures straight into this project. */
function BoardAddTask({
  projectId,
  onOpenTask,
}: {
  projectId: string;
  onOpenTask: (t: Task) => void;
}): JSX.Element {
  const cap = useCapture(projectId);
  return (
    <div className="proto-board-add">
      <CaptureForm cap={cap} onOpenTask={onOpenTask} placeholder="Add task…" hideDest />
    </div>
  );
}

function ProjectPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}): JSX.Element {
  const s = useStore();
  return (
    <select
      className="proto-select"
      aria-label="Project"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="" disabled>
        Choose project…
      </option>
      {orderedProjects(s).map((p) => (
        <option key={p.id} value={p.id}>
          {p.inbox ? '⌂ ' : ''}
          {p.name}
          {p.readOnly ? ' (read-only)' : ''}
        </option>
      ))}
    </select>
  );
}

// ======================================================================= A

export function VariantA(): JSX.Element {
  const s = useStore();
  const [route, setRoute] = useState<Route>({ kind: 'current' });
  const [captureOpen, setCaptureOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const boardProject = route.kind === 'board' ? route.projectId : null;
  // Global capture → Inbox; on a (non-Inbox) board → that project.
  const local = boardProject ? s.projects.find((p) => p.id === boardProject) : undefined;
  const cap = useCapture(local && !local.inbox && !local.readOnly ? local.id : null);
  const openTask = (t: Task): void => setRoute({ kind: 'task', taskId: t.id, back: route });
  useProtoShortcuts(
    () => setCaptureOpen(true),
    () => setSearchOpen((o) => !o),
  );
  const inbox = inboxOf(s);
  const inboxCount = inbox ? boardTasks(s, inbox.id).length : 0;

  return (
    <div className="app-shell">
      <Topbar>
        <ProjectPicker
          value={boardProject ?? ''}
          onChange={(id) => setRoute({ kind: 'board', projectId: id })}
        />
        <button
          type="button"
          className={`btn topbar-action${route.kind === 'current' ? ' topbar-action--active' : ''}`}
          onClick={() => setRoute({ kind: 'current' })}
        >
          Current work
        </button>
        {inbox && (
          <button
            type="button"
            className="btn topbar-action"
            onClick={() => setRoute({ kind: 'board', projectId: inbox.id })}
          >
            ⌂ Inbox <span className="proto-count">{inboxCount}</span>
          </button>
        )}
        <span className="topbar-spacer" />
        <button
          type="button"
          className="btn"
          onClick={() => setCaptureOpen((o) => !o)}
          title="Capture (n)"
        >
          + Capture <kbd>n</kbd>
        </button>
        <SearchButton onClick={() => setSearchOpen(true)} />
      </Topbar>
      {captureOpen && (
        <div className="proto-popover" role="dialog" aria-label="Quick capture">
          <CaptureForm
            cap={cap}
            autoFocus
            onOpenTask={(t) => {
              setCaptureOpen(false);
              openTask(t);
            }}
            onCancel={() => {
              setCaptureOpen(false);
              cap.clearCreated();
            }}
          />
          <p className="muted proto-small">Esc closes · stays open for the next task</p>
        </div>
      )}
      <main className="content proto-main">
        {route.kind === 'current' && (
          <CurrentPage
            onOpenTask={openTask}
            onGoToBoard={(id) => setRoute({ kind: 'board', projectId: id })}
          />
        )}
        {route.kind === 'board' && (
          <StubBoard
            projectId={route.projectId}
            onOpenTask={openTask}
            addTask={<BoardAddTask projectId={route.projectId} onOpenTask={openTask} />}
          />
        )}
        {route.kind === 'task' && (
          <StubEditor
            taskId={route.taskId}
            onBack={() => setRoute(route.back)}
            backLabel={backLabel(route.back)}
          />
        )}
      </main>
      <StubSearch open={searchOpen} onClose={() => setSearchOpen(false)} onOpenTask={openTask} />
    </div>
  );
}

function CurrentPage({
  onOpenTask,
  onGoToBoard,
}: {
  onOpenTask: (t: Task) => void;
  onGoToBoard: (id: string) => void;
}): JSX.Element {
  const cw = useCurrentWork();
  return (
    <div className="proto-page">
      <CurrentWorkList {...cw} onOpenTask={onOpenTask} onGoToBoard={onGoToBoard} />
    </div>
  );
}

// ======================================================================= B

export function VariantB(): JSX.Element {
  const s = useStore();
  const [route, setRoute] = useState<Route>({ kind: 'home' });
  const [searchOpen, setSearchOpen] = useState(false);
  const captureRef = useRef<HTMLInputElement>(null);
  const cap = useCapture(null);
  const openTask = (t: Task): void => setRoute({ kind: 'task', taskId: t.id, back: route });
  useProtoShortcuts(
    () => {
      if (route.kind !== 'home') setRoute({ kind: 'home' });
      setTimeout(() => captureRef.current?.focus(), 0);
    },
    () => setSearchOpen((o) => !o),
  );
  const boardProject = route.kind === 'board' ? route.projectId : '';

  return (
    <div className="app-shell">
      <Topbar>
        <button
          type="button"
          className={`btn topbar-action${route.kind === 'home' ? ' topbar-action--active' : ''}`}
          onClick={() => setRoute({ kind: 'home' })}
        >
          Home
        </button>
        <ProjectPicker
          value={boardProject}
          onChange={(id) => setRoute({ kind: 'board', projectId: id })}
        />
        <span className="topbar-spacer" />
        <SearchButton onClick={() => setSearchOpen(true)} />
      </Topbar>
      <main className="content proto-main">
        {route.kind === 'home' && (
          <div className="proto-page proto-home">
            <CaptureForm
              cap={cap}
              inputRef={captureRef}
              autoFocus
              big
              onOpenTask={openTask}
              placeholder="What needs doing? (n to focus, Enter to add)"
            />
            <div className="proto-home-grid">
              <InboxTriageList onOpenTask={openTask} />
              <HomeCurrent
                onOpenTask={openTask}
                onGoToBoard={(id) => setRoute({ kind: 'board', projectId: id })}
              />
            </div>
            <p className="muted proto-small">
              {s.projects.length} projects · nothing else lives on Home (no widgets, planner or
              weather).
            </p>
          </div>
        )}
        {route.kind === 'board' && (
          <StubBoard
            projectId={route.projectId}
            onOpenTask={openTask}
            addTask={<BoardAddTask projectId={route.projectId} onOpenTask={openTask} />}
          />
        )}
        {route.kind === 'task' && (
          <StubEditor
            taskId={route.taskId}
            onBack={() => setRoute(route.back)}
            backLabel={backLabel(route.back)}
          />
        )}
      </main>
      <StubSearch open={searchOpen} onClose={() => setSearchOpen(false)} onOpenTask={openTask} />
    </div>
  );
}

function HomeCurrent(props: {
  onOpenTask: (t: Task) => void;
  onGoToBoard: (id: string) => void;
}): JSX.Element {
  const cw = useCurrentWork();
  return <CurrentWorkList {...cw} {...props} dense />;
}

function InboxTriageList({ onOpenTask }: { onOpenTask: (t: Task) => void }): JSX.Element {
  const s = useStore();
  const action = useTaskAction();
  const inbox = inboxOf(s);
  const items = inbox ? boardTasks(s, inbox.id) : [];
  return (
    <section className="proto-current proto-current--dense" aria-label="Inbox">
      <div className="proto-section-head">
        <h2>⌂ Inbox</h2>
        <span className="board-column-count">{items.length}</span>
      </div>
      <ActionError action={action} />
      {items.length === 0 && (
        <p className="status-message status-message--empty">
          {inbox ? 'Inbox is clear.' : 'No Inbox yet — your first capture creates it.'}
        </p>
      )}
      <ul className="proto-rows">
        {items.map((t) => {
          const busy = action.busy.has(t.id);
          return (
            <li key={t.id} className={`proto-row${busy ? ' saving' : ''}`}>
              <button type="button" className="board-card-title" onClick={() => onOpenTask(t)}>
                {t.title}
              </button>
              {t.task_state !== 'todo' && (
                <span className="board-badge board-badge--muted">
                  {t.task_state.replace('_', ' ')}
                </span>
              )}
              <MoveTo task={t} run={action.run} busy={busy} />
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                disabled={busy}
                onClick={() => void action.run(t.id, () => archiveTask(t.id, t.revision))}
              >
                Archive
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ======================================================================= C

export function VariantC(): JSX.Element {
  const s = useStore();
  const [route, setRoute] = useState<Route>({ kind: 'board', projectId: 'backlogger' });
  const [captureOpen, setCaptureOpen] = useState(false);
  const [drawer, setDrawer] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const cap = useCapture(null);
  const openTask = (t: Task): void =>
    setRoute({ kind: 'task', taskId: t.id, back: route.kind === 'task' ? route.back : route });
  useProtoShortcuts(
    () => setCaptureOpen(true),
    () => setSearchOpen((o) => !o),
  );
  const inbox = inboxOf(s);
  const inboxCount = inbox ? boardTasks(s, inbox.id).length : 0;
  const current = route.kind === 'board' ? route.projectId : null;

  return (
    <div className="app-shell">
      <Topbar>
        <span className="topbar-spacer" />
        <button
          type="button"
          className={`btn topbar-action${drawer ? ' topbar-action--active' : ''}`}
          onClick={() => setDrawer((d) => !d)}
        >
          Current work ▸
        </button>
        <SearchButton onClick={() => setSearchOpen(true)} />
      </Topbar>
      <main className="content proto-c">
        <nav className="proto-rail" aria-label="Workspace">
          <button
            type="button"
            className="btn proto-rail-capture"
            onClick={() => setCaptureOpen(true)}
            title="Capture (n)"
          >
            + Capture <kbd>n</kbd>
          </button>
          <button
            type="button"
            className={`proto-rail-item${route.kind === 'triage' ? ' active' : ''}`}
            onClick={() => setRoute({ kind: 'triage' })}
          >
            ⌂ Inbox <span className="proto-count">{inboxCount}</span>
          </button>
          <div className="proto-rail-label">Projects</div>
          {orderedProjects(s)
            .filter((p) => !p.inbox)
            .map((p) => (
              <button
                key={p.id}
                type="button"
                className={`proto-rail-item${current === p.id ? ' active' : ''}`}
                onClick={() => setRoute({ kind: 'board', projectId: p.id })}
              >
                <ProjectName id={p.id} />
              </button>
            ))}
        </nav>
        <div className="proto-c-main">
          {route.kind === 'triage' && <TriageMode onOpenTask={openTask} />}
          {route.kind === 'board' && (
            <StubBoard
              projectId={route.projectId}
              onOpenTask={openTask}
              addTask={<BoardAddTask projectId={route.projectId} onOpenTask={openTask} />}
            />
          )}
          {route.kind === 'task' && (
            <StubEditor
              taskId={route.taskId}
              onBack={() => setRoute(route.back)}
              backLabel={backLabel(route.back)}
            />
          )}
        </div>
        {drawer && (
          <aside className="proto-drawer">
            <DrawerCurrent
              onOpenTask={openTask}
              onGoToBoard={(id) => setRoute({ kind: 'board', projectId: id })}
            />
          </aside>
        )}
      </main>
      {captureOpen && (
        <div className="command-palette-backdrop" onClick={() => setCaptureOpen(false)}>
          <div
            className="command-palette proto-capture-palette"
            role="dialog"
            aria-label="Quick capture"
            onClick={(e) => e.stopPropagation()}
          >
            <CaptureForm
              cap={cap}
              autoFocus
              big
              onOpenTask={(t) => {
                setCaptureOpen(false);
                openTask(t);
              }}
              onCancel={() => {
                setCaptureOpen(false);
                cap.clearCreated();
              }}
            />
            <div className="command-palette-footer">
              Enter add · Esc close · stays open for the next task
            </div>
          </div>
        </div>
      )}
      <StubSearch open={searchOpen} onClose={() => setSearchOpen(false)} onOpenTask={openTask} />
    </div>
  );
}

function DrawerCurrent(props: {
  onOpenTask: (t: Task) => void;
  onGoToBoard: (id: string) => void;
}): JSX.Element {
  const cw = useCurrentWork();
  return <CurrentWorkList {...cw} {...props} dense />;
}

/** One Inbox item at a time; number keys file it, s skips, a archives, o opens. */
function TriageMode({ onOpenTask }: { onOpenTask: (t: Task) => void }): JSX.Element {
  const s = useStore();
  const action = useTaskAction();
  const inbox = inboxOf(s);
  const items = inbox ? boardTasks(s, inbox.id) : [];
  const [skip, setSkip] = useState(0);
  const item = items.length ? items[skip % items.length] : undefined;
  const targets = orderedProjects(s)
    .filter((p) => !p.readOnly && !p.inbox)
    .slice(0, 9);
  const busy = item ? action.busy.has(item.id) : false;

  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement;
      if (
        !item ||
        busy ||
        t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT'
      )
        return;
      const n = Number(e.key);
      if (n >= 1 && n <= targets.length)
        void action.run(item.id, () => fileTask(item.id, item.revision, targets[n - 1]!.id));
      else if (e.key === 's') setSkip((k) => k + 1);
      else if (e.key === 'a') void action.run(item.id, () => archiveTask(item.id, item.revision));
      else if (e.key === 'o') onOpenTask(item);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  return (
    <div className="proto-page proto-triage">
      <div className="proto-section-head">
        <h2>⌂ Inbox triage</h2>
        <span className="board-column-count">{items.length} left</span>
      </div>
      <ActionError action={action} />
      {!item && (
        <p className="status-message status-message--empty">
          {inbox
            ? 'Inbox is clear. Press n to capture.'
            : 'No Inbox yet — your first capture creates it.'}
        </p>
      )}
      {item && (
        <div className={`proto-triage-card${busy ? ' saving' : ''}`}>
          <h3>{item.title}</h3>
          <p className="muted proto-small">
            {item.status} · <StateSelect task={item} run={action.run} busy={busy} /> · id{' '}
            <code>{item.id}</code>
          </p>
          <p className="proto-small">{item.body || <span className="muted">No details.</span>}</p>
          <div className="proto-triage-targets">
            {targets.map((p, i) => (
              <button
                key={p.id}
                type="button"
                className="btn"
                disabled={busy}
                onClick={() =>
                  void action.run(item.id, () => fileTask(item.id, item.revision, p.id))
                }
              >
                <kbd>{i + 1}</kbd> {p.name}
              </button>
            ))}
          </div>
          <div className="proto-triage-targets">
            <button type="button" className="btn btn--ghost" onClick={() => setSkip((k) => k + 1)}>
              <kbd>s</kbd> Keep in Inbox
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => onOpenTask(item)}>
              <kbd>o</kbd> Open
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => void action.run(item.id, () => archiveTask(item.id, item.revision))}
            >
              <kbd>a</kbd> Archive
            </button>
          </div>
          {busy && (
            <p className="muted proto-small">
              Moving… the task stays in Inbox until the move is saved.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export const VARIANTS = [
  { key: 'A', name: 'Topbar capture + Current work page', Component: VariantA },
  { key: 'B', name: 'Home page: capture, Inbox, Current work', Component: VariantB },
  { key: 'C', name: 'Rail + triage mode + Current work drawer', Component: VariantC },
] as const;
