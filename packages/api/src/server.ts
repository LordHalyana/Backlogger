import * as fs from 'node:fs/promises';
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
import { formatSkippedFiles } from './services/reindex-report.js';

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

// Auto-discover project folders (or symlinks) that exist on disk but have
// no DB row yet. This handles Docker volume mounts and manual folder drops:
//   docker run -v /host/my-project:/app/data/projects/my-project backlogger
// Any folder whose name matches the project-id pattern (^[a-z0-9][a-z0-9-]+$)
// and is absent from the DB is registered automatically and reindexed.
await discoverNewProjects(ctx.resolver.projectsRoot, ctx.projectsRepo, ctx.reindexService);

// Sync every already-known project on startup so files added to bind-mounted
// folders while the container was down are picked up. The file watcher only
// catches live changes (ignoreInitial: true), so without this a restart after
// adding docs would leave the new files unindexed until a manual reload.
for (const project of ctx.projectsRepo.list()) {
  const report = await ctx.reindexService.runProject(project.id);
  if (report.added > 0 || report.updated > 0 || report.removed > 0 || report.skipped.length > 0) {
    logger.info(
      `startup sync project="${project.id}" added=${report.added} updated=${report.updated} removed=${report.removed} skipped=${report.skipped.length}`,
    );
    if (report.skipped.length > 0) {
      logger.warn(`startup sync project="${project.id}" skipped files: ${formatSkippedFiles(report.skipped)}`);
    }
  }
}

// Auto-reindex on startup if the documents table is empty but the FS has
// content (e.g. fresh DB after a restore or a manual file drop).
if (ctx.documentsRepo.count() === 0 && (await hasAnyMarkdown(ctx.resolver.projectsRoot))) {
  const report = await ctx.reindexService.run();
  logger.info(
    `startup reindex: scanned=${report.scanned} inserted=${report.inserted} skipped=${report.skipped.length}`,
  );
  if (report.skipped.length > 0) {
    logger.warn(`startup reindex skipped files: ${formatSkippedFiles(report.skipped)}`);
  }
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

/** Kebab-id → "Title Case" display name. `backlogger-docs` → `Backlogger Docs`. */
function idToName(id: string): string {
  return id
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Scan the projects root for directories (and symlinks to directories) whose
 * name is a valid project-id but have no DB row yet.  Registers each one and
 * runs a project-scoped reindex so documents are queryable immediately.
 * Safe to call every startup — existing projects are skipped.
 */
async function discoverNewProjects(
  projectsRoot: string,
  projectsRepo: import('./db/projects-repo.js').ProjectsRepo,
  reindexService: import('./services/reindex-service.js').ReindexService,
): Promise<void> {
  // Same pattern as ProjectIdSchema in @backlogger/shared.
  const VALID_ID = /^[a-z0-9][a-z0-9-]{1,62}$/;

  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(projectsRoot, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const id = entry.name;
    if (!VALID_ID.test(id)) continue;
    if (projectsRepo.exists(id)) continue;

    // Accept plain directories and symlinks that resolve to a directory.
    let isDir = entry.isDirectory();
    if (!isDir && entry.isSymbolicLink()) {
      try {
        const st = await fs.stat(path.join(projectsRoot, id));
        isDir = st.isDirectory();
      } catch {
        isDir = false;
      }
    }
    if (!isDir) continue;

    const now = new Date().toISOString();
    projectsRepo.insert({
      id,
      name: idToName(id),
      description: null,
      readOnly: true,
      created_at: now,
      updated_at: now,
    });

    const report = await reindexService.runProject(id);
    logger.info(`discovered project '${id}': indexed ${report.added} doc(s), skipped ${report.skipped.length}`);
    if (report.skipped.length > 0) {
      logger.warn(`discovered project '${id}' skipped files: ${formatSkippedFiles(report.skipped)}`);
    }
  }
}

function parseOrigins(raw: string): string[] | '*' {
  const trimmed = raw.trim();
  if (trimmed === '*' || trimmed === '') return trimmed === '' ? [] : '*';
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
