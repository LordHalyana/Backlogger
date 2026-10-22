import type { QueryClient } from '@tanstack/react-query';
import type { Document } from '@backlogger/shared';

/**
 * Centralized React Query keys. Every query and mutation must reference keys
 * through this object so the cache fan-out after a mutation stays consistent.
 *
 * See docs/design/derived-data.md for the invalidation contract these keys serve.
 */
export const queryKeys = {
  projects: () => ['projects'] as const,
  documents: (projectId: string) => ['documents', projectId] as const,
  document: (id: string) => ['document', id] as const,
  tags: (projectId: string) => ['tags', projectId] as const,
  titles: (projectId: string) => ['titles', projectId] as const,
  backlinks: (documentId: string) => ['backlinks', documentId] as const,
  graph: (projectId: string) => ['graph', projectId] as const,
  folders: (projectId: string) => ['folders', projectId] as const,
  board: (projectId: string) => ['board', projectId] as const,
  currentWork: () => ['current-work'] as const,
  comments: (taskId: string) => ['comments', taskId] as const,
  /** A task's history opened on one comment; under `comments(taskId)`, so writes refresh it. */
  commentsAround: (taskId: string, commentId: string) =>
    ['comments', taskId, 'around', commentId] as const,
  /** Every search query; each one appends its query, project filter and limit. */
  search: () => ['search'] as const,
} as const;

/**
 * Search results match documents and comments, so every write that can change
 * what search finds (saves, filing, comment writes, deletion, Reload,
 * Reindex) clears them. External edits show up after Reload or Reindex.
 */
export function invalidateSearch(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: queryKeys.search() });
}

/**
 * Invalidate every cache derived from a document's body or frontmatter for a
 * given project: the document list, tags, titles, and all backlinks.
 *
 * Call this after any mutation that changes document content so derived views
 * (tag explorer, wiki-link resolution, backlinks panel) refresh together.
 */
export function invalidateDocumentDerived(qc: QueryClient, projectId: string): void {
  void qc.invalidateQueries({ queryKey: queryKeys.documents(projectId) });
  void qc.invalidateQueries({ queryKey: queryKeys.tags(projectId) });
  void qc.invalidateQueries({ queryKey: queryKeys.titles(projectId) });
  void qc.invalidateQueries({ queryKey: queryKeys.graph(projectId) });
  void qc.invalidateQueries({ queryKey: queryKeys.board(projectId) });
  void qc.invalidateQueries({ queryKey: queryKeys.currentWork() });
  // Backlinks are keyed per-document; invalidate the whole family.
  void qc.invalidateQueries({ queryKey: ['backlinks'] });
  invalidateSearch(qc);
}

export function invalidateProjectList(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: queryKeys.projects() });
  // Board cards and Current work carry the project's read-only flag.
  void qc.invalidateQueries({ queryKey: ['board'] });
  void qc.invalidateQueries({ queryKey: queryKeys.currentWork() });
  // A deleted project's documents leave the results.
  invalidateSearch(qc);
}

/**
 * Refetch comment histories: one task's after a comment write, or every
 * task's (no `taskId`) after a reload or reindex re-reads them from disk.
 * Search results match comment text, so they are cleared too.
 */
export function invalidateComments(qc: QueryClient, taskId?: string): Promise<void> {
  invalidateSearch(qc);
  return qc.invalidateQueries({ queryKey: taskId ? queryKeys.comments(taskId) : ['comments'] });
}

export function invalidateProjectFolders(qc: QueryClient, projectId: string): void {
  void qc.invalidateQueries({ queryKey: queryKeys.folders(projectId) });
}

export function invalidateProjectStructure(qc: QueryClient, projectId: string): void {
  invalidateProjectFolders(qc, projectId);
  void qc.invalidateQueries({ queryKey: queryKeys.documents(projectId) });
}

/** Refetch one document, e.g. after a command that answers with an acknowledgement only. */
export function invalidateDocument(qc: QueryClient, id: string): void {
  void qc.invalidateQueries({ queryKey: queryKeys.document(id) });
}

export function setDocumentCache(qc: QueryClient, doc: Document): void {
  qc.setQueryData(queryKeys.document(doc.id), doc);
}

export function removeDocumentCache(qc: QueryClient, id: string): void {
  qc.removeQueries({ queryKey: queryKeys.document(id) });
}

export function invalidateProjectReload(
  qc: QueryClient,
  projectId: string,
  removedIds: readonly string[],
): void {
  invalidateDocumentDerived(qc, projectId);
  invalidateProjectFolders(qc, projectId);
  void invalidateComments(qc);
  clearDocumentBuffers(qc);
  for (const id of removedIds) removeDocumentCache(qc, id);
}

export function invalidateGlobalReindex(qc: QueryClient): void {
  invalidateProjectList(qc);
  void qc.invalidateQueries({ queryKey: ['documents'] });
  void qc.invalidateQueries({ queryKey: ['tags'] });
  void qc.invalidateQueries({ queryKey: ['titles'] });
  void qc.invalidateQueries({ queryKey: ['backlinks'] });
  void qc.invalidateQueries({ queryKey: ['graph'] });
  void qc.invalidateQueries({ queryKey: ['folders'] });
  void qc.invalidateQueries({ queryKey: ['board'] });
  void invalidateComments(qc);
  clearDocumentBuffers(qc);
}

/**
 * Drop all cached `document` queries so open editors refetch from scratch.
 *
 * Needed after a project reload: out-of-band file edits don't bump frontmatter
 * `updated_at`, so the editor buffer won't rebuild on `updated_at` change alone.
 */
export function clearDocumentBuffers(qc: QueryClient): void {
  qc.removeQueries({ predicate: (q) => q.queryKey[0] === 'document' });
}
