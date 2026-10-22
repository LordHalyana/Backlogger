import {
  COMMENTS_SEGMENT,
  FrontmatterSchema,
  storedTaskState,
  TICKETS_SEGMENT,
  type DocumentSummary,
  type FileDocumentAck,
  type RecoveryKind,
  type RecoveryPath,
  type RecoveryReason,
} from '@backlogger/shared';
import { ConflictError } from '../errors.js';
import {
  contentRevision,
  DocumentNotFoundError,
  FsRepoError,
  NotUtf8Error,
  type FsRepository,
} from '../fs/index.js';
import { parseCommentFile } from '../fs/comment-file.js';
import { isWriteLeftover } from '../fs/durable.js';
import type { CommentRow, CommentsRepo } from '../db/comments-repo.js';
import type { DocumentsRepo } from '../db/documents-repo.js';
import type { ManifestEntry } from '../db/operations-repo.js';
import type {
  CheckpointRecovered,
  CompleteRecovered,
  IntentRecord,
  PendingOperation,
  RecoveryAssessment,
  Recoverer,
  WriteCoordinator,
} from './write-coordinator.js';

export const TRANSFER_COMMAND = 'document.file';

export interface TaskTransferDeps {
  coordinator: WriteCoordinator;
  documentsRepo: DocumentsRepo;
  commentsRepo: CommentsRepo;
  fs: FsRepository;
}

/**
 * What a pending transfer keeps besides its manifest: who moves where, and
 * the last phase it durably passed.
 */
interface TransferPayload {
  task_id: string;
  source_project_id: string;
  target_project_id: string;
  phase: TransferPhase;
}

/**
 * `copying` until every destination file is verified; `destination_verified`
 * once the checkpoint transaction recorded that, after which the source copies
 * are cleaned up.
 */
type TransferPhase = 'copying' | 'destination_verified';

type ManifestRole = 'task_source' | 'task_target' | 'comment_source' | 'comment_target';

/** One file a transfer moves: from `source` to `target`, unchanged except the task's project line. */
interface TransferFile {
  kind: 'task' | 'comment';
  source: string;
  target: string;
  sourceRevision: string;
  targetRevision: string;
}

/** A transfer, read back from its payload and manifest. */
export interface TransferPlan {
  operationId: string;
  taskId: string;
  sourceProjectId: string;
  targetProjectId: string;
  phase: TransferPhase;
  /** The task first, then its comments by path. */
  files: TransferFile[];
}

/** Why a transfer cannot go on from where it stands. */
interface Stop {
  kind: Exclude<RecoveryKind, 'resumable'>;
  reason: RecoveryReason;
  message: string;
}

/** Where every file a transfer covers stands now. */
interface Observation {
  /** Path → revision of its bytes now; `null` when absent. */
  revisions: Map<string, string | null>;
  /** Entries in either comment directory that the manifest does not list. */
  unexpected: string[];
}

export type AdvanceResult = { done: true; ack: FileDocumentAck } | { done: false; stop: Stop };

/** The phase transactions an advancing transfer runs. */
export interface TransferTransactions {
  checkpoint: CheckpointRecovered;
  complete: CompleteRecovered;
}

/** What Reload and Reindex must leave alone while transfers are pending. */
export interface TransferIndexRules {
  /** Copies that are not authoritative yet (or any more): never indexed. */
  skipPaths: ReadonlySet<string>;
  /** Tasks mid-transfer: their rows are never purged by a Reload. */
  tasks: ReadonlySet<string>;
}

/** `<project>/tickets/<task>/comments`, the comment directory of a task. */
export function commentDir(projectId: string, taskId: string): string {
  return `${projectId}/${TICKETS_SEGMENT}/${taskId}/${COMMENTS_SEGMENT}`;
}

/** A task's path once filed into `targetProjectId`: the same project-relative path. */
export function filedPath(summary: DocumentSummary, targetProjectId: string): string {
  return rehome(summary.path, summary.project_id, targetProjectId);
}

