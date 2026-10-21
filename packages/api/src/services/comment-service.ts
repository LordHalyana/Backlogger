import {
  COMMENT_PAGE_DEFAULT,
  COMMENT_PAGE_MAX,
  commentPath,
  isUuid,
  type Comment,
  type CommentAck,
  type CommentPage,
  type DocumentSummary,
} from '@backlogger/shared';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  PreconditionRequiredError,
} from '../errors.js';
import { contentRevision, DocumentNotFoundError, type FsRepository } from '../fs/index.js';
import { parseCommentFile, rewriteCommentBody, serializeComment } from '../fs/comment-file.js';
import type { CommentPosition, CommentRow, CommentsRepo } from '../db/comments-repo.js';
import type { DocumentsRepo } from '../db/documents-repo.js';
import type { ProjectsRepo } from '../db/projects-repo.js';
import {
  operationFingerprint,
  parseOperationId,
  type WriteCoordinator,
} from './write-coordinator.js';

export interface CommentServiceDeps {
  commentsRepo: CommentsRepo;
  documentsRepo: DocumentsRepo;
  projectsRepo: ProjectsRepo;
  fs: FsRepository;
  coordinator: WriteCoordinator;
  now?: () => string;
}

/**
 * `comment.create`, as received: the Idempotency-Key and every field
 * unvalidated, so an HTTP route and a future MCP adapter hand over the same
 * thing.
 */
export interface CreateCommentCommand {
  operationId: unknown;
  taskId: string;
  commentId: unknown;
  body: unknown;
}

/** `comment.edit`, as received; `expectedRevision` is the If-Match value. */
export interface EditCommentCommand {
  operationId: unknown;
  commentId: string;
  expectedRevision: unknown;
  body: unknown;
}

/** `comment.delete`, as received; `expectedRevision` is the If-Match value. */
export interface DeleteCommentCommand {
  operationId: unknown;
  commentId: string;
  expectedRevision: unknown;
}

export interface ListCommentsQuery {
  cursor?: unknown;
  limit?: unknown;
}

/** What a pending `comment.create` or `comment.edit` keeps until its completion transaction. */
export interface PendingCommentWrite {
  path: string;
  /** The exact intended bytes, server timestamps included. */
  content: string;
  /** Revision of the file before the write; `null` when it must not exist. */
  before: string | null;
  after: string;
}

/** What a pending `comment.delete` keeps: identity, path and expected revision only. */
export interface PendingCommentDelete {
  comment_id: string;
  parent_id: string;
  path: string;
  expected_revision: string;
}

/**
 * Comments on backlog items (spec #58): reads from the comment index and the
 * files, writes as retry-safe commands through the write coordinator.
 * Commands carry no project ID; the parent task says where a comment lives,
 * and comment writes never touch the parent's file.
 */
export class CommentService {
  private readonly commentsRepo: CommentsRepo;
  private readonly documentsRepo: DocumentsRepo;
  private readonly projectsRepo: ProjectsRepo;
  private readonly fs: FsRepository;
  private readonly coordinator: WriteCoordinator;
  private readonly now: () => string;

