import {
  isCommentStoragePath,
  isLowercaseUuid,
  type CommentAck,
  type RecoveryKind,
  type RecoveryReason,
} from '@backlogger/shared';
import {
  contentRevision,
  DocumentNotFoundError,
  FsRepoError,
  type FsRepository,
} from '../fs/index.js';
import { parseCommentFile } from '../fs/comment-file.js';
import type { CommentsRepo } from '../db/comments-repo.js';
import type { DocumentsRepo } from '../db/documents-repo.js';
import type { PendingCommentDelete, PendingCommentWrite } from './comment-service.js';
import type {
  CompleteRecovered,
  PendingOperation,
  RecoveryAssessment,
  Recoverer,
} from './write-coordinator.js';

export interface CommentRecoveryDeps {
  commentsRepo: CommentsRepo;
  documentsRepo: DocumentsRepo;
  fs: FsRepository;
}

type CommentCommand = CommentAck['command'];

export const COMMENT_COMMANDS: readonly CommentCommand[] = [
  'comment.create',
  'comment.edit',
  'comment.delete',
];

/** A pending comment operation, read back from its payload. */
interface CommentTarget {
  command: CommentCommand;
  path: string;
  projectId: string;
  taskId: string;
  commentId: string;
  /** Revision of the file before the operation; `null` when it must be absent. */
  before: string | null;
  /** Revision of the file after the operation; `null` once it is deleted. */
  after: string | null;
  /** The exact intended bytes of a create or edit. */
  content: string | null;
}

/** Where the target's file stands: one of the two known states, or a stop. */
type Observation =
  | { state: 'before' | 'after'; target: CommentTarget; current: string | null }
  | { state: 'stopped'; assessment: RecoveryAssessment };

const OUTCOMES: Record<CommentCommand, CommentAck['outcome']> = {
  'comment.create': 'created',
  'comment.edit': 'edited',
  'comment.delete': 'deleted',
};

/**
 * Known-state recovery for comment operations (spec #58, "Comment write and
 * recovery sequence"). A file in the known before state is taken forward by
 * repeating the operation's write; one already in the known after state only
 * needs the bookkeeping. Any other state keeps the files and the payload and
 * is reported as a conflict. A missing parent, a changed owner or an
 * ambiguous path stops recovery. A file may be absent before a create or
 * after a delete; an edit's missing file is a conflict and never recreated.
 */
export class CommentRecovery implements Recoverer {
  readonly abandonable = true;
  private readonly commentsRepo: CommentsRepo;
  private readonly documentsRepo: DocumentsRepo;
  private readonly fs: FsRepository;

  constructor(deps: CommentRecoveryDeps) {
    this.commentsRepo = deps.commentsRepo;
    this.documentsRepo = deps.documentsRepo;
    this.fs = deps.fs;
  }

  async assess(op: PendingOperation): Promise<RecoveryAssessment> {
    const seen = await this.observe(op);
    if (seen.state === 'stopped') return seen.assessment;
    return assessment(seen.target, seen.current, {
      kind: 'resumable',
      reason: 'interrupted',
      message:
        seen.state === 'before'
          ? 'The operation stopped before its file was written; Recheck finishes it.'
          : 'The file was written but the operation was not recorded as finished; Recheck finishes it.',
    });
  }

  async resume(op: PendingOperation, complete: CompleteRecovered): Promise<void> {
    let seen = await this.observe(op);
    if (seen.state === 'before') {
      await this.writeForward(seen.target);
      seen = await this.observe(op);
    }
    if (seen.state !== 'after') return;
    const { target } = seen;
    const ack: CommentAck = {
      operation_id: op.operation_id,
      command: target.command,
      comment_id: target.commentId,
      parent_id: target.taskId,
      outcome: OUTCOMES[target.command],
      result_revision: target.after,
    };
    complete(ack, () => this.reindex(target));
  }

  /** Repeat the operation's own write from the known before state. */
  private async writeForward(target: CommentTarget): Promise<void> {
    if (target.command === 'comment.delete') {
      // 'changed' leaves the file in place; the next observation reports it.
      await this.fs.deleteIfUnchanged(target.path, target.before ?? '');
    } else if (target.command === 'comment.create') {
      await this.fs.createNew(target.path, target.content ?? '');
    } else {
      await this.fs.writeRaw(target.path, target.content ?? '');
    }
  }

  /** The completion transaction's index write. */
  private reindex(target: CommentTarget): void {
    if (target.command === 'comment.delete') {
      this.commentsRepo.delete(target.commentId);
      return;
    }
    const parsed = parseCommentFile(target.path, target.content ?? '');
    if (!parsed.ok) throw new Error(`Pending comment ${target.path} is not a valid comment.`);
    this.commentsRepo.upsert({
      id: target.commentId,
      task_id: target.taskId,
      project_id: target.projectId,
      path: target.path,
      body: parsed.comment.body,
      created_at: parsed.comment.created_at,
      updated_at: parsed.comment.updated_at,
      revision: target.after ?? '',
    });
  }

