import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  taskStateColumn,
  TASK_STATES,
  TASK_STATE_LABELS,
  type BoardCard,
  type Project,
  type RecoverySummary,
  type TaskState,
} from '@backlogger/shared';
import { ApiError } from '../lib/api.js';
import { useArchiveCard, useBoard, useMoveCard, useRestoreCard } from '../lib/board.js';
import { toastError, useDialog } from '../lib/dialog.js';
import { useCapture } from '../lib/capture.js';
import { acceptsBacklogItems } from '../lib/inbox.js';
import { useProjects } from '../lib/projects.js';
import {
  isDeletion,
  isMoving,
  needsReview,
  taskName,
  useRecoveryBlockedToast,
  useRecoveryList,
} from '../lib/recovery.js';
import { CaptureForm } from './CaptureForm.js';
import { Icon } from './Icon.js';
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
  /** Open the Recovery page on an operation that blocks or hides a card. */
  onOpenRecovery?: (operationId: string) => void;
}

const noop = (): void => undefined;

/**
 * The project board: one column per task state, showing every non-archived
 * backlog item. Columns and their order come from the server; a moved card
 * takes its creation-order place in the target column.
 */
export function TaskBoard({
  projectId,
  onOpenCard,
  onOpenRecovery = noop,
}: TaskBoardProps): JSX.Element {
  const { data, isLoading, isError, error, refetch } = useBoard(projectId);
  const projects = useProjects();
  const project = projects.data?.find((p) => p.id === projectId);
  const recovery = useRecoveryList();
  const pending = (recovery.data?.operations ?? []).filter((op) => op.state === 'pending');
  // Items a stopped deletion hides have no card; the notice above the columns names them.
  const hidden = pending.filter(
    (op) => op.command === 'document.delete' && op.project_id === projectId && needsReview(op),
  );
  const operationFor = (cardId: string): RecoverySummary | undefined =>
    pending.find((op) => op.task_id === cardId && !isDeletion(op));
  const projectName = (id: string | null): string =>
    projects.data?.find((p) => p.id === id)?.name ?? id ?? '';
  const recoveryBlocked = useRecoveryBlockedToast(onOpenRecovery);
  const canAdd = !!project && acceptsBacklogItems(project);
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
      if (recoveryBlocked(what, err)) return;
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
    [dialog, recoveryBlocked],
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
            title="Dismiss"
            onClick={() => setConflict(null)}
          >
            <Icon name="close" />
          </button>
        </div>
      )}
      {archived && (
        <div className="board-notice" role="status">
          <span>{`Archived "${archived.card.title}".`}</span>
          <button type="button" className="btn btn--sm" onClick={undoArchive}>
            Undo
          </button>
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            aria-label="Dismiss"
            title="Dismiss"
            onClick={() => setArchived(null)}
          >
            <Icon name="close" />
          </button>
        </div>
      )}
      {hidden.length > 0 && (
        <div className="board-notice recovery-hidden-notice" role="note" aria-label="Hidden items">
          <strong>
            {hidden.length === 1
              ? '1 item in this project is hidden while deletion is stopped.'
              : `${hidden.length} items in this project are hidden while deletion is stopped.`}
          </strong>
          {hidden.map((op) => (
            <span key={op.operation_id} className="recovery-hidden-item">
              {taskName(op)}
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => onOpenRecovery(op.operation_id)}
              >
                Review
              </button>
            </span>
          ))}
        </div>
      )}
      {total === 0 && !canAdd ? (
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
              operationFor={operationFor}
              projectName={projectName}
              onOpenRecovery={onOpenRecovery}
              addTask={
                state === 'todo' && canAdd ? (
                  <BoardAddTask
                    projectId={projectId}
                    projects={projects.data ?? []}
                    onOpenCard={onOpenCard}
                  />
                ) : undefined
              }
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
  /** The pending operation on a card's task, if any. */
  operationFor: (cardId: string) => RecoverySummary | undefined;
  projectName: (projectId: string | null) => string;
  onOpenRecovery: (operationId: string) => void;
  /** Shown at the top of the column (To do on writable boards). */
  addTask?: ReactNode;
}

/** Inline Add task: a capture into this board's project, title only. */
function BoardAddTask({
  projectId,
  projects,
  onOpenCard,
}: {
  projectId: string;
  projects: readonly Project[];
  onOpenCard: (documentId: string) => void;
}): JSX.Element {
  const capture = useCapture(projectId);
  return (
    <CaptureForm
      className="board-add-task"
      capture={capture}
      projects={projects}
      placeholder="Add task…"
      onOpenTask={(doc) => onOpenCard(doc.id)}
    />
  );
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
  operationFor,
  projectName,
  onOpenRecovery,
  addTask,
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
      {addTask}
      <ul className="board-cards">
        {cards.map((card) => (
          <li key={card.id}>
            <BoardCardView
              card={card}
              operation={operationFor(card.id)}
              projectName={projectName}
              onReview={onOpenRecovery}
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
  /** A pending operation on the task: Moving…, or Recovery required with Review. */
  operation?: RecoverySummary;
  projectName: (projectId: string | null) => string;
  onReview: (operationId: string) => void;
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
  operation,
  projectName,
  onReview,
  saving,
  onDragStart,
  onDragEnd,
  onStep,
  onArchive,
  onOpen,
}: BoardCardViewProps): JSX.Element {
  const moving = operation !== undefined && isMoving(operation);
  const blocked = operation !== undefined && needsReview(operation);
  // Writes to the task are refused while an operation is pending on it.
  const movable = !card.readOnly && !saving && !operation;
  return (
    <article
      className={
        'board-card' +
        (card.readOnly ? ' read-only' : '') +
        (saving ? ' saving' : '') +
        (blocked ? ' is-blocked' : '') +
        (moving ? ' is-moving' : '')
      }
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
        {moving && (
          <>
            <span className="board-badge board-badge--moving">Moving…</span>
            <span className="board-card-note">to {projectName(operation.target_project_id)}</span>
          </>
        )}
        {blocked && <span className="board-badge">Recovery required</span>}
        {card.status === 'draft' && <span className="board-badge">Draft</span>}
        {card.readOnly && <span className="board-badge board-badge--muted">Read-only</span>}
        {card.tags.map((tag) => (
          <span key={tag} className="board-tag">
            {tag}
          </span>
        ))}
      </div>
      {blocked && (
        <div className="board-card-actions">
          <button
            type="button"
            className="btn btn--sm btn--link"
            onClick={() => onReview(operation.operation_id)}
          >
            Review
          </button>
        </div>
      )}
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
