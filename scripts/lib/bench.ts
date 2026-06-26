import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, type Db } from '../../packages/api/src/db/database.ts';

/** p-th percentile of a pre-sorted ascending array. */
export function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

/**
 * Create a throwaway temp data dir + migrated SQLite db for a bench run.
 * The caller is responsible for `db.close()` and removing `tmp`.
 */
export async function createBenchContext(
  prefix: string,
): Promise<{ db: Db; tmp: string; dataDir: string }> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const dataDir = path.join(tmp, 'data');
  await fs.mkdir(dataDir, { recursive: true });
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.resolve(here, '..', '..', 'migrations');
  const db = openDatabase({ file: path.join(tmp, 'bench.sqlite'), migrationsDir });
  return { db, tmp, dataDir };
}
