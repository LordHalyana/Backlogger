import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Prepare the e2e data directory before tests run.
 *
 * playwright.config.ts sets BACKLOGGER_DATA_DIR to an absolute path; we honour
 * that here so the templates dir we manage is the same one the server reads.
 *
 * We DO NOT wipe the SQLite file: by the time globalSetup runs the API server
 * is already up (Playwright starts webServer first), and deleting an open
 * database orphans its file descriptor. Tests use Date.now()-based IDs for
 * inter-test isolation. We only clear the templates/ subdirectory so the
 * built-in-only template count stays deterministic across runs.
 */
export default async function globalSetup(): Promise<void> {
  const dataDir =
    process.env.BACKLOGGER_DATA_DIR ?? path.resolve(process.cwd(), '.e2e-data');
  const templatesDir = path.join(dataDir, 'templates');
  await fs.rm(templatesDir, { recursive: true, force: true });
  await fs.mkdir(templatesDir, { recursive: true });
}
