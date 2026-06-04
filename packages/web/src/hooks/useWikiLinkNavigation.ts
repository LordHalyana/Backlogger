import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTitles, type TitleRow } from '../lib/links.js';

interface UseWikiLinkNavigationOptions {
  projectId: string | null;
  onNavigate: (projectId: string, documentId: string) => void;
}

/**
 * Registers a delegated click listener on `window` that intercepts clicks on
 * `a.wiki-link` elements rendered by the Markdown preview.  Resolves the link
 * title against the cached titles list and calls `onNavigate` when a match is
 * found, or marks the link as broken when no match exists.
 *
 * Extracted from App.tsx (Phase 4 / Block 1).
 */
export function useWikiLinkNavigation({
  projectId,
  onNavigate,
}: UseWikiLinkNavigationOptions): void {
  const qc = useQueryClient();
  const titlesQuery = useTitles(projectId);
  const titlesRef = useRef<readonly TitleRow[]>([]);

  useEffect(() => {
    titlesRef.current = titlesQuery.data ?? [];
  }, [titlesQuery.data]);

  useEffect(() => {
    if (!projectId) return;

    const onClick = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLElement>('a.wiki-link');
      if (!anchor) return;
      event.preventDefault();
      const title = anchor.getAttribute('data-title');
      if (!title) return;
      const norm = title.trim().toLowerCase();
      const hit = titlesRef.current.find((t) => t.title.trim().toLowerCase() === norm);
      if (hit) {
        void qc.invalidateQueries({ queryKey: ['titles'] });
        onNavigate(hit.project_id, hit.id);
      } else {
        anchor.classList.add('broken');
      }
    };

    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, [projectId, onNavigate, qc]);
}
