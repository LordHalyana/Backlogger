#!/usr/bin/env -S npx tsx
/** Apply pending SQL migrations against the configured database file. */
import * as path from 'node:path';
import { openDatabase } from '../packages/api/src/db/database.ts';

const dataDir = path.resolve(process.env.BACKLOGGER_DATA_DIR ?? './data');
const dbFile = path.join(dataDir, 'backlogger.sqlite');

const db = openDatabase({ file: dbFile });
const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number };
// eslint-disable-next-line no-console
console.log(`[backlogger] migrations applied. current schema version: ${row.v}`);
db.close();
