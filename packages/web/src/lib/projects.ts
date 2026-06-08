import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { CreateProjectRequest, Project, UpdateProjectRequest } from '@backlogger/shared';
import { apiFetch } from './api.js';
import { queryKeys, invalidateDocumentDerived, clearDocumentBuffers } from './query-keys.js';

const PROJECTS_KEY = queryKeys.projects();

export function useProjects(): UseQueryResult<Project[]> {
  return useQuery({
    queryKey: PROJECTS_KEY,
    queryFn: () => apiFetch<Project[]>('/api/projects'),
  });
}

export function useCreateProject(): UseMutationResult<Project, Error, CreateProjectRequest> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) =>
      apiFetch<Project>('/api/projects', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: PROJECTS_KEY }),
  });
}

export function useUpdateProject(): UseMutationResult<
  Project,
  Error,
  { id: string; input: UpdateProjectRequest }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }) =>
      apiFetch<Project>(`/api/projects/${id}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: PROJECTS_KEY }),
  });
}

export function useDeleteProject(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => apiFetch<void>(`/api/projects/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: PROJECTS_KEY }),
  });
}

export interface ReloadProjectReport {
  projectId: string;
  added: number;
  updated: number;
  removed: number;
  skipped: Array<{ path: string; reason: string }>;
  durationMs: number;
  removedIds: string[];
}

export function useReloadProject(): UseMutationResult<ReloadProjectReport, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) =>
      apiFetch<ReloadProjectReport>(`/api/projects/${id}/reload`, { method: 'POST' }),
    onSuccess: (report) => {
      invalidateDocumentDerived(qc, report.projectId);
      // Out-of-band edits don't bump frontmatter `updated_at`, so React
      // Query won't rebuild buffers via updated_at change alone. Drop the
      // cached document queries so any open editor refetches from scratch.
      clearDocumentBuffers(qc);
      for (const id of report.removedIds) {
        qc.removeQueries({ queryKey: queryKeys.document(id) });
      }
    },
  });
}
