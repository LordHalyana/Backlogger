import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SubsystemState } from '@backlogger/shared';

const PROBE_FILE = '.health-probe';

/**
 * Storage probe — verifies the data directory is reachable and writable.
 *
 * - `stat()` fails           → `error`
 * - `stat()` ok, write fails → `degraded`
 * - both ok                  → `ok`
 *
 * Writes/unlinks a fixed hidden file at the data-dir root so it can never
 * collide with a user-authored Markdown document under `projects/`.
 */
export function createStorageProbe(dataDir: string): () => SubsystemState {
  return (): SubsystemState => {
    try {
      fs.statSync(dataDir);
    } catch {
      return 'error';
    }
    const probePath = path.join(dataDir, PROBE_FILE);
    try {
      fs.writeFileSync(probePath, '');
      fs.unlinkSync(probePath);
      return 'ok';
    } catch {
      return 'degraded';
    }
  };
}