  constructor(deps: CommentServiceDeps) {
    this.commentsRepo = deps.commentsRepo;
    this.documentsRepo = deps.documentsRepo;
    this.projectsRepo = deps.projectsRepo;
    this.fs = deps.fs;
    this.coordinator = deps.coordinator;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async create(command: CreateCommentCommand): Promise<CommentAck> {
    const operationId = parseOperationId(command.operationId);
    const commentId = parseCommentId(command.commentId);
    const body = parseBody(command.body);
    const taskId = command.taskId;
    const fingerprint = operationFingerprint('comment.create', [taskId, commentId, body]);

    return this.coordinator.command({
      operation: { id: operationId, command: 'comment.create', fingerprint },
      locate: () => {
        const parent = this.findParent(taskId);
        const relPath = commentPath(parent.project_id, taskId, commentId);
        return { parent, relPath, projects: [parent.project_id] };
      },
      moved: ({ parent }) => parentMoved(parent),
      guards: ({ relPath }) => ({ tasks: [taskId], paths: [relPath] }),
      run: async ({ parent, relPath }, scope) => {
        this.assertWritable(parent);
        if (this.commentsRepo.find(commentId) || (await this.fileExists(relPath))) {
          throw new ConflictError(
            'COMMENT_ID_CONFLICT',
            `Comment id ${commentId} is already taken; post with a new id.`,
          );
        }

        const now = this.now();
        const content = serializeComment(
          { id: commentId, parent_id: taskId, created_at: now, updated_at: now },
          body,
        );
        const revision = contentRevision(content);
        const pending: PendingCommentWrite = {
          path: relPath,
          content,
          before: null,
          after: revision,
        };
        scope.intent({
          guards: [
            { project_id: parent.project_id, scope: 'task', key: taskId },
            { project_id: parent.project_id, scope: 'path', key: relPath },
          ],
          payload: JSON.stringify(pending),
        });

        await this.fs.createNew(relPath, content);
        // Step 10: anything but the intended bytes leaves the operation
        // pending for recovery instead of claiming success.
        if ((await this.fs.readText(relPath)) !== content) {
          throw new Error(`Comment file ${relPath} does not hold the intended bytes.`);
        }

        const ack: CommentAck = {
          operation_id: operationId,
          command: 'comment.create',
          comment_id: commentId,
          parent_id: taskId,
          outcome: 'created',
          result_revision: revision,
        };
        return scope.complete(ack, () =>
          this.commentsRepo.upsert({
            id: commentId,
            task_id: taskId,
            project_id: parent.project_id,
            path: relPath,
            body,
            created_at: now,
            updated_at: now,
            revision,
          }),
        );
      },
    });
  }

  /**
   * Replace a comment's body. Identity, parent, `created_at` and every other
   * frontmatter byte stay as they are; `updated_at` becomes now.
   */
  async edit(command: EditCommentCommand): Promise<CommentAck> {
    const operationId = parseOperationId(command.operationId);
    const commentId = parseCommentId(command.commentId);
    const expected = parseExpectedRevision(command.expectedRevision);
    const body = parseBody(command.body);
    const fingerprint = operationFingerprint('comment.edit', [commentId, expected, body]);

    return this.coordinator.command({
      operation: { id: operationId, command: 'comment.edit', fingerprint },
      ...this.locateComment(commentId),
      run: async ({ comment, parent }, scope) => {
        this.assertWritable(parent);
        const text = await this.readAtRevision(comment, expected);
        const now = this.now();
        const rewrite = rewriteCommentBody(comment.path, text, body, now);
        if (!rewrite.ok) {
          throw new ConflictError(
            'COMMENT_NOT_PRESERVABLE',
            `Comment ${commentId} cannot be edited without losing data: ${rewrite.message}.`,
          );
        }
        const { content } = rewrite;
        const revision = contentRevision(content);
        const pending: PendingCommentWrite = {
          path: comment.path,
          content,
          before: expected,
          after: revision,
        };
        scope.intent({ guards: commentGuards(comment), payload: JSON.stringify(pending) });

        await this.fs.writeRaw(comment.path, content);
        if ((await this.fs.readText(comment.path)) !== content) {
          throw new Error(`Comment file ${comment.path} does not hold the intended bytes.`);
        }

        const ack: CommentAck = {
          operation_id: operationId,
          command: 'comment.edit',
          comment_id: commentId,
          parent_id: comment.task_id,
          outcome: 'edited',
          result_revision: revision,
        };
        return scope.complete(ack, () =>
          this.commentsRepo.upsert({ ...comment, body, updated_at: now, revision }),
        );
      },
    });
  }

  /** Delete a comment's file and index row, permanently within the app. */
  async delete(command: DeleteCommentCommand): Promise<CommentAck> {
    const operationId = parseOperationId(command.operationId);
    const commentId = parseCommentId(command.commentId);
    const expected = parseExpectedRevision(command.expectedRevision);
    const fingerprint = operationFingerprint('comment.delete', [commentId, expected]);

    return this.coordinator.command({
      operation: { id: operationId, command: 'comment.delete', fingerprint },
      ...this.locateComment(commentId),
      run: async ({ comment, parent }, scope) => {
        this.assertWritable(parent);
        await this.readAtRevision(comment, expected);
        const pending: PendingCommentDelete = {
          comment_id: commentId,
          parent_id: comment.task_id,
          path: comment.path,
          expected_revision: expected,
        };
        scope.intent({ guards: commentGuards(comment), payload: JSON.stringify(pending) });

        // Anything but a removed (or already absent) file leaves the
        // operation pending for recovery.
        const result = await this.fs.deleteIfUnchanged(comment.path, expected);
        if (result === 'changed') {
          throw new Error(`Comment file ${comment.path} changed before it could be deleted.`);
        }
        if (await this.fileExists(comment.path)) {
          throw new Error(`Comment file ${comment.path} is still present after deletion.`);
        }

        const ack: CommentAck = {
          operation_id: operationId,
          command: 'comment.delete',
          comment_id: commentId,
          parent_id: comment.task_id,
          outcome: 'deleted',
          result_revision: null,
        };
        return scope.complete(ack, () => this.commentsRepo.delete(commentId));
      },
    });
  }

  /** One comment, read fresh from its file. */
  async get(rawId: string): Promise<Comment> {
    const id = rawId.toLowerCase();
    const row = isUuid(id) ? this.commentsRepo.find(id) : undefined;
    if (!row) throw commentNotFound(rawId);
    let text: string;
    try {
      text = await this.fs.readText(row.path);
    } catch (err) {
      if (err instanceof DocumentNotFoundError) throw commentNotFound(rawId);
      throw err;
    }
    const parsed = parseCommentFile(row.path, text);
    if (!parsed.ok) throw commentNotFound(rawId);
    const parent = this.documentsRepo.find(row.task_id);
    return {
      id: row.id,
      parent_id: row.task_id,
      project_id: parent?.project_id ?? row.project_id,
      body: parsed.comment.body,
      created_at: parsed.comment.created_at,
      updated_at: parsed.comment.updated_at,
      revision: contentRevision(text),
      writable: parent !== undefined && this.isWritable(parent),
    };
  }

  /**
   * A page of a task's comments from the index: without a cursor the newest
   * page, with one the next older page. Oldest first within the page.
   */
  list(taskId: string, query: ListCommentsQuery = {}): CommentPage {
    const limit = parseLimit(query.limit);
    const before = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const parent = this.findParent(taskId);
    const rows = this.commentsRepo.listNewestBefore(taskId, before, limit + 1);
    const hasOlder = rows.length > limit;
    const page = rows.slice(0, limit).reverse();
    const writable = this.isWritable(parent);
    return {
      comments: page.map((row) => toComment(row, parent.project_id, writable)),
      next_cursor: hasOlder && page[0] ? encodeCursor(page[0]) : null,
      total: this.commentsRepo.countForTask(taskId),
    };
  }

  /**
   * The coordinator's lookup for a command on an existing comment: the
   * comment's index row and its parent, which must still live where the
   * comment does.
   */
  private locateComment(commentId: string) {
    const locate = () => {
      const comment = this.commentsRepo.find(commentId);
      if (!comment) throw commentNotFound(commentId);
      const parent = this.findParent(comment.task_id);
      return { comment, parent, projects: [parent.project_id, comment.project_id] };
    };
    return {
      locate,
      moved: ({ parent }: ReturnType<typeof locate>) => parentMoved(parent),
      guards: ({ comment }: ReturnType<typeof locate>) => ({
        tasks: [comment.task_id],
        paths: [comment.path],
      }),
    };
  }

  /**
   * The comment file's text, once its revision matches the caller's
   * If-Match; `REVISION_CONFLICT` with the current revision otherwise.
   */
  private async readAtRevision(comment: CommentRow, expected: string): Promise<string> {
    let text: string;
    try {
      text = await this.fs.readText(comment.path);
    } catch (err) {
      if (err instanceof DocumentNotFoundError) throw commentNotFound(comment.id);
      throw err;
    }
    const current = contentRevision(text);
    if (current !== expected) {
      throw new ConflictError(
        'REVISION_CONFLICT',
        `Comment ${comment.id} was changed since If-Match=${expected}; current revision=${current}.`,
        { currentRevision: current },
      );
    }
    return text;
  }

  private findParent(taskId: string): DocumentSummary {
    const parent = this.documentsRepo.find(taskId);
    if (!parent) throw new NotFoundError('PARENT_NOT_FOUND', `Task not found: ${taskId}`);
    return parent;
  }

  /** Done allows changes; archived, read-only and non-backlog parents do not. */
  private isWritable(parent: DocumentSummary): boolean {
    return this.notWritableReason(parent) === null;
  }

  private assertWritable(parent: DocumentSummary): void {
    const reason = this.notWritableReason(parent);
    if (reason) throw new ConflictError('COMMENT_NOT_WRITABLE', reason);
  }

  private notWritableReason(parent: DocumentSummary): string | null {
    if (parent.type !== 'backlog_item') return 'Only backlog items have comments.';
    if (parent.status === 'archived')
      return 'This item is archived; restore it to change its comments.';
    if (parent.readOnly || this.projectsRepo.find(parent.project_id)?.readOnly !== false) {
      return 'This project is read-only.';
    }
    return null;
  }

  private async fileExists(relPath: string): Promise<boolean> {
    try {
      await this.fs.readText(relPath);
      return true;
    } catch (err) {
      if (err instanceof DocumentNotFoundError) return false;
      throw err;
    }
  }
}

function toComment(row: CommentRow, projectId: string, writable: boolean): Comment {
  return {
    id: row.id,
    parent_id: row.task_id,
    project_id: projectId,
    body: row.body,
    created_at: row.created_at,
    updated_at: row.updated_at,
    revision: row.revision,
    writable,
  };
}

/** A pending edit or delete blocks the parent task and the comment's path. */
function commentGuards(comment: CommentRow) {
  return [
    { project_id: comment.project_id, scope: 'task' as const, key: comment.task_id },
    { project_id: comment.project_id, scope: 'path' as const, key: comment.path },
  ];
}

function invalid(message: string): BadRequestError {
  return new BadRequestError('INVALID_COMMAND', message);
}

function parseCommentId(raw: unknown): string {
  if (typeof raw !== 'string' || !isUuid(raw.trim())) throw invalid('id must be a UUID.');
  return raw.trim().toLowerCase();
}

/** The If-Match value of an edit or delete; required, compared verbatim. */
function parseExpectedRevision(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new PreconditionRequiredError(
      'REVISION_REQUIRED',
      'If-Match with the comment revision is required.',
    );
  }
  return raw.trim();
}