/** The same project-relative path (project id first) in another project. */
function rehome(relPath: string, fromProjectId: string, toProjectId: string): string {
  return `${toProjectId}/${relPath.slice(fromProjectId.length + 1)}`;
}

/**
 * Recoverable task-and-comment transfers (spec #58, "Filing (transfer)").
 *
 *  1. Prepare: list the task and its comments from disk into a manifest of
 *     paths and expected revisions; anything else in the comment directory
 *     blocks the filing.
 *  2. Copy each file to the target, byte for byte (the task's project line
 *     aside), never over an unexpected file.
 *  3. Verify every copy and the unchanged source set, then record
 *     `destination_verified` in a checkpoint transaction.
 *  4. Clean up: remove each listed source file that still matches, after
 *     checking its copy. A missing source is done; a changed one is a conflict.
 *  5. Complete: index, receipt and guard release in one transaction.
 *
 * Recovery runs the same steps forward from the recorded phase, reusing
 * matching copies. Anything unexpected stops it as a conflict, with every
 * file kept. There is no rollback and no abandon.
 */
export class TaskTransfer implements Recoverer {
  readonly abandonable = false;
  private readonly coordinator: WriteCoordinator;
  private readonly documentsRepo: DocumentsRepo;
  private readonly commentsRepo: CommentsRepo;
  private readonly fs: FsRepository;

  constructor(deps: TaskTransferDeps) {
    this.coordinator = deps.coordinator;
    this.documentsRepo = deps.documentsRepo;
    this.commentsRepo = deps.commentsRepo;
    this.fs = deps.fs;
  }

  /**
   * Step 1, before the intent: the manifest of a transfer of `summary`
   * (whose file holds `taskText`, already checked) into `targetProjectId`.
   * Refuses, changing nothing, when the comment directory holds anything but
   * valid comments of this task, or anything already sits at the target.
   */
  async prepare(
    operationId: string,
    summary: DocumentSummary,
    targetProjectId: string,
    taskText: string,
  ): Promise<{ plan: TransferPlan; intent: IntentRecord }> {
    const taskId = summary.id;
    const sourceProjectId = summary.project_id;
    const files: TransferFile[] = [
      {
        kind: 'task',
        source: summary.path,
        target: filedPath(summary, targetProjectId),
        sourceRevision: contentRevision(taskText),
        targetRevision: contentRevision(rewriteProjectLine(taskText, targetProjectId)),
      },
    ];

    const problems: string[] = [];
    for (const entry of await this.fs.listDir(commentDir(sourceProjectId, taskId))) {
      if (entry.kind !== 'file') {
        problems.push(entry.path);
        continue;
      }
      let text: string;
      try {
        text = await this.fs.readExactText(entry.path);
      } catch (err) {
        // Not UTF-8, or not a name a comment file can have.
        if (err instanceof FsRepoError && !(err instanceof DocumentNotFoundError)) {
          problems.push(entry.path);
          continue;
        }
        throw err;
      }
      if (!parseCommentFile(entry.path, text).ok) {
        problems.push(entry.path);
        continue;
      }
      const revision = contentRevision(text);
      files.push({
        kind: 'comment',
        source: entry.path,
        target: rehome(entry.path, sourceProjectId, targetProjectId),
        sourceRevision: revision,
        targetRevision: revision,
      });
    }
    if (problems.length > 0) {
      throw new ConflictError(
        'COMMENTS_NOT_TRANSFERABLE',
        `The task's comment directory holds files that are not its comments; move or repair them first: ${problems.join(', ')}`,
        { paths: problems },
      );
    }

    const taken = [
      ...(await this.presentOf(files.map((f) => f.target))),
      ...(await this.fs.listDir(commentDir(targetProjectId, taskId))).map((e) => e.path),
    ];
    if (taken.length > 0) {
      throw new ConflictError(
        'TARGET_PATH_TAKEN',
        `Files already exist where the task would be filed: ${[...new Set(taken)].join(', ')}`,
        { paths: [...new Set(taken)] },
      );
    }

    const plan: TransferPlan = {
      operationId,
      taskId,
      sourceProjectId,
      targetProjectId,
      phase: 'copying',
      files,
    };
    const task = files[0]!;
    return {
      plan,
      intent: {
        guards: [
          { project_id: sourceProjectId, scope: 'task', key: taskId },
          { project_id: sourceProjectId, scope: 'path', key: task.source },
          { project_id: sourceProjectId, scope: 'path', key: commentDir(sourceProjectId, taskId) },
          { project_id: targetProjectId, scope: 'task', key: taskId },
          { project_id: targetProjectId, scope: 'path', key: task.target },
          { project_id: targetProjectId, scope: 'path', key: commentDir(targetProjectId, taskId) },
        ],
        payload: serializePayload(plan),
        manifest: files.flatMap((f): ManifestEntry[] => [
          { path: f.source, role: `${f.kind}_source`, fingerprint: f.sourceRevision },
          { path: f.target, role: `${f.kind}_target`, fingerprint: f.targetRevision },
        ]),
      },
    };
  }

