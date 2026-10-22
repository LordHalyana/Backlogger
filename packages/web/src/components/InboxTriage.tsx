import { useEffect, useMemo, useRef, useState } from 'react';
import { TASK_STATES, type BoardCard, type Project, type TaskState } from '@backlogger/shared';
import { ApiError } from '../lib/api.js';
import { isTextField } from '../lib/keyboard.js';
import { useBoard } from '../lib/board.js';
import { newUuid } from '../lib/comments.js';
import {
  filingTargets,
  readRecentTargets,
  rememberTarget,
  useFileItem,
  useUpdateItem,
  type ItemChange,
} from '../lib/inbox.js';
import { StatusMessage } from './StatusMessage.js';
import { TaskStateSelect } from './TaskStateSelect.js';

interface InboxTriageProps {
  projects: readonly Project[];
  onOpenTask: (projectId: string, documentId: string) => void;
}

/** Inbox items, oldest first, regardless of task state. */
function inboxItems(columns: Record<TaskState, BoardCard[]>): BoardCard[] {
  return TASK_STATES.flatMap((state) => columns[state]).sort((a, b) =>
    a.created_at === b.created_at
      ? a.id.localeCompare(b.id)
      : a.created_at.localeCompare(b.created_at),
  );
}

function failureMessage(err: Error, what: string): string {
  if (err instanceof ApiError) {
    if (err.code === 'REVISION_CONFLICT' || err.code === 'DOCUMENT_VERSION_MISMATCH') {
      return `This task was changed somewhere else, so the ${what} was not saved. It has been reloaded — try again.`;
    }
    if (err.code === 'PROJECT_NOT_WRITABLE' || err.code === 'PROJECT_READ_ONLY') {
      return `That project cannot take tasks, so the ${what} was not saved.`;
    }
    return `The ${what} was not saved: ${err.message}`;
  }
  return `Could not reach the server, so the ${what} was not saved. The task stays in the Inbox.`;
}

/**
 * ⌂ triage mode: one Inbox item at a time. `1`–`9` file it into the most
 * recently used writable projects, typing filters the full list, `s` skips
 * (it stays in the Inbox), `a` archives and `o` opens it in the editor. The
 * item stays, marked as moving, until a filing is saved.
 */
export function InboxTriage({ projects, onOpenTask }: InboxTriageProps): JSX.Element {
  const inbox = projects.find((p) => p.isInbox);
  if (!inbox) {
    return (
      <div className="workspace-empty">
        <StatusMessage kind="empty">
          No Inbox — it could not be created when the server started. Capture into a project
          instead.
        </StatusMessage>
      </div>
    );
  }
  return <Triage inbox={inbox} projects={projects} onOpenTask={onOpenTask} />;
}

