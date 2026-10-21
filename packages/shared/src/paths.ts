/**
 * Folder and archive path helpers.
 *
 * Backlogger encodes archive state in the on-disk path: an archived document
 * lives under `<project-id>/archived/<original-subpath>`. This convention is
 * referenced by the document service (move on archive/unarchive), the reindex
 * status-correction logic, and the sidebar folder tree. These helpers are the
 * single source of truth for that convention so the layers cannot drift.
 *
 * See docs/design/archive-invariants.md and docs/design/folder-invariants.md.
 */

/** The reserved path segment that marks archived content. */
export const ARCHIVE_SEGMENT = 'archived';

/**
 * Is this project-relative *document* path archived?
 *
 * Document paths include the project id as their first segment, so the archive
 * marker sits at index 1: `proj/archived/notes/doc.md` → true.
 */
export function isArchivedPath(projectRelativePath: string): boolean {
  return projectRelativePath.split('/')[1] === ARCHIVE_SEGMENT;
}

/**
 * Insert an `archived` segment immediately after the project-id in a
 * project-relative path.
 *
 * `my-project/notes/doc-abc.md` → `my-project/archived/notes/doc-abc.md`
 */
export function archivePath(projectRelativePath: string): string {
  const parts = projectRelativePath.split('/');
  return [parts[0], ARCHIVE_SEGMENT, ...parts.slice(1)].join('/');
}

/**
 * Remove the `archived` segment from an archived project-relative path.
 *
 * `my-project/archived/notes/doc-abc.md` → `my-project/notes/doc-abc.md`
 *
 * If the path is not under `archived/`, it is returned unchanged.
 */
export function unarchivePath(projectRelativePath: string): string {
  const parts = projectRelativePath.split('/');
  if (parts[1] !== ARCHIVE_SEGMENT) return projectRelativePath;
  return [parts[0], ...parts.slice(2)].join('/');
}

/**
 * Derive the folder (project-relative, no project id, no filename) that a
 * document lives in.
 *
 * `proj/notes/sub/doc-abc.md` → `notes/sub`; a root-level document → `''`.
 */
export function folderFromDocumentPath(projectId: string, documentPath: string): string {
  const rest = documentPath.startsWith(`${projectId}/`)
    ? documentPath.slice(projectId.length + 1)
    : documentPath;
  const idx = rest.lastIndexOf('/');
  return idx >= 0 ? rest.slice(0, idx) : '';
}

/**
 * Is this *folder* path (project-relative, no project id) the archive folder or
 * a subfolder of it? `archived` and `archived/2025` → true; `notes` → false.
 */
export function isArchivedFolder(folder: string): boolean {
  return folder === ARCHIVE_SEGMENT || folder.startsWith(`${ARCHIVE_SEGMENT}/`);
}

/** The folder that holds every task's comment directory. */
export const TICKETS_SEGMENT = 'tickets';
/** The per-task comment directory: `tickets/<task-id>/comments/`. */
export const COMMENTS_SEGMENT = 'comments';

/**
 * Project-relative path (project id first) of one comment file:
 * `<project-id>/tickets/<task-id>/comments/<comment-id>.md`.
 */
export function commentPath(projectId: string, taskId: string, commentId: string): string {
  return `${projectId}/${TICKETS_SEGMENT}/${taskId}/${COMMENTS_SEGMENT}/${commentId}.md`;
}

/**
 * Is this project-relative path (project id first) a task's comment
 * directory or anything inside it? The scanner classifies these explicitly:
 * they are comments, never documents. `p/tickets/<id>/comments/x.md` → true.
 */
export function isCommentStoragePath(projectRelativePath: string): boolean {
  const parts = projectRelativePath.split('/');
  return parts.length >= 4 && parts[1] === TICKETS_SEGMENT && parts[3] === COMMENTS_SEGMENT;
}

/** `isCommentStoragePath` for a *folder* path (no project id): `tickets/<id>/comments`. */
export function isCommentStorageFolder(folder: string): boolean {
  return isCommentStoragePath(`_/${folder}`);
}
