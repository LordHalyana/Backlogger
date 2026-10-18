import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { AppContext } from './context.js';
import { logger } from './logger.js';
import { formatSkippedFiles } from './services/reindex-report.js';

/**
 * Everything the server does with the data dir before serving requests:
 * establish the Inbox, register project folders that have no row yet, sync
 * every known project and, over an empty index, rebuild it from disk.
 */
export async function prepareDataDir(ctx: AppContext): Promise<void> {
  await ctx.fs.ensureRoot();

  // Before discovery, so a rebuilt database re-registers the designated Inbox
  // writable instead of discovering its folder as a read-only project.
  await ctx.inboxService.ensure();

  // Auto-discover project folders (or symlinks) that exist on disk but have
  // no DB row yet. This handles Docker volume mounts and manual folder drops:
  //   docker run -v /host/my-project:/app/data/projects/my-project backlogger
  // Any folder whose name matches the project-id pattern (^[a-z0-9][a-z0-9-]+$)
  // and is absent from the DB is registered automatically and reindexed.
  await discoverNewProjects(ctx);

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
}

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
async function discoverNewProjects(ctx: AppContext): Promise<void> {
  const { projectsRepo, reindexService } = ctx;
  const projectsRoot = ctx.resolver.projectsRoot;
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
