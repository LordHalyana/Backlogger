import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Express } from 'express';
import { createApp, type CreateAppOptions } from './app.js';
import { buildContext, type AppContext } from './context.js';
import { openDatabase, type Db } from './db/database.js';
import { loadTemplatesFromDir, TemplateRegistry } from './templates/registry.js';

/**
 * Shared harness for HTTP API tests: real routes over a temporary data dir
 * and an in-memory SQLite database with the real migrations applied.
 */

export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'migrations',
);

export const TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'templates',
);

export interface Harness {
  app: Express;
  dataDir: string;
  db: Db;
  ctx: AppContext;
}

export interface SetupOptions extends CreateAppOptions {
  /** Reuse an existing data dir (e.g. a fresh DB over the same files). */
  dataDir?: string;
}

export async function setup(opts: SetupOptions = {}): Promise<Harness> {
  const dataDir = opts.dataDir ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'backlogger-api-')));
  const db = openDatabase({ file: ':memory:', migrationsDir: MIGRATIONS_DIR });
  const templates = new TemplateRegistry();
  const { loaded } = await loadTemplatesFromDir(TEMPLATES_DIR);
  templates.setAll(loaded);
  const ctx = buildContext({ db, dataDir, templates });
  await ctx.fs.ensureRoot();
  return { app: createApp(ctx, { allowedOrigins: opts.allowedOrigins }), dataDir, db, ctx };
}

export async function teardown(h: Harness): Promise<void> {
  h.db.close();
  await fs.rm(h.dataDir, { recursive: true, force: true });
}
