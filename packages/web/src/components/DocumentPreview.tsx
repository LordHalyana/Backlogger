import { useEffect, useMemo, useRef } from 'react';
import type { MouseEvent } from 'react';
import { renderMarkdown, type DocumentSummary } from '@backlogger/shared';
import { findMatchingBlock, markTerms, type Landing } from '../lib/landing.js';

interface DocumentPreviewProps {
  body: string;
  projectId?: string;
  currentPath?: string;
  docs?: readonly DocumentSummary[];
  onOpenDocument?: (projectId: string, documentId: string) => void;
  /** A Description match: mark and focus the matching paragraph. */
  landing?: Extract<Landing, { kind: 'description' }> | null;
}

/** Resolve a relative POSIX-style path against a base file's directory. */
function resolveRelative(basePath: string, href: string): string {
  const hashIdx = href.search(/[?#]/);
  const cleanHref = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
  if (!cleanHref) return '';
  const baseDir = basePath.includes('/') ? basePath.slice(0, basePath.lastIndexOf('/')) : '';
  const parts = (baseDir ? baseDir.split('/') : []).concat(cleanHref.split('/'));
  const out: string[] = [];
  for (const seg of parts) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length === 0) return '';
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.join('/');
}

export function DocumentPreview({
  body,
  projectId,
  currentPath,
  docs,
  onOpenDocument,
  landing = null,
}: DocumentPreviewProps): JSX.Element {
  const html = useMemo(() => renderMarkdown(body), [body]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const markedLanding = useRef<number | null>(null);
  useEffect(() => {
    if (!landing || markedLanding.current === landing.key || !rootRef.current) return;
    markedLanding.current = landing.key;
    rootRef.current.querySelector('.is-search-match')?.classList.remove('is-search-match');
    const block = findMatchingBlock(rootRef.current, landing.terms);
    if (!block) return;
    markTerms(block, landing.terms);
    block.classList.add('is-search-match');
    block.tabIndex = -1;
    block.focus({ preventScroll: true });
    block.scrollIntoView?.({ block: 'center' });
  }, [landing, html]);
  const ctxRef = useRef({ projectId, currentPath, docs, onOpenDocument });
  ctxRef.current = { projectId, currentPath, docs, onOpenDocument };

  const handleClick = (event: MouseEvent<HTMLDivElement>): void => {
    const target = event.target as Element | null;
    if (!target) return;
    const anchor = target.closest('a');
    if (!anchor) return;
    // Let the global wiki-link handler in App.tsx handle these.
    if (anchor.classList.contains('wiki-link')) return;
    if (event.defaultPrevented) return;
    // Respect modifier keys / middle-click: let the browser handle those.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.button !== 0) return;
    const href = anchor.getAttribute('href');
    if (!href) return;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return; // scheme (http:, mailto:, …)
    if (href.startsWith('#')) return;
    if (href.startsWith('/')) return;
    if (href.startsWith('//')) return;

    const hashIdx = href.search(/[?#]/);
    const cleanHref = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
    if (!/\.md$/i.test(cleanHref)) return;

    const { projectId: pid, currentPath: cur, docs: list, onOpenDocument: open } = ctxRef.current;
    if (!pid || !cur || !list || !open) return;

    const resolved = resolveRelative(cur, href);
    const hit = list.find((d) => d.path === resolved);
    // Always prevent the browser from following relative .md hrefs so the
    // SPA doesn't navigate away, even if the target can't be matched.
    event.preventDefault();
    if (hit) {
      open(pid, hit.id);
    } else {
      anchor.classList.add('broken');
    }
  };

  return (
    <div
      ref={rootRef}
      className="document-preview markdown-body"
      onClick={handleClick}
      // eslint-disable-next-line react/no-danger
      // Trust boundary: HTML is produced by the shared markdown renderer from
      // local Markdown files only. Raw HTML is not accepted from untrusted input.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
