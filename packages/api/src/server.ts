import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
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
import { watchProjectFiles } from './fs/project-watcher.js';
import { logger } from './logger.js';
import { prepareDataDir } from './startup.js';

// Load .env from the repository root (this file is packages/api/src/server.ts → 4 ups).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
dotenv.config({ path: path.join(repoRoot, '.env') });

const host = process.env.BACKLOGGER_HOST ?? '0.0.0.0';
const port = Number(process.env.BACKLOGGER_PORT ?? 3333);
const dataDir = path.resolve(process.env.BACKLOGGER_DATA_DIR ?? './data');
const dbFile = path.join(dataDir, 'backlogger.sqlite');

// File watching auto-reindexes on external changes. Disable with
// BACKLOGGER_WATCH=0 on hosts with a low inotify limit or very large trees
// (the watcher also self-disables on ENOSPC). Manual Reload still re-syncs.
const watchFiles = process.env.BACKLOGGER_WATCH !== '0';

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
logger.info(`templates loaded=${loaded.length} skipped=${skipped.length}`);
const ctx = buildContext({ db, dataDir, templates, builtinTemplatesDir: builtinDir, userTemplatesDir: userDir });
await ctx.fs.ensureRoot();

await prepareDataDir(ctx);

// Only after the startup pass released the exclusive gate. Watcher-triggered
// reloads run as coordinated commands (ReindexService.runProject).
const stopWatcher = watchUserTemplates({ builtinDir, userDir, registry: templates });
let stopProjectWatcher: () => void = () => {};
if (watchFiles) {
  stopProjectWatcher = watchProjectFiles({
    projectsRoot: ctx.resolver.projectsRoot,
    reindexService: ctx.reindexService,
  });
} else {
  logger.info('project file watcher disabled (BACKLOGGER_WATCH=0)');
}

const app = createApp(ctx, { allowedOrigins });

// In production (Docker), the API server also serves the Vite-built web
// frontend. The web dist sits at <repo-root>/packages/web/dist/.
// In dev the Vite dev server handles the frontend separately.
if (process.env.NODE_ENV === 'production') {
  const webDistDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..', '..', '..', 'packages', 'web', 'dist',
  );
  app.use(express.static(webDistDir));
  // SPA fallback: client-side routes not matched by static files get index.html
  app.use((_req, res) => {
    res.sendFile(path.join(webDistDir, 'index.html'));
  });
}

app.listen(port, host, () => {
  logger.info(`api listening on http://${host}:${port}`);
  logger.info(`data dir: ${dataDir}`);
  logger.info(
    `cors: ${allowedOrigins === '*' ? 'reflect-any' : allowedOrigins.join(', ') || 'disabled'}`,
  );
});

const shutdown = (): void => {
  logger.info('shutting down');
  stopWatcher();
  stopProjectWatcher();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function parseOrigins(raw: string): string[] | '*' {
  const trimmed = raw.trim();
  if (trimmed === '*' || trimmed === '') return trimmed === '' ? [] : '*';
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
