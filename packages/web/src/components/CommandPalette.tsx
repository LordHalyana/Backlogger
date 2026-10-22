import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  TASK_STATE_LABELS,
  taskStateColumn,
  type DocumentSummary,
  type SearchHit,
} from '@backlogger/shared';
import { useSearch } from '../lib/search.js';
import { ApiError, apiFetch } from '../lib/api.js';
import { queryTerms, type LandingTarget } from '../lib/landing.js';
import { invalidateSearch } from '../lib/query-keys.js';
import { DOCUMENT_TYPE_LABELS } from '../lib/display.js';

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  /** Open a result in its document's current project, landing on what matched. */
  onOpenDocument: (projectId: string, documentId: string, landing: LandingTarget) => void;
}

/** A result whose document was deleted, kept in place to say so. */
interface GoneRow {
  hit: SearchHit;
  index: number;
}

/**
 * Modal command palette. Ctrl/Cmd+K toggle is wired by the caller; this
 * component manages query state, keyboard navigation, and selection.
 */
export function CommandPalette(props: CommandPaletteProps): JSX.Element | null {
  const { open, onClose, onOpenDocument } = props;
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [gone, setGone] = useState<GoneRow | null>(null);
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const { hits, isLoading, isError, error, debouncedQuery } = useSearch(query, { limit: 20 });

  // Reset when opened.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      setGone(null);
      // Focus once mounted.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Clamp active index when results change.
  useEffect(() => {
    if (activeIndex >= hits.length) setActiveIndex(Math.max(0, hits.length - 1));
  }, [hits.length, activeIndex]);

  // Scroll the active row into view when navigating with the keyboard.
  useEffect(() => {
    const li = listRef.current?.querySelector<HTMLLIElement>(
      `li[data-index="${activeIndex}"]`,
    );
    li?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const status = useMemo(() => {
    if (debouncedQuery.length < 2) return 'Type at least 2 characters to search.';
    if (isError) return `Search failed: ${error?.message ?? 'unknown error'}`;
    if (isLoading) return 'Searching…';
    if (hits.length === 0) return 'No results.';
    return `${hits.length} result${hits.length === 1 ? '' : 's'}`;
  }, [debouncedQuery, isError, isLoading, hits.length, error]);

  if (!open) return null;

  /**
   * Check the document still exists, then open it where it lives now. A
   * deleted one says so in its row and the results refresh without it.
   */
  const activate = async (hit: SearchHit, index: number): Promise<void> => {
    // Filing moves a task; open it where it is now. Any other failure opens
    // it where the result says, and the workspace reports the error.
    let projectId = hit.project_id;
    try {
      projectId = (await apiFetch<DocumentSummary>(`/api/documents/${hit.id}`)).project_id;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setGone({ hit, index });
        invalidateSearch(qc);
        return;
      }
    }
    const terms = queryTerms(debouncedQuery);
    onOpenDocument(
      projectId,
      hit.id,
      hit.match.kind === 'comment'
        ? { kind: 'comment', commentId: hit.match.comment_id, terms }
        : { kind: 'description', terms },
    );
    onClose();
  };

  // The rows: the results, with a deleted one kept where it was.
  const rows: Array<{ hit: SearchHit; gone: boolean }> = hits
    .filter((h) => h.id !== gone?.hit.id)
    .map((h) => ({ hit: h, gone: false }));
  if (gone) rows.splice(Math.min(gone.index, rows.length), 0, { hit: gone.hit, gone: true });

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (rows.length > 0) setActiveIndex((i) => Math.min(rows.length - 1, i + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (rows.length > 0) setActiveIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const row = rows[activeIndex];
      if (row && !row.gone) void activate(row.hit, activeIndex);
    }
  };

  const node = (
    <div
      className="command-palette-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search documents"
        onKeyDown={handleKeyDown}
      >
        <input
          ref={inputRef}
          className="command-palette-input"
          type="search"
          placeholder="Search documents…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setGone(null);
          }}
          spellCheck={false}
          autoComplete="off"
        />
        <div className="command-palette-status" aria-live="polite">
          {status}
        </div>
        <ul ref={listRef} className="command-palette-results" role="listbox">
          {rows.map(({ hit, gone: isGone }, index) =>
            isGone ? (
              <li
                key={hit.id}
                data-index={index}
                role="option"
                aria-selected={index === activeIndex}
                aria-disabled="true"
                className="command-palette-row is-gone"
              >
                {hit.type === 'backlog_item'
                  ? 'This task is no longer available.'
                  : 'This document is no longer available.'}
              </li>
            ) : (
              <CommandPaletteRow
                key={hit.id}
                hit={hit}
                index={index}
                active={index === activeIndex}
                onActivate={() => void activate(hit, index)}
                onHover={() => setActiveIndex(index)}
              />
            ),
          )}
        </ul>
        <div className="command-palette-footer">
          <kbd>↑</kbd> <kbd>↓</kbd> navigate &middot; <kbd>Enter</kbd> open &middot; <kbd>Esc</kbd> close
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}

interface CommandPaletteRowProps {
  hit: SearchHit;
  index: number;
  active: boolean;
  onActivate: () => void;
  onHover: () => void;
}

function CommandPaletteRow(props: CommandPaletteRowProps): JSX.Element {
  const { hit, index, active, onActivate, onHover } = props;
  return (
    <li
      data-index={index}
      role="option"
      aria-selected={active}
      className={active ? 'command-palette-row active' : 'command-palette-row'}
      onMouseMove={onHover}
      onClick={onActivate}
    >
      <div className="command-palette-row-title">
        <span className="command-palette-row-doc">{hit.title}</span>
        <span className="command-palette-row-meta">
          {hit.status === 'archived' && <span className="command-palette-chip">Archived</span>}
          <span>{hit.project_id}</span>
          <span aria-hidden="true">&middot;</span>
          <span>{stateLabel(hit)}</span>
        </span>
      </div>
      <div className="command-palette-row-match">
        <span className="command-palette-chip">{matchLabel(hit)}</span>
        <span className="command-palette-row-snippet">
          <Highlighted text={hit.snippet} ranges={hit.highlights} />
        </span>
      </div>
    </li>
  );
}

/** A backlog item's task state; any other document's type. */
function stateLabel(hit: SearchHit): string {
  if (hit.type === 'backlog_item') return TASK_STATE_LABELS[taskStateColumn(hit.task_state)];
  return DOCUMENT_TYPE_LABELS[hit.type];
}

function matchLabel(hit: SearchHit): string {
  if (hit.match.kind === 'description') return 'Description match';
  const date = new Date(hit.match.created_at).toLocaleDateString(undefined, { dateStyle: 'medium' });
  return `Comment match · ${date}`;
}

/** `text` with the `[start, end)` ranges wrapped in `<mark>`. */
function Highlighted(props: { text: string; ranges: SearchHit['highlights'] }): JSX.Element {
  const { text, ranges } = props;
  const parts: Array<string | JSX.Element> = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start < at || end <= start) continue;
    if (start > at) parts.push(text.slice(at, start));
    parts.push(<mark key={start}>{text.slice(start, end)}</mark>);
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}
