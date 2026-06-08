// URL <-> workspace selection synchronisation.
//
// The selected project and document are reflected in the URL *path* so users
// can deep-link and refresh without losing their place:
//
//   /                                              → no project selected
//   /projects/:projectId                           → project, no document
//   /projects/:projectId/documents/:documentId     → project + open document
//
// Only path-based selection lives here; the `?help=` query param (help-link.ts)
// and any hash are preserved when we rewrite the path. This intentionally stays
// a couple of hand-rolled routes rather than pulling in a full router.

export interface WorkspaceUrlState {
  projectId: string | null;
  documentId: string | null;
}

/** Parse the current `location.pathname` into a workspace selection. */
export function readWorkspaceFromUrl(): WorkspaceUrlState {
  if (typeof window === 'undefined') return { projectId: null, documentId: null };
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'projects' || !parts[1]) {
    return { projectId: null, documentId: null };
  }
  const projectId = decodeURIComponent(parts[1]);
  const documentId =
    parts[2] === 'documents' && parts[3] ? decodeURIComponent(parts[3]) : null;
  return { projectId, documentId };
}

/** Build the pathname for a given selection (no leading project → `/`). */
export function workspacePathname(
  projectId: string | null,
  documentId: string | null,
): string {
  if (!projectId) return '/';
  const base = `/projects/${encodeURIComponent(projectId)}`;
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
): void {
  if (typeof window === 'undefined') return;
  const target = workspacePathname(projectId, documentId);
  if (window.location.pathname === target) return;
  const u = new URL(window.location.href);
  u.pathname = target;
  window.history.pushState(window.history.state, '', u.toString());
}
