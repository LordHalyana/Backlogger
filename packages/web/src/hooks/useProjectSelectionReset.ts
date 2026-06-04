import { useEffect, useRef } from 'react';

interface UseProjectSelectionResetOptions {
  projectId: string | null;
  /**
   * Called when `projectId` changes to a different value.  Not called on
   * initial mount.  Stabilize with `useCallback` to prevent spurious resets.
   */
  onReset: () => void;
}

/**
 * Fires `onReset` whenever `projectId` changes to a new value.  Uses a ref
 * to compare against the previous value so the effect does not fire on the
 * initial render.
 *
 * Extracted from App.tsx (Phase 4 / Block 4).
 */
export function useProjectSelectionReset({
  projectId,
  onReset,
}: UseProjectSelectionResetOptions): void {
  const prevRef = useRef(projectId);

  useEffect(() => {
    if (prevRef.current !== projectId) {
      prevRef.current = projectId;
      onReset();
    }
  }, [projectId, onReset]);
}
