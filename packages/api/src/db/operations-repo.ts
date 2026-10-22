import type { Db } from './database.js';

/**
 * The protected operational tables (migration 0011): operation rows (pending
 * operations and completed receipts), recovery payloads, manifests and guard
 * rows. Only the write coordinator writes them. Reload and Reindex never
 * touch them.
 */

export type OperationState = 'pending' | 'completed' | 'abandoned';
export type GuardScope = 'project' | 'task' | 'path';

export interface OperationRecord {
  operation_id: string;
  command: string;
  fingerprint: string;
  state: OperationState;
  /** Acknowledgement metadata; `null` until the operation completes. */
  outcome: unknown;
  created_at: string;
  completed_at: string | null;
  /** When the user dismissed an abandoned operation's final state; `null` until then. */
  dismissed_at?: string | null;
}

export interface GuardRow {
  operation_id: string;
  project_id: string;
  scope: GuardScope;
  key: string;
}

export interface ManifestEntry {
  path: string;
  role: string;
  fingerprint: string | null;
}

/** Commands whose pending operations hide what they delete (see `PermanentDeletion`). */
export const DELETE_DOCUMENT_COMMAND = 'document.delete';
export const DELETE_PROJECT_COMMAND = 'project.delete';

/**
 * SQL that is true while a pending permanent deletion covers the document
 * `doc` (an alias of `documents`): its task guard, or its project's guard.
 * Pending deletion wins over indexing: whatever Reload or Reindex put back
 * in the index stays hidden from boards, lists and search until the deletion
 * completes and its completion transaction removes the rows.
 */
export function pendingDeletionCovers(doc: string): string {
  return `EXISTS (
    SELECT 1 FROM operation_guards g JOIN operations o ON o.operation_id = g.operation_id
    WHERE o.state = 'pending'
      AND ((o.command = '${DELETE_DOCUMENT_COMMAND}' AND g.scope = 'task' AND g.key = ${doc}.id)
        OR (o.command = '${DELETE_PROJECT_COMMAND}' AND g.scope = 'project' AND g.key = ${doc}.project_id)))`;
}

interface OperationRow extends Omit<OperationRecord, 'outcome'> {
  outcome: string | null;
}

function rowToOperation(row: OperationRow): OperationRecord {
  return { ...row, outcome: row.outcome === null ? null : (JSON.parse(row.outcome) as unknown) };
}

/** True when `err` is SQLite refusing a duplicate operation ID. */
export function isDuplicateOperation(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || code === 'SQLITE_CONSTRAINT_UNIQUE';
}

export class OperationsRepo {
  constructor(private readonly db: Db) {}

  find(operationId: string): OperationRecord | undefined {
    const row = this.db
      .prepare<[string], OperationRow>(`SELECT * FROM operations WHERE operation_id = ?`)
      .get(operationId);
    return row ? rowToOperation(row) : undefined;
  }

  listPending(): OperationRecord[] {
    return this.db
      .prepare<
        [],
        OperationRow
      >(`SELECT * FROM operations WHERE state = 'pending' ORDER BY created_at, operation_id`)
      .all()
      .map(rowToOperation);
  }

  /**
   * What the Recovery page lists, oldest first: every pending operation, and
   * every abandoned one whose final state the user has not dismissed yet.
   */
  listReviewable(): OperationRecord[] {
    return this.db
      .prepare<[], OperationRow>(
        `SELECT * FROM operations
         WHERE state = 'pending' OR (state = 'abandoned' AND dismissed_at IS NULL)
         ORDER BY created_at, operation_id`,
      )
      .all()
      .map(rowToOperation);
  }

  /** Take an abandoned operation off the Recovery page; a second dismissal keeps the first time. */
  markDismissed(operationId: string, dismissedAt: string): void {
    this.db
      .prepare(
        `UPDATE operations SET dismissed_at = ?
         WHERE operation_id = ? AND state = 'abandoned' AND dismissed_at IS NULL`,
      )
      .run(dismissedAt, operationId);
  }

  /** Throws a SQLite constraint error when the ID is already taken. */
  insert(op: Omit<OperationRecord, 'completed_at'> & { completed_at?: string | null }): void {
    this.db
      .prepare(
        `INSERT INTO operations (operation_id, command, fingerprint, state, outcome, created_at, completed_at)
         VALUES (@operation_id, @command, @fingerprint, @state, @outcome, @created_at, @completed_at)`,
      )
      .run({
        ...op,
        outcome: op.outcome === null ? null : JSON.stringify(op.outcome),
        completed_at: op.completed_at ?? null,
      });
  }

  markCompleted(operationId: string, outcome: unknown, completedAt: string): void {
    this.db
      .prepare(
        `UPDATE operations SET state = 'completed', outcome = ?, completed_at = ?
         WHERE operation_id = ? AND state = 'pending'`,
      )
      .run(JSON.stringify(outcome), completedAt, operationId);
  }

  /** Record that the user gave up a pending operation; it is never replayed. */
  markAbandoned(operationId: string, outcome: unknown, abandonedAt: string): void {
    this.db
      .prepare(
        `UPDATE operations SET state = 'abandoned', outcome = ?, completed_at = ?
         WHERE operation_id = ? AND state = 'pending'`,
      )
      .run(JSON.stringify(outcome), abandonedAt, operationId);
  }