  /**
   * Steps 2–5 from the plan's phase, with the transfer's locks held. Returns
   * the acknowledgement once complete, or where it stopped, every file kept.
   */
  async advance(plan: TransferPlan, tx: TransferTransactions): Promise<AdvanceResult> {
    // A copy killed mid-write leaves a temp file beside its target; it is
    // ours, so it never stops the transfer.
    await this.fs.removeWriteLeftovers(plan.files.map((f) => f.target));
    let stop = this.judge(plan, await this.observe(plan));
    if (stop) return { done: false, stop };

    if (plan.phase === 'copying') {
      for (const file of plan.files) {
        if (await this.isPresent(file.target)) continue;
        await this.fs.createNew(file.target, await this.targetContent(plan, file));
      }
      // Step 3: every copy in place and the sources untouched.
      stop = this.judge(plan, await this.observe(plan), { copied: true });
      if (stop) return { done: false, stop };
      plan = { ...plan, phase: 'destination_verified' };
      tx.checkpoint(serializePayload(plan));
    }

    // Step 4: the task file last, so a half-cleaned source never lists
    // comments without their task.
    for (const file of [...plan.files.slice(1), plan.files[0]!]) {
      if ((await this.revisionOf(file.target)) !== file.targetRevision) {
        return { done: false, stop: copyChanged(file.target) };
      }
      if ((await this.fs.deleteIfUnchanged(file.source, file.sourceRevision)) === 'changed') {
        return { done: false, stop: sourceChanged(file.source) };
      }
    }
    await this.fs.removeEmptyDir(commentDir(plan.sourceProjectId, plan.taskId));
    await this.fs.removeEmptyDir(`${plan.sourceProjectId}/${TICKETS_SEGMENT}/${plan.taskId}`);

    stop = this.judge(plan, await this.observe(plan));
    if (stop) return { done: false, stop };
    const write = await this.completionWrite(plan);
    const ack = acknowledgement(plan);
    tx.complete(ack, write);
    return { done: true, ack };
  }

  async assess(op: PendingOperation): Promise<RecoveryAssessment> {
    const plan = this.planOf(op);
    if (!plan) {
      return {
        kind: 'structural',
        reason: 'ambiguous_path',
        message: 'The filing does not name a task and its files; repair by hand.',
        project_id: null,
        task_id: null,
        comment_id: null,
        paths: [],
        pending_content: null,
        current_content: null,
      };
    }
    const seen = await this.observe(plan);
    const stop = this.judge(plan, seen);
    return {
      ...(stop ?? {
        kind: 'resumable',
        reason: 'interrupted',
        message:
          plan.phase === 'copying'
            ? `Filing into ${plan.targetProjectId} stopped while copying; Recheck finishes it.`
            : `Filing into ${plan.targetProjectId} stopped while cleaning up ${plan.sourceProjectId}; Recheck finishes it.`,
      }),
      project_id: plan.sourceProjectId,
      task_id: plan.taskId,
      comment_id: null,
      target_project_id: plan.targetProjectId,
      paths: plan.files.flatMap((f): RecoveryPath[] => [
        {
          path: f.source,
          before_revision: f.sourceRevision,
          after_revision: null,
          observed_revision: seen.revisions.get(f.source) ?? null,
        },
        {
          path: f.target,
          before_revision: null,
          after_revision: f.targetRevision,
          observed_revision: seen.revisions.get(f.target) ?? null,
        },
      ]),
      pending_content: null,
      current_content: null,
    };
  }

