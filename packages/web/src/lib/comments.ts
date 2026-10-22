import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type UseInfiniteQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';
import type { Comment, CommentAck, CommentPage } from '@backlogger/shared';
import { apiFetch } from './api.js';
import { invalidateComments, invalidateRecovery, queryKeys } from './query-keys.js';

/**
 * A task's comment history. The first page is the newest one; each further
 * page is the next older one. Comments within a page run oldest first.
 */
export function useCommentHistory(
  taskId: string,
  enabled = true,
): UseInfiniteQueryResult<InfiniteData<CommentPage, string | null>> {
  return useInfiniteQuery({
    queryKey: queryKeys.comments(taskId),
    queryFn: ({ pageParam }) =>
      apiFetch<CommentPage>(
        `/api/documents/${taskId}/comments` +
          (pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled,
  });
}

/**
 * A task's comment history opened on one comment beyond the newest page: that
 * comment with two either side, then further pages outwards. As in
 * `useCommentHistory`, the first page is the newest one loaded; newer pages
 * are fetched as previous pages, older ones as next pages. Disabled without a
 * comment.
 */
export function useCommentsAround(
  taskId: string,
  commentId: string | null,
): UseInfiniteQueryResult<InfiniteData<CommentPage, string>> {
  return useInfiniteQuery({
    queryKey: queryKeys.commentsAround(taskId, commentId ?? ''),
    // Each page param is the list's query string.
    queryFn: ({ pageParam }) =>
      apiFetch<CommentPage>(`/api/documents/${taskId}/comments?${pageParam}`),
    initialPageParam: `around=${encodeURIComponent(commentId ?? '')}`,
    getNextPageParam: (last) =>
      last.next_cursor ? `cursor=${encodeURIComponent(last.next_cursor)}` : null,
    getPreviousPageParam: (first) =>
      first.newer_cursor ? `after=${encodeURIComponent(first.newer_cursor)}` : null,
    enabled: commentId !== null,
  });
}

/** The loaded comments oldest to newest, and the task's total. */
export function flattenHistory(data: InfiniteData<CommentPage, unknown> | undefined): {
  comments: Comment[];
  total: number;
} {
  if (!data) return { comments: [], total: 0 };
  const seen = new Set<string>();
  const comments: Comment[] = [];
  for (const page of [...data.pages].reverse()) {
    for (const c of page.comments) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      comments.push(c);
    }
  }
  return { comments, total: data.pages[0]?.total ?? comments.length };
}

/**
 * A fresh UUID v4 for a comment ID or an Idempotency-Key. Falls back to
 * `getRandomValues` because `randomUUID` needs a secure context, and a
 * self-hosted Backlogger is often served over plain HTTP.
 */
export function newUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function fetchComment(commentId: string): Promise<Comment> {
  return apiFetch<Comment>(`/api/comments/${commentId}`);
}

export interface CreateCommentArgs {
  /** The Idempotency-Key; Retry resends the same one with the same comment ID. */
  operationId: string;
  commentId: string;
  body: string;
}

export interface EditCommentArgs {
  operationId: string;
  commentId: string;
  /** The revision being edited (If-Match). */
  revision: string;
  body: string;
}

export interface DeleteCommentArgs {
  operationId: string;
  commentId: string;
  revision: string;
}

/*
 * Comment writes. Each refetches the task's history once it settles, success
 * or not, and resolves only after that refetch, so callers see the new history.
 * A failed write may have left an operation pending, so recovery refetches too.
 */

/**
 * Composer drafts held while recovery pauses writing: the draft is kept, so
 * leaving the task (to review the recovery, say) does not discard it, and
 * reopening the task in this tab restores it.
 */
const heldDrafts = new Map<string, string>();

export function holdDraft(taskId: string, text: string): void {
  if (text === '') heldDrafts.delete(taskId);
  else heldDrafts.set(taskId, text);
}

export function heldDraft(taskId: string): string {
  return heldDrafts.get(taskId) ?? '';
}

function settleWrite(qc: QueryClient, taskId: string): Promise<void> {
  void invalidateRecovery(qc);
  return invalidateComments(qc, taskId);
}

export function useCreateComment(
  taskId: string,
): UseMutationResult<CommentAck, Error, CreateCommentArgs> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ operationId, commentId, body }) =>
      apiFetch<CommentAck>(`/api/documents/${taskId}/comments`, {
        method: 'POST',
        headers: { 'Idempotency-Key': operationId },
        body: JSON.stringify({ id: commentId, body }),
      }),
    onSettled: () => settleWrite(qc, taskId),
  });
}

export function useEditComment(
  taskId: string,
): UseMutationResult<CommentAck, Error, EditCommentArgs> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ operationId, commentId, revision, body }) =>
      apiFetch<CommentAck>(`/api/comments/${commentId}`, {
        method: 'PUT',
        headers: { 'Idempotency-Key': operationId, 'If-Match': revision },
        body: JSON.stringify({ body }),
      }),
    onSettled: () => settleWrite(qc, taskId),
  });
}

export function useDeleteComment(
  taskId: string,
): UseMutationResult<CommentAck, Error, DeleteCommentArgs> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ operationId, commentId, revision }) =>
      apiFetch<CommentAck>(`/api/comments/${commentId}`, {
        method: 'DELETE',
        headers: { 'Idempotency-Key': operationId, 'If-Match': revision },
      }),
    onSettled: () => settleWrite(qc, taskId),
  });
}
