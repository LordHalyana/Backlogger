// PROTOTYPE — throwaway. Building blocks the three variants arrange differently.
// Stand-ins (board, editor, search) mimic the existing components' look only.

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Icon } from '../../components/Icon.js';
import {
  archiveTask,
  boardTasks,
  fileTask,
  inboxOf,
  isReadOnly,
  orderedProjects,
  projectOf,
  setTaskState,
  editBody,
  useStore,
  useTaskAction,
  type CurrentGroup,
  type Task,
  type TaskState,
  type useCapture,
} from './store.js';

export const STATE_LABEL: Record<TaskState, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
};

export function Topbar({ children }: { children: ReactNode }): JSX.Element {
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <Icon name="book" className="topbar-logo" />
        <h1>Backlogger</h1>
      </div>
      <span className="topbar-divider" aria-hidden="true" />
      {children}
    </header>
  );
}

export function SearchButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className="btn topbar-action search-button"
      onClick={onClick}
      title="Search (Ctrl/Cmd+K)"
    >
      <Icon name="search" />
      <span>Search</span>
      <kbd>Ctrl+K</kbd>
    </button>
  );
}

/** A project's display name; the designated Inbox is marked so a same-named project is distinguishable. */
export function ProjectName({ id }: { id: string }): JSX.Element {
  const s = useStore();
  const p = projectOf(s, id);
  if (!p) return <span className="muted">(gone)</span>;
  return (
    <span className="proto-project-name">
      {p.inbox && (
        <span className="proto-inbox-mark" title="Designated Inbox">
          ⌂
        </span>
      )}
      {p.name}
      {p.readOnly && <Icon name="lock" className="proto-lock" />}
    </span>
  );
}

// ------------------------------------------------------------------ capture

type Capture = ReturnType<typeof useCapture>;

