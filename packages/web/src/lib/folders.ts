import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiFetch } from './api.js';
import { queryKeys } from './query-keys.js';

export const FOLDERS_KEY = (projectId: string) => queryKeys.folders(projectId);

export function useFolders(projectId: string | undefined): UseQueryResult<string[]> {
  return useQuery({
    queryKey: FOLDERS_KEY(projectId ?? '__none__'),
    queryFn: () => apiFetch<string[]>(`/api/projects/${projectId}/folders`),
    enabled: Boolean(projectId),
  });
}

export function useCreateFolder(): UseMutationResult<
  { folder: string },
  Error,
  { projectId: string; folder: string }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, folder }) =>
      apiFetch<{ folder: string }>(`/api/projects/${projectId}/folders`, {
        method: 'POST',
        body: JSON.stringify({ folder }),
      }),
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: FOLDERS_KEY(vars.projectId) }),
  });
}

export function useDeleteFolder(): UseMutationResult<
  void,
  Error,
  { projectId: string; folder: string }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, folder }) =>
      apiFetch<void>(
        `/api/projects/${projectId}/folders/${folder
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`,
        { method: 'DELETE' },
      ),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: FOLDERS_KEY(vars.projectId) });
      qc.invalidateQueries({ queryKey: queryKeys.documents(vars.projectId) });
    },
  });
}
