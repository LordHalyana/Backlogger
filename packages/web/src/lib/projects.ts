import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  CreateProjectRequest,
  DuplicateFile,
  Project,
  UpdateProjectRequest,
} from '@backlogger/shared';
import { apiFetch } from './api.js';
import {
  queryKeys,
  clearDocumentBuffers,
  invalidateDocumentDerived,
  invalidateProjectList,
  invalidateProjectReload,
} from './query-keys.js';

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
    onSuccess: () => invalidateProjectList(qc),
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
    onSuccess: (_project, vars) => {
      invalidateProjectList(qc);
      invalidateDocumentDerived(qc, vars.id);
      clearDocumentBuffers(qc);
    },
  });
}

export function useDeleteProject(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => apiFetch<void>(`/api/projects/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateProjectList(qc),
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
  duplicates: DuplicateFile[];
}

export function useReloadProject(): UseMutationResult<ReloadProjectReport, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) =>
      apiFetch<ReloadProjectReport>(`/api/projects/${id}/reload`, { method: 'POST' }),
    onSuccess: (report) =>
      invalidateProjectReload(qc, report.projectId, report.removedIds),
  });
}
