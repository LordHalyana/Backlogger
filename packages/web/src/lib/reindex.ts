import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './api.js';
import { useDialog } from './dialog.js';

interface ReindexResult {
  scanned: number;
  inserted: number;
  skipped: Array<{ path: string; reason: string }>;
}

export function useReindex(): {
  run: () => void;
  isPending: boolean;
} {
  const qc = useQueryClient();
  const dialog = useDialog();
  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<ReindexResult>('/api/admin/reindex', { method: 'POST' }),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
      void qc.invalidateQueries({ queryKey: ['documents'] });
      dialog.toast(
        `Reindex complete: ${result.inserted} of ${result.scanned} documents (${result.skipped.length} skipped)`,
      );
    },
    onError: (err) => {
      dialog.toast(`Reindex failed: ${err.message}`, { kind: 'error' });
    },
  });
  return {
    run: () => mutation.mutate(),
    isPending: mutation.isPending,
  };
}

export type { ReindexResult };
