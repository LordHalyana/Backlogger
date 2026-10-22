import { createHash } from 'node:crypto';
import {
  isUuid,
  type RecoveryKind,
  type RecoveryPath,
  type RecoveryReason,
} from '@backlogger/shared';
import { BadRequestError, ConflictError } from '../errors.js';
import {
  isDuplicateOperation,
  type GuardRow,
  type ManifestEntry,
  type OperationRecord,
  type OperationsRepo,
} from '../db/operations-repo.js';
import type { Db } from '../db/database.js';
import type { ProjectQueue } from './project-queue.js';
import type { WorkspaceGate } from './workspace-gate.js';
import { logger } from '../logger.js';

/**
 * The one commit seam for workspace writes (spec #58, "Write coordinator").
 * Every command runs the same operation order:
 *
 *  1. validate (caller)               7. preconditions / If-Match (plan.run)
 *  2. lockless receipt lookup         8. intent transaction (scope.intent)
 *  3. find the target projects        9. durable file writes (plan.run)
 *  4. shared gate, then the queues   10. verify on disk (plan.run)
 *  5. repeat receipt + project lookup 11. completion transaction (scope.complete / commit)
 *  6. guard check (RECOVERY_REQUIRED) 12. invalidate caches, release, respond
 *
 * Lock order is gate → project queues (ascending ID, all taken up front,
 * never re-entered) → guard rows → one synchronous SQLite transaction, which
 * better-sqlite3 refuses to hold across an `await`. There are no in-memory
 * task locks and no receipt mutex: the operation ID's primary key settles
 * retry races, followed by a re-lookup.
 */

/** Identity of a retry-safe command (its Idempotency-Key and fingerprint). */
export interface OperationIdentity {
  id: string;
  command: string;
  fingerprint: string;
}

/** Where a command's targets live now. */
export interface Located {
  projects: readonly string[];
}

export interface GuardTargets {
  tasks?: readonly string[];
  /** Paths written, moved or removed: any overlapping path guard refuses them. */
  paths?: readonly string[];
  /**
   * Folders created: refused by a guard on the folder or a folder above it,
   * never by guarded files inside it, since creating it writes none of them.
   */
  newFolders?: readonly string[];
}

export interface CommandPlan<L extends Located, T> {
  /** Present for retry-safe commands: enables receipt lookup and claim. */
  operation?: OperationIdentity;
  /** Step 3, repeated once the locks are held. May throw (e.g. 404). */
  locate: () => L;
  /** The error for a target that moved to a project this command does not hold. */
  moved?: (now: L) => Error;
  /** Tasks and paths this command touches; guards on the held projects are always checked. */
  guards?: (located: L) => GuardTargets;
  /**
   * A recovery action (recheck, abandon): reads and recovery stay allowed
   * while operations are pending, so no guard is checked.
   */
  recoveryAction?: boolean;
  /**
   * Steps 7–11, with the locks held and the guards checked. A receipt found
   * by the intent claim unwinds `run` with a thrown non-Error value; a
   * `catch` in here that rolls back must rethrow whatever it caught.
   */
  run: (located: L, scope: CommandScope) => Promise<T>;
}

export interface IntentRecord {
  guards: ReadonlyArray<Omit<GuardRow, 'operation_id'>>;
  /** Exact intended bytes, removed by the completion transaction. */
  payload?: string;
  manifest?: readonly ManifestEntry[];
}

