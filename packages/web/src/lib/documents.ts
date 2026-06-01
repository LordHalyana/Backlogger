import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  CreateDocumentRequest,
  Document,
  DocumentSummary,
  ImportRequest,
  ImportResult,
  UpdateDocumentRequest,
} from '@backlogger/shared';
import { apiFetch } from './api.js';

export const documentsKey = (projectId: string) => ['documents', projectId] as const;
export const documentKey = (id: string) => ['document', id] as const;

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
    onSuccess: () => qc.invalidateQueries({ queryKey: documentsKey(projectId) }),
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
      qc.setQueryData(documentKey(doc.id), doc);
      qc.invalidateQueries({ queryKey: documentsKey(projectId) });
      qc.invalidateQueries({ queryKey: ['tags', projectId] });
      qc.invalidateQueries({ queryKey: ['backlinks'] });
    },
  });
}

export function useDeleteDocument(
  projectId: string,
): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => apiFetch<void>(`/api/documents/${id}`, { method: 'DELETE' }),
    onSuccess: (_v, id) => {
      qc.removeQueries({ queryKey: documentKey(id) });
      qc.invalidateQueries({ queryKey: documentsKey(projectId) });
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
      qc.invalidateQueries({ queryKey: documentsKey(projectId) });
      qc.invalidateQueries({ queryKey: ['tags', projectId] });
    },
  });
}
