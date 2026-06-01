import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import request from 'supertest';
import { fileURLToPath } from 'node:url';
import type { Express } from 'express';
import { createApp } from '../app.js';
import { buildContext } from '../context.js';
import { openDatabase, type Db } from '../db/database.js';
import { HealthService } from './health-service.js';
import { loadTemplatesFromDir, TemplateRegistry } from '../templates/registry.js';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'migrations',
);

const TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'templates',
);

interface Harness {
  app: Express;
  dataDir: string;
  db: Db;
}

async function setup(): Promise<Harness> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'backlogger-health-'));
  const db = openDatabase({ file: ':memory:', migrationsDir: MIGRATIONS_DIR });
  const templates = new TemplateRegistry();
  const { loaded } = await loadTemplatesFromDir(TEMPLATES_DIR);
  templates.setAll(loaded);
  const ctx = buildContext({ db, dataDir, templates });
  await ctx.fs.ensureRoot();
  return { app: createApp(ctx), dataDir, db };
}

async function teardown(h: Harness): Promise<void> {
  try {
    h.db.close();
  } catch {
    /* already closed */
  }
  await fs.rm(h.dataDir, { recursive: true, force: true });
}

describe('HealthService', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await setup();
  });
  afterEach(() => teardown(h));

  it('reports database=error when the connection is closed', async () => {
    h.db.close();
    const res = await request(h.app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('error');
    expect(res.body.database).toBe('error');
    expect(res.body.fts).toBe('error');
  });

  it('reports templates=degraded when fewer than 5 templates are loaded', async () => {
    const tpl = new TemplateRegistry();
    const db = openDatabase({ file: ':memory:', migrationsDir: MIGRATIONS_DIR });
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'backlogger-health-d-'));
    const ctx = buildContext({ db, dataDir, templates: tpl });
    await ctx.fs.ensureRoot();
    const app = createApp(ctx);
    try {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('degraded');
      expect(res.body.templates).toBe('degraded');
    } finally {
      db.close();
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  });

  it('caches the snapshot within the TTL window', () => {
    const db = openDatabase({ file: ':memory:', migrationsDir: MIGRATIONS_DIR });
    const tpl = new TemplateRegistry();
    const probeSpy = vi.spyOn(db, 'prepare');
    const svc = new HealthService({
      db,
      dataDir: h.dataDir,
      templates: tpl,
      version: 'test',
      ttlMs: 5_000,
      now: () => 1_000,
    });
    svc.snapshot();
    const callsAfterFirst = probeSpy.mock.calls.length;
    svc.snapshot();
    svc.snapshot();
    expect(probeSpy.mock.calls.length).toBe(callsAfterFirst);
    db.close();
  });

  it('refreshes after the TTL expires', () => {
    const db = openDatabase({ file: ':memory:', migrationsDir: MIGRATIONS_DIR });
    const tpl = new TemplateRegistry();
    let clock = 0;
    const svc = new HealthService({
      db,
      dataDir: h.dataDir,
      templates: tpl,
      version: 'test',
      ttlMs: 100,
      now: () => clock,
    });
    const a = svc.snapshot();
    clock += 50;
    const b = svc.snapshot();
    expect(b.checked_at).toBe(a.checked_at);
    clock += 200;
    const c = svc.snapshot();
    expect(c.checked_at).not.toBe(a.checked_at);
    db.close();
  });
});