export interface CommandScope {
  /** The projects whose queues this command holds, ascending. */
  readonly projects: readonly string[];
  /** Refuse with RECOVERY_REQUIRED while anything is pending in `projectId`. */
  assertNothingPendingIn(projectId: string): void;
  /**
   * Step 6 for targets only known once the command runs (a new document's
   * ID and path, say): refuse with RECOVERY_REQUIRED if a task or path
   * guard covers any of them. Call it before writing any file.
   */
  assertUnguarded(targets: GuardTargets): void;
  /**
   * Step 8: record the pending operation and install its guards, atomically.
   * A retry-safe command calls it before writing any file, so a duplicate
   * key is caught here, before a second write.
   */
  intent(record: IntentRecord): void;
  /** Step 11 for a plain command: one synchronous transaction of index writes. */
  commit<R>(write: () => R): R;
  /**
   * Step 11 for a retry-safe command, after `intent`: index writes, the
   * receipt, payload removal and guard release in one transaction. Returns
   * the acknowledgement.
   */
  complete<A>(outcome: A, write?: () => void): A;
  /**
   * Inside step 9, after `intent`: durably record how far a multi-phase
   * operation (a transfer) got, by replacing its payload in one transaction.
   */
  checkpoint(payload: string): void;
  /**
   * Steps 8 and 11 of a recovery abandon, in one transaction and without
   * file writes: claim this command's operation ID straight into a completed
   * receipt, mark `targetOperationId` abandoned (never replayed) and remove
   * its payload and guards. Returns the acknowledgement.
   */
  abandon<A>(targetOperationId: string, outcome: A, target?: AbandonedTarget): A;
}

/**
 * What an abandoned operation was about, kept on its row once its payload is
 * gone, so the Recovery page can still show its final state.
 */
export interface AbandonedTarget {
  kind: RecoveryKind;
  reason: RecoveryReason;
  project_id: string | null;
  task_id: string | null;
  comment_id: string | null;
}

export interface WriteCoordinatorDeps {
  db: Db;
  operations: OperationsRepo;
  gate: WorkspaceGate;
  queue: ProjectQueue;
  /** Step 12: drop derived caches for the projects a command held. */
  invalidate?: (projectIds: readonly string[]) => void;
  now?: () => string;
}

/** A pending operation with its recovery payload, if it kept one. */
export interface PendingOperation extends OperationRecord {
  payload: string | null;
}

/** Where a pending operation stands on disk now. */
export interface RecoveryAssessment {
  kind: RecoveryKind;
  reason: RecoveryReason;
  message: string;
  project_id: string | null;
  task_id: string | null;
  comment_id: string | null;
  /** Where a filing is taking the task; absent for other operations. */
  target_project_id?: string | null;
  paths: RecoveryPath[];
  pending_content: string | null;
  current_content: string | null;
}

/** The completion transaction of a resumed operation (see `CommandScope.complete`). */
export type CompleteRecovered = (outcome: unknown, write?: () => void) => void;

/** The checkpoint transaction of a resumed operation (see `CommandScope.checkpoint`). */
export type CheckpointRecovered = (payload: string) => void;

/** How one command's pending operations are inspected and finished after a crash. */
export interface Recoverer {
  /** Whether the user may abandon this command's pending operations. */
  readonly abandonable: boolean;
  /** Reads only: where the operation stands on disk now. */
  assess(operation: PendingOperation): Promise<RecoveryAssessment>;
  /**
   * With the operation's locks held: finish it from a known state, calling
   * `complete` once the files are in the known after state, and leave
   * anything else pending, files and payload untouched. A multi-phase
   * operation records each phase it passes with `checkpoint`.
   */
  resume(
    operation: PendingOperation,
    complete: CompleteRecovered,
    checkpoint: CheckpointRecovered,
  ): Promise<void>;
}

/** Step 1: an Idempotency-Key must be a client-generated UUID. Returns it normalized. */
export function parseOperationId(raw: unknown): string {
  if (typeof raw !== 'string' || !isUuid(raw.trim())) {
    throw new BadRequestError('INVALID_COMMAND', 'Idempotency-Key must be a UUID.');
  }
  return raw.trim().toLowerCase();
}

/**
 * SHA-256 over the UTF-8 JSON of `[version, command, ...fields]`. Callers pass
 * normalized UUIDs and bodies exactly as submitted; server timestamps and the
 * current project are never fields.
 */
export function operationFingerprint(command: string, fields: readonly unknown[]): string {
  return createHash('sha256')
    .update(JSON.stringify([1, command, ...fields]), 'utf8')
    .digest('hex');
}

export function recoveryRequired(operationId: string): ConflictError {
  return new ConflictError(
    'RECOVERY_REQUIRED',
    `Blocked by pending operation ${operationId}; review it before retrying.`,
    { operationId, inspect: `/api/recovery/${operationId}` },
  );
}

