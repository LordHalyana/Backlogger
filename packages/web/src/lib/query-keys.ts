import type { QueryClient } from '@tanstack/react-query';

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
} as const;

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
  // Backlinks are keyed per-document; invalidate the whole family.
  void qc.invalidateQueries({ queryKey: ['backlinks'] });
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
