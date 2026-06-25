#!/usr/bin/env -S node --experimental-strip-types
/**
 * Full reindex CLI.
 *
 * Rebuilds the SQLite `documents`, links, tags, and FTS indexes from the
 * Markdown files under `<BACKLOGGER_DATA_DIR>/projects/`. This is the CLI
 * equivalent of `POST /api/admin/reindex`; run it with the server stopped
 * (e.g. after restoring a backup or large external file changes).
 */
import * as path from 'node:path';
import { openDatabase } from '../packages/api/src/db/database.ts';
import { buildContext } from '../packages/api/src/context.ts';

const dataDir = path.resolve(process.env.BACKLOGGER_DATA_DIR ?? './data');
const dbFile = path.join(dataDir, 'backlogger.sqlite');

async function main(): Promise<void> {
  const db = openDatabase({ file: dbFile });
  try {
    const ctx = buildContext({ db, dataDir });
    await ctx.fs.ensureRoot();
    const report = await ctx.reindexService.run();
    // eslint-disable-next-line no-console
    console.log(
      `[backlogger] reindex complete: scanned ${report.scanned}, ` +
        `inserted ${report.inserted}, skipped ${report.skipped.length}`,
    );
    for (const s of report.skipped) {
      // eslint-disable-next-line no-console
      console.log(`  skipped ${s.path}: ${s.reason}`);
    }
  } finally {
    db.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
