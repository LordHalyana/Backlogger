import { useQuery } from '@tanstack/react-query';
import type { DocumentSummary } from '@backlogger/shared';
import { apiFetch } from './api.js';

export interface TagCount {
  tag: string;
  count: number;
}

export function useTags(projectId: string | null) {
  return useQuery({
    queryKey: ['tags', projectId],
    enabled: !!projectId,
    staleTime: 10_000,
    queryFn: () =>
      apiFetch<TagCount[]>(
        `/api/tags?projectId=${encodeURIComponent(projectId!)}`,
      ),
  });
}

export function useFilteredDocuments(
  projectId: string | null,
  tags: readonly string[],
) {
  const qs = tags.map((t) => `tag=${encodeURIComponent(t)}`).join('&');
  return useQuery({
    queryKey: ['documents', projectId, 'tagged', [...tags].sort()],
    enabled: !!projectId && tags.length > 0,
    staleTime: 10_000,
    queryFn: () =>
      apiFetch<DocumentSummary[]>(
        `/api/projects/${encodeURIComponent(projectId!)}/documents?${qs}`,
      ),
  });
}
