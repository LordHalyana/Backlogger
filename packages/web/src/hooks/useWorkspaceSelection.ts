import { useCallback, useEffect, useRef, useState } from 'react';
import {
  readTriageFromUrl,
  readWorkspaceFromUrl,
  syncWorkspaceUrl,
  type WorkspaceView,
} from '../lib/workspace-url.js';
import { useConfirmLeave } from '../lib/leave-guard.js';

export interface WorkspaceSelection {
  /** Currently selected project, or `null` when none is chosen. */
  projectId: string | null;
  /** Currently open document within the selected project, or `null`. */
  documentId: string | null;
  /**
   * Documents or Board. A document opened in the Board view keeps that view
   * (its URL is `/board/documents/:id`), so the editor can link back.
   */
  view: WorkspaceView;
  /** Active tag filters for the document tree. */
  tags: string[];
  /** ⌂ Inbox triage mode, in place of a project. */
  triage: boolean;
  /** Enter triage mode; selecting a project or opening a document leaves it. */
  openTriage: () => void;
  /**
   * Select a project.  Switching to a different project clears the open
   * document and tag filters so we never show stale state from the previous
   * project.  Selecting the same project is a no-op.
   */
  selectProject: (id: string | null) => void;
  /** Switch the project between the Documents and Board views. */
  selectView: (view: WorkspaceView) => void;
  /** Open a document picked in the tree: always the Documents view. */
  selectTreeDocument: (id: string) => void;
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
  const [view, setView] = useState<WorkspaceView>(initial.view);
  const [tags, setTags] = useState<string[]>([]);
  const [triage, setTriage] = useState<boolean>(() => readTriageFromUrl());
  // Mirror of projectId so the stable callbacks can compare against the current
  // value without depending on it (and being recreated every selection).
  const projectIdRef = useRef<string | null>(initial.projectId);
  // Mirrors of the open document and view, for the leave guard and for
  // putting the URL back when the user stays.
  const documentIdRef = useRef<string | null>(initial.documentId);
  documentIdRef.current = documentId;
  const viewRef = useRef<WorkspaceView>(initial.view);
  viewRef.current = view;
  const triageRef = useRef(triage);
  triageRef.current = triage;
  const confirmLeave = useConfirmLeave();
  /** Run `go` now, or after Stay / Discard and leave when it would close a task with a comment draft. */
  const leaveTo = useCallback(
    (nextDocumentId: string | null, go: () => void, stay?: () => void): void => {
      if (nextDocumentId === documentIdRef.current) go();
      else confirmLeave(go, stay);
    },
    [confirmLeave],
  );

  // Reflect project/view/document selection into the URL path (preserving any
  // `?help=` query / hash). Tags stay local state. Skipped when the path
  // already matches (initial load, popstate).
  useEffect(() => {
    syncWorkspaceUrl(projectId, documentId, view, triage);
  }, [projectId, documentId, view, triage]);

  // Back/forward navigation maps to workspace navigation: re-read the URL and
  // apply it. The sync effect above then sees a matching path and does not push.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onPopState = (): void => {
      const next = readWorkspaceFromUrl();
      const stayProjectId = projectIdRef.current;
      leaveTo(
        next.documentId,
        () => {
          projectIdRef.current = next.projectId;
          setProjectId(next.projectId);
          setDocumentId(next.documentId);
          setView(next.view);
          setTags([]);
          setTriage(readTriageFromUrl());
        },
        // The browser already moved the URL; put it back on the task.
        () =>
          syncWorkspaceUrl(
            stayProjectId,
            documentIdRef.current,
            viewRef.current,
            triageRef.current,
          ),
      );
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [leaveTo]);

  const openTriage = useCallback((): void => {
    leaveTo(null, () => {
      projectIdRef.current = null;
      setProjectId(null);
      setDocumentId(null);
      setView('documents');
      setTags([]);
      setTriage(true);
    });
  }, [leaveTo]);

  const selectProject = useCallback(
    (id: string | null): void => {
      if (projectIdRef.current === id) {
        setTriage(false);
        return;
      }
      leaveTo(null, () => {
        setTriage(false);
        projectIdRef.current = id;
        setProjectId(id);
        setDocumentId(null);
        setView('documents');
        setTags([]);
      });
    },
    [leaveTo],
  );

  const selectView = useCallback(
    (next: WorkspaceView): void => {
      leaveTo(null, () => {
        setView(next);
        setDocumentId(null);
      });
    },
    [leaveTo],
  );

  const selectDocument = useCallback(
    (id: string | null): void => {
      leaveTo(id, () => setDocumentId(id));
    },
    [leaveTo],
  );

  const selectTreeDocument = useCallback(
    (id: string): void => {
      leaveTo(id, () => {
        setView('documents');
        setDocumentId(id);
      });
    },
    [leaveTo],
  );

  const openDocument = useCallback(
    (nextProjectId: string, nextDocumentId: string): void => {
      leaveTo(nextDocumentId, () => {
        setTriage(false);
        if (projectIdRef.current !== nextProjectId) {
          projectIdRef.current = nextProjectId;
          setProjectId(nextProjectId);
          setTags([]);
        }
        setDocumentId(nextDocumentId);
      });
    },
    [leaveTo],
  );

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
    view,
    tags,
    triage,
    openTriage,
    selectProject,
    selectView,
    selectTreeDocument,
    selectDocument,
    openDocument,
    toggleTag,
    clearTags,
    removeTag,
    clearDocumentIfRemoved,
  };
}
