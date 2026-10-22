import { createHash } from 'node:crypto';
import {
  isUuid,
  type AbandonRecoveryAck,
  type DismissRecoveryAck,
  type RecheckResult,
  type RecoveryAction,
  type RecoveryDetail,
  type RecoveryList,
  type RecoverySummary,
} from '@backlogger/shared';
import { BadRequestError, ConflictError, NotFoundError } from '../errors.js';
import type { DocumentsRepo } from '../db/documents-repo.js';
import {
  operationFingerprint,
  type AbandonedTarget,
  parseOperationId,
  type PendingOperation,
  type RecoveryAssessment,
  type WriteCoordinator,
} from './write-coordinator.js';

export interface RecoveryServiceDeps {
  coordinator: WriteCoordinator;
  /** For the task titles the Recovery page names operations by. */
  documentsRepo: DocumentsRepo;
}

/** `recovery.abandon`, as received: its own Idempotency-Key and the review token. */
export interface AbandonCommand {
  operationId: unknown;
  targetOperationId: string;
  reviewToken: unknown;
}

/**
 * The shared recovery API (spec #58, "Recovery API and guards"): list the
 * pending operations, inspect one, recheck it (resume the original
 * operation) or, for comment operations only, abandon it. The server decides
 * which actions an operation offers; nothing forces an overwrite or a
 * deletion. Reads take no locks; recheck and abandon run through the write
 * coordinator under the operation's project queues.
 */
export class RecoveryService {
  private readonly coordinator: WriteCoordinator;
  private readonly documentsRepo: DocumentsRepo;

  constructor(deps: RecoveryServiceDeps) {
    this.coordinator = deps.coordinator;
    this.documentsRepo = deps.documentsRepo;
  }

  /**
   * Summaries of every pending operation, and of abandoned ones not yet
   * dismissed, oldest first. Never any content.
   */
  async list(): Promise<RecoveryList> {
    const operations: RecoverySummary[] = [];
    for (const op of this.coordinator.reviewableOperations()) {
      operations.push(
        op.state === 'abandoned'
          ? this.abandonedSummary(op)
          : this.summary(op, await this.assess(op)),
      );
    }
    return { operations };
  }

  /** A pending operation's review, or an abandoned one's final state. */
  async detail(rawId: string): Promise<RecoveryDetail> {
    const op = this.find(rawId);
    if (op.state === 'abandoned') {
      return {
        ...this.abandonedSummary(op),
        paths: [],
        actions: [],
        review_token: reviewToken(op, null),
        pending_content: null,
        current_content: null,
      };
    }
    if (op.state !== 'pending') {
      throw new NotFoundError('RECOVERY_NOT_FOUND', `Operation ${rawId} is not pending.`);
    }
    return this.detailOf(op);
  }

  /**
   * Take an abandoned operation's final state off the Recovery page, once the
   * user dismissed its notice on the task. Only a display flag changes, so a
   * repeat is harmless and needs no Idempotency-Key.
   */
  dismiss(rawId: string): DismissRecoveryAck {
    const op = this.find(rawId);
    if (op.state !== 'abandoned') {
      throw new ConflictError(
        'RECOVERY_ACTION_NOT_ALLOWED',
        `Operation ${op.operation_id} (${op.command}, ${op.state}) has no final state to dismiss.`,
        { operationId: op.operation_id, actions: this.actionsFor(op) },
      );
    }
    this.coordinator.dismiss(op.operation_id);
    return { operation_id: op.operation_id, dismissed: true };
  }

  /** Resume the original operation from where it stands; never start a new one. */
  async recheck(rawId: string): Promise<RecheckResult> {
    const id = this.find(rawId).operation_id;
    await this.coordinator.command({
      locate: () => ({ projects: this.coordinator.guardedProjects(id) }),
      recoveryAction: true,
      run: () => this.coordinator.resume(id),
    });
    const op = this.find(id);
    return {
      operation_id: id,
      state: op.state,
      acknowledgement: op.state === 'completed' ? op.outcome : null,
      recovery: op.state === 'pending' ? await this.detailOf(op) : null,
    };
  }

