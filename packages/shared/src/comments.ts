/**
 * Comments on backlog items (spec #58): one Markdown file per comment at
 * `<project-id>/tickets/<task-id>/comments/<comment-id>.md`, indexed as
 * their own records, separate from documents.
 */

/** The only comment file schema this version reads and writes. */
export const COMMENT_SCHEMA_VERSION = 1;

/** Default and maximum page size of `GET /api/documents/:taskId/comments`. */
export const COMMENT_PAGE_DEFAULT = 50;
export const COMMENT_PAGE_MAX = 200;

/** `POST /api/documents/:taskId/comments`. The operation ID travels as `Idempotency-Key`. */
export interface CreateCommentRequest {
  /** Client-generated comment UUID. */
  id: string;
  /** Markdown, stored exactly as submitted; whitespace-only is refused. */
  body: string;
}

/**
 * `PUT /api/comments/:commentId`. The operation ID travels as
 * `Idempotency-Key`, the expected revision as `If-Match`.
 */
export interface UpdateCommentRequest {
  /** Markdown, stored exactly as submitted; whitespace-only is refused. */
  body: string;
}

/** A comment as `GET /api/comments/:commentId` and list pages return it. */
export interface Comment {
  id: string;
  parent_id: string;
  /** The project the parent task lives in now. */
  project_id: string;
  body: string;
  created_at: string;
  updated_at: string;
  /** Fingerprint of the comment file's exact bytes; the If-Match value for edits. */
  revision: string;
  /** False while the parent is archived, its project read-only, or it is not a backlog item. */
  writable: boolean;
}

/** One page of a task's comments, oldest first within the page. */
export interface CommentPage {
  comments: Comment[];
  /** Fetches the next older page; `null` when this page holds the oldest comment. */
  next_cursor: string | null;
  /** All comments on the task. */
  total: number;
}

/** The acknowledgement of a comment command. It never carries the body. */
export interface CommentAck {
  operation_id: string;
  command: 'comment.create' | 'comment.edit' | 'comment.delete';
  comment_id: string;
  parent_id: string;
  outcome: 'created' | 'edited' | 'deleted';
  /** Revision of the file the command left; `null` after a delete. */
  result_revision: string | null;
}

/** Why a file in a comment directory was left out of the comment index. */
export type CommentProblemReason =
  | 'malformed'
  | 'unsupported_schema_version'
  | 'missing_parent'
  | 'duplicate_id';

/** A comment file Reload or Reindex reported instead of indexing. It is never changed. */
export interface CommentProblem {
  /** Relative to `<dataDir>/projects/`. */
  path: string;
  reason: CommentProblemReason;
  message: string;
}

export interface CommentIndexReport {
  indexed: number;
  problems: CommentProblem[];
}
