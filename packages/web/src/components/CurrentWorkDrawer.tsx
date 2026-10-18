import { useState } from 'react';
import type { BoardCard, TaskState } from '@backlogger/shared';
import { ApiError } from '../lib/api.js';
import { useCurrentWork } from '../lib/current-work.js';
import { useUpdateItem } from '../lib/inbox.js';
import { toastError, useDialog } from '../lib/dialog.js';
import { Icon } from './Icon.js';
import { ProjectName } from './ProjectName.js';
import { TaskStateSelect } from './TaskStateSelect.js';

interface CurrentWorkDrawerProps {
  onOpenTask: (projectId: string, documentId: string) => void;
  onGoToBoard: (projectId: string) => void;
  onClose: () => void;
}

/**
 * Current work: In progress backlog items across native projects, grouped by
 * project. Read-only items are listed without actions. It reloads when shown,
 * on window focus, after the user's own changes, and from its Reload button.
 */
export function CurrentWorkDrawer({
  onOpenTask,
  onGoToBoard,
  onClose,
}: CurrentWorkDrawerProps): JSX.Element {
  const { data, isLoading, isError, isFetching, refetch } = useCurrentWork();
  const update = useUpdateItem();
  const dialog = useDialog();
  const [saving, setSaving] = useState<ReadonlySet<string>>(() => new Set());
  const [conflict, setConflict] = useState<string | null>(null);

  const changeState = (projectId: string, card: BoardCard, next: TaskState): void => {
    setSaving((prev) => new Set(prev).add(card.id));
    update.mutate(
      { id: card.id, projectId, revision: card.revision, change: { task_state: next } },
      {
        onError: (err) => {
          if (err instanceof ApiError && err.status === 409) {
            setConflict(`“${card.title}” was changed somewhere else, so the change was not saved.`);
            void refetch();
          } else {
            toastError(dialog, 'Failed to change the task state', err);
          }
        },
        onSettled: () =>
          setSaving((prev) => {
            const next = new Set(prev);
            next.delete(card.id);
            return next;
          }),
      },
    );
  };

  const total = data?.groups.reduce((n, g) => n + g.items.length, 0) ?? 0;
  return (
    <aside className="current-work-drawer" aria-label="Current work">
      <div className="current-work-head">
        <h2>Current work</h2>
        {data && <span className="board-column-count">{total}</span>}
        <span className="topbar-spacer" />
        <button
          type="button"
          className="btn btn--sm btn--ghost btn--icon"
          onClick={() => void refetch()}
          disabled={isFetching}
          aria-label="Reload Current work"
          title="Reload"
        >
          <Icon name="refresh" />
        </button>
        <button
          type="button"
          className="btn btn--sm btn--ghost btn--icon"
          onClick={onClose}
          aria-label="Close Current work"
          title="Close"
        >
          <Icon name="close" />
        </button>
      </div>
      {conflict && (
        <div className="conflict-banner" role="alert">
          <span>{conflict}</span>
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => setConflict(null)}
          >
            Dismiss
          </button>
        </div>
      )}
      {isLoading && <p className="status-message status-message--loading">Loading Current work…</p>}
      {isError && !data && (
        <div className="status-message status-message--error" role="alert">
          Could not load Current work — server unreachable.{' '}
          <button type="button" className="btn btn--sm" onClick={() => void refetch()}>
            Try again
          </button>
        </div>
      )}
      {data && total === 0 && (
        <p className="status-message status-message--empty">Nothing is In progress.</p>
      )}
      {data?.groups.map((group) => {
        return (
          <section
            key={group.project.id}
            className="current-work-group"
            aria-label={group.project.name}
          >
            <h3 className="current-work-group-head">
              <button
                type="button"
                className="btn btn--link"
                onClick={() => onGoToBoard(group.project.id)}
                title="Go to board"
              >
                <ProjectName project={group.project} />
              </button>
              <span className="board-column-count">{group.items.length}</span>
            </h3>
            <ul className="current-work-rows">
              {group.items.map((card) => {
                const busy = saving.has(card.id);
                return (
                  <li
                    key={card.id}
                    className={`current-work-row${card.readOnly ? ' read-only' : ''}${busy ? ' saving' : ''}`}
                    aria-busy={busy}
                  >
                    <button
                      type="button"
                      className="board-card-title"
                      onClick={() => onOpenTask(group.project.id, card.id)}
                    >
                      {card.title}
                    </button>
                    {card.status === 'draft' && <span className="board-badge">draft</span>}
                    {card.readOnly ? (
                      <span
                        className="board-badge board-badge--muted"
                        title="Read-only: no actions"
                      >
                        read-only
                      </span>
                    ) : (
                      <TaskStateSelect
                        title={card.title}
                        value={card.task_state}
                        disabled={busy}
                        onChange={(next) => changeState(group.project.id, card, next)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </aside>
  );
}
