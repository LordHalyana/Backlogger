import { useCallback, useEffect, useRef, useState } from 'react';
import {
  readWorkspaceFromUrl,
  syncWorkspaceUrl,
} from '../lib/workspace-url.js';

export interface WorkspaceSelection {
  /** Currently selected project, or `null` when none is chosen. */
  projectId: string | null;
  /** Currently open document within the selected project, or `null`. */
  documentId: string | null;
  /** Active tag filters for the document tree. */
  tags: string[];
  /**
   * Select a project.  Switching to a different project clears the open
   * document and tag filters so we never show stale state from the previous
   * project.  Selecting the same project is a no-op.
   */
  selectProject: (id: string | null) => void;
  /** Open (or clear, with `null`) a document in the current project. */
  selectDocument: (id: string | null) => void;
  /**
   * Open a document, switching projects first if necessary.  Project and
   * document are updated in the same event handler so React batches them into
   * one render — the target document is never clobbered by the project switch.
   */
  openDocument: (projectId: string, documentId: string) => void;
  /** Toggle a tag in the active filter set. */
  toggleTag: (tag: string) => void;
  /** Clear all active tag filters. */
  clearTags: () => void;
  /** Remove a single tag from the active filter set. */
  removeTag: (tag: string) => void;
  /** Clear the open document if its id appears in `removedIds` (e.g. after reload). */
  clearDocumentIfRemoved: (removedIds: string[]) => void;
}

/**
 * Owns the cohesive "what is the user looking at" state for the workspace:
 * the selected project, the open document, and the active tag filters, plus the
 * transitions between them.  Project-switch resets are modeled explicitly in
 * the setters rather than reacting to a `projectId` change in an effect, which
 * removes the previous `setTimeout` ordering workaround in `App.tsx`.
 */
export function useWorkspaceSelection(): WorkspaceSelection {
  // Restore the project/document selection from the URL so refreshes and
  // deep-links land on the same place.
  const initial = readWorkspaceFromUrl();
  const [projectId, setProjectId] = useState<string | null>(initial.projectId);
  const [documentId, setDocumentId] = useState<string | null>(initial.documentId);
  const [tags, setTags] = useState<string[]>([]);
  // Mirror of projectId so the stable callbacks can compare against the current
  // value without depending on it (and being recreated every selection).
  const projectIdRef = useRef<string | null>(initial.projectId);

  // Reflect project/document selection into the URL path (preserving any
  // `?help=` query / hash). Only project + document are URL-synced; tags stay
  // local state. Skipped when the path already matches (initial load, popstate).
  useEffect(() => {
    syncWorkspaceUrl(projectId, documentId);
  }, [projectId, documentId]);

  // Back/forward navigation maps to workspace navigation: re-read the URL and
  // apply it. The sync effect above then sees a matching path and does not push.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onPopState = (): void => {
      const next = readWorkspaceFromUrl();
      projectIdRef.current = next.projectId;
      setProjectId(next.projectId);
      setDocumentId(next.documentId);
      setTags([]);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const selectProject = useCallback((id: string | null): void => {
    if (projectIdRef.current === id) return;
    projectIdRef.current = id;
    setProjectId(id);
    setDocumentId(null);
    setTags([]);
  }, []);

  const selectDocument = useCallback((id: string | null): void => {
    setDocumentId(id);
  }, []);

  const openDocument = useCallback((nextProjectId: string, nextDocumentId: string): void => {
    if (projectIdRef.current !== nextProjectId) {
      projectIdRef.current = nextProjectId;
      setProjectId(nextProjectId);
      setTags([]);
    }
    setDocumentId(nextDocumentId);
  }, []);

  const toggleTag = useCallback((tag: string): void => {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }, []);

  const clearTags = useCallback((): void => setTags([]), []);

  const removeTag = useCallback((tag: string): void => {
    setTags((prev) => prev.filter((t) => t !== tag));
  }, []);

  const clearDocumentIfRemoved = useCallback((removedIds: string[]): void => {
    setDocumentId((current) => (current && removedIds.includes(current) ? null : current));
  }, []);

  return {
    projectId,
    documentId,
    tags,
    selectProject,
    selectDocument,
    openDocument,
    toggleTag,
    clearTags,
    removeTag,
    clearDocumentIfRemoved,
  };
}