  async resume(
    op: PendingOperation,
    complete: CompleteRecovered,
    checkpoint: CheckpointRecovered,
  ): Promise<void> {
    const plan = this.planOf(op);
    if (plan) await this.advance(plan, { checkpoint, complete });
  }

  /**
   * Manifests first (spec #58): before the checkpoint the source copies are
   * authoritative, after it the target copies, so Reload and Reindex never
   * pick a duplicate winner for a task mid-transfer.
   */
  indexRules(): TransferIndexRules {
    const skipPaths = new Set<string>();
    const tasks = new Set<string>();
    for (const op of this.coordinator.pendingOperations()) {
      if (op.command !== TRANSFER_COMMAND) continue;
      const plan = this.planOf(op);
      if (!plan) continue;
      tasks.add(plan.taskId);
      for (const f of plan.files) {
        skipPaths.add(plan.phase === 'copying' ? f.target : f.source);
      }
    }
    return { skipPaths, tasks };
  }

  /** The transfer a pending operation records, or `undefined` when unreadable. */
  private planOf(op: PendingOperation): TransferPlan | undefined {
    let payload: Partial<TransferPayload>;
    try {
      payload = JSON.parse(op.payload ?? '') as Partial<TransferPayload>;
    } catch {
      return undefined;
    }
    const { task_id: taskId, source_project_id: from, target_project_id: to, phase } = payload;
    if (typeof taskId !== 'string' || typeof from !== 'string' || typeof to !== 'string') {
      return undefined;
    }
    if (phase !== 'copying' && phase !== 'destination_verified') return undefined;

    const entries = this.coordinator.manifestOf(op.operation_id);
    const byRole = (role: ManifestRole) => entries.filter((e) => e.role === role);
    const targets = new Map(
      [...byRole('task_target'), ...byRole('comment_target')].map((e) => [e.path, e]),
    );
    const files: TransferFile[] = [];
    for (const kind of ['task', 'comment'] as const) {
      for (const source of byRole(`${kind}_source`)) {
        if (!source.path.startsWith(`${from}/`)) return undefined;
        const target = targets.get(rehome(source.path, from, to));
        if (!target || source.fingerprint === null || target.fingerprint === null) {
          return undefined;
        }
        targets.delete(target.path);
        files.push({
          kind,
          source: source.path,
          target: target.path,
          sourceRevision: source.fingerprint,
          targetRevision: target.fingerprint,
        });
      }
    }
    if (files[0]?.kind !== 'task' || files.filter((f) => f.kind === 'task').length !== 1) {
      return undefined;
    }
    if (targets.size > 0) return undefined;
    return {
      operationId: op.operation_id,
      taskId,
      sourceProjectId: from,
      targetProjectId: to,
      phase,
      files,
    };
  }

  private async observe(plan: TransferPlan): Promise<Observation> {
    const revisions = new Map<string, string | null>();
    for (const f of plan.files) {
      revisions.set(f.source, await this.revisionOf(f.source));
      revisions.set(f.target, await this.revisionOf(f.target));
    }
    const listed = new Set(plan.files.flatMap((f) => [f.source, f.target]));
    const unexpected: string[] = [];
    for (const projectId of [plan.sourceProjectId, plan.targetProjectId]) {
      for (const entry of await this.fs.listDir(commentDir(projectId, plan.taskId))) {
        if (entry.kind === 'file' && (listed.has(entry.path) || isLeftoverOf(entry.path, listed))) {
          continue;
        }
        unexpected.push(entry.path);
      }
    }
    return { revisions, unexpected };
  }

