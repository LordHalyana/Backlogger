import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SearchHit } from '@backlogger/shared';
import { useSearch } from '../lib/search.js';

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onOpenDocument: (projectId: string, documentId: string) => void;
}

/**
 * Modal command palette. Ctrl/Cmd+K toggle is wired by the caller; this
 * component manages query state, keyboard navigation, and selection.
 */
export function CommandPalette(props: CommandPaletteProps): JSX.Element | null {
  const { open, onClose, onOpenDocument } = props;
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const { hits, isLoading, isError, error, debouncedQuery } = useSearch(query, { limit: 20 });

  // Reset when opened.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
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

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (hits.length > 0) setActiveIndex((i) => Math.min(hits.length - 1, i + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (hits.length > 0) setActiveIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const hit = hits[activeIndex];
      if (hit) {
        onOpenDocument(hit.project_id, hit.id);
        onClose();
      }
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
          }}
          spellCheck={false}
          autoComplete="off"
        />
        <div className="command-palette-status" aria-live="polite">
          {status}
        </div>
        <ul ref={listRef} className="command-palette-results" role="listbox">
          {hits.map((hit, index) => (
            <CommandPaletteRow
              key={hit.id}
              hit={hit}
              index={index}
              active={index === activeIndex}
              onActivate={() => {
                onOpenDocument(hit.project_id, hit.id);
                onClose();
              }}
              onHover={() => setActiveIndex(index)}
            />
          ))}
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
          {hit.project_id} &middot; {hit.type}
        </span>
      </div>
      <div className="command-palette-row-snippet">{hit.snippet}</div>
    </li>
  );
}
