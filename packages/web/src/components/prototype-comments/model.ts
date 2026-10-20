// PROTOTYPE — throwaway, issue #59. In-memory comment store; no API, no persistence.
// Lives on branch prototype/comments-tab-59 only. Do not merge.
import { useCallback, useEffect, useRef, useState } from 'react';

export type Scenario =
  | 'live'
  | 'empty'
  | 'composing'
  | 'saving'
  | 'failed'
  | 'conflict'
  | 'archived'
  | 'readonly'
  | 'recovery'
  | 'long';

export const SCENARIOS: { key: Scenario; label: string }[] = [
  { key: 'live', label: 'Live (6 comments)' },
  { key: 'empty', label: 'Empty' },
  { key: 'composing', label: 'Composing' },
  { key: 'saving', label: 'Saving (stuck)' },
  { key: 'failed', label: 'Post failed' },
  { key: 'conflict', label: 'Edit conflict' },
  { key: 'archived', label: 'Archived task' },
  { key: 'readonly', label: 'Read-only project' },
  { key: 'recovery', label: 'Recovery required' },
  { key: 'long', label: 'Long history (120)' },
];

export type NextOutcome = 'ok' | 'fail' | 'conflict';
export type GuardMode = 'confirm' | 'keep';

export const PAGE_SIZE = 50;

export interface Comment {
  id: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  revision: number;
}

export type Phase = 'idle' | 'saving' | 'failed' | 'conflict';

export interface ComposerState {
  open: boolean;
  draft: string;
  phase: Phase;
  error: string | null;
  /** Idempotency-Key: kept across retries of the same draft, new after success. */
  opKey: string;
  restoredNotice: boolean;
}

export interface EditState {
  id: string;
  draft: string;
  baseRevision: number;
  phase: Phase;
  error: string | null;
  /** Server copy that won the race, shown during a conflict. */
  current: Comment | null;
}

const SAMPLE_BODIES = [
  'Started on this. The import path splits on `\\r\\n` but Windows exports use `\\r` alone in a few legacy files.',
  'Repro steps:\n\n1. Export a project from the old tool\n2. Import into **Backlogger**\n3. Open any note with a table\n\nRows collapse into one line.',
  'Checked the parser — it is the line-ending normalisation, not the table renderer.',
  'Decision: normalise to `\\n` at read time, never rewrite the source file.\n\n> Keeps the Markdown on disk exactly as the user wrote it.',
  'Wrote a fixture with mixed endings. Passing locally.',
  'Remaining: check the search snippet code path uses the same normaliser.',
];

let seq = 0;
const newKey = (): string => `op-${(++seq).toString(36)}-${Date.now().toString(36).slice(-4)}`;

