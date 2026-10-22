import { useCallback, useEffect, useRef, useState } from 'react';
import {
  readCommentFromUrl,
  readTriageFromUrl,
  historyIndex,
  readWorkspaceFromUrl,
  syncWorkspaceUrl,
  type WorkspaceView,
} from '../lib/workspace-url.js';
import { useConfirmLeave } from '../lib/leave-guard.js';
import { keyLanding, type Landing, type LandingTarget } from '../lib/landing.js';

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
  /**
   * Where the open document lands: a comment (from search or a comment link,
   * which the URL then carries) or the description's matching paragraph.
   * Moving to another document drops it.
   */
  landing: Landing | null;
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
   * `landing` lands on a comment or the matching paragraph, each time anew.
   */
  openDocument: (projectId: string, documentId: string, landing?: LandingTarget) => void;
  /**
   * The open document lives in `projectId` now (a link from before it was
   * filed): switch to it in place, replacing the history entry and keeping
   * the landing.
   */
  relocateProject: (projectId: string) => void;
  /** Toggle a tag in the active filter set. */
  toggleTag: (tag: string) => void;
  /** Clear all active tag filters. */
  clearTags: () => void;
  /** Remove a single tag from the active filter set. */
  removeTag: (tag: string) => void;
  /** Clear the open document if its id appears in `removedIds` (e.g. after reload). */
  clearDocumentIfRemoved: (removedIds: string[]) => void;
}

/** What the workspace shows; every navigation moves from one of these to the next. */
interface Selection {
  projectId: string | null;
  documentId: string | null;
  view: WorkspaceView;
  triage: boolean;
  landing: Landing | null;
}

/** The landing a comment link in the current URL asks for. */
function landingFromUrl(): Landing | null {
  const commentId = readCommentFromUrl();
  return commentId ? keyLanding({ kind: 'comment', commentId, terms: [] }) : null;
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
  const [landing, setLanding] = useState<Landing | null>(landingFromUrl);
  // Mirrors of the selection so the stable callbacks can build the next one
  // without depending on (and being recreated by) every change.
  const current = useRef<Selection>({ ...initial, triage, landing });
  current.current = { projectId, documentId, view, triage, landing };
  // Set by a redirect, so the URL sync rewrites the entry instead of adding one.
  const replaceUrl = useRef(false);
  const confirmLeave = useConfirmLeave();

  /**
   * The one way the selection changes. Moving off the open document runs
   * through the leave guard (Stay / Discard and leave while a comment is
   * unsaved); `stay` runs when the user stays.
   */
  const navigate = useCallback(
    (next: Selection, options: { clearTags?: boolean; stay?: () => void } = {}): void => {
      const go = (): void => {
        const prev = current.current;
        current.current = next;
        setProjectId(next.projectId);
        setDocumentId(next.documentId);
        setView(next.view);
        setTriage(next.triage);
        setLanding(next.landing);
        if (options.clearTags || next.projectId !== prev.projectId) setTags([]);
      };
      if (next.documentId === current.current.documentId) go();
      else confirmLeave(go, options.stay);
    },
    [confirmLeave],
  );

  // The history entry the workspace is showing, to undo a back/forward the
  // user cancels at the leave prompt.
  const shownIndex = useRef(historyIndex());

  // Reflect project/view/document selection into the URL path (preserving any
  // `?help=` query / hash). Tags stay local state. Skipped when the path
  // already matches (initial load, popstate).
  const landedCommentId = landing?.kind === 'comment' ? landing.commentId : null;
  useEffect(() => {
    syncWorkspaceUrl(projectId, documentId, view, triage, {
      commentId: landedCommentId,
      replace: replaceUrl.current,
    });
    replaceUrl.current = false;
    shownIndex.current = historyIndex();
  }, [projectId, documentId, view, triage, landedCommentId]);

  // Back/forward navigation maps to workspace navigation: re-read the URL and
  // apply it. The sync effect above then sees a matching path and does not push.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    // Set while `history.go` is returning to the shown entry after Stay.
    let returning = false;
    const onPopState = (): void => {
      const index = historyIndex();
      if (returning && index === shownIndex.current) {
        returning = false;
        return;
      }
      const {
        projectId: nextProjectId,
        documentId: nextDocumentId,
        view: nextView,
      } = readWorkspaceFromUrl();
      navigate(
        {
          projectId: nextProjectId,
          documentId: nextDocumentId,
          view: nextView,
          triage: readTriageFromUrl(),
          landing: landingFromUrl(),
        },
        {
          clearTags: true,
          // The browser already moved; step back to the task's entry, which
          // keeps the history on both sides of it.
          stay: () => {
            const delta = shownIndex.current - index;
            if (delta === 0) return;
            returning = true;
            window.history.go(delta);
          },
        },
      );
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [navigate]);

  const openTriage = useCallback((): void => {
    navigate(
      { projectId: null, documentId: null, view: 'documents', triage: true, landing: null },
      { clearTags: true },
    );
  }, [navigate]);

  const selectProject = useCallback(
    (id: string | null): void => {
      const now = current.current;
      if (now.projectId === id) navigate({ ...now, triage: false });
      else {
        navigate({
          projectId: id,
          documentId: null,
          view: 'documents',
          triage: false,
          landing: null,
        });
      }
    },
    [navigate],
  );

  const selectView = useCallback(
    (next: WorkspaceView): void => {
      navigate({ ...current.current, view: next, documentId: null, landing: null });
    },
    [navigate],
  );

  const selectDocument = useCallback(
    (id: string | null): void => {
      navigate({ ...current.current, documentId: id, landing: null });
    },
    [navigate],
  );

  const selectTreeDocument = useCallback(
    (id: string): void => {
      navigate({ ...current.current, view: 'documents', documentId: id, landing: null });
    },
    [navigate],
  );

  const openDocument = useCallback(
    (nextProjectId: string, nextDocumentId: string, target?: LandingTarget): void => {
      navigate({
        ...current.current,
        projectId: nextProjectId,
        documentId: nextDocumentId,
        triage: false,
        landing: target ? keyLanding(target) : null,
      });
    },
    [navigate],
  );

  const relocateProject = useCallback(
    (nextProjectId: string): void => {
      replaceUrl.current = true;
      navigate({ ...current.current, projectId: nextProjectId });
    },
    [navigate],
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
    landing,
    openTriage,
    selectProject,
    selectView,
    selectTreeDocument,
    selectDocument,
    openDocument,
    relocateProject,
    toggleTag,
    clearTags,
    removeTag,
    clearDocumentIfRemoved,
  };
}
