// URL <-> workspace selection synchronisation.
//
// The selected project, view and document are reflected in the URL *path* so
// users can deep-link and refresh without losing their place:
//
//   /                                                    → no project selected
//   /projects/:projectId                                 → project, Documents view
//   /projects/:projectId/documents/:documentId           → project + open document
//   /projects/:projectId/board                           → project, Board view
//   /projects/:projectId/board/documents/:documentId     → document opened from the board
//   …/documents/:documentId/comments/:commentId          → landing on one of its comments
//   /inbox                                               → ⌂ Inbox triage mode
//   /recovery                                            → the Recovery page
//   /recovery/:operationId                               → … with one operation selected
//
// Only path-based selection lives here; the `?help=` query param (help-link.ts)
// and any hash are preserved when we rewrite the path. This intentionally stays
// a couple of hand-rolled routes rather than pulling in a full router.

/** Which pane a project shows: the document tree's editor, or the board. */
export type WorkspaceView = 'documents' | 'board';

export interface WorkspaceUrlState {
  projectId: string | null;
  documentId: string | null;
  view: WorkspaceView;
}

/** Parse the current `location.pathname` into a workspace selection. */
export function readWorkspaceFromUrl(): WorkspaceUrlState {
  if (typeof window === 'undefined') {
    return { projectId: null, documentId: null, view: 'documents' };
  }
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'projects' || !parts[1]) {
    return { projectId: null, documentId: null, view: 'documents' };
  }
  const projectId = decodeURIComponent(parts[1]);
  const view: WorkspaceView = parts[2] === 'board' ? 'board' : 'documents';
  const rest = view === 'board' ? parts.slice(3) : parts.slice(2);
  const documentId = rest[0] === 'documents' && rest[1] ? decodeURIComponent(rest[1]) : null;
  return { projectId, documentId, view };
}

/** The comment a `…/documents/:documentId/comments/:commentId` link lands on, if any. */
export function readCommentFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'projects' || !parts[1]) return null;
  const rest = parts[2] === 'board' ? parts.slice(3) : parts.slice(2);
  return rest[0] === 'documents' && rest[1] && rest[2] === 'comments' && rest[3]
    ? decodeURIComponent(rest[3])
    : null;
}

/** The path of ⌂ Inbox triage mode. */
export const TRIAGE_PATHNAME = '/inbox';

/** True when the current URL is ⌂ Inbox triage mode. */
export function readTriageFromUrl(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.pathname.replace(/\/+$/, '') === TRIAGE_PATHNAME;
}

/** The Recovery page, and the operation it shows. */
export interface RecoveryRoute {
  operationId: string | null;
}

/** The path of the Recovery page. */
export const RECOVERY_PATHNAME = '/recovery';

/** The Recovery page the current URL shows, or `null` when it shows something else. */
export function readRecoveryFromUrl(): RecoveryRoute | null {
  if (typeof window === 'undefined') return null;
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'recovery') return null;
  return { operationId: parts[1] ? decodeURIComponent(parts[1]) : null };
}

export function recoveryPathname(operationId: string | null): string {
  return operationId
    ? `${RECOVERY_PATHNAME}/${encodeURIComponent(operationId)}`
    : RECOVERY_PATHNAME;
}

/** Build the pathname for a given selection (no leading project → `/`). */
export function workspacePathname(
  projectId: string | null,
  documentId: string | null,
  view: WorkspaceView = 'documents',
  commentId: string | null = null,
): string {
  if (!projectId) return '/';
  const project = `/projects/${encodeURIComponent(projectId)}`;
  const base = view === 'board' ? `${project}/board` : project;
  if (!documentId) return base;
  const document = `${base}/documents/${encodeURIComponent(documentId)}`;
  return commentId ? `${document}/comments/${encodeURIComponent(commentId)}` : document;
}

/**
 * Push the selection into the browser history, but only when it differs from
 * the current path — so refreshes and back/forward restores do not create
 * redundant history entries. `search` (e.g. `?help=`) and `hash` are preserved.
 * `replace` rewrites the current entry instead, for a redirect.
 */
export function syncWorkspaceUrl(
  projectId: string | null,
  documentId: string | null,
  view: WorkspaceView = 'documents',
  triage = false,
  options: { commentId?: string | null; replace?: boolean; recovery?: RecoveryRoute | null } = {},
): void {
  if (typeof window === 'undefined') return;
  const target = options.recovery
    ? recoveryPathname(options.recovery.operationId)
    : triage
      ? TRIAGE_PATHNAME
      : workspacePathname(projectId, documentId, view, options.commentId ?? null);
  if (window.location.pathname === target) return;
  const u = new URL(window.location.href);
  u.pathname = target;
  if (options.replace) {
    window.history.replaceState(withHistoryIndex(historyIndex()), '', u.toString());
  } else {
    window.history.pushState(withHistoryIndex(historyIndex() + 1), '', u.toString());
  }
}

/** Key in `history.state` holding the entry's position in this tab's history. */
const HISTORY_INDEX_KEY = 'backloggerIndex';

/**
 * The current history entry's position, as stamped by `syncWorkspaceUrl`.
 * Entries the app never stamped (the first one) count as 0. Back/forward use it
 * to tell how far the browser moved, so a cancelled move can be undone with
 * `history.go` instead of pushing a new entry.
 */
export function historyIndex(): number {
  if (typeof window === 'undefined') return 0;
  const state: unknown = window.history.state;
  if (state && typeof state === 'object' && HISTORY_INDEX_KEY in state) {
    const index = (state as Record<string, unknown>)[HISTORY_INDEX_KEY];
    if (typeof index === 'number') return index;
  }
  return 0;
}

function withHistoryIndex(index: number): Record<string, unknown> {
  const state: unknown = window.history.state;
  const base = state && typeof state === 'object' ? (state as Record<string, unknown>) : {};
  return { ...base, [HISTORY_INDEX_KEY]: index };
}
