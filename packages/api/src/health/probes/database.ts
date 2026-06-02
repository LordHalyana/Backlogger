import type { SubsystemState } from '@backlogger/shared';
import type Database from 'better-sqlite3';
import type { Db } from '../../db/database.js';

/**
 * Database probe — runs a trivial `SELECT 1` to verify the SQLite connection
 * is open and answering. Any throw → `error`.
 */
export function createDatabaseProbe(db: Db): () => SubsystemState {
  // Cache the prepared statement so probing doesn't leak parsed statements.
  let stmt: Database.Statement<[], { ok: number }> | null = null;
  return (): SubsystemState => {
    try {
      if (!stmt) stmt = db.prepare<[], { ok: number }>('SELECT 1 AS ok');
      const row = stmt.get();
      return row?.ok === 1 ? 'ok' : 'error';
    } catch {
      return 'error';
    }
  };
}
