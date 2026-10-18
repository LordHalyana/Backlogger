import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  taskStateColumn,
  TASK_STATES,
  type Board,
  type BoardCard,
  type Document,
  type TaskState,
} from '@backlogger/shared';
import { apiFetch } from './api.js';
import { invalidateDocumentDerived, queryKeys, setDocumentCache } from './query-keys.js';

/** The project board. Column assignment and order come from the server. */
export function useBoard(projectId: string): UseQueryResult<Board> {
  return useQuery({
    queryKey: queryKeys.board(projectId),
    queryFn: () => apiFetch<Board>(`/api/projects/${projectId}/board`),
  });
}

/**
 * Place `card` in the column for `to`, at its creation-order position
 * (`created_at`, then id), mirroring the server's order for optimistic display.
 */
export function placeCard(board: Board, card: BoardCard, to: TaskState): Board {
  const columns = {} as Board['columns'];
  for (const state of TASK_STATES) {
    columns[state] = board.columns[state].filter((c) => c.id !== card.id);
  }
  const target = [...columns[to], card];
  target.sort((a, b) =>
    a.created_at === b.created_at
      ? a.id.localeCompare(b.id)
      : a.created_at.localeCompare(b.created_at),
  );
  columns[to] = target;
  return { columns };
}

export interface MoveCardArgs {
  card: BoardCard;
  to: TaskState;
}

/**
 * Change a card's task state. The card moves immediately; a rejected save
 * (e.g. 409 on a stale revision) puts it back in its previous column.
 */
export function useMoveCard(
  projectId: string,
): UseMutationResult<Document, Error, MoveCardArgs, { previous: BoardCard }> {
  const qc = useQueryClient();
  const key = queryKeys.board(projectId);
  const update = (fn: (board: Board) => Board): void => {
    qc.setQueryData<Board>(key, (board) => (board ? fn(board) : board));
  };
  return useMutation({
    mutationFn: ({ card, to }) =>
      apiFetch<Document>(`/api/documents/${card.id}`, {
        method: 'PUT',
        headers: { 'If-Match': card.revision },
        body: JSON.stringify({ task_state: to }),
      }),
    onMutate: async ({ card, to }) => {
      await qc.cancelQueries({ queryKey: key });
      update((board) => placeCard(board, { ...card, task_state: to }, to));
      return { previous: card };
    },
    onError: (_err, _args, context) => {
      if (!context) return;
      const { previous } = context;
      update((board) => placeCard(board, previous, taskStateColumn(previous.task_state)));
    },
    onSuccess: (doc, { card, to }) => {
      setDocumentCache(qc, doc);
      update((board) => placeCard(board, { ...card, task_state: to, revision: doc.revision }, to));
    },
    onSettled: () => invalidateDocumentDerived(qc, projectId),
  });
}
