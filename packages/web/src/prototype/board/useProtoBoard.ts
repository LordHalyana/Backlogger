// PROTOTYPE — throwaway. Answers "What is the smallest useful board interaction?" (issue #9).
// In-memory task state only; nothing here persists. Delete with the prototype branch.
import { useCallback, useMemo, useRef, useState } from 'react';
import type { DocumentSummary } from '@backlogger/shared';
import { useDocuments } from '../../lib/documents.js';

export type TaskState = 'todo' | 'in_progress' | 'done';
export const TASK_STATES: readonly TaskState[] = ['todo', 'in_progress', 'done'];
export const TASK_STATE_LABELS: Record<TaskState, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
};

/** Simulated conditions so every required state can be seen on demand. */
export type SimMode = 'normal' | 'loading' | 'empty' | 'readonly' | 'slow' | 'reject';
export const SIM_MODES: readonly SimMode[] = ['normal', 'loading', 'empty', 'readonly', 'slow', 'reject'];
export const SIM_LABELS: Record<SimMode, string> = {
  normal: 'Normal',
  loading: 'Loading',
  empty: 'Empty board',
  readonly: 'Read-only project',
  slow: 'Slow save (2s)',
  reject: 'Save rejected (conflict)',
};

export interface ProtoCard {
  id: string;
  title: string;
  tags: string[];
  draft: boolean;
  readOnly: boolean;
  /** Real document that opens in the existing editor, or illustrative-only. */
  real: boolean;
  state: TaskState;
}

const DEMO: Omit<ProtoCard, 'state'>[] = [
  { id: 'demo-1', title: 'Write board spec', tags: ['planning'], draft: false, readOnly: false, real: false },
  { id: 'demo-2', title: 'Fix shared-sidecar save race', tags: ['bug'], draft: false, readOnly: false, real: false },
  { id: 'demo-3', title: 'Sketch backup restore drill', tags: [], draft: true, readOnly: false, real: false },
  { id: 'demo-4', title: 'Mounted: upstream API notes', tags: ['mounted'], draft: false, readOnly: true, real: false },
  { id: 'demo-5', title: 'Pick fractional rank library', tags: ['research'], draft: false, readOnly: false, real: false },
];
const DEMO_STATES: Record<string, TaskState> = {
  'demo-1': 'in_progress',
  'demo-5': 'done',
};

export interface ProtoBoard {
  loading: boolean;
  projectReadOnly: boolean;
  usingDemo: boolean;
  cards: ProtoCard[];
  pending: ReadonlySet<string>;
  error: { id: string; message: string } | null;
  lastArchived: ProtoCard | null;
  move: (id: string, to: TaskState) => void;
  archive: (id: string) => void;
  undoArchive: () => void;
  dismissError: () => void;
}

export function useProtoBoard(
  projectId: string,
  projectReadOnly: boolean,
  sim: SimMode,
): ProtoBoard {
  const docs = useDocuments(projectId);
  const [states, setStates] = useState<Record<string, TaskState>>(DEMO_STATES);
  const [archived, setArchived] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const [lastArchived, setLastArchived] = useState<ProtoCard | null>(null);
  const simRef = useRef(sim);
  simRef.current = sim;

  const realItems = useMemo<DocumentSummary[]>(
    () =>
      (docs.data ?? []).filter((d) => d.type === 'backlog_item' && d.status !== 'archived'),
    [docs.data],
  );
  const usingDemo = realItems.length === 0;
  const roProject = projectReadOnly || sim === 'readonly';

  const cards = useMemo<ProtoCard[]>(() => {
    if (sim === 'empty') return [];
    const base = usingDemo
      ? DEMO
      : realItems.map((d) => ({
          id: d.id,
          title: d.title,
          tags: d.tags,
          draft: d.status === 'draft',
          readOnly: d.readOnly,
          real: true,
        }));
    return base
      .filter((c) => !archived.has(c.id))
      .map((c) => ({
        ...c,
        readOnly: c.readOnly || roProject,
        // Missing/legacy values show as To do (decided in #6).
        state: states[c.id] ?? 'todo',
      }));
  }, [sim, usingDemo, realItems, archived, roProject, states]);

  const move = useCallback(
    (id: string, to: TaskState) => {
      const card = cards.find((c) => c.id === id);
      if (!card || card.readOnly || card.state === to || pending.has(id)) return;
      const from = card.state;
      setError(null);
      setStates((s) => ({ ...s, [id]: to }));
      setPending((p) => new Set(p).add(id));
      const mode = simRef.current;
      window.setTimeout(
        () => {
          setPending((p) => {
            const n = new Set(p);
            n.delete(id);
            return n;
          });
          if (mode === 'reject') {
            setStates((s) => ({ ...s, [id]: from }));
            setError({
              id,
              message: `"${card.title}" was changed elsewhere. The move was not saved — the card is back in ${TASK_STATE_LABELS[from]}.`,
            });
          }
        },
        mode === 'slow' ? 2000 : 450,
      );
    },
    [cards, pending],
  );

  const archive = useCallback(
    (id: string) => {
      const card = cards.find((c) => c.id === id);
      if (!card || card.readOnly) return;
      setArchived((a) => new Set(a).add(id));
      setLastArchived(card);
    },
    [cards],
  );

  const undoArchive = useCallback(() => {
    if (!lastArchived) return;
    setArchived((a) => {
      const n = new Set(a);
      n.delete(lastArchived.id);
      return n;
    });
    setLastArchived(null);
  }, [lastArchived]);

  return {
    loading: sim === 'loading' || docs.isLoading,
    projectReadOnly: roProject,
    usingDemo,
    cards,
    pending,
    error,
    lastArchived,
    move,
    archive,
    undoArchive,
    dismissError: () => setError(null),
  };
}

export function nextState(s: TaskState, dir: -1 | 1): TaskState | null {
  const i = TASK_STATES.indexOf(s) + dir;
  return TASK_STATES[i] ?? null;
}
