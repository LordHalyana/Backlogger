import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  CreateDocumentRequest,
  DeleteDocumentAck,
  Document,
  DocumentSummary,
  ImportRequest,
  ImportResult,
  UpdateDocumentRequest,
} from '@backlogger/shared';
import { apiFetch } from './api.js';
import {
  queryKeys,
  invalidateDocumentDerived,
  invalidateProjectStructure,
  invalidateRecovery,
  removeDocumentCache,
  setDocumentCache,
} from './query-keys.js';

export const documentsKey = (projectId: string) => queryKeys.documents(projectId);
export const documentKey = (id: string) => queryKeys.document(id);

export function useDocuments(projectId: string | null): UseQueryResult<DocumentSummary[]> {
  return useQuery({
    queryKey: projectId ? documentsKey(projectId) : ['documents', 'none'],
    queryFn: () => apiFetch<DocumentSummary[]>(`/api/projects/${projectId!}/documents`),
    enabled: !!projectId,
  });
}

export function useDocument(documentId: string | null): UseQueryResult<Document> {
  return useQuery({
    queryKey: documentId ? documentKey(documentId) : ['document', 'none'],
    queryFn: () => apiFetch<Document>(`/api/documents/${documentId!}`),
    enabled: !!documentId,
    // Editor owns the local buffer; don't clobber it with a refetch.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
}

export function useCreateDocument(
  projectId: string,
): UseMutationResult<Document, Error, CreateDocumentRequest> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) =>
      apiFetch<Document>(`/api/projects/${projectId}/documents`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => invalidateDocumentDerived(qc, projectId),
  });
}

export interface UpdateDocumentArgs {
  id: string;
  ifMatch: string;
  input: UpdateDocumentRequest;
}

export function useUpdateDocument(
  projectId: string,
): UseMutationResult<Document, Error, UpdateDocumentArgs> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ifMatch, input }) =>
      apiFetch<Document>(`/api/documents/${id}`, {
        method: 'PUT',
        headers: { 'If-Match': ifMatch },
        body: JSON.stringify(input),
      }),
    onSuccess: (doc) => {
      setDocumentCache(qc, doc);
      invalidateDocumentDerived(qc, projectId);
    },
  });
}

export interface DeleteDocumentArgs {
  id: string;
  /**
   * The Idempotency-Key, generated when the user confirms (`newUuid`).
   * Resending the same request must reuse it to get the original
   * acknowledgement.
   */
  operationId: string;
}

/**
 * Permanently delete a document and, for a backlog item, all its comments.
 * The server answers with an acknowledgement only. The lists and Recovery
 * are refetched either way: a failed delete may have left a pending
 * deletion, which hides the item.
 */
export function useDeleteDocument(
  projectId: string,
): UseMutationResult<DeleteDocumentAck, Error, DeleteDocumentArgs> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, operationId }) =>
      apiFetch<DeleteDocumentAck>(`/api/documents/${id}`, {
        method: 'DELETE',
        headers: { 'Idempotency-Key': operationId },
      }),
    onSuccess: (_ack, { id }) => removeDocumentCache(qc, id),
    onSettled: () => {
      invalidateDocumentDerived(qc, projectId);
      void invalidateRecovery(qc);
    },
  });
}

export function useImportFiles(
  projectId: string,
): UseMutationResult<ImportResult, Error, ImportRequest> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) =>
      apiFetch<ImportResult>(`/api/projects/${projectId}/import`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      invalidateDocumentDerived(qc, projectId);
    },
  });
}

export interface MoveDocumentArgs {
  id: string;
  /** Project-relative destination folder; empty string targets the root. */
  folder: string;
}

export function useMoveDocument(
  projectId: string,
): UseMutationResult<Document, Error, MoveDocumentArgs> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, folder }) =>
      apiFetch<Document>(`/api/documents/${id}/move`, {
        method: 'POST',
        body: JSON.stringify({ folder }),
      }),
    onSuccess: (doc) => {
      setDocumentCache(qc, doc);
      invalidateProjectStructure(qc, projectId);
      invalidateDocumentDerived(qc, projectId);
    },
  });
}
