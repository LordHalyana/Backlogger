import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export type Db = Database.Database;

export interface OpenDbOptions {
  /** Absolute or relative path to the SQLite file, or `:memory:` for tests. */
  file: string;
  /** Absolute path to the directory containing numbered `*.sql` migrations. */
  migrationsDir?: string;
}

/**
 * Open a SQLite database, apply any pending migrations, and return the handle.
 *
 * Migrations are plain `.sql` files named `NNNN_*.sql` (e.g. `0001_init.sql`).
 * The `schema_version` table tracks the highest applied version.
 */
export function openDatabase(opts: OpenDbOptions): Db {
  const file = opts.file;
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  // Coordinated writes must survive power loss once committed: WAL with FULL
  // syncs the log on every commit (NORMAL would only sync at checkpoints).
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');

  const migrationsDir = opts.migrationsDir ?? defaultMigrationsDir();
  applyMigrations(db, migrationsDir);
  return db;
}

function defaultMigrationsDir(): string {
  // From compiled output (dist/db/database.js) or source (src/db/database.ts),
  // walk up to the package root, then to <repo>/migrations.
  const here = path.dirname(fileURLToPath(import.meta.url));
  // packages/api/(src|dist)/db -> packages/api -> packages -> repo root
  return path.resolve(here, '..', '..', '..', '..', 'migrations');
}

export function applyMigrations(db: Db, migrationsDir: string): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);`);

  const currentRow = db
    .prepare(`SELECT COALESCE(MAX(version), 0) AS v FROM schema_version`)
    .get() as { v: number };
  const current = currentRow.v;

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();

  for (const file of files) {
    const version = Number(file.slice(0, 4));
    if (version <= current) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const apply = db.transaction(() => {
      db.exec(sql);
      db.prepare(`INSERT INTO schema_version (version) VALUES (?)`).run(version);
    });
    apply();
  }
}
