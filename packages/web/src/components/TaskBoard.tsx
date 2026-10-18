import { TASK_STATES, TASK_STATE_LABELS, type BoardCard, type TaskState } from '@backlogger/shared';
import { useBoard } from '../lib/board.js';
import { StatusMessage } from './StatusMessage.js';

interface TaskBoardProps {
  projectId: string;
  /** Open a card's document in the editor. */
  onOpenCard: (documentId: string) => void;
}

/**
 * The project board: one column per task state, showing every non-archived
 * backlog item. Columns and their order come from the server.
 */
export function TaskBoard({ projectId, onOpenCard }: TaskBoardProps): JSX.Element {
  const { data, isLoading, isError, error } = useBoard(projectId);

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

  return (
    <div className="task-board">
      {TASK_STATES.map((state) => (
        <BoardColumn
          key={state}
          state={state}
          cards={data.columns[state]}
          onOpenCard={onOpenCard}
        />
      ))}
    </div>
  );
}

interface BoardColumnProps {
  state: TaskState;
  cards: BoardCard[];
  onOpenCard: (documentId: string) => void;
}

function BoardColumn({ state, cards, onOpenCard }: BoardColumnProps): JSX.Element {
  const label = TASK_STATE_LABELS[state];
  return (
    <section className="board-column" aria-label={label} data-state={state}>
      <header className="board-column-header">
        <h2>{label}</h2>
        <span className="board-column-count">{cards.length}</span>
      </header>
      <ul className="board-cards">
        {cards.map((card) => (
          <li key={card.id}>
            <BoardCardView card={card} onOpen={() => onOpenCard(card.id)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

interface BoardCardViewProps {
  card: BoardCard;
  onOpen: () => void;
}

function BoardCardView({ card, onOpen }: BoardCardViewProps): JSX.Element {
  return (
    <article
      className={'board-card' + (card.readOnly ? ' read-only' : '')}
      aria-label={card.title}
      tabIndex={0}
      onDoubleClick={onOpen}
    >
      <button type="button" className="board-card-title" onClick={onOpen}>
        {card.title}
      </button>
      <div className="board-card-meta">
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