  private async observe(op: PendingOperation): Promise<Observation> {
    const target = readTarget(op);
    if (!target) {
      return stopped(unknownTarget(), null, {
        kind: 'structural',
        reason: 'ambiguous_path',
        message: 'The operation does not name one comment file; repair by hand.',
      });
    }
    const parent = this.documentsRepo.find(target.taskId);
    if (!parent) {
      return stopped(target, null, {
        kind: 'structural',
        reason: 'parent_missing',
        message: `The comment's task ${target.taskId} no longer exists.`,
      });
    }
    if (parent.project_id !== target.projectId) {
      return stopped(target, null, {
        kind: 'structural',
        reason: 'owner_changed',
        message: `The task now lives in project ${parent.project_id}, not ${target.projectId}.`,
      });
    }
    const indexed = this.commentsRepo.find(target.commentId);
    if (indexed && indexed.path !== target.path) {
      return stopped(target, null, {
        kind: 'structural',
        reason: 'ambiguous_path',
        message: `Comment ${target.commentId} is also indexed at ${indexed.path}.`,
      });
    }

    let current: string | null;
    try {
      current = await this.fs.readText(target.path);
    } catch (err) {
      if (err instanceof DocumentNotFoundError) current = null;
      else if (err instanceof FsRepoError) {
        return stopped(target, null, {
          kind: 'structural',
          reason: 'ambiguous_path',
          message: `${target.path} cannot be read safely: ${err.message}`,
        });
      } else throw err;
    }
    const observed = current === null ? null : contentRevision(current);
    if (observed === target.before) return { state: 'before', target, current };
    if (observed === target.after) return { state: 'after', target, current };
    if (current === null) {
      return stopped(target, current, {
        kind: 'structural',
        reason: 'file_missing',
        message: 'The comment file is missing; an edit never recreates it.',
      });
    }
    return stopped(target, current, {
      kind: 'content_conflict',
      reason: 'content_changed',
      message: 'The comment file was changed outside this operation.',
    });
  }
}

function stopped(
  target: CommentTarget,
  current: string | null,
  why: { kind: RecoveryKind; reason: RecoveryReason; message: string },
): Observation {
  return { state: 'stopped', assessment: assessment(target, current, why) };
}

function assessment(
  target: CommentTarget,
  current: string | null,
  why: { kind: RecoveryKind; reason: RecoveryReason; message: string },
): RecoveryAssessment {
  return {
    ...why,
    project_id: target.projectId || null,
    task_id: target.taskId || null,
    comment_id: target.commentId || null,
    paths: target.path
      ? [
          {
            path: target.path,
            before_revision: target.before,
            after_revision: target.after,
            observed_revision: current === null ? null : contentRevision(current),
          },
        ]
      : [],
    pending_content: target.content,
    current_content: current,
  };
}

function unknownTarget(): CommentTarget {
  return {
    command: 'comment.create',
    path: '',
    projectId: '',
    taskId: '',
    commentId: '',
    before: null,
    after: null,
    content: null,
  };
}

/**
 * The target named by a pending comment operation's payload, or `undefined`
 * when the payload is missing, unreadable or names a path that is not
 * exactly one comment file of the task it claims.
 */
function readTarget(op: PendingOperation): CommentTarget | undefined {
  const command = COMMENT_COMMANDS.find((c) => c === op.command);
  if (!command || op.payload === null) return undefined;
  let value: Partial<PendingCommentWrite & PendingCommentDelete>;
  try {
    value = JSON.parse(op.payload) as typeof value;
  } catch {
    return undefined;
  }
  const relPath = value.path;
  if (typeof relPath !== 'string' || !isCommentStoragePath(relPath)) return undefined;
  const [projectId = '', , taskId = '', , file = ''] = relPath.split('/');
  const commentId = file.replace(/\.md$/, '');
  if (relPath.split('/').length !== 5 || !isLowercaseUuid(taskId) || !isLowercaseUuid(commentId)) {
    return undefined;
  }
  const base = { command, path: relPath, projectId, taskId, commentId };
  if (command === 'comment.delete') {
    if (value.comment_id !== commentId || value.parent_id !== taskId) return undefined;
    if (typeof value.expected_revision !== 'string') return undefined;
    return { ...base, before: value.expected_revision, after: null, content: null };
  }
  if (typeof value.content !== 'string' || typeof value.after !== 'string') return undefined;
  if (value.after !== contentRevision(value.content)) return undefined;
  const before = command === 'comment.create' ? null : value.before;
  if (before === undefined || (command === 'comment.edit' && typeof before !== 'string')) {
    return undefined;
  }
  return { ...base, before: before ?? null, after: value.after, content: value.content };
}
