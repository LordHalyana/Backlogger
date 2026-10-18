import { useCallback, useState, type DragEvent } from 'react';
import {
  taskStateColumn,
  TASK_STATES,
  TASK_STATE_LABELS,
  type BoardCard,
  type TaskState,
} from '@backlogger/shared';
import { useBoard, useMoveCard } from '../lib/board.js';
import { StatusMessage } from './StatusMessage.js';

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
  const { data, isLoading, isError, error } = useBoard(projectId);
  const moveCard = useMoveCard(projectId);
  const [saving, setSaving] = useState<ReadonlySet<string>>(() => new Set());
  const [dragging, setDragging] = useState<BoardCard | null>(null);
  const [dropTarget, setDropTarget] = useState<TaskState | null>(null);

  const setCardSaving = useCallback((id: string, on: boolean): void => {
    setSaving((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const move = useCallback(
    (card: BoardCard, to: TaskState): void => {
      if (card.readOnly || saving.has(card.id)) return;
      if (taskStateColumn(card.task_state) === to) return;
      setCardSaving(card.id, true);
      moveCard.mutate({ card, to }, { onSettled: () => setCardSaving(card.id, false) });
    },
    [moveCard, saving, setCardSaving],
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
  if (total === 0) {
    return (
      <div className="workspace-empty">
        <StatusMessage kind="empty">
          No backlog items yet. Documents of type <code>backlog_item</code> appear here.
        </StatusMessage>
      </div>
    );
  }

  const endDrag = (): void => {
    setDragging(null);
    setDropTarget(null);
  };

  return (
    <div className="task-board">
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
          onOpenCard={onOpenCard}
        />
      ))}
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
  onOpen: () => void;
}

function BoardCardView({
  card,
  saving,
  onDragStart,
  onDragEnd,
  onOpen,
}: BoardCardViewProps): JSX.Element {
  const movable = !card.readOnly && !saving;
  return (
    <article
      className={'board-card' + (card.readOnly ? ' read-only' : '') + (saving ? ' saving' : '')}
      aria-label={card.title}
      aria-busy={saving}
      tabIndex={0}
      draggable={movable}
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
    </article>
  );
}