function throwIfGuarded(guard: GuardRow | undefined): void {
  if (guard) throw recoveryRequired(guard.operation_id);
}

/** Thrown inside a command when a re-lookup finds the original acknowledgement. */
class ReceiptFound {
  constructor(readonly outcome: unknown) {}
}

export class WriteCoordinator {
  private readonly db: Db;
  private readonly operations: OperationsRepo;
  private readonly gate: WorkspaceGate;
  private readonly queue: ProjectQueue;
  private readonly invalidate: (projectIds: readonly string[]) => void;
  private readonly now: () => string;
  /** Operation IDs being worked on in this process: status, not a lock. */
  private readonly running = new Map<string, number>();
  private readonly recoverers = new Map<string, Recoverer>();

  constructor(deps: WriteCoordinatorDeps) {
    this.db = deps.db;
    this.operations = deps.operations;
    this.gate = deps.gate;
    this.queue = deps.queue;
    this.invalidate = deps.invalidate ?? (() => undefined);
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  /** Run a command under the shared gate and its projects' queues. */
  async command<L extends Located, T>(plan: CommandPlan<L, T>): Promise<T> {
    const op = plan.operation;
    if (op) {
      const receipt = this.lookupReceipt(op, false);
      if (receipt) return receipt.outcome as T;
      this.running.set(op.id, (this.running.get(op.id) ?? 0) + 1);
    }
    try {
      const first = this.locateUnlocked(plan);
      const held = [...new Set(first.projects)].sort();
      return await this.gate.withShared(() =>
        this.inQueues(held, async () => {
          try {
            return await this.runHeld(plan, held);
          } finally {
            this.invalidate(held);
          }
        }),
      );
    } catch (err) {
      if (err instanceof ReceiptFound) return err.outcome as T;
      throw err;
    } finally {
      if (op) {
        const left = (this.running.get(op.id) ?? 1) - 1;
        if (left > 0) this.running.set(op.id, left);
        else this.running.delete(op.id);
      }
    }
  }

  /**
   * Run `operation` with the gate held exclusively: no command, Reload or
   * settings change runs alongside it. For full Reindex and the startup pass;
   * `operation` must not call `command`.
   */
  exclusive<T>(operation: () => Promise<T>): Promise<T> {
    return this.gate.withExclusive(operation);
  }

  /**
   * One synchronous SQLite transaction, for index writes made while the
   * caller already holds the right locks (a command scope's `commit`, or the
   * exclusive startup and reindex passes). A function returning a promise is
   * refused, so the transaction is never held across an `await`.
   */
  transaction<R>(write: () => R): R {
    return this.db.transaction(write)();
  }

  /** Register how to inspect and finish pending operations of one command. */
  onRecover(command: string, recoverer: Recoverer): void {
    this.recoverers.set(command, recoverer);
  }

  /** How `command` is recovered; `undefined` when this version cannot. */
  recovererFor(command: string): Recoverer | undefined {
    return this.recoverers.get(command);
  }

  /** Whether a request for this operation ID is running in this process. */
  isRunning(operationId: string): boolean {
    return this.running.has(operationId);
  }

  /**
   * The Recovery page's operations, oldest first: the pending ones with their
   * payloads, then abandoned ones not yet dismissed (which have none).
   */
  reviewableOperations(): PendingOperation[] {
    return this.operations
      .listReviewable()
      .map((op) => ({ ...op, payload: this.operations.getPayload(op.operation_id) }));
  }

  /** Take an abandoned operation's final state off the Recovery page. */
  dismiss(operationId: string): void {
    this.operations.markDismissed(operationId, this.now());
  }

  /** Every pending operation with its payload, oldest first. */
  pendingOperations(): PendingOperation[] {
    return this.operations
      .listPending()
      .map((op) => ({ ...op, payload: this.operations.getPayload(op.operation_id) }));
  }

  /** The paths and expected fingerprints a transfer or deletion recorded. */
  manifestOf(operationId: string): ManifestEntry[] {
    return this.operations.getManifest(operationId);
  }

  /** Whether a pending project deletion hides `projectId`. */
  isProjectPendingDeletion(projectId: string): boolean {
    return this.operations.isProjectPendingDeletion(projectId);
  }

  /** The projects whose queues a recovery action on `operationId` holds. */
  guardedProjects(operationId: string): string[] {
    return this.operations.guardedProjects(operationId);
  }

  /** An operation with its payload, or `undefined` when the ID is unused. */
  findOperation(operationId: string): PendingOperation | undefined {
    const op = this.operations.find(operationId);
    return op && { ...op, payload: this.operations.getPayload(operationId) };
  }

  /**
   * Startup, with the gate held exclusively: load the pending operations
   * (their guard rows were installed by the intent transaction and stay in
   * force) and try to finish each one. Returns the ones still pending.
   */
  async recoverPending(): Promise<OperationRecord[]> {
    for (const op of this.operations.listPending()) {
      try {
        await this.resume(op.operation_id);
      } catch (err) {
        logger.warn(`recovery of ${op.operation_id} failed: ${(err as Error).message}`);
      }
    }
    return this.operations.listPending();
  }

  /**
   * Resume one pending operation; the caller holds its locks (the exclusive
   * gate at startup, or a recovery action's command). Never starts a new
   * operation: anything not pending, or without a recoverer, is left as is.
   */
  async resume(operationId: string): Promise<void> {
    const op = this.findOperation(operationId);
    const recoverer = op && this.recoverers.get(op.command);
    if (!op || op.state !== 'pending' || !recoverer) return;
    await recoverer.resume(
      op,
      (outcome, write) => this.settle(operationId, outcome, write),
      (payload) => this.checkpoint(operationId, payload),
    );
  }

  /**
   * Step 3, before any lock. An identical request may complete between the
   * receipt lookup and here (a delete removes its own target), so a failed
   * lookup answers from that receipt when there is one.
   */
  private locateUnlocked<L extends Located, T>(plan: CommandPlan<L, T>): L {
    try {
      return plan.locate();
    } catch (err) {
      const receipt = plan.operation && this.lookupReceipt(plan.operation, true);
      if (receipt) throw new ReceiptFound(receipt.outcome);
      throw err;
    }
  }

  private async runHeld<L extends Located, T>(
    plan: CommandPlan<L, T>,
    held: readonly string[],
  ): Promise<T> {
    // Step 5: what changed while the command waited for its locks.
    const op = plan.operation;
    if (op) {
      const receipt = this.lookupReceipt(op, true);
      if (receipt) throw new ReceiptFound(receipt.outcome);
    }
    const located = plan.locate();
    if (!located.projects.every((p) => held.includes(p))) {
      throw (
        plan.moved?.(located) ??
        new ConflictError('REVISION_CONFLICT', 'The target moved while the command waited.', {
          currentProjectIds: located.projects,
        })
      );
    }

    // Step 6: durable guards.
    if (!plan.recoveryAction) {
      throwIfGuarded(
        this.operations.findGuard('project', held) ??
          this.findTargetGuard(plan.guards?.(located) ?? {}),
      );
    }

    return plan.run(located, this.scope(held, op));
  }

  /** A task guard on any of the tasks, or a path guard overlapping any of the paths. */
  private findTargetGuard(targets: GuardTargets): GuardRow | undefined {
    return (
      this.operations.findGuard('task', targets.tasks ?? []) ??
      this.operations.findPathGuard(targets.paths ?? []) ??
      this.operations.findPathGuard(targets.newFolders ?? [], { contents: false })
    );
  }

  private scope(held: readonly string[], op: OperationIdentity | undefined): CommandScope {
    let intended = false;
    const requireOp = (): OperationIdentity => {
      if (!op) throw new Error('This command has no operation identity.');
      return op;
    };
    return {
      projects: held,
      assertNothingPendingIn: (projectId) =>
        throwIfGuarded(this.operations.findGuardInProject(projectId)),
      assertUnguarded: (targets) => throwIfGuarded(this.findTargetGuard(targets)),
      intent: (record) => {
        const claimed = requireOp();
        const { id, command, fingerprint } = claimed;
        this.claim(claimed, () => {
          this.operations.insert({
            operation_id: id,
            command,
            fingerprint,
            state: 'pending',
            outcome: null,
            created_at: this.now(),
          });
          if (record.payload !== undefined) this.operations.setPayload(id, record.payload);
          if (record.manifest) this.operations.addManifest(id, record.manifest);
          this.operations.addGuards(id, record.guards);
        });
        intended = true;
      },
      commit: (write) => this.transaction(write),
      complete: (outcome, write) => {
        const { id } = requireOp();
        if (!intended) throw new Error('complete() needs a recorded intent.');
        this.settle(id, outcome, write);
        return outcome;
      },
      checkpoint: (payload) => {
        const { id } = requireOp();
        if (!intended) throw new Error('checkpoint() needs a recorded intent.');
        this.checkpoint(id, payload);
      },
      abandon: (targetOperationId, outcome, target) => {
        const claimed = requireOp();
        if (intended) throw new Error('abandon() is for commands without an intent.');
        const now = this.now();
        this.claim(claimed, () => {
          this.operations.insert({
            operation_id: claimed.id,
            command: claimed.command,
            fingerprint: claimed.fingerprint,
            state: 'completed',
            outcome,
            created_at: now,
            completed_at: now,
          });
          this.operations.markAbandoned(
            targetOperationId,
            { abandoned_by: claimed.id, ...target },
            now,
          );
          this.operations.removePayload(targetOperationId);
          this.operations.removeManifest(targetOperationId);
          this.operations.releaseGuards(targetOperationId);
        });
        return outcome;
      },
    };
  }

  /**
   * Step 11: index writes, the receipt, and removal of the payload, manifest
   * and guards, atomically.
   */
  private settle(operationId: string, outcome: unknown, write?: () => void): void {
    this.transaction(() => {
      write?.();
      this.operations.markCompleted(operationId, outcome, this.now());
      this.operations.removePayload(operationId);
      this.operations.removeManifest(operationId);
      this.operations.releaseGuards(operationId);
    });
  }

  /** A checkpoint transaction: the pending operation's payload, replaced. */
  private checkpoint(operationId: string, payload: string): void {
    this.transaction(() => {
      if (this.operations.find(operationId)?.state !== 'pending') {
        throw new Error(`Operation ${operationId} is not pending.`);
      }
      this.operations.replacePayload(operationId, payload);
    });
  }

  /**
   * Insert an operation row inside one transaction. A duplicate ID means a
   * concurrent request with the same key got there first: look its receipt
   * up again and answer from it instead of writing a second time.
   */
  private claim(op: OperationIdentity, insert: () => void): void {
    try {
      this.db.transaction(insert)();
    } catch (err) {
      if (!isDuplicateOperation(err)) throw err;
      const receipt = this.lookupReceipt(op, true);
      throw receipt ? new ReceiptFound(receipt.outcome) : err;
    }
  }

  /**
   * Steps 2 and 5: the recorded fate of an operation ID, checked before any
   * revision or lifecycle. `undefined` when the ID is unused. `self` says
   * whether the calling request is itself counted as running.
   */
  private lookupReceipt(op: OperationIdentity, self: boolean): { outcome: unknown } | undefined {
    const record = this.operations.find(op.id);
    if (!record) return undefined;
    if (record.fingerprint !== op.fingerprint || record.command !== op.command) {
      throw new ConflictError(
        'OPERATION_ID_CONFLICT',
        `Operation ${op.id} was already used for a different request.`,
        { operationId: op.id },
      );
    }
    if (record.state === 'completed') return { outcome: record.outcome };
    if (record.state === 'abandoned') {
      throw new ConflictError('OPERATION_ABANDONED', `Operation ${op.id} was abandoned.`, {
        operationId: op.id,
      });
    }
    if ((this.running.get(op.id) ?? 0) > (self ? 1 : 0)) {
      throw new ConflictError(
        'OPERATION_IN_PROGRESS',
        `Operation ${op.id} is still running; retry the identical request shortly.`,
        { operationId: op.id },
      );
    }
    throw recoveryRequired(op.id);
  }

  private inQueues<T>(projects: readonly string[], operation: () => Promise<T>): Promise<T> {
    const [first, ...rest] = projects;
    if (first === undefined) return operation();
    return this.queue.run(first, () => this.inQueues(rest, operation));
  }
}
