import { useEffect } from 'react';

interface GlobalShortcuts {
  onToggleCommandPalette: () => void;
  onToggleHelp: () => void;
}

/**
 * Registers a single `keydown` listener on `window` covering all global
 * keyboard shortcuts:
 *   - Ctrl/Cmd+K  → toggle command palette
 *   - ?           → toggle help (suppressed inside text inputs)
 *
 * Both callbacks must be stable references (wrap in `useCallback` at the
 * call site) to avoid unnecessary listener churn.
 *
 * Extracted from App.tsx (Phase 4 / Block 2).
 */
export function useGlobalShortcuts({
  onToggleCommandPalette,
  onToggleHelp,
}: GlobalShortcuts): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      // Ctrl/Cmd+K → command palette
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onToggleCommandPalette();
        return;
      }

      // ? → help (blocked when focus is inside a text field)
      if (event.key === '?') {
        const t = event.target as HTMLElement | null;
        if (
          t &&
          (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
        ) {
          return;
        }
        event.preventDefault();
        onToggleHelp();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onToggleCommandPalette, onToggleHelp]);
}
