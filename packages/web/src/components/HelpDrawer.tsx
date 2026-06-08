import { useEffect, useMemo, useState } from 'react';
import { renderMarkdown } from '@backlogger/shared';
import { HELP_CHAPTERS, findChapter, type HelpChapter } from '../help/index.js';
import { writeHelpSlugToUrl } from '../lib/help-link.js';

interface HelpDrawerProps {
  open: boolean;
  initialSlug?: string | null;
  onClose: () => void;
}

export function HelpDrawer({ open, initialSlug, onClose }: HelpDrawerProps): JSX.Element | null {
  const initial = findChapter(initialSlug) ?? HELP_CHAPTERS[0]!;
  const [activeSlug, setActiveSlug] = useState<string>(initial.slug);
  const [query, setQuery] = useState<string>('');

  // When the drawer opens with a fresh initialSlug, jump to that chapter.
  useEffect(() => {
    if (open) {
      const target = findChapter(initialSlug) ?? HELP_CHAPTERS[0]!;
      setActiveSlug(target.slug);
    }
  }, [open, initialSlug]);

  // Sync the URL whenever the active chapter changes (only while open).
  useEffect(() => {
    if (open) writeHelpSlugToUrl(activeSlug);
  }, [open, activeSlug]);

  // Esc closes the drawer.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const filtered = useMemo<readonly HelpChapter[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return HELP_CHAPTERS;
    return HELP_CHAPTERS.filter(
      (c) => c.title.toLowerCase().includes(q) || c.body.toLowerCase().includes(q),
    );
  }, [query]);

  const active = findChapter(activeSlug) ?? HELP_CHAPTERS[0]!;
  const html = useMemo(() => renderMarkdown(active.body), [active]);

  if (!open) return null;

  return (
    <div className="help-drawer-backdrop" onClick={onClose}>
      <aside
        className="help-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Help"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="help-drawer-header">
          <h2>Help</h2>
          <button
            type="button"
            className="modal-close"
            onClick={() => {
              writeHelpSlugToUrl(null);
              onClose();
            }}
            aria-label="Close help"
          >
            ×
          </button>
        </header>
        <div className="help-drawer-body">
          <nav className="help-drawer-nav" aria-label="Help chapters">
            <input
              className="help-drawer-search"
              type="search"
              placeholder="Filter chapters…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Filter help chapters"
            />
            <ul>
              {filtered.map((c) => (
                <li key={c.slug}>
                  <button
                    type="button"
                    className={c.slug === activeSlug ? 'active' : ''}
                    onClick={() => setActiveSlug(c.slug)}
                  >
                    {c.title}
                  </button>
                </li>
              ))}
              {filtered.length === 0 && <li className="empty">No matching chapters.</li>}
            </ul>
          </nav>
          <article
            className="help-drawer-content markdown-body"
            // eslint-disable-next-line react/no-danger
            // Trust boundary: HTML is rendered from bundled help content authored
            // in this repo. No user-supplied or imported content is rendered here.
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </aside>
    </div>
  );
}