function makeComments(n: number): Comment[] {
  const start = Date.UTC(2026, 8, 1, 9, 0);
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i + 1}`,
    body:
      n > SAMPLE_BODIES.length
        ? `Work log entry ${i + 1}. ${SAMPLE_BODIES[i % SAMPLE_BODIES.length]}`
        : SAMPLE_BODIES[i % SAMPLE_BODIES.length]!,
    createdAt: new Date(start + i * 7 * 3600_000).toISOString(),
    editedAt: i === 2 ? new Date(start + i * 7 * 3600_000 + 1800_000).toISOString() : null,
    revision: 1,
  }));
}

const closedComposer = (): ComposerState => ({
  open: false,
  draft: '',
  phase: 'idle',
  error: null,
  opKey: newKey(),
  restoredNotice: false,
});

export interface Model {
  scenario: Scenario;
  comments: Comment[];
  loaded: number;
  composer: ComposerState;
  edit: EditState | null;
  confirmDeleteId: string | null;
  restriction: null | 'archived' | 'readonly';
  recovery: boolean;
  announcement: string;
  lastFocus: string;
  hasDraft: boolean;
  visible: Comment[];
  remaining: number;
  // actions
  openComposer: () => void;
  setDraft: (v: string) => void;
  cancelComposer: () => void;
  post: () => void;
  startEdit: (id: string) => void;
  setEditDraft: (v: string) => void;
  cancelEdit: () => void;
  saveEdit: () => void;
  rebaseEdit: () => void;
  discardEdit: () => void;
  askDelete: (id: string) => void;
  cancelDelete: () => void;
  confirmDelete: (id: string) => void;
  loadMore: () => void;
  focus: (id: string) => void;
}

interface InitState {
  comments: Comment[];
  loaded: number;
  composer: ComposerState;
  edit: EditState | null;
  confirmDeleteId: string | null;
  restriction: null | 'archived' | 'readonly';
  recovery: boolean;
  announcement: string;
}

function initial(s: Scenario): InitState {
  const base: InitState = {
    comments: makeComments(6),
    loaded: PAGE_SIZE,
    composer: closedComposer(),
    edit: null,
    confirmDeleteId: null,
    restriction: null,
    recovery: false,
    announcement: '',
  };
  const draft = 'Found the second call site in `search/snippet.ts`. Same fix applies.';
  switch (s) {
    case 'empty':
      return { ...base, comments: [] };
    case 'composing':
      return { ...base, composer: { ...base.composer, open: true, draft } };
    case 'saving':
      return { ...base, composer: { ...base.composer, open: true, draft, phase: 'saving' } };
    case 'failed':
      return {
        ...base,
        composer: {
          ...base.composer,
          open: true,
          draft,
          phase: 'failed',
          error: 'Could not save the comment: the server did not respond. Your text is kept.',
        },
      };
    case 'conflict': {
      const c = base.comments[3]!;
      return {
        ...base,
        edit: {
          id: c.id,
          draft: c.body + '\n\nAlso applies to the export path.',
          baseRevision: 1,
          phase: 'conflict',
          error: null,
          current: {
            ...c,
            body: c.body + '\n\n(Edited in another tab: added link to fixture.)',
            revision: 2,
            editedAt: new Date().toISOString(),
          },
        },
      };
    }
    case 'archived':
      return { ...base, restriction: 'archived' };
    case 'readonly':
      return { ...base, restriction: 'readonly' };
    case 'recovery':
      return { ...base, recovery: true };
    case 'long':
      return { ...base, comments: makeComments(120) };
    default:
      return base;
  }
}

export function useCommentsModel(
  scenario: Scenario,
  nextOutcome: NextOutcome,
  persisted: { draft: string } | null,
): Model {
  const [st, setSt] = useState(() => {
    const init = initial(scenario);
    if (persisted?.draft) {
      init.composer = {
        ...init.composer,
        open: true,
        draft: persisted.draft,
        restoredNotice: true,
      };
    }
    return init;
  });
  const [lastFocus, setLastFocus] = useState('');
  const pendingFocus = useRef<string | null>(null);
  const outcome = useRef(nextOutcome);
  outcome.current = nextOutcome;

  // Move focus after render, once the target exists.
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    const el = document.getElementById(id);
    if (el) {
      el.focus();
      el.scrollIntoView({ block: 'nearest' });
      pendingFocus.current = null;
      setLastFocus(id);
    }
  });

  const focus = useCallback((id: string) => {
    pendingFocus.current = id;
    setLastFocus(id);
  }, []);

  const openComposer = useCallback(() => {
    setSt((s) => ({ ...s, composer: { ...s.composer, open: true } }));
    focus('composer-input');
  }, [focus]);

  const setDraft = useCallback((draft: string) => {
    setSt((s) => ({
      ...s,
      composer: {
        ...s.composer,
        draft,
        // Editing a failed draft keeps the same key: it is still the same intent only if unchanged.
        opKey:
          s.composer.phase === 'failed' && draft !== s.composer.draft ? newKey() : s.composer.opKey,
        phase: s.composer.phase === 'saving' ? 'saving' : 'idle',
        restoredNotice: false,
      },
    }));
  }, []);

  const cancelComposer = useCallback(() => {
    setSt((s) => ({ ...s, composer: closedComposer() }));
    focus('add-comment');
  }, [focus]);

  const post = useCallback(() => {
    setSt((s) => {
      if (s.composer.phase === 'saving' || !s.composer.draft.trim() || s.restriction || s.recovery)
        return s;
      return {
        ...s,
        composer: { ...s.composer, phase: 'saving', error: null },
        announcement: 'Posting comment…',
      };
    });
    window.setTimeout(() => {
      setSt((s) => {
        if (s.composer.phase !== 'saving') return s;
        if (outcome.current === 'fail') {
          return {
            ...s,
            composer: {
              ...s.composer,
              phase: 'failed',
              error: 'Could not save the comment: the server did not respond. Your text is kept.',
            },
            announcement: 'Comment not saved. Your text is kept.',
          };
        }
        if (outcome.current === 'conflict') {
          return {
            ...s,
            composer: {
              ...s.composer,
              phase: 'conflict',
              error:
                'This task was moved or archived somewhere else since you opened it. Your text is kept.',
            },
            announcement: 'Task changed elsewhere. Your text is kept.',
          };
        }
        const c: Comment = {
          id: `c${Date.now()}`,
          body: s.composer.draft,
          createdAt: new Date().toISOString(),
          editedAt: null,
          revision: 1,
        };
        const comments = [...s.comments, c];
        pendingFocus.current = `c-${c.id}`;
        return {
          ...s,
          comments,
          loaded: Math.max(s.loaded, comments.length),
          composer: closedComposer(),
          announcement: 'Comment posted.',
        };
      });
    }, 900);
  }, []);

  const startEdit = useCallback(
    (id: string) => {
      setSt((s) => {
        const c = s.comments.find((x) => x.id === id);
        if (!c) return s;
        return {
          ...s,
          edit: {
            id,
            draft: c.body,
            baseRevision: c.revision,
            phase: 'idle',
            error: null,
            current: null,
          },
        };
      });
      focus(`c-${id}-input`);
    },
    [focus],
  );

  const setEditDraft = useCallback((draft: string) => {
    setSt((s) =>
      s.edit
        ? {
            ...s,
            edit: { ...s.edit, draft, phase: s.edit.phase === 'conflict' ? 'conflict' : 'idle' },
          }
        : s,
    );
  }, []);

  const cancelEdit = useCallback(() => {
    setSt((s) => {
      if (s.edit) pendingFocus.current = `c-${s.edit.id}-edit`;
      return { ...s, edit: null };
    });
  }, []);

  const saveEdit = useCallback(() => {
    setSt((s) =>
      s.edit && s.edit.phase !== 'saving'
        ? {
            ...s,
            edit: { ...s.edit, phase: 'saving', error: null },
            announcement: 'Saving comment…',
          }
        : s,
    );
    window.setTimeout(() => {
      setSt((s) => {
        if (!s.edit || s.edit.phase !== 'saving') return s;
        const e = s.edit;
        const server = s.comments.find((c) => c.id === e.id)!;
        if (outcome.current === 'fail') {
          return {
            ...s,
            edit: {
              ...e,
              phase: 'failed',
              error: 'Could not save: the server did not respond. Your edit is kept.',
            },
            announcement: 'Edit not saved. Your text is kept.',
          };
        }
        if (outcome.current === 'conflict' || server.revision !== e.baseRevision) {
          const current =
            server.revision !== e.baseRevision
              ? server
              : {
                  ...server,
                  body: server.body + '\n\n(Edited in another tab.)',
                  revision: server.revision + 1,
                };
          return {
            ...s,
            comments: s.comments.map((c) => (c.id === e.id ? current : c)),
            edit: { ...e, phase: 'conflict', current },
            announcement:
              'This comment changed elsewhere. Your edit is kept; review the current version.',
          };
        }
        pendingFocus.current = `c-${e.id}`;
        return {
          ...s,
          comments: s.comments.map((c) =>
            c.id === e.id
              ? {
                  ...c,
                  body: e.draft,
                  editedAt: new Date().toISOString(),
                  revision: c.revision + 1,
                }
              : c,
          ),
          edit: null,
          announcement: 'Comment saved.',
        };
      });
    }, 900);
  }, []);

  /** Keep my text, but base it on the current revision; next Save may succeed. */
  const rebaseEdit = useCallback(() => {
    setSt((s) => {
      if (!s.edit?.current) return s;
      pendingFocus.current = `c-${s.edit.id}-input`;
      return {
        ...s,
        edit: { ...s.edit, baseRevision: s.edit.current.revision, phase: 'idle', current: null },
        announcement: 'Your edit is now based on the current version. Save to apply it.',
      };
    });
  }, []);

  const discardEdit = useCallback(() => {
    setSt((s) => {
      if (s.edit) pendingFocus.current = `c-${s.edit.id}`;
      return {
        ...s,
        edit: null,
        announcement: 'Your edit was discarded. Showing the current version.',
      };
    });
  }, []);

  const askDelete = useCallback(
    (id: string) => {
      setSt((s) => ({ ...s, confirmDeleteId: id }));
      focus(`c-${id}-delete-cancel`);
    },
    [focus],
  );
  const cancelDelete = useCallback(() => {
    setSt((s) => {
      if (s.confirmDeleteId) pendingFocus.current = `c-${s.confirmDeleteId}-delete`;
      return { ...s, confirmDeleteId: null };
    });
  }, []);
  const confirmDelete = useCallback((id: string) => {
    setSt((s) => {
      const idx = s.comments.findIndex((c) => c.id === id);
      const comments = s.comments.filter((c) => c.id !== id);
      const visible = comments.slice(0, s.loaded);
      const next = visible[idx] ?? visible[idx - 1];
      pendingFocus.current = next ? `c-${next.id}` : 'add-comment';
      return {
        ...s,
        comments,
        confirmDeleteId: null,
        announcement: `Comment deleted. ${comments.length} comments.`,
      };
    });
  }, []);

  const loadMore = useCallback(() => {
    setSt((s) => {
      const first = s.comments[s.loaded];
      if (first) pendingFocus.current = `c-${first.id}`;
      const loaded = s.loaded + PAGE_SIZE;
      const shown = Math.min(loaded, s.comments.length);
      return {
        ...s,
        loaded,
        announcement: `Loaded more comments. Showing ${shown} of ${s.comments.length}.`,
      };
    });
  }, []);

  const visible = st.comments.slice(0, st.loaded);
  const hasDraft =
    st.composer.draft.trim() !== '' ||
    (st.edit !== null && st.edit.draft !== st.comments.find((c) => c.id === st.edit!.id)?.body);

  // Real tab-close guard while a draft exists.
  useEffect(() => {
    if (!hasDraft) return;
    const h = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [hasDraft]);

  return {
    scenario,
    ...st,
    lastFocus,
    hasDraft,
    visible,
    remaining: Math.max(0, st.comments.length - st.loaded),
    openComposer,
    setDraft,
    cancelComposer,
    post,
    startEdit,
    setEditDraft,
    cancelEdit,
    saveEdit,
    rebaseEdit,
    discardEdit,
    askDelete,
    cancelDelete,
    confirmDelete,
    loadMore,
    focus,
  };
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