function Triage({
  inbox,
  projects,
  onOpenTask,
}: InboxTriageProps & { inbox: Project }): JSX.Element {
  const { data, isLoading, isError, error, refetch } = useBoard(inbox.id);
  const fileItem = useFileItem();
  const updateItem = useUpdateItem();
  const [skipped, setSkipped] = useState(0);
  const [busy, setBusy] = useState<{ id: string; label: string } | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const [filter, setFilter] = useState('');
  const filterRef = useRef<HTMLInputElement>(null);
  const [recent, setRecent] = useState<string[]>(() => readRecentTargets());

  const items = useMemo(() => (data ? inboxItems(data.columns) : []), [data]);
  const item = items.length > 0 ? items[skipped % items.length] : undefined;
  const targets = useMemo(() => filingTargets(projects, recent), [projects, recent]);
  const quick = targets.slice(0, 9);
  const filtered = filter.trim()
    ? targets.filter((p) => p.name.toLowerCase().includes(filter.trim().toLowerCase()))
    : [];
  const working = !!item && busy?.id === item.id;

  const file = (target: Project): void => {
    if (!item || busy) return;
    setBusy({ id: item.id, label: `Moving to ${target.name}…` });
    setMessage(null);
    fileItem.mutate(
      {
        id: item.id,
        revision: item.revision,
        from: inbox.id,
        to: target.id,
        operationId: newUuid(),
      },
      {
        onSuccess: () => {
          rememberTarget(target.id);
          setRecent(readRecentTargets());
          setFilter('');
          setMessage({ kind: 'ok', text: `Filed “${item.title}” in ${target.name}.` });
          // Still "moving" until the Inbox no longer lists it.
          void refetch().finally(() => setBusy(null));
        },
        onError: (err) => {
          setBusy(null);
          setMessage({ kind: 'error', text: failureMessage(err, 'move') });
          void refetch();
        },
      },
    );
  };

  const update = (change: ItemChange): void => {
    if (!item || busy) return;
    const archiving = 'status' in change;
    setBusy({ id: item.id, label: archiving ? 'Archiving…' : 'Saving…' });
    setMessage(null);
    updateItem.mutate(
      { id: item.id, projectId: inbox.id, revision: item.revision, change },
      {
        onSuccess: () => {
          if (archiving) setMessage({ kind: 'ok', text: `Archived “${item.title}”.` });
        },
        onError: (err) => {
          setMessage({
            kind: 'error',
            text: failureMessage(err, archiving ? 'archive' : 'change'),
          });
          void refetch();
        },
        onSettled: () => setBusy(null),
      },
    );
  };

  // Keep the latest handlers for the window listener without re-binding it.
  const keys = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keys.current = (e: KeyboardEvent): void => {
    if (!item || e.ctrlKey || e.metaKey || e.altKey || isTextField(e.target)) return;
    if (document.querySelector('[aria-modal="true"]')) return;
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= quick.length) {
      e.preventDefault();
      file(quick[n - 1]!);
    } else if (e.key === 's') {
      e.preventDefault();
      setMessage(null);
      setSkipped((k) => k + 1);
    } else if (e.key === 'a') {
      e.preventDefault();
      update({ status: 'archived' });
    } else if (e.key === 'o') {
      e.preventDefault();
      onOpenTask(inbox.id, item.id);
    } else if (e.key.length === 1 && /\p{L}/u.test(e.key) && e.key !== 'n') {
      // Any other letter starts filtering the full project list.
      e.preventDefault();
      setFilter(e.key);
      filterRef.current?.focus();
    }
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => keys.current(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (isLoading) {
    return (
      <div className="workspace-empty">
        <StatusMessage kind="loading">Loading the Inbox…</StatusMessage>
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="workspace-empty">
        <StatusMessage kind="error">Failed to load the Inbox: {error?.message}</StatusMessage>
      </div>
    );
  }

  return (
    <div className="inbox-triage">
      <div className="inbox-triage-head">
        <h2>
          <span className="inbox-mark" aria-hidden="true">
            ⌂
          </span>
          {inbox.name} triage
        </h2>
        <span className="board-column-count">{items.length} left</span>
      </div>
      {message && (
        <div
          className={`board-notice inbox-triage-message inbox-triage-message--${message.kind}`}
          role={message.kind === 'error' ? 'alert' : 'status'}
        >
          <span>{message.text}</span>
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => setMessage(null)}>
            Dismiss
          </button>
        </div>
      )}
      {!item ? (
        <StatusMessage kind="empty">Inbox is clear. Press n to capture.</StatusMessage>
      ) : (
        <article
          className={`inbox-triage-card${working ? ' saving' : ''}`}
          aria-label={item.title}
          aria-busy={working}
          data-card-id={item.id}
        >
          <h3>{item.title}</h3>
          <div className="inbox-triage-meta">
            {item.status === 'draft' && <span className="board-badge">draft</span>}
            <TaskStateSelect
              title={item.title}
              value={item.task_state}
              disabled={!!busy}
              onChange={(next) => update({ task_state: next })}
            />
          </div>
          {working && <p className="muted inbox-triage-moving">{busy!.label}</p>}
          <div className="inbox-triage-actions" aria-label="File into">
            {quick.length === 0 && (
              <span className="muted">No writable project to file into yet.</span>
            )}
            {quick.map((p, i) => (
              <button
                key={p.id}
                type="button"
                className="btn"
                disabled={!!busy}
                onClick={() => file(p)}
              >
                <kbd>{i + 1}</kbd> {p.name}
              </button>
            ))}
          </div>
          <form
            className="inbox-triage-filter"
            onSubmit={(e) => {
              e.preventDefault();
              if (filtered[0]) file(filtered[0]);
            }}
          >
            <input
              ref={filterRef}
              type="search"
              aria-label="Find a project to file into"
              placeholder="Type to find a project…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setFilter('');
                  e.currentTarget.blur();
                }
              }}
            />
            {filtered.length > 0 && (
              <div className="inbox-triage-actions">
                {filtered.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="btn btn--sm"
                    disabled={!!busy}
                    onClick={() => file(p)}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
            {filter.trim() && filtered.length === 0 && (
              <span className="muted">No writable project matches.</span>
            )}
          </form>
          <div className="inbox-triage-actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setMessage(null);
                setSkipped((k) => k + 1);
              }}
            >
              <kbd>s</kbd> Keep in Inbox
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => onOpenTask(inbox.id, item.id)}
            >
              <kbd>o</kbd> Open
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={!!busy}
              onClick={() => update({ status: 'archived' })}
            >
              <kbd>a</kbd> Archive
            </button>
          </div>
        </article>
      )}
    </div>
  );
}
