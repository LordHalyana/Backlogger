import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import {
  taskStateColumn,
  TASK_STATES,
  TASK_STATE_LABELS,
  type BoardCard,
  type TaskState,
} from '@backlogger/shared';
import { ApiError } from '../lib/api.js';
import { useArchiveCard, useBoard, useMoveCard, useRestoreCard } from '../lib/board.js';
import { toastError, useDialog } from '../lib/dialog.js';
import { StatusMessage } from './StatusMessage.js';

/** An archived card that can still be restored from the Undo notice. */
interface ArchivedNotice {
  card: BoardCard;
  /** Revision returned by the archive; the restore is conditional on it. */
  revision: string;
}

interface TaskBoardProps {
  projectId: string;
  /** Open a card's document in the editor. */
  onOpenCard: (documentId: string) => void;
}

/**
 * The project board: one column per task state, showing every non-archived
 * backlog item. Columns and their order come from the server; a moved card
 * takes its creation-order place in the target column.
 */
export function TaskBoard({ projectId, onOpenCard }: TaskBoardProps): JSX.Element {
  const { data, isLoading, isError, error, refetch } = useBoard(projectId);
  const moveCard = useMoveCard(projectId);
  const archiveCard = useArchiveCard(projectId);
  const restoreCard = useRestoreCard(projectId);
  const dialog = useDialog();
  const [archived, setArchived] = useState<ArchivedNotice | null>(null);
  /** Why the last change was refused (409); shown in the conflict banner. */
  const [conflict, setConflict] = useState<string | null>(null);
  const [saving, setSaving] = useState<ReadonlySet<string>>(() => new Set());
  const [dragging, setDragging] = useState<BoardCard | null>(null);
  const [dropTarget, setDropTarget] = useState<TaskState | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  // A keyboard-moved card remounts in its new column; focus it there once.
  const [focusTarget, setFocusTarget] = useState<{ id: string; state: TaskState } | null>(null);

  useEffect(() => {
    if (!focusTarget) return;
    const el = boardRef.current?.querySelector<HTMLElement>(
      `[data-state="${focusTarget.state}"] [data-card-id="${CSS.escape(focusTarget.id)}"]`,
    );
    if (!el) return;
    el.focus();
    setFocusTarget(null);
  }, [focusTarget, data]);

  const setCardSaving = useCallback((id: string, on: boolean): void => {
    setSaving((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  /** A 409 shows the conflict banner; any other failure is a toast. */
  const reportFailure = useCallback(
    (what: string, err: Error): void => {
      if (err instanceof ApiError && err.status === 409) {
        setConflict(
          err.code === 'PROJECT_READ_ONLY'
            ? `This project is read-only, so the ${what} was not saved.`
            : `This card was changed somewhere else, so the ${what} was not saved.`,
        );
      } else {
        toastError(dialog, `Failed to save the ${what}`, err);
      }
    },
    [dialog],
  );

  const move = useCallback(
    (card: BoardCard, to: TaskState): void => {
      if (card.readOnly || saving.has(card.id)) return;
      if (taskStateColumn(card.task_state) === to) return;
      setCardSaving(card.id, true);
      moveCard.mutate(
        { card, to },
        {
          onError: (err) => reportFailure('move', err),
          onSettled: () => setCardSaving(card.id, false),
        },
      );
    },
    [moveCard, reportFailure, saving, setCardSaving],
  );

  const archive = useCallback(
    (card: BoardCard): void => {
      if (card.readOnly || saving.has(card.id)) return;
      setArchived(null);
      archiveCard.mutate(card, {
        onSuccess: (doc) => setArchived({ card, revision: doc.revision }),
        onError: (err) => reportFailure('archive', err),
      });
    },
    [archiveCard, reportFailure, saving],
  );

  const undoArchive = useCallback((): void => {
    if (!archived) return;
    setArchived(null);
    restoreCard.mutate(archived, {
      onError: (err) => reportFailure('restore', err),
    });
  }, [archived, reportFailure, restoreCard]);

  /** Alt+←/→: step to the adjacent column; nothing happens at either edge. */
  const step = useCallback(
    (card: BoardCard, delta: -1 | 1): void => {
      const next = TASK_STATES[TASK_STATES.indexOf(taskStateColumn(card.task_state)) + delta];
      if (!next) return;
      setFocusTarget({ id: card.id, state: next });
      move(card, next);
    },
    [move],
  );

  if (isLoading) {
    return (
      <div className="workspace-empty">
        <StatusMessage kind="loading">Loading board…</StatusMessage>
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="workspace-empty">
        <StatusMessage kind="error">Failed to load the board: {error?.message}</StatusMessage>
      </div>
    );
  }

  const total = TASK_STATES.reduce((n, state) => n + data.columns[state].length, 0);

  const endDrag = (): void => {
    setDragging(null);
    setDropTarget(null);
  };

  return (
    <div className="board-workspace">
      {conflict && (
        <div className="conflict-banner" role="alert">
          <span>{conflict}</span>
          <button
            type="button"
            onClick={() => {
              setConflict(null);
              void refetch();
            }}
          >
            Reload
          </button>
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            aria-label="Dismiss"
            onClick={() => setConflict(null)}
          >
            ×
          </button>
        </div>
      )}
      {archived && (
        <div className="board-notice" role="status">
          <span>Archived “{archived.card.title}”.</span>
          <button type="button" className="btn btn--sm" onClick={undoArchive}>
            Undo
          </button>
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            aria-label="Dismiss"
            onClick={() => setArchived(null)}
          >
            ×
          </button>
        </div>
      )}
      {total === 0 ? (
        <div className="workspace-empty">
          <StatusMessage kind="empty">
            No backlog items yet. Documents of type <code>backlog_item</code> appear here.
          </StatusMessage>
        </div>
      ) : (
        <div className="task-board" ref={boardRef}>
          {TASK_STATES.map((state) => (
            <BoardColumn
              key={state}
              state={state}
              cards={data.columns[state]}
              saving={saving}
              isDropTarget={dropTarget === state}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                setDropTarget(state);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging) move(dragging, state);
                endDrag();
              }}
              onDragStartCard={setDragging}
              onDragEndCard={endDrag}
              onStepCard={step}
              onArchiveCard={archive}
              onOpenCard={onOpenCard}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface BoardColumnProps {
  state: TaskState;
  cards: BoardCard[];
  saving: ReadonlySet<string>;
  isDropTarget: boolean;
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
  onDragStartCard: (card: BoardCard) => void;
  onDragEndCard: () => void;
  onStepCard: (card: BoardCard, delta: -1 | 1) => void;
  onArchiveCard: (card: BoardCard) => void;
  onOpenCard: (documentId: string) => void;
}

function BoardColumn({
  state,
  cards,
  saving,
  isDropTarget,
  onDragOver,
  onDrop,
  onDragStartCard,
  onDragEndCard,
  onStepCard,
  onArchiveCard,
  onOpenCard,
}: BoardColumnProps): JSX.Element {
  const label = TASK_STATE_LABELS[state];
  return (
    <section
      className={'board-column' + (isDropTarget ? ' drop-target' : '')}
      aria-label={label}
      data-state={state}
      onDragEnter={onDragOver}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <header className="board-column-header">
        <h2>{label}</h2>
        <span className="board-column-count">{cards.length}</span>
      </header>
      <ul className="board-cards">
        {cards.map((card) => (
          <li key={card.id}>
            <BoardCardView
              card={card}
              saving={saving.has(card.id)}
              onDragStart={() => onDragStartCard(card)}
              onDragEnd={onDragEndCard}
              onStep={(delta) => onStepCard(card, delta)}
              onArchive={state === 'done' ? () => onArchiveCard(card) : undefined}
              onOpen={() => onOpenCard(card.id)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

interface BoardCardViewProps {
  card: BoardCard;
  saving: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onStep: (delta: -1 | 1) => void;
  /** Offered on Done cards only. */
  onArchive?: () => void;
  onOpen: () => void;
}

function BoardCardView({
  card,
  saving,
  onDragStart,
  onDragEnd,
  onStep,
  onArchive,
  onOpen,
}: BoardCardViewProps): JSX.Element {
  const movable = !card.readOnly && !saving;
  return (
    <article
      className={'board-card' + (card.readOnly ? ' read-only' : '') + (saving ? ' saving' : '')}
      aria-label={card.title}
      aria-busy={saving}
      data-card-id={card.id}
      tabIndex={0}
      draggable={movable}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          // Also keeps Alt+← from navigating the browser back.
          e.preventDefault();
          if (movable) onStep(e.key === 'ArrowRight' ? 1 : -1);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          onOpen();
        }
      }}
      onDragStart={(e) => {
        if (!movable) {
          e.preventDefault();
          return;
        }
        // Firefox only starts a drag when data is set.
        e.dataTransfer?.setData('text/plain', card.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      <button type="button" className="board-card-title" onClick={onOpen}>
        {card.title}
      </button>
      <div className="board-card-meta">
        {saving && <span className="board-badge board-badge--muted">Saving…</span>}
        {card.status === 'draft' && <span className="board-badge">Draft</span>}
        {card.readOnly && <span className="board-badge board-badge--muted">Read-only</span>}
        {card.tags.map((tag) => (
          <span key={tag} className="board-tag">
            {tag}
          </span>
        ))}
      </div>
      {onArchive && movable && (
        <div className="board-card-actions">
          <button type="button" className="btn btn--sm btn--ghost" onClick={onArchive}>
            Archive
          </button>
        </div>
      )}
    </article>
  );
}
