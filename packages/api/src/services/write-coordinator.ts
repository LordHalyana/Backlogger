import { createHash } from 'node:crypto';
import { isUuid } from '@backlogger/shared';
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
  paths?: readonly string[];
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

/** Tries to finish one pending operation found at startup. */
export type RecoveryHook = (operation: OperationRecord) => Promise<void>;

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
  private readonly recoveryHooks = new Map<string, RecoveryHook>();

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
      const first = plan.locate();
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

  /** Register how to finish pending operations of one command after a crash. */
  onRecover(command: string, hook: RecoveryHook): void {
    this.recoveryHooks.set(command, hook);
  }

  /**
   * Startup, with the gate held exclusively: load the pending operations
   * (their guard rows were installed by the intent transaction and stay in
   * force) and try to finish each one. Returns the ones still pending.
   */
  async recoverPending(): Promise<OperationRecord[]> {
    for (const op of this.operations.listPending()) {
      const hook = this.recoveryHooks.get(op.command);
      if (hook) await hook(op);
    }
    return this.operations.listPending();
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
    const targets = plan.guards?.(located) ?? {};
    const guard =
      this.operations.findGuard('project', held) ??
      this.operations.findGuard('task', targets.tasks ?? []) ??
      this.operations.findGuard('path', targets.paths ?? []);
    if (guard) throw recoveryRequired(guard.operation_id);

    return plan.run(located, this.scope(held, op));
  }

  private scope(held: readonly string[], op: OperationIdentity | undefined): CommandScope {
    let intended = false;
    const requireOp = (): OperationIdentity => {
      if (!op) throw new Error('This command has no operation identity.');
      return op;
    };
    return {
      projects: held,
      assertNothingPendingIn: (projectId) => {
        const guard = this.operations.findGuardInProject(projectId);
        if (guard) throw recoveryRequired(guard.operation_id);
      },
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
        this.transaction(() => {
          write?.();
          this.operations.markCompleted(id, outcome, this.now());
          this.operations.removePayload(id);
          this.operations.releaseGuards(id);
        });
        return outcome;
      },
    };
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
