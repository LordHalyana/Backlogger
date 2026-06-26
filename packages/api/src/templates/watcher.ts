import * as fs from 'node:fs/promises';
import chokidar from 'chokidar';
import { logger } from '../logger.js';
import type { TemplateRegistry } from './registry.js';
import { loadAllTemplates } from './registry.js';

const DEBOUNCE_MS = 500;

export interface TemplateWatcherOptions {
  builtinDir: string;
  userDir: string;
  registry: TemplateRegistry;
}

/**
 * Watch `userDir` for changes and reload all templates (builtin + user) into
 * `registry` whenever a file is added, changed, or removed. Uses a 500 ms
 * debounce to batch rapid file writes.
 */
export function watchUserTemplates(opts: TemplateWatcherOptions): () => void {
  const { builtinDir, userDir, registry } = opts;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const reload = (): void => {
    void loadAllTemplates(builtinDir, userDir).then(({ loaded }) => {
      registry.setAll(loaded);
    });
  };

  const debounced = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(reload, DEBOUNCE_MS);
  };

  const watcher = chokidar.watch(userDir, { ignoreInitial: true });
  watcher
    .on('add', debounced)
    .on('change', debounced)
    .on('unlink', debounced)
    .on('error', (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`template watcher error: ${msg}`);
    });

  return () => {
    if (timer) clearTimeout(timer);
    void watcher.close();
  };
}

/** Ensure the user templates directory exists (creates it if missing). */
export async function ensureUserTemplatesDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}
