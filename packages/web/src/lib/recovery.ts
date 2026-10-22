import { useCallback } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  AbandonRecoveryAck,
  DismissRecoveryAck,
  RecheckResult,
  RecoveryDetail,
  RecoveryList,
  RecoverySummary,
} from '@backlogger/shared';
import { ApiError, apiFetch } from './api.js';
import { useDialog } from './dialog.js';
import { queryKeys } from './query-keys.js';

/*
 * Recovery review (spec #58, #61): operations a crash or failure left
 * pending, shown on the Recovery page, in the workspace banner and on the
 * boards, Current work and the task they block.
 */

const TRANSFER_COMMAND = 'document.file';
const DELETE_COMMANDS = ['document.delete', 'project.delete'];

export function isCommentOperation(op: Pick<RecoverySummary, 'command'>): boolean {
  return op.command.startsWith('comment.');
}

export function isTransfer(op: Pick<RecoverySummary, 'command'>): boolean {
  return op.command === TRANSFER_COMMAND;
}

export function isDeletion(op: Pick<RecoverySummary, 'command'>): boolean {
  return DELETE_COMMANDS.includes(op.command);
}

/** Stopped and waiting for the user. Moves and deletions still running do not count. */
export function needsReview(op: RecoverySummary): boolean {
  return op.state === 'pending' && !op.in_progress;
}

/** A filing running right now: its card shows Moving… and nothing needs doing. */
export function isMoving(op: RecoverySummary): boolean {
  return op.state === 'pending' && op.in_progress && isTransfer(op);
}

/** The badge naming what stopped. */
export function kindLabel(op: Pick<RecoverySummary, 'command'>): string {
  if (isTransfer(op)) return 'Filing stopped';
  if (isDeletion(op)) return 'Deletion stopped';
  return 'Content conflict';
}

/** Names projects for display; falls back to the ID. */
export type ProjectNamer = (projectId: string | null) => string;

export function taskName(op: Pick<RecoverySummary, 'task_title' | 'task_id'>): string {
  return op.task_title ?? (op.task_id ? `Task ${op.task_id.slice(0, 8)}` : 'Unknown task');
}

const COMMENT_ACTIONS: Record<string, string> = {
  'comment.create': 'Add comment',
  'comment.edit': 'Edit comment',
  'comment.delete': 'Delete comment',
};

/** The review panel's heading: what was attempted, in a few words. */
export function headline(op: RecoverySummary, project: ProjectNamer): string {
  const task = taskName(op);
  if (isTransfer(op)) {
    return `${task}: ${project(op.project_id)} → ${project(op.target_project_id)}`;
  }
  if (op.command === 'project.delete') return `Delete project ${project(op.project_id)}`;
  if (isDeletion(op)) return `Delete ${task} permanently`;
  return `${COMMENT_ACTIONS[op.command] ?? op.command} on ${task}`;
}

/** The Attempted fact: the same, as a sentence. */
export function attempted(op: RecoverySummary, project: ProjectNamer): string {
  const task = taskName(op);
  if (isTransfer(op)) {
    return `File ${task} from ${project(op.project_id)} to ${project(op.target_project_id)}`;
  }
  if (op.command === 'project.delete') {
    return `Delete project ${project(op.project_id)} and everything in it permanently`;
  }
  if (isDeletion(op)) return `Delete ${task} and its comments permanently`;
  const verb = COMMENT_ACTIONS[op.command]?.replace(' comment', ' a comment') ?? op.command;
  return `${verb} on ${task}`;
}

/** The list row's second line: the kind, or a filing's route. */
export function routeLabel(op: RecoverySummary, project: ProjectNamer): string {
  if (isTransfer(op)) return `${project(op.project_id)} → ${project(op.target_project_id)}`;
  if (isDeletion(op)) return 'Delete permanently';
  return 'Content conflict';
}