  /**
   * Give up a pending comment operation: one transaction records this
   * command's acknowledgement, marks the original abandoned (it is never
   * replayed) and removes its payload and guards. Markdown is left as it is.
   */
  async abandon(command: AbandonCommand): Promise<AbandonRecoveryAck> {
    const operationId = parseOperationId(command.operationId);
    const token = command.reviewToken;
    if (typeof token !== 'string' || token === '') {
      throw new BadRequestError('INVALID_COMMAND', 'review_token is required.');
    }
    const targetId = command.targetOperationId.toLowerCase();
    const fingerprint = operationFingerprint('recovery.abandon', [targetId, token]);

    return this.coordinator.command({
      operation: { id: operationId, command: 'recovery.abandon', fingerprint },
      locate: () => ({
        projects: this.coordinator.guardedProjects(this.find(targetId).operation_id),
      }),
      recoveryAction: true,
      run: async (_located, scope) => {
        const target = this.find(targetId);
        if (target.state === 'abandoned') {
          throw new ConflictError('OPERATION_ABANDONED', `Operation ${targetId} was abandoned.`, {
            operationId: targetId,
          });
        }
        if (
          target.state !== 'pending' ||
          !this.coordinator.recovererFor(target.command)?.abandonable
        ) {
          throw new ConflictError(
            'RECOVERY_ACTION_NOT_ALLOWED',
            `Operation ${targetId} (${target.command}, ${target.state}) cannot be abandoned.`,
            { operationId: targetId, actions: this.actionsFor(target) },
          );
        }
        const current = await this.detailOf(target);
        if (current.review_token !== token) {
          throw new ConflictError(
            'REVISION_CONFLICT',
            `Operation ${targetId} changed since it was reviewed; review it again.`,
            { operationId: targetId, reviewToken: current.review_token },
          );
        }
        const ack: AbandonRecoveryAck = {
          operation_id: operationId,
          command: 'recovery.abandon',
          target_operation_id: targetId,
          outcome: 'abandoned',
        };
        const about: AbandonedTarget = {
          kind: current.kind,
          reason: current.reason,
          project_id: current.project_id,
          task_id: current.task_id,
          comment_id: current.comment_id,
        };
        return scope.abandon(targetId, ack, about);
      },
    });
  }

  private async detailOf(op: PendingOperation): Promise<RecoveryDetail> {
    const assessed = await this.assess(op);
    return {
      ...this.summary(op, assessed),
      paths: assessed.paths,
      actions: this.actionsFor(op),
      review_token: reviewToken(op, assessed),
      pending_content: assessed.pending_content,
      current_content: assessed.current_content,
    };
  }

  private summary(op: PendingOperation, assessed: RecoveryAssessment): RecoverySummary {
    return {
      operation_id: op.operation_id,
      command: op.command,
      state: 'pending',
      created_at: op.created_at,
      kind: assessed.kind,
      reason: assessed.reason,
      message: assessed.message,
      project_id: assessed.project_id,
      task_id: assessed.task_id,
      task_title: this.titleOf(assessed.task_id),
      target_project_id: assessed.target_project_id ?? null,
      comment_id: assessed.comment_id,
      in_progress: this.coordinator.isRunning(op.operation_id),
      abandoned_at: null,
    };
  }

  /** An abandoned operation, from what its row kept once the payload went. */
  private abandonedSummary(op: PendingOperation): RecoverySummary {
    const about = (op.outcome ?? {}) as Partial<AbandonedTarget>;
    const taskId = about.task_id ?? null;
    return {
      operation_id: op.operation_id,
      command: op.command,
      state: 'abandoned',
      created_at: op.created_at,
      kind: about.kind ?? 'content_conflict',
      reason: about.reason ?? 'content_changed',
      message: 'The pending change was abandoned. The current file was kept unchanged.',
      project_id: about.project_id ?? null,
      task_id: taskId,
      task_title: this.titleOf(taskId),
      target_project_id: null,
      comment_id: about.comment_id ?? null,
      in_progress: false,
      abandoned_at: op.completed_at,
    };
  }

  private titleOf(taskId: string | null): string | null {
    return taskId === null ? null : (this.documentsRepo.find(taskId)?.title ?? null);
  }

  private assess(op: PendingOperation): Promise<RecoveryAssessment> {
    const recoverer = this.coordinator.recovererFor(op.command);
    if (recoverer) return recoverer.assess(op);
    return Promise.resolve({
      kind: 'structural',
      reason: 'unsupported',
      message: `This version cannot inspect ${op.command} operations; Recheck once it can.`,
      project_id: null,
      task_id: null,
      comment_id: null,
      paths: [],
      pending_content: null,
      current_content: null,
    });
  }

  private actionsFor(op: PendingOperation): RecoveryAction[] {
    if (op.state !== 'pending') return [];
    return this.coordinator.recovererFor(op.command)?.abandonable
      ? ['recheck', 'abandon']
      : ['recheck'];
  }

  private find(rawId: string): PendingOperation {
    const id = rawId.toLowerCase();
    const op = isUuid(id) ? this.coordinator.findOperation(id) : undefined;
    if (!op) throw new NotFoundError('RECOVERY_NOT_FOUND', `No operation ${rawId}.`);
    return op;
  }
}

/** Changes whenever what the user reviewed changes: the reason, the files or the payload. */
function reviewToken(op: PendingOperation, assessed: RecoveryAssessment | null): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        op.operation_id,
        op.state,
        assessed?.reason ?? null,
        assessed?.paths ?? [],
        op.payload === null ? null : createHash('sha256').update(op.payload).digest('hex'),
      ]),
      'utf8',
    )
    .digest('hex');
}
