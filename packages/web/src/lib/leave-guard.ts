import { useCallback, useEffect } from 'react';
import { useDialog } from './dialog.js';

/**
 * Unsaved work that leaving the open task would discard: a comment draft or
 * an open comment edit. Drafts are not kept after leaving the task, so every
 * workspace navigation asks first while one of these is registered.
 *
 * Module state rather than context: like `beforeunload`, there is one leave
 * prompt per browser tab, and the guard must see blockers registered anywhere
 * in the tree.
 */
const blockers = new Set<symbol>();

/**
 * Blockers the user chose to discard at the prompt. They stay registered until
 * their owners unmount (the navigation closes the task), but no longer ask.
 * A new draft registers a new token, so it asks again.
 */
const discarded = new Set<symbol>();

function hasUnsavedWork(): boolean {
  for (const token of blockers) if (!discarded.has(token)) return true;
  return false;
}

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
      discarded.delete(token);
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
      if (!hasUnsavedWork()) {
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
          if (ok) for (const token of blockers) discarded.add(token);
          for (const run of ok ? prompt.leaves : prompt.stays) run();
        });
    },
    [dialog],
  );
}
