// PROTOTYPE — throwaway, issue #59. Three structurally different Comments tab layouts.
import { useEffect, useState } from 'react';
import { fmtTime, type Model } from './model.js';
import {
  canWrite,
  CommentBlock,
  Composer,
  EmptyState,
  LiveRegion,
  LoadMore,
  Markdown,
  Notices,
} from './parts.js';

/**
 * A — Thread, composer docked at the bottom (GitHub-like).
 * History scrolls; the composer is docked under it so it is always reachable.
 * "Add comment" in the toolbar just focuses the docked composer.
 * Delete confirms inline inside the comment block.
 */
export function VariantA({ m }: { m: Model }): JSX.Element {
  return (
    <div className="pc-root pc-a">
      <LiveRegion m={m} />
      <Notices m={m} />
      <div className="pc-toolbar">
        <span className="pc-hint">{m.comments.length} comments · oldest first</span>
        {canWrite(m) && (
          <button id="add-comment" type="button" className="btn btn--sm" onClick={m.openComposer}>
            Add comment
          </button>
        )}
      </div>
      <div className="pc-scroll" id="pc-history">
        {m.comments.length === 0 ? (
          <p className="pc-empty-inline">No comments yet. Write the first one below.</p>
        ) : (
          m.visible.map((c) => <CommentBlock key={c.id} m={m} c={c} deleteStyle="inline" />)
        )}
        <LoadMore m={m} />
      </div>
      <div className="pc-dock">
        {m.composer.open || m.composer.draft ? (
          <Composer m={m} />
        ) : canWrite(m) ? (
          <button type="button" className="pc-fake-input" onClick={m.openComposer}>
            Write a comment…
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * B — Composer on top (Jira-like).
 * "Add comment" expands a composer above the history; history runs oldest
 * first beneath with Load more at the end. Delete uses the shared modal dialog.
 */
export function VariantB({ m }: { m: Model }): JSX.Element {
  const showComposer = m.composer.open || !!m.composer.draft;
  return (
    <div className="pc-root pc-b">
      <LiveRegion m={m} />
      <div className="pc-scroll">
        <Notices m={m} />
        {m.comments.length === 0 && !showComposer ? (
          <EmptyState m={m} />
        ) : (
          <>
            <div className="pc-b-top">
              {showComposer ? (
                <Composer m={m} />
              ) : (
                canWrite(m) && (
                  <button
                    id="add-comment"
                    type="button"
                    className="btn pc-primary"
                    onClick={m.openComposer}
                  >
                    Add comment
                  </button>
                )
              )}
            </div>
            <h2 className="pc-section-h">
              History <span className="pc-hint">{m.comments.length} · oldest first</span>
            </h2>
            {m.visible.map((c) => (
              <CommentBlock key={c.id} m={m} c={c} deleteStyle="dialog" />
            ))}
            <LoadMore m={m} />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * C — List and reader (mail-like).
 * A narrow list of comments (date + first line) on the left, the selected
 * comment or the composer full-width on the right. Up/Down move through the
 * list; Enter opens. Delete confirms inline in the reader.
 */
export function VariantC({ m }: { m: Model }): JSX.Element {
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const sel =
    selected === 'new' || m.composer.open
      ? 'new'
      : (selected ?? m.edit?.id ?? m.visible[m.visible.length - 1]?.id ?? null);
  const current = m.visible.find((c) => c.id === sel);

  // After a post the model focuses the new comment's article; follow it in the list.
  useEffect(() => {
    if (m.lastFocus.startsWith('c-') && !m.lastFocus.includes('-', 2))
      setSelected(m.lastFocus.slice(2));
  }, [m.lastFocus]);

  const ids = m.visible.map((c) => c.id);
  const onListKey = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = sel ? ids.indexOf(sel) : -1;
    const next = ids[Math.max(0, Math.min(ids.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) {
      setSelected(next);
      document.getElementById(`pc-li-${next}`)?.focus();
    }
  };

  return (
    <div className="pc-root pc-c">
      <LiveRegion m={m} />
      <Notices m={m} />
      <div className="pc-c-grid">
        <nav className="pc-c-list" aria-label="Comments">
          {canWrite(m) && (
            <button
              id="add-comment"
              type="button"
              className={'pc-c-item pc-c-new' + (sel === 'new' ? ' active' : '')}
              onClick={() => {
                setSelected('new');
                m.openComposer();
              }}
            >
              + New comment{m.composer.draft ? ' (draft)' : ''}
            </button>
          )}
          <ul role="listbox" aria-label="Comment history, oldest first" onKeyDown={onListKey}>
            {m.visible.map((c) => (
              <li key={c.id}>
                <button
                  id={`pc-li-${c.id}`}
                  role="option"
                  aria-selected={sel === c.id}
                  tabIndex={sel === c.id || (!ids.includes(sel ?? '') && c.id === ids[0]) ? 0 : -1}
                  type="button"
                  className={'pc-c-item' + (sel === c.id ? ' active' : '')}
                  onClick={() => {
                    if (m.composer.open && !m.composer.draft) m.cancelComposer();
                    setSelected(c.id);
                  }}
                >
                  <span className="pc-c-date">
                    {fmtTime(c.createdAt)}
                    {c.editedAt ? ' · edited' : ''}
                    {m.edit?.id === c.id ? ' · editing' : ''}
                  </span>
                  <span className="pc-c-snip">{c.body.replace(/[#>*`]/g, '').slice(0, 80)}</span>
                </button>
              </li>
            ))}
          </ul>
          {m.comments.length === 0 && <p className="pc-hint pc-pad">No comments yet.</p>}
          <LoadMore m={m} />
        </nav>
        <section className="pc-c-reader" aria-label="Selected comment">
          {sel === 'new' ? (
            <Composer m={m} />
          ) : current ? (
            <CommentBlock m={m} c={current} deleteStyle="inline" flat />
          ) : m.comments.length === 0 ? (
            <EmptyState m={m} />
          ) : (
            <Markdown body="_Select a comment._" />
          )}
        </section>
      </div>
    </div>
  );
}

export const VARIANTS = [
  { key: 'A', name: 'Thread, docked composer', C: VariantA },
  { key: 'B', name: 'Composer on top', C: VariantB },
  { key: 'C', name: 'List + reader', C: VariantC },
] as const;
