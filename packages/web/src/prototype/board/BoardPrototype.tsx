// PROTOTYPE — throwaway. Issue #9: "What is the smallest useful board interaction?"
// Three structurally different variants on the existing project route, switched via
// `?board=A|B|C`. Cards come from the project's real backlog_item documents (or
// illustrative demo cards when there are none); task state and saves are stubbed
// in memory. Opening a real card mounts the existing DocumentWorkspace unchanged.
import { useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import './board-prototype.css';
import { PrototypeSwitcher, type VariantInfo } from './PrototypeSwitcher.js';
import {
  TASK_STATES,
  TASK_STATE_LABELS,
  nextState,
  useProtoBoard,
  type ProtoBoard,
  type ProtoCard,
  type SimMode,
  type TaskState,
} from './useProtoBoard.js';

export const BOARD_VARIANTS: readonly VariantInfo[] = [
  { key: 'A', name: 'Board, open in place (drag + keys, archive on Done)' },
  { key: 'B', name: 'Board + docked document (buttons only)' },
  { key: 'C', name: 'Grouped list (state picker per row)' },
];

interface BoardPrototypeProps {
  variant: string;
  projectId: string;
  projectReadOnly: boolean;
  documentId: string | null;
  onOpen: (documentId: string | null) => void;
  onVariantChange: (key: string) => void;
  onExit: () => void;
  renderDocument: (documentId: string) => ReactNode;
}

export function BoardPrototype(props: BoardPrototypeProps): JSX.Element {
  const [sim, setSim] = useState<SimMode>('normal');
  const board = useProtoBoard(props.projectId, props.projectReadOnly, sim);
  // Illustrative cards have no document; track "opened" demo cards locally.
  const [openDemo, setOpenDemo] = useState<string | null>(null);
  const openId = props.documentId ?? openDemo;
  const open = (card: ProtoCard | null): void => {
    if (!card) {
      setOpenDemo(null);
      props.onOpen(null);
    } else if (card.real) {
      setOpenDemo(null);
      props.onOpen(card.id);
    } else {
      setOpenDemo(card.id);
    }
  };
  const doc = (id: string): ReactNode =>
    board.cards.find((c) => c.id === id && !c.real) ? (
      <div className="workspace-empty">
        <p>Illustrative card — in the real board this opens the existing document editor.</p>
      </div>
    ) : (
      props.renderDocument(id)
    );

  const shared = { board, openId, open, doc };
  return (
    <>
      {props.variant === 'B' ? (
        <VariantB {...shared} />
      ) : props.variant === 'C' ? (
        <VariantC {...shared} />
      ) : (
        <VariantA {...shared} />
      )}
      <PrototypeSwitcher
        variants={BOARD_VARIANTS}
        current={props.variant}
        onChange={props.onVariantChange}
        sim={sim}
        onSimChange={setSim}
        onExit={props.onExit}
      />
    </>
  );
}

interface VariantProps {
  board: ProtoBoard;
  openId: string | null;
  open: (card: ProtoCard | null) => void;
  doc: (id: string) => ReactNode;
}

// ---------------------------------------------------------------- shared bits

function BoardChrome({ board, children }: { board: ProtoBoard; children: ReactNode }): JSX.Element {
  return (
    <div className="proto-board">
      <div className="proto-board-header">
        <strong>Board</strong>
        <span className="proto-muted">
          {board.cards.length} task{board.cards.length === 1 ? '' : 's'}
          {board.usingDemo && ' · illustrative data (no backlog items in this project)'}
        </span>
        {board.projectReadOnly && <span className="proto-badge proto-badge--ro">Read-only project</span>}
      </div>
      {board.error && (
        <div className="conflict-banner" role="alert">
          <span>{board.error.message}</span>
          <button type="button" onClick={board.dismissError}>
            Dismiss
          </button>
        </div>
      )}
      {board.lastArchived && (
        <div className="proto-toast" role="status">
          Archived "{board.lastArchived.title}".{' '}
          <button type="button" className="btn btn--link" onClick={board.undoArchive}>
            Undo
          </button>
        </div>
      )}
      {board.loading ? (
        <div className="proto-placeholder">Loading tasks…</div>
      ) : board.cards.length === 0 ? (
        <div className="proto-placeholder">
          No tasks yet. Create a document of type <code>backlog_item</code> to see it here.
        </div>
      ) : (
        children
      )}
    </div>
  );
}

function CardMeta({ card, board }: { card: ProtoCard; board: ProtoBoard }): JSX.Element {
  return (
    <span className="proto-card-meta">
      {card.draft && <span className="proto-badge">Draft</span>}
      {card.readOnly && <span className="proto-badge proto-badge--ro">Read-only</span>}
      {board.pending.has(card.id) && <span className="proto-badge proto-badge--saving">Saving…</span>}
      {card.tags.map((t) => (
        <span key={t} className="proto-tag">
          #{t}
        </span>
      ))}
    </span>
  );
}

function BackBar({ onBack }: { onBack: () => void }): JSX.Element {
  return (
    <div className="proto-backbar">
      <button type="button" className="btn btn--sm" onClick={onBack}>
        ← Back to board
      </button>
    </div>
  );
}

function byState(cards: ProtoCard[], s: TaskState): ProtoCard[] {
  return cards.filter((c) => c.state === s);
}

// ---------------------------------------------------------------- Variant A
// Classic columns replace the workspace pane. Drag-and-drop plus keyboard
// (Alt+←/→ on a focused card). Done cards get an Archive shortcut. Opening a
// card swaps the board for the existing editor with a back bar.

function VariantA({ board, openId, open, doc }: VariantProps): JSX.Element {
  const [dragOver, setDragOver] = useState<TaskState | null>(null);
  if (openId) {
    return (
      <div className="proto-docpane">
        <BackBar onBack={() => open(null)} />
        {doc(openId)}
      </div>
    );
  }
  const onKey = (card: ProtoCard) => (e: KeyboardEvent) => {
    if (e.key === 'Enter') open(card);
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const to = nextState(card.state, e.key === 'ArrowLeft' ? -1 : 1);
      if (to) board.move(card.id, to);
      // keep focus on the moved card after re-render
      const id = card.id;
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-card="${id}"]`)?.focus());
    }
  };
  const onDrop = (to: TaskState) => (e: DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData('text/plain');
    if (id) board.move(id, to);
  };
  return (
    <BoardChrome board={board}>
      <p className="proto-hint">
        Drag cards between columns, or focus a card and press <kbd>Alt</kbd>+<kbd>←</kbd>/<kbd>→</kbd>.{' '}
        <kbd>Enter</kbd> opens.
      </p>
      <div className="proto-columns">
        {TASK_STATES.map((s) => (
          <section
            key={s}
            className={'proto-column' + (dragOver === s ? ' proto-column--over' : '')}
            aria-label={TASK_STATE_LABELS[s]}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(s);
            }}
            onDragLeave={() => setDragOver(null)}
            onDrop={onDrop(s)}
          >
            <h3>
              {TASK_STATE_LABELS[s]} <span className="proto-muted">{byState(board.cards, s).length}</span>
            </h3>
            {byState(board.cards, s).map((card) => (
              <div
                key={card.id}
                data-card={card.id}
                className={'proto-card' + (card.readOnly ? ' proto-card--ro' : '')}
                tabIndex={0}
                role="button"
                aria-label={`${card.title}, ${TASK_STATE_LABELS[card.state]}${card.readOnly ? ', read-only' : ''}`}
                draggable={!card.readOnly}
                onDragStart={(e) => e.dataTransfer.setData('text/plain', card.id)}
                onKeyDown={onKey(card)}
                onClick={() => open(card)}
              >
                <span className="proto-card-title">{card.title}</span>
                <CardMeta card={card} board={board} />
                {s === 'done' && !card.readOnly && (
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost proto-card-action"
                    onClick={(e) => {
                      e.stopPropagation();
                      board.archive(card.id);
                    }}
                  >
                    Archive
                  </button>
                )}
              </div>
            ))}
          </section>
        ))}
      </div>
    </BoardChrome>
  );
}

// ---------------------------------------------------------------- Variant B
// Board stays visible as a narrow pane; the selected card's document docks on
// the right. Moves are explicit ◀ ▶ buttons on each card — no drag, no
// archive shortcut (archive via the document's metadata as today).

function VariantB({ board, openId, open, doc }: VariantProps): JSX.Element {
  return (
    <div className={'proto-split' + (openId ? ' proto-split--open' : '')}>
      <BoardChrome board={board}>
        <div className="proto-columns proto-columns--compact">
          {TASK_STATES.map((s) => (
            <section key={s} className="proto-column" aria-label={TASK_STATE_LABELS[s]}>
              <h3>
                {TASK_STATE_LABELS[s]} <span className="proto-muted">{byState(board.cards, s).length}</span>
              </h3>
              {byState(board.cards, s).map((card) => {
                const prev = nextState(card.state, -1);
                const next = nextState(card.state, 1);
                return (
                  <div
                    key={card.id}
                    className={
                      'proto-card' +
                      (card.readOnly ? ' proto-card--ro' : '') +
                      (openId === card.id ? ' proto-card--selected' : '')
                    }
                  >
                    <button type="button" className="proto-card-open" onClick={() => open(card)}>
                      {card.title}
                    </button>
                    <CardMeta card={card} board={board} />
                    {!card.readOnly && (
                      <span className="proto-card-moves">
                        <button
                          type="button"
                          className="btn btn--sm btn--ghost"
                          disabled={!prev || board.pending.has(card.id)}
                          onClick={() => prev && board.move(card.id, prev)}
                          aria-label={prev ? `Move to ${TASK_STATE_LABELS[prev]}` : 'No previous state'}
                        >
                          ◀
                        </button>
                        <button
                          type="button"
                          className="btn btn--sm btn--ghost"
                          disabled={!next || board.pending.has(card.id)}
                          onClick={() => next && board.move(card.id, next)}
                          aria-label={next ? `Move to ${TASK_STATE_LABELS[next]}` : 'No next state'}
                        >
                          ▶
                        </button>
                      </span>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </BoardChrome>
      {openId && (
        <div className="proto-docpane proto-docpane--docked">
          <div className="proto-backbar">
            <button type="button" className="btn btn--sm" onClick={() => open(null)}>
              Close ✕
            </button>
          </div>
          {doc(openId)}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Variant C
// Not columns at all: a grouped list. Each row carries a 3-way state picker
// (also keys 1/2/3 on a focused row). Dense, keyboard-first, no drag.

function VariantC({ board, openId, open, doc }: VariantProps): JSX.Element {
  if (openId) {
    return (
      <div className="proto-docpane">
        <BackBar onBack={() => open(null)} />
        {doc(openId)}
      </div>
    );
  }
  const onKey = (card: ProtoCard) => (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter') open(card);
    const i = ['1', '2', '3'].indexOf(e.key);
    if (i >= 0) {
      board.move(card.id, TASK_STATES[i]!);
      const id = card.id;
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-row="${id}"]`)?.focus());
    }
  };
  return (
    <BoardChrome board={board}>
      <p className="proto-hint">
        Focus a row: <kbd>1</kbd> To do · <kbd>2</kbd> In progress · <kbd>3</kbd> Done · <kbd>Enter</kbd> opens.
      </p>
      <div className="proto-list">
        {TASK_STATES.map((s) => (
          <section key={s} aria-label={TASK_STATE_LABELS[s]}>
            <h3 className="proto-list-heading">
              {TASK_STATE_LABELS[s]} <span className="proto-muted">{byState(board.cards, s).length}</span>
            </h3>
            {byState(board.cards, s).length === 0 && <div className="proto-list-empty">Nothing here.</div>}
            {byState(board.cards, s).map((card) => (
              <div
                key={card.id}
                data-row={card.id}
                className={'proto-row' + (card.readOnly ? ' proto-card--ro' : '')}
                tabIndex={0}
                onKeyDown={onKey(card)}
              >
                <button type="button" className="proto-card-open" onClick={() => open(card)}>
                  {card.title}
                </button>
                <CardMeta card={card} board={board} />
                <span className="proto-picker" role="radiogroup" aria-label={`State of ${card.title}`}>
                  {TASK_STATES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={card.state === t}
                      disabled={card.readOnly || board.pending.has(card.id)}
                      className={card.state === t ? 'is-on' : ''}
                      onClick={() => board.move(card.id, t)}
                    >
                      {TASK_STATE_LABELS[t]}
                    </button>
                  ))}
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </BoardChrome>
  );
}
