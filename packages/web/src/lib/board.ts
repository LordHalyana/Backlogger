import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { Board } from '@backlogger/shared';
import { apiFetch } from './api.js';
import { queryKeys } from './query-keys.js';

/** The project board. Column assignment and order come from the server. */
export function useBoard(projectId: string): UseQueryResult<Board> {
  return useQuery({
    queryKey: queryKeys.board(projectId),
    queryFn: () => apiFetch<Board>(`/api/projects/${projectId}/board`),
  });
}
