import { useCallback } from 'react';
import { useDialog } from '../lib/dialog.js';
import { useReloadProject } from '../lib/projects.js';

interface UseReloadToastOptions {
  /** The project to reload. When `null`, `trigger` is a no-op. */
  projectId: string | null;
  /**
   * Called with the list of document IDs that were removed during the reload.
   * Use this to clear any in-memory selection of a removed document.
   */
  onRemovedIds?: (ids: string[]) => void;
}

interface UseReloadToastResult {
  /** Fire the reload. No-op when `projectId` is `null`. */
  trigger: () => void;
  isPending: boolean;
}

/**
 * Encapsulates the full reload flow: fires the mutation, shows a success or
 * error toast via `useDialog`, and notifies the caller of removed document
 * IDs so they can clear stale UI selection.
 *
 * Replaces the inline reload `onClick` handler and local `[toast, setToast]`
 * state in App.tsx (Phase 4 / Block 3).
 */
export function useReloadToast({
  projectId,
  onRemovedIds,
}: UseReloadToastOptions): UseReloadToastResult {
  const dialog = useDialog();
  const mutation = useReloadProject();

  const trigger = useCallback(() => {
    if (!projectId) return;
    mutation.mutate(projectId, {
      onSuccess: (r) => {
        dialog.toast(
          `Reloaded ${projectId}: +${r.added}/~${r.updated}/-${r.removed} in ${r.durationMs} ms`,
        );
        if (r.removedIds.length > 0) onRemovedIds?.(r.removedIds);
      },
      onError: (err) => {
        dialog.toast(`Reload failed: ${err.message}`, { kind: 'error' });
      },
    });
  }, [projectId, mutation, dialog, onRemovedIds]);

  return { trigger, isPending: mutation.isPending };
}
