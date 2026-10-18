import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { CurrentWork } from '@backlogger/shared';
import { apiFetch } from './api.js';
import { queryKeys } from './query-keys.js';

/**
 * Current work, reloaded whenever it is shown, when the window regains focus,
 * and after the user's own changes (see `invalidateDocumentDerived`).
 */
export function useCurrentWork(): UseQueryResult<CurrentWork> {
  return useQuery({
    queryKey: queryKeys.currentWork(),
    queryFn: () => apiFetch<CurrentWork>('/api/current-work'),
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  });
}

const DRAWER_KEY = 'backlogger.currentWorkOpen';

/** Whether the Current work drawer was left open in this browser. */
export function readDrawerOpen(): boolean {
  try {
    return localStorage.getItem(DRAWER_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeDrawerOpen(open: boolean): void {
  try {
    localStorage.setItem(DRAWER_KEY, open ? '1' : '0');
  } catch {
    // Storage unavailable: the drawer just starts closed next time.
  }
}
