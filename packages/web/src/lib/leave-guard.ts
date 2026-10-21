import { useCallback, useEffect } from 'react';
import { useDialog } from './dialog.js';

/**
 * Unsaved work that leaving the open task would discard: a comment draft or
 * an open comment edit. Drafts are not kept after leaving the task, so every
 * workspace navigation asks first while one of these is registered.
 */
const blockers = new Set<symbol>();

/**
 * The open Stay / Discard and leave prompt. Navigations requested while it is
 * open (one handler often makes several) join it and share its answer.
 */
let pendingPrompt: { leaves: (() => void)[]; stays: (() => void)[] } | null = null;

/** Register unsaved work while `active`; also arms the browser's own `beforeunload` prompt. */
export function useBlockLeave(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    const token = Symbol('leave-blocker');
    blockers.add(token);
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      blockers.delete(token);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [active]);
}

/**
 * Returns `confirmLeave(leave, stay?)`: runs `leave` at once when nothing is
 * unsaved, otherwise asks Stay / Discard and leave first and runs `leave` or
 * `stay` by the answer.
 */
export function useConfirmLeave(): (leave: () => void, stay?: () => void) => void {
  const dialog = useDialog();
  return useCallback(
    (leave, stay) => {
      if (blockers.size === 0) {
        leave();
        return;
      }
      if (pendingPrompt) {
        pendingPrompt.leaves.push(leave);
        if (stay) pendingPrompt.stays.push(stay);
        return;
      }
      const prompt = { leaves: [leave], stays: stay ? [stay] : [] };
      pendingPrompt = prompt;
      void dialog
        .confirm({
          title: 'Leave this task?',
          message: 'You have an unsaved comment. It is not kept if you leave the task.',
          confirmLabel: 'Discard and leave',
          cancelLabel: 'Stay',
          danger: true,
        })
        .then((ok) => {
          pendingPrompt = null;
          if (ok) blockers.clear();
          for (const run of ok ? prompt.leaves : prompt.stays) run();
        });
    },
    [dialog],
  );
}
