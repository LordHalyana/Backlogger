import { createElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { DuplicateFile } from '@backlogger/shared';
import { ReindexResultSummary } from '../components/ReindexResultSummary.js';
import { apiFetch } from './api.js';
import { toastError, useDialog } from './dialog.js';
import { invalidateGlobalReindex } from './query-keys.js';

interface ReindexResult {
  scanned: number;
  inserted: number;
  skipped: Array<{ path: string; reason: string }>;
  duplicates: DuplicateFile[];
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
      invalidateGlobalReindex(qc);
      dialog.toast(
        `Reindex complete: ${result.inserted} of ${result.scanned} documents (${result.skipped.length} skipped)`,
      );
      if (result.skipped.length > 0 || result.duplicates.length > 0) {
        void dialog.alert({
          title: 'Reindex result',
          message: createElement(ReindexResultSummary, {
            counts: [
              { label: 'Scanned', value: result.scanned },
              { label: 'Indexed', value: result.inserted },
              { label: 'Skipped', value: result.skipped.length },
            ],
            skipped: result.skipped,
            duplicates: result.duplicates,
          }),
          confirmLabel: 'OK',
        });
      }
    },
    onError: (err) => toastError(dialog, 'Reindex failed', err),
  });
  return {
    run: () => mutation.mutate(),
    isPending: mutation.isPending,
  };
}

export type { ReindexResult };
