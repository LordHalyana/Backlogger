import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { TemplateSummary } from '@backlogger/shared';
import { apiFetch } from './api.js';
import { toastError, useDialog } from './dialog.js';

export const TEMPLATES_KEY = ['templates'] as const;

export function useTemplates(): UseQueryResult<TemplateSummary[]> {
  return useQuery({
    queryKey: TEMPLATES_KEY,
    queryFn: () => apiFetch<TemplateSummary[]>('/api/templates'),
    staleTime: Infinity,
  });
}

interface ReloadResult {
  loaded: number;
  skipped: Array<{ file: string; reason: string }>;
}

export function useReloadTemplates(): { run: () => void; isPending: boolean } {
  const qc = useQueryClient();
  const dialog = useDialog();
  const mutation = useMutation({
    mutationFn: () => apiFetch<ReloadResult>('/api/admin/reload-templates', { method: 'POST' }),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: TEMPLATES_KEY });
      const skipNote = result.skipped.length ? ` (${result.skipped.length} skipped)` : '';
      dialog.toast(`Templates reloaded: ${result.loaded} loaded${skipNote}`);
    },
    onError: (err) => toastError(dialog, 'Template reload failed', err),
  });
  return { run: () => mutation.mutate(), isPending: mutation.isPending };
}
