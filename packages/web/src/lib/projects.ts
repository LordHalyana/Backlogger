import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  CreateProjectRequest,
  DeleteProjectAck,
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
  invalidateRecovery,
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

export interface DeleteProjectArgs {
  id: string;
  /** The Idempotency-Key, generated when the user confirms (`newUuid`). */
  operationId: string;
}

/**
 * Permanently delete a project with every task, comment and file in it. The
 * project list and Recovery are refetched either way: a failed delete may
 * have left a pending deletion, which hides the project.
 */
export function useDeleteProject(): UseMutationResult<DeleteProjectAck, Error, DeleteProjectArgs> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, operationId }) =>
      apiFetch<DeleteProjectAck>(`/api/projects/${id}`, {
        method: 'DELETE',
        headers: { 'Idempotency-Key': operationId },
      }),
    onSettled: () => {
      invalidateProjectList(qc);
      void invalidateRecovery(qc);
    },
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