/** Kept exactly as submitted; only whitespace-only bodies are refused. */
function parseBody(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw invalid('body must be non-empty Markdown text.');
  }
  return raw;
}

function parseLimit(raw: unknown): number {
  if (raw === undefined) return COMMENT_PAGE_DEFAULT;
  const n = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > COMMENT_PAGE_MAX) {
    throw invalid(`limit must be an integer from 1 to ${COMMENT_PAGE_MAX}.`);
  }
  return n;
}

/** Opaque to clients: the position of the oldest comment on the page. */
function encodeCursor(row: CommentPosition): string {
  return Buffer.from(JSON.stringify([row.created_at, row.id]), 'utf8').toString('base64url');
}

function decodeCursor(raw: unknown): CommentPosition {
  try {
    if (typeof raw !== 'string') throw new Error();
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'string' &&
      typeof value[1] === 'string'
    ) {
      return { created_at: value[0], id: value[1] };
    }
  } catch {
    // fall through
  }
  throw invalid('cursor is not one this server issued.');
}

function commentNotFound(id: string): NotFoundError {
  return new NotFoundError('COMMENT_NOT_FOUND', `Comment not found: ${id}`);
}

/** The parent was filed into another project while the command waited. */
function parentMoved(parent: DocumentSummary): ConflictError {
  return new ConflictError(
    'REVISION_CONFLICT',
    `The task was filed into project ${parent.project_id} while the comment waited; reload it.`,
    { currentRevision: parent.revision, currentProjectId: parent.project_id },
  );
}
