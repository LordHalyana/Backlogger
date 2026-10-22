import type { SubsystemState } from '@backlogger/shared';
import type Database from 'better-sqlite3';
import type { Db } from '../../db/database.js';

/**
 * FTS probe — verifies the `search_fts` virtual table is queryable.
 * A count of `0` is healthy (a fresh install has no docs yet).
 */
export function createFtsProbe(db: Db): () => SubsystemState {
  let stmt: Database.Statement<[], { c: number }> | null = null;
  return (): SubsystemState => {
    try {
      if (!stmt) stmt = db.prepare<[], { c: number }>('SELECT count(*) AS c FROM search_fts');
      stmt.get();
      return 'ok';
    } catch {
      return 'error';
    }
  };
}
