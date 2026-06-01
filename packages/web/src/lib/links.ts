import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api.js';

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
    queryKey: ['titles', projectId],
    enabled: !!projectId,
    staleTime: 30_000,
    queryFn: () =>
      apiFetch<TitleRow[]>(`/api/projects/${encodeURIComponent(projectId!)}/titles`),
  });
}

export function useBacklinks(documentId: string | null) {
  return useQuery({
    queryKey: ['backlinks', documentId],
    enabled: !!documentId,
    staleTime: 10_000,
    queryFn: () =>
      apiFetch<BacklinkRow[]>(`/api/documents/${encodeURIComponent(documentId!)}/backlinks`),
  });
}
