import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api.js';
import { queryKeys } from './query-keys.js';

export interface TitleRow {
  id: string;
  project_id: string;
  title: string;
}

export interface BacklinkRow {
  id: string;
  project_id: string;
  title: string;
  display: string;
  position: number;
}

export function useTitles(projectId: string | null) {
  return useQuery({
    queryKey: queryKeys.titles(projectId ?? '__none__'),
    enabled: !!projectId,
    staleTime: 30_000,
    queryFn: () =>
      apiFetch<TitleRow[]>(`/api/projects/${encodeURIComponent(projectId!)}/titles`),
  });
}

export function useBacklinks(documentId: string | null) {
  return useQuery({
    queryKey: queryKeys.backlinks(documentId ?? '__none__'),
    enabled: !!documentId,
    staleTime: 10_000,
    queryFn: () =>
      apiFetch<BacklinkRow[]>(`/api/documents/${encodeURIComponent(documentId!)}/backlinks`),
  });
}