  /**
   * Whether the files are in a state the transfer can go on from: before the
   * checkpoint, untouched sources and absent or matching copies (every copy
   * matching once `copied`); after it, matching copies and absent or
   * untouched sources. `null` when it can.
   */
  private judge(plan: TransferPlan, seen: Observation, { copied = false } = {}): Stop | null {
    const [first] = seen.unexpected;
    if (first !== undefined) {
      return {
        kind: 'structural',
        reason: 'unexpected_file',
        message: `${first} is not part of this filing; move it out of the comment directory, then Recheck.`,
      };
    }
    const verified = plan.phase === 'destination_verified';
    for (const f of plan.files) {
      const source = side(f.source, f.sourceRevision, seen, sourceChanged);
      const copy = side(f.target, f.targetRevision, seen, copyChanged);
      // `required` must already be in place: the source before the
      // checkpoint, the copy after it. `optional` may be absent.
      const [required, optional] = verified ? [copy, source] : [source, copy];
      if (required.observed !== required.expected) {
        return required.observed === null
          ? {
              kind: 'structural',
              reason: 'file_missing',
              message: `${required.path} is missing; restore it, then Recheck.`,
            }
          : required.changed(required.path);
      }
      if (optional.observed !== null && optional.observed !== optional.expected) {
        return optional.changed(optional.path);
      }
      if (copied && !verified && copy.observed === null) {
        return {
          kind: 'structural',
          reason: 'file_missing',
          message: `${copy.path} was not written; Recheck tries again.`,
        };
      }
    }
    return null;
  }

  /** The bytes a target copy must hold. Only called before the checkpoint, with sources verified. */
  private async targetContent(plan: TransferPlan, file: TransferFile): Promise<string> {
    const text = await this.fs.readExactText(file.source);
    return file.kind === 'task' ? rewriteProjectLine(text, plan.targetProjectId) : text;
  }

  /** Step 5's index writes, read ahead so the transaction itself never awaits. */
  private async completionWrite(plan: TransferPlan): Promise<() => void> {
    const [task, ...comments] = plan.files;
    const raw = await this.fs.read(task!.target);
    const fm = FrontmatterSchema.parse(raw.frontmatter);
    const row = this.documentsRepo.find(plan.taskId);
    const commentRows: CommentRow[] = [];
    for (const c of comments) {
      const parsed = parseCommentFile(c.target, await this.fs.readExactText(c.target));
      if (!parsed.ok) throw new Error(`${c.target} is not a valid comment: ${parsed.message}`);
      commentRows.push({
        id: parsed.comment.id,
        task_id: plan.taskId,
        project_id: plan.targetProjectId,
        path: c.target,
        body: parsed.comment.body,
        created_at: parsed.comment.created_at,
        updated_at: parsed.comment.updated_at,
        revision: c.targetRevision,
      });
    }
    return () => {
      this.documentsRepo.upsert({
        id: plan.taskId,
        project_id: plan.targetProjectId,
        title: fm.title,
        type: fm.type,
        status: row?.status ?? fm.status,
        path: task!.target,
        tags: fm.tags,
        readOnly: false,
        body: raw.body,
        created_at: fm.created_at,
        updated_at: fm.updated_at,
        revision: task!.targetRevision,
        task_state: storedTaskState(fm.task_state),
      });
      for (const r of commentRows) this.commentsRepo.upsert(r);
    };
  }

  private async revisionOf(relPath: string): Promise<string | null> {
    try {
      return contentRevision(await this.fs.readExactText(relPath));
    } catch (err) {
      if (err instanceof DocumentNotFoundError) return null;
      // Present, but no copy of ours: never equal to an expected revision.
      if (err instanceof NotUtf8Error) return 'not-utf8';
      throw err;
    }
  }