  getPayload(operationId: string): string | null {
    const row = this.db
      .prepare<
        [string],
        { payload: string }
      >(`SELECT payload FROM operation_payloads WHERE operation_id = ?`)
      .get(operationId);
    return row?.payload ?? null;
  }

  setPayload(operationId: string, payload: string): void {
    this.db
      .prepare(`INSERT INTO operation_payloads (operation_id, payload) VALUES (?, ?)`)
      .run(operationId, payload);
  }

  /** A checkpoint: the pending operation's payload, replaced in place. */
  replacePayload(operationId: string, payload: string): void {
    this.db
      .prepare(`UPDATE operation_payloads SET payload = ? WHERE operation_id = ?`)
      .run(payload, operationId);
  }

  removePayload(operationId: string): void {
    this.db.prepare(`DELETE FROM operation_payloads WHERE operation_id = ?`).run(operationId);
  }

  addManifest(operationId: string, entries: readonly ManifestEntry[]): void {
    const insert = this.db.prepare(
      `INSERT INTO operation_manifest_entries (operation_id, path, role, fingerprint)
       VALUES (?, ?, ?, ?)`,
    );
    for (const e of entries) insert.run(operationId, e.path, e.role, e.fingerprint);
  }

  getManifest(operationId: string): ManifestEntry[] {
    return this.db
      .prepare<[string], ManifestEntry>(
        `SELECT path, role, fingerprint FROM operation_manifest_entries
         WHERE operation_id = ? ORDER BY role, path`,
      )
      .all(operationId);
  }

  removeManifest(operationId: string): void {
    this.db
      .prepare(`DELETE FROM operation_manifest_entries WHERE operation_id = ?`)
      .run(operationId);
  }

  addGuards(operationId: string, guards: ReadonlyArray<Omit<GuardRow, 'operation_id'>>): void {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO operation_guards (operation_id, project_id, scope, key)
       VALUES (?, ?, ?, ?)`,
    );
    for (const g of guards) insert.run(operationId, g.project_id, g.scope, g.key);
  }

  releaseGuards(operationId: string): void {
    this.db.prepare(`DELETE FROM operation_guards WHERE operation_id = ?`).run(operationId);
  }

  /** The projects an operation's guards live in, ascending. */
  guardedProjects(operationId: string): string[] {
    return this.db
      .prepare<[string], { project_id: string }>(
        `SELECT DISTINCT project_id FROM operation_guards WHERE operation_id = ?
         ORDER BY project_id`,
      )
      .all(operationId)
      .map((row) => row.project_id);
  }

  /**
   * The first guard of `scope` on any of `keys`, or undefined. Keys match
   * exactly; path guards go through `findPathGuard`.
   */
  findGuard(scope: Exclude<GuardScope, 'path'>, keys: readonly string[]): GuardRow | undefined {
    if (keys.length === 0) return undefined;
    const marks = keys.map(() => '?').join(', ');
    return this.db
      .prepare<string[], GuardRow>(
        `SELECT * FROM operation_guards WHERE scope = ? AND key IN (${marks})
         ORDER BY operation_id LIMIT 1`,
      )
      .get(scope, ...keys);
  }

  /**
   * The first path guard overlapping any of `paths`: the same path, a path
   * under it (a guarded folder) or, unless `contents` is false, a path it
   * lies under (a folder holding a guarded file). Paths are project-relative
   * with the project ID first.
   */
  findPathGuard(
    paths: readonly string[],
    { contents = true }: { contents?: boolean } = {},
  ): GuardRow | undefined {
    const overlaps = this.db.prepare<[{ p: string }], GuardRow>(
      `SELECT * FROM operation_guards WHERE scope = 'path' AND (
         key = @p
         OR substr(@p, 1, length(key) + 1) = key || '/'
         ${contents ? `OR substr(key, 1, length(@p) + 1) = @p || '/'` : ''}
       ) ORDER BY operation_id LIMIT 1`,
    );
    for (const p of paths) {
      const guard = overlaps.get({ p });
      if (guard) return guard;
    }
    return undefined;
  }

  /** Whether a pending project deletion covers `projectId`. */
  isProjectPendingDeletion(projectId: string): boolean {
    return (
      this.db
        .prepare<[string], { n: number }>(
          `SELECT COUNT(*) AS n FROM operation_guards g
           JOIN operations o ON o.operation_id = g.operation_id
           WHERE o.state = 'pending' AND o.command = '${DELETE_PROJECT_COMMAND}'
             AND g.scope = 'project' AND g.key = ?`,
        )
        .get(projectId)!.n > 0
    );
  }

  /** The first guard of any scope living in `projectId`, or undefined. */
  findGuardInProject(projectId: string): GuardRow | undefined {
    return this.db
      .prepare<
        [string],
        GuardRow
      >(`SELECT * FROM operation_guards WHERE project_id = ? ORDER BY operation_id LIMIT 1`)
      .get(projectId);
  }
}
