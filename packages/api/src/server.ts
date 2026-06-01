import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createApp } from './app.js';
import { buildContext } from './context.js';
import { openDatabase } from './db/database.js';
import {
  defaultTemplatesDir,
  loadAllTemplates,
  TemplateRegistry,
  userTemplatesDir,
} from './templates/registry.js';
import { ensureUserTemplatesDir, watchUserTemplates } from './templates/watcher.js';

// Load .env from the repository root (this file is packages/api/src/server.ts → 4 ups).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
dotenv.config({ path: path.join(repoRoot, '.env') });

const host = process.env.BACKLOGGER_HOST ?? '0.0.0.0';
const port = Number(process.env.BACKLOGGER_PORT ?? 3333);
const dataDir = path.resolve(process.env.BACKLOGGER_DATA_DIR ?? './data');
const dbFile = path.join(dataDir, 'backlogger.sqlite');

// Comma-separated. `*` reflects any origin (LAN-friendly for self-hosting).
// Default `*` keeps the "access from another device on the local network"
// use case working out of the box; lock it down by setting the env var.
const allowedOrigins = parseOrigins(process.env.BACKLOGGER_ALLOWED_ORIGINS ?? '*');

const db = openDatabase({ file: dbFile });
const templates = new TemplateRegistry();
const builtinDir = process.env.BACKLOGGER_TEMPLATES_DIR ?? defaultTemplatesDir();
const userDir = userTemplatesDir(dataDir);
await ensureUserTemplatesDir(userDir);
const { loaded, skipped } = await loadAllTemplates(builtinDir, userDir);
templates.setAll(loaded);
// eslint-disable-next-line no-console
console.log(
  `[backlogger] templates loaded=${loaded.length} skipped=${skipped.length}`,
);
const ctx = buildContext({ db, dataDir, templates, builtinTemplatesDir: builtinDir, userTemplatesDir: userDir });
await ctx.fs.ensureRoot();

const stopWatcher = watchUserTemplates({ builtinDir, userDir, registry: templates });

// Auto-reindex on startup if the documents table is empty but the FS has
// content (e.g. fresh DB after a restore or a manual file drop).
if (ctx.documentsRepo.count() === 0 && (await hasAnyMarkdown(ctx.resolver.projectsRoot))) {
  const report = await ctx.reindexService.run();
  // eslint-disable-next-line no-console
  console.log(
    `[backlogger] startup reindex: scanned=${report.scanned} inserted=${report.inserted} skipped=${report.skipped.length}`,
  );
}

const app = createApp(ctx, { allowedOrigins });

app.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`[backlogger] api listening on http://${host}:${port}`);
  // eslint-disable-next-line no-console
  console.log(`[backlogger] data dir: ${dataDir}`);
  // eslint-disable-next-line no-console
  console.log(
    `[backlogger] cors: ${allowedOrigins === '*' ? 'reflect-any' : allowedOrigins.join(', ') || 'disabled'}`,
  );
});

const shutdown = (): void => {
  // eslint-disable-next-line no-console
  console.log('[backlogger] shutting down');
  stopWatcher();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function hasAnyMarkdown(dir: string): Promise<boolean> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (await hasAnyMarkdown(path.join(dir, e.name))) return true;
    } else if (e.isFile() && e.name.endsWith('.md')) {
      return true;
    }
  }
  return false;
}

function parseOrigins(raw: string): string[] | '*' {
  const trimmed = raw.trim();
  if (trimmed === '*' || trimmed === '') return trimmed === '' ? [] : '*';
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
