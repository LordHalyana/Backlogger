import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SearchHit } from '@backlogger/shared';
import { apiFetch } from './api.js';

export interface UseSearchOptions {
  projectId?: string;
  limit?: number;
  /** Debounce delay in ms before issuing the request. Default: 200. */
  debounceMs?: number;
}

export interface UseSearchResult {
  hits: SearchHit[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  debouncedQuery: string;
}

/**
 * Reactive full-text search. Debounces the query string and skips the
 * request entirely when the trimmed query is shorter than 2 characters.
 */
export function useSearch(query: string, opts: UseSearchOptions = {}): UseSearchResult {
  const { projectId, limit, debounceMs = 200 } = opts;
  const [debounced, setDebounced] = useState(query);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(query), debounceMs);
    return () => clearTimeout(handle);
  }, [query, debounceMs]);

  const trimmed = debounced.trim();
  const enabled = trimmed.length >= 2;

  const result = useQuery<SearchHit[], Error>({
    queryKey: ['search', trimmed, projectId ?? null, limit ?? null],
    queryFn: () => {
      const params = new URLSearchParams({ q: trimmed });
      if (projectId) params.set('projectId', projectId);
      if (limit) params.set('limit', String(limit));
      return apiFetch<SearchHit[]>(`/api/search?${params.toString()}`);
    },
    enabled,
    staleTime: 30_000,
  });

  return {
    hits: result.data ?? [],
    isLoading: enabled && result.isLoading,
    isError: result.isError,
    error: result.error ?? null,
    debouncedQuery: trimmed,
  };
}
