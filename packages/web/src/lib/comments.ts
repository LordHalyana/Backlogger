import {
  useInfiniteQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';
import type { Comment, CommentAck, CommentPage } from '@backlogger/shared';
import { apiFetch } from './api.js';
import { queryKeys } from './query-keys.js';

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

/** The loaded comments oldest to newest, and the task's total. */
export function flattenHistory(data: InfiniteData<CommentPage, string | null> | undefined): {
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

export function createComment(
  taskId: string,
  input: { operationId: string; commentId: string; body: string },
): Promise<CommentAck> {
  return apiFetch<CommentAck>(`/api/documents/${taskId}/comments`, {
    method: 'POST',
    headers: { 'Idempotency-Key': input.operationId },
    body: JSON.stringify({ id: input.commentId, body: input.body }),
  });
}

export function editComment(input: {
  operationId: string;
  commentId: string;
  revision: string;
  body: string;
}): Promise<CommentAck> {
  return apiFetch<CommentAck>(`/api/comments/${input.commentId}`, {
    method: 'PUT',
    headers: { 'Idempotency-Key': input.operationId, 'If-Match': input.revision },
    body: JSON.stringify({ body: input.body }),
  });
}

export function deleteComment(input: {
  operationId: string;
  commentId: string;
  revision: string;
}): Promise<CommentAck> {
  return apiFetch<CommentAck>(`/api/comments/${input.commentId}`, {
    method: 'DELETE',
    headers: { 'Idempotency-Key': input.operationId, 'If-Match': input.revision },
  });
}
