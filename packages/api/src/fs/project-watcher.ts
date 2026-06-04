import * as path from 'node:path';
import chokidar from 'chokidar';
import type { ReindexService } from '../services/reindex-service.js';

const DEBOUNCE_MS = 800;

export interface ProjectWatcherOptions {
  projectsRoot: string;
  reindexService: ReindexService;
}

/**
 * Watch `projectsRoot` for Markdown file changes and trigger a per-project
 * reindex whenever files are added, modified, or removed.
 *
 * Uses per-project debouncing so rapid multi-file writes (e.g. git checkout,
 * bulk copy) are batched into a single reindex run per project.
 *
 * Returns a cleanup function that stops the watcher.
 */
export function watchProjectFiles(opts: ProjectWatcherOptions): () => void {
  const { projectsRoot, reindexService } = opts;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const scheduleReindex = (projectId: string): void => {
    const existing = timers.get(projectId);
    if (existing) clearTimeout(existing);
    timers.set(
      projectId,
      setTimeout(() => {
        timers.delete(projectId);
        reindexService.runProject(projectId).then((report) => {
          // eslint-disable-next-line no-console
          console.log(
            `[backlogger] auto-reindex project="${projectId}" added=${report.added} updated=${report.updated} removed=${report.removed}`,
          );
        }).catch((err: unknown) => {
          // ReloadInProgressError is normal when the user also clicks Reload; suppress it.
          const msg = err instanceof Error ? err.message : String(err);
          // eslint-disable-next-line no-console
          console.warn(`[backlogger] auto-reindex project="${projectId}" skipped: ${msg}`);
        });
      }, DEBOUNCE_MS),
    );
  };

  const handleChange = (filePath: string): void => {
    if (!filePath.endsWith('.md')) return;
    const rel = path.relative(projectsRoot, filePath);
    // rel starts with <projectId>/...
    const projectId = rel.split(path.sep)[0];
    if (!projectId || projectId.startsWith('.')) return;
    scheduleReindex(projectId);
  };

  const watcher = chokidar.watch(projectsRoot, {
    ignoreInitial: true,
    // Don't emit events for directory entries themselves, only files.
    ignored: (p: string) => {
      const base = path.basename(p);
      return base.startsWith('.') || base === 'node_modules';
    },
  });

  watcher
    .on('add', handleChange)
    .on('change', handleChange)
    .on('unlink', handleChange);

  return () => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    void watcher.close();
  };
}
