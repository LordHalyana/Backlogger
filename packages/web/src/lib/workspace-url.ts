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

/** Build the pathname for a given selection (no leading project → `/`). */
export function workspacePathname(
  projectId: string | null,
  documentId: string | null,
  view: WorkspaceView = 'documents',
): string {
  if (!projectId) return '/';
  const project = `/projects/${encodeURIComponent(projectId)}`;
  const base = view === 'board' ? `${project}/board` : project;
  return documentId ? `${base}/documents/${encodeURIComponent(documentId)}` : base;
}

/**
 * Push the selection into the browser history, but only when it differs from
 * the current path — so refreshes and back/forward restores do not create
 * redundant history entries. `search` (e.g. `?help=`) and `hash` are preserved.
 */
export function syncWorkspaceUrl(
  projectId: string | null,
  documentId: string | null,
  view: WorkspaceView = 'documents',
): void {
  if (typeof window === 'undefined') return;
  const target = workspacePathname(projectId, documentId, view);
  if (window.location.pathname === target) return;
  const u = new URL(window.location.href);
  u.pathname = target;
  window.history.pushState(window.history.state, '', u.toString());
}