export function formatStarted(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * What blocks a task now: its pending operation, or else an abandoned one
 * whose final state is still to be dismissed.
 */
export function operationForTask(
  ops: readonly RecoverySummary[] | undefined,
  taskId: string,
): RecoverySummary | undefined {
  const mine = (ops ?? []).filter((op) => op.task_id === taskId);
  return mine.find((op) => op.state === 'pending') ?? mine.find((op) => op.state === 'abandoned');
}

/** The pending operation a `RECOVERY_REQUIRED` refusal names, if `err` is one. */
export function blockingOperationId(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.code !== 'RECOVERY_REQUIRED') return null;
  const id = (err.details as { operationId?: unknown } | undefined)?.operationId;
  return typeof id === 'string' ? id : null;
}

export function invalidateRecovery(qc: QueryClient): Promise<void> {
  return qc.invalidateQueries({ queryKey: queryKeys.recovery() });
}

/** Every pending operation, and abandoned ones not yet dismissed. Polled so the banner appears. */
export function useRecoveryList(): UseQueryResult<RecoveryList> {
  return useQuery({
    queryKey: queryKeys.recovery(),
    queryFn: () => apiFetch<RecoveryList>('/api/recovery'),
    refetchInterval: 10_000,
  });
}

export function useRecoveryDetail(operationId: string | null): UseQueryResult<RecoveryDetail> {
  return useQuery({
    queryKey: queryKeys.recoveryDetail(operationId ?? ''),
    queryFn: () => apiFetch<RecoveryDetail>(`/api/recovery/${operationId}`),
    enabled: operationId !== null,
    retry: false,
  });
}

/** Recheck: resume the original operation. Refreshes the list and every view it may have blocked. */
export function useRecheck(): UseMutationResult<RecheckResult, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (operationId) =>
      apiFetch<RecheckResult>(`/api/recovery/${operationId}/recheck`, { method: 'POST' }),
    onSuccess: (result) => {
      if (result.recovery) {
        qc.setQueryData(queryKeys.recoveryDetail(result.operation_id), result.recovery);
      }
      if (result.state === 'completed') refreshAfterRecovery(qc);
    },
    onSettled: () => invalidateRecovery(qc),
  });
}

export interface AbandonArgs {
  operationId: string;
  /** The abandon's own Idempotency-Key. */
  key: string;
  reviewToken: string;
}

export function useAbandon(): UseMutationResult<AbandonRecoveryAck, Error, AbandonArgs> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ operationId, key, reviewToken }) =>
      apiFetch<AbandonRecoveryAck>(`/api/recovery/${operationId}/abandon`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify({ review_token: reviewToken }),
      }),
    onSettled: async () => {
      refreshAfterRecovery(qc);
      await invalidateRecovery(qc);
    },
  });
}

export function useDismissRecovery(): UseMutationResult<DismissRecoveryAck, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (operationId) =>
      apiFetch<DismissRecoveryAck>(`/api/recovery/${operationId}/dismiss`, { method: 'POST' }),
    onSettled: () => invalidateRecovery(qc),
  });
}

/** A finished or abandoned operation can change boards, documents, comments and search. */
function refreshAfterRecovery(qc: QueryClient): void {
  for (const key of ['board', 'current-work', 'documents', 'document', 'comments', 'search']) {
    void qc.invalidateQueries({ queryKey: [key] });
  }
}

/**
 * Reports a command refused with `RECOVERY_REQUIRED`: a toast saying what
 * could not be done, with Review recovery (focused), or no link while the
 * task is moving. Returns false for any other error, which the caller reports.
 */
export function useRecoveryBlockedToast(
  openRecovery: (operationId: string) => void,
): (what: string, err: unknown) => boolean {
  const qc = useQueryClient();
  const dialog = useDialog();
  return useCallback(
    (what, err) => {
      const operationId = blockingOperationId(err);
      if (!operationId) return false;
      const known = qc
        .getQueryData<RecoveryList>(queryKeys.recovery())
        ?.operations.find((op) => op.operation_id === operationId);
      void invalidateRecovery(qc);
      if (known && isMoving(known)) {
        dialog.toast(`Can't ${what}: this task is moving.`);
      } else {
        dialog.toast(`Can't ${what}: a pending operation on this task needs review.`, {
          durationMs: 10_000,
          action: { label: 'Review recovery', onClick: () => openRecovery(operationId) },
        });
      }
      return true;
    },
    [dialog, openRecovery, qc],
  );
}
