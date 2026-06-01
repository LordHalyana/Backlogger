import type { SubsystemState } from '@backlogger/shared';
import type { Db } from '../../db/database.js';

/**
 * FTS probe — verifies the `documents_fts` virtual table is queryable.
 * A count of `0` is healthy (a fresh install has no docs yet).
 */
export function createFtsProbe(db: Db): () => SubsystemState {
  let stmt: ReturnType<Db['prepare']> | null = null;
  return (): SubsystemState => {
    try {
      if (!stmt) stmt = db.prepare('SELECT count(*) AS c FROM documents_fts');
      stmt.get();
      return 'ok';
    } catch {
      return 'error';
    }
  };
}