export function CaptureForm({
  cap,
  inputRef,
  autoFocus,
  onOpenTask,
  onCancel,
  placeholder = 'Capture a task… (Enter to add)',
  big,
  hideDest,
}: {
  cap: Capture;
  /** Board-local Add task: the destination is the board's project. */
  hideDest?: boolean;
  inputRef?: RefObject<HTMLInputElement>;
  autoFocus?: boolean;
  onOpenTask: (task: Task) => void;
  onCancel?: () => void;
  placeholder?: string;
  big?: boolean;
}): JSX.Element {
  const s = useStore();
  const writable = orderedProjects(s).filter((p) => !p.readOnly);
  const inbox = inboxOf(s);
  return (
    <form
      className={`proto-capture${big ? ' proto-capture--big' : ''}`}
      onSubmit={(e) => {
        e.preventDefault();
        void cap.submit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && onCancel) {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="proto-capture-row">
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          className="proto-input"
          aria-label="Task title"
          placeholder={placeholder}
          value={cap.title}
          onChange={(e) => cap.setTitle(e.target.value)}
          // Stays editable while pending; only the submit is disabled.
        />
        {!hideDest && (
          <select
            className="proto-select"
            aria-label="Destination project"
            value={cap.dest ?? ''}
            onChange={(e) => cap.setDest(e.target.value || null)}
          >
            <option value="">{inbox ? '⌂ Inbox' : '⌂ Inbox (created on first capture)'}</option>
            {writable
              .filter((p) => !p.inbox)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        )}
        <button type="submit" className="btn" disabled={cap.pending || !cap.title.trim()}>
          {cap.pending ? 'Saving…' : cap.error ? 'Retry' : 'Add'}
        </button>
      </div>
      <div className="proto-capture-feedback" aria-live="polite">
        {cap.pending && <span className="muted">Saving “{cap.title.trim()}”…</span>}
        {!cap.pending && cap.error && (
          <span className="proto-error">{cap.error} Your text is kept — press Enter to retry.</span>
        )}
        {!cap.pending && !cap.error && cap.created && (
          <span className="proto-ok">
            Added “{cap.created.title}” to <ProjectName id={cap.created.projectId} />.{' '}
            <button
              type="button"
              className="btn btn--link"
              onClick={() => onOpenTask(cap.created!)}
            >
              Open task
            </button>
          </span>
        )}
      </div>
    </form>
  );
}

// ------------------------------------------------------------------- filing

export function MoveTo({
  task,
  run,
  busy,
  compact,
}: {
  task: Task;
  run: ReturnType<typeof useTaskAction>['run'];
  busy: boolean;
  compact?: boolean;
}): JSX.Element {
  const s = useStore();
  const targets = orderedProjects(s).filter((p) => !p.readOnly && p.id !== task.projectId);
  return (
    <select
      className="proto-select proto-select--sm"
      aria-label={`Move “${task.title}” to project`}
      disabled={busy}
      value=""
      onChange={(e) => {
        const to = e.target.value;
        if (to) void run(task.id, () => fileTask(task.id, task.revision, to));
      }}
    >
      <option value="">{busy ? 'Moving…' : compact ? 'Move…' : 'Move to project…'}</option>
      {targets.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

export function StateSelect({
  task,
  run,
  busy,
}: {
  task: Task;
  run: ReturnType<typeof useTaskAction>['run'];
  busy: boolean;
}): JSX.Element {
  return (
    <select
      className="proto-select proto-select--sm"
      aria-label={`Task state of “${task.title}”`}
      disabled={busy}
      value={task.task_state}
      onChange={(e) =>
        void run(task.id, () => setTaskState(task.id, task.revision, e.target.value as TaskState))
      }
    >
      {(Object.keys(STATE_LABEL) as TaskState[]).map((k) => (
        <option key={k} value={k}>
          {STATE_LABEL[k]}
        </option>
      ))}
    </select>
  );
}

export function ActionError({
  action,
}: {
  action: ReturnType<typeof useTaskAction>;
}): JSX.Element | null {
  if (!action.error) return null;
  return (
    <div className="board-notice proto-notice-error" role="alert">
      <span>
        {action.error.message}
        {action.error.kind === 'conflict' && ' The list has been reloaded.'}
      </span>
      <button type="button" className="btn btn--sm btn--ghost" onClick={action.dismiss}>
        Dismiss
      </button>
    </div>
  );
}

// -------------------------------------------------------------- current work

export function CurrentWorkList({
  groups,
  loading,
  reload,
  onOpenTask,
  onGoToBoard,
  dense,
}: {
  groups: CurrentGroup[] | null;
  loading: boolean;
  reload: () => void;
  onOpenTask: (t: Task) => void;
  onGoToBoard: (projectId: string) => void;
  dense?: boolean;
}): JSX.Element {
  const s = useStore();
  const action = useTaskAction(reload);
  const total = groups?.reduce((n, g) => n + g.tasks.length, 0) ?? 0;
  return (
    <section
      className={`proto-current${dense ? ' proto-current--dense' : ''}`}
      aria-label="Current work"
    >
      <div className="proto-section-head">
        <h2>Current work</h2>
        {groups && <span className="board-column-count">{total}</span>}
        <span className="topbar-spacer" />
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={reload}
          title="Reload (also on window focus)"
        >
          <Icon name="refresh" />
        </button>
      </div>
      <ActionError action={action} />
      {loading && !groups && (
        <p className="status-message status-message--loading">Loading current work…</p>
      )}
      {!loading && !groups && (
        <p className="status-message status-message--error">
          Could not load Current work — server unreachable.{' '}
          <button type="button" className="btn btn--sm" onClick={reload}>
            Try again
          </button>
        </p>
      )}
      {groups && total === 0 && (
        <p className="status-message status-message--empty">
          Nothing is In progress. Move a task to In progress on a board, or here from its menu, to
          see it.
        </p>
      )}
      {groups?.map((g) => (
        <div key={g.project.id} className="proto-group">
          <h3 className="proto-group-head">
            <button
              type="button"
              className="btn btn--link"
              onClick={() => onGoToBoard(g.project.id)}
              title="Go to board"
            >
              <ProjectName id={g.project.id} />
            </button>
            <span className="board-column-count">{g.tasks.length}</span>
          </h3>
          <ul className="proto-rows">
            {g.tasks.map((t) => {
              const ro = isReadOnly(s, t);
              const busy = action.busy.has(t.id);
              return (
                <li
                  key={t.id}
                  className={`proto-row${ro ? ' read-only' : ''}${busy ? ' saving' : ''}`}
                >
                  <button type="button" className="board-card-title" onClick={() => onOpenTask(t)}>
                    {t.title}
                  </button>
                  {t.status === 'draft' && <span className="board-badge">draft</span>}
                  {ro ? (
                    <span className="board-badge board-badge--muted" title="Read-only: no actions">
                      read-only
                    </span>
                  ) : (
                    <StateSelect task={t} run={action.run} busy={busy} />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {loading && groups && <p className="muted proto-small">Reloading…</p>}
    </section>
  );
}

// ------------------------------------------------------- board (stand-in)

/** Stand-in for TaskBoard: same columns/order rules, plus the new Add task and Inbox Move actions. */
export function StubBoard({
  projectId,
  onOpenTask,
  addTask,
}: {
  projectId: string;
  onOpenTask: (t: Task) => void;
  /** Rendered at the top of To do; the variant decides what Add task looks like. */
  addTask?: ReactNode;
}): JSX.Element {
  const s = useStore();
  const project = projectOf(s, projectId);
  const action = useTaskAction();
  if (!project) return <p className="status-message">This project no longer exists.</p>;
  const tasks = boardTasks(s, projectId);
  return (
    <div className="board-workspace">
      <div className="board-notice">
        <span>
          <ProjectName id={projectId} /> — board{' '}
          <span className="muted">(stand-in for the existing TaskBoard)</span>
        </span>
      </div>
      <ActionError action={action} />
      <div className="task-board">
        {(Object.keys(STATE_LABEL) as TaskState[]).map((col) => {
          const cards = tasks.filter((t) => t.task_state === col);
          return (
            <section key={col} className="board-column" data-state={col}>
              <header className="board-column-header">
                <h2>{STATE_LABEL[col]}</h2>
                <span className="board-column-count">{cards.length}</span>
              </header>
              {col === 'todo' && !project.readOnly && addTask}
              <ul className="board-cards">
                {cards.length === 0 && <li className="muted proto-small">No tasks.</li>}
                {cards.map((t) => {
                  const ro = isReadOnly(s, t);
                  const busy = action.busy.has(t.id);
                  return (
                    <li
                      key={t.id}
                      className={`board-card${ro ? ' read-only' : ''}${busy ? ' saving' : ''}`}
                    >
                      <button
                        type="button"
                        className="board-card-title"
                        onClick={() => onOpenTask(t)}
                      >
                        {t.title}
                      </button>
                      <div className="board-card-meta">
                        {t.status === 'draft' && <span className="board-badge">draft</span>}
                        {ro && <span className="board-badge board-badge--muted">read-only</span>}
                      </div>
                      {!ro && (
                        <div className="board-card-actions proto-card-actions">
                          {project.inbox && (
                            <MoveTo task={t} run={action.run} busy={busy} compact />
                          )}
                          <StateSelect task={t} run={action.run} busy={busy} />
                          <button
                            type="button"
                            className="btn btn--sm btn--ghost"
                            disabled={busy}
                            onClick={() =>
                              void action.run(t.id, () => archiveTask(t.id, t.revision))
                            }
                          >
                            Archive
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------- editor (stand-in)

export function StubEditor({
  taskId,
  onBack,
  backLabel,
}: {
  taskId: string;
  onBack: () => void;
  backLabel: string;
}): JSX.Element {
  const s = useStore();
  const t = s.tasks.find((x) => x.id === taskId);
  if (!t) return <p className="status-message">Task not found.</p>;
  const ro = isReadOnly(s, t);
  return (
    <div className="proto-editor">
      <button type="button" className="btn btn--sm btn--ghost back-to-board" onClick={onBack}>
        ← {backLabel}
      </button>
      <div className="proto-editor-body">
        <p className="proto-stub-note">
          Stand-in: the existing <code>DocumentWorkspace</code> editor mounts here unchanged
          (autosave fix #22 is consumed, not modified).
        </p>
        <h2>{t.title}</h2>
        <p className="muted proto-small">
          <ProjectName id={t.projectId} /> · {STATE_LABEL[t.task_state]} · {t.status} · id{' '}
          <code>{t.id}</code> · rev {t.revision}
        </p>
        <textarea
          className="proto-textarea"
          aria-label="Task body"
          readOnly={ro}
          value={t.body}
          placeholder="Write details… (searchable)"
          onChange={(e) => editBody(t.id, e.target.value)}
        />
      </div>
    </div>
  );
}

// ------------------------------------------------------- search (stand-in)

export function StubSearch({
  open,
  onClose,
  onOpenTask,
}: {
  open: boolean;
  onClose: () => void;
  onOpenTask: (t: Task) => void;
}): JSX.Element | null {
  const s = useStore();
  const [q, setQ] = useState('');
  useEffect(() => {
    if (open) setQ('');
  }, [open]);
  if (!open) return null;
  const needle = q.trim().toLowerCase();
  const hits = needle
    ? s.tasks.filter((t) => `${t.title}\n${t.body}`.toLowerCase().includes(needle)).slice(0, 8)
    : [];
  return (
    <div className="command-palette-backdrop" onClick={onClose}>
      <div
        className="command-palette"
        role="dialog"
        aria-label="Search"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          className="command-palette-input"
          placeholder="Search all projects… (stand-in for the existing palette)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'Enter' && hits[0]) {
              onOpenTask(hits[0]);
              onClose();
            }
          }}
        />
        <ul className="command-palette-results">
          {hits.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="command-palette-row"
                onClick={() => {
                  onOpenTask(t);
                  onClose();
                }}
              >
                <span className="command-palette-row-title">{t.title}</span>
                <span className="command-palette-row-meta">
                  <ProjectName id={t.projectId} /> ·{' '}
                  {t.status === 'archived' ? 'archived' : STATE_LABEL[t.task_state]}
                </span>
                {t.body && (
                  <span className="command-palette-row-snippet">{t.body.slice(0, 90)}</span>
                )}
              </button>
            </li>
          ))}
          {needle && hits.length === 0 && <li className="command-palette-status">No matches.</li>}
        </ul>
      </div>
    </div>
  );
}

/** Keyboard: `n` opens capture (outside text fields), Ctrl/Cmd+K search. */
export function useProtoShortcuts(onCapture: () => void, onSearch: () => void): void {
  const ref = useRef({ onCapture, onSearch });
  ref.current = { onCapture, onSearch };
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ref.current.onSearch();
        return;
      }
      const t = e.target as HTMLElement;
      if (
        t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' ||
        t.isContentEditable
      )
        return;
      if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        ref.current.onCapture();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
}