  private async isPresent(relPath: string): Promise<boolean> {
    return (await this.revisionOf(relPath)) !== null;
  }

  private async presentOf(paths: readonly string[]): Promise<string[]> {
    const out: string[] = [];
    for (const p of paths) if (await this.isPresent(p)) out.push(p);
    return out;
  }
}

/** A temp file an interrupted write of one of the `listed` files left beside it. */
function isLeftoverOf(relPath: string, listed: ReadonlySet<string>): boolean {
  const at = relPath.lastIndexOf('/');
  const dir = relPath.slice(0, at);
  const name = relPath.slice(at + 1);
  return [...listed].some(
    (p) => p.slice(0, p.lastIndexOf('/')) === dir && isWriteLeftover(name, p.slice(p.lastIndexOf('/') + 1)),
  );
}

function serializePayload(plan: TransferPlan): string {
  const payload: TransferPayload = {
    task_id: plan.taskId,
    source_project_id: plan.sourceProjectId,
    target_project_id: plan.targetProjectId,
    phase: plan.phase,
  };
  return JSON.stringify(payload);
}

/** One side of a transferred file: where it is, what it must hold, what it holds now. */
function side(
  path: string,
  expected: string,
  seen: Observation,
  changed: (path: string) => Stop,
): { path: string; expected: string; observed: string | null; changed: (path: string) => Stop } {
  return { path, expected, observed: seen.revisions.get(path) ?? null, changed };
}

function acknowledgement(plan: TransferPlan): FileDocumentAck {
  return filingAck({
    operationId: plan.operationId,
    taskId: plan.taskId,
    sourceProjectId: plan.sourceProjectId,
    targetProjectId: plan.targetProjectId,
    outcome: 'filed',
    resultRevision: plan.files[0]!.targetRevision,
  });
}

/** The acknowledgement of a filing, whether it moved the task or found it in place. */
export function filingAck(f: {
  operationId: string;
  taskId: string;
  sourceProjectId: string;
  targetProjectId: string;
  outcome: FileDocumentAck['outcome'];
  resultRevision: string;
}): FileDocumentAck {
  return {
    operation_id: f.operationId,
    command: TRANSFER_COMMAND,
    document_id: f.taskId,
    source_project_id: f.sourceProjectId,
    target_project_id: f.targetProjectId,
    outcome: f.outcome,
    result_revision: f.resultRevision,
  };
}

function sourceChanged(relPath: string): Stop {
  return {
    kind: 'content_conflict',
    reason: 'content_changed',
    message: `${relPath} changed while it was being filed; it is kept as it is.`,
  };
}

function copyChanged(relPath: string): Stop {
  return {
    kind: 'content_conflict',
    reason: 'content_changed',
    message: `${relPath} holds content this filing did not write; it is never overwritten.`,
  };
}

/**
 * Replace the value of the frontmatter's top-level `project:` line, leaving
 * every other byte as it was. Throws unless exactly one such line exists.
 */
export function rewriteProjectLine(text: string, projectId: string): string {
  const match = /^(---\r?\n)([\s\S]*?\r?\n)(---(?:\r?\n|$))/.exec(text);
  const lines = match ? match[2]!.match(/^project:[^\r\n]*$/gm) : null;
  if (!match || !lines || lines.length !== 1) throw frontmatterNotRewritable();
  const block = match[2]!.replace(/^project:[^\r\n]*$/m, `project: ${projectId}`);
  return match[1] + block + text.slice(match[1]!.length + match[2]!.length);
}

/** Frontmatter whose `project:` line Backlogger cannot rewrite without touching other bytes. */
export function frontmatterNotRewritable(): ConflictError {
  return new ConflictError(
    'DERIVED_DOCUMENT_READ_ONLY',
    'This document has frontmatter Backlogger cannot rewrite safely; edit its project line by hand.',
  );
}
