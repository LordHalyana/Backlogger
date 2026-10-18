import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import request from 'supertest';
import { setup, teardown, type Harness } from './test-support.js';

/**
 * HTTP API tests for the daily-work milestone (spec #40): the designated
 * Inbox, capture, filing and Current work. Real routes, temp data dir,
 * in-memory SQLite. `workspace.json` and the Markdown files are public
 * contracts, so tests read them from disk directly.
 */

function readWorkspaceFile(h: Harness): Promise<unknown> {
  return fs.readFile(path.join(h.dataDir, 'workspace.json'), 'utf8').then(JSON.parse);
}

interface ProjectBody {
  id: string;
  name: string;
  readOnly: boolean;
  isInbox: boolean;
}

async function listProjects(h: Harness): Promise<ProjectBody[]> {
  const res = await request(h.app).get('/api/projects');
  expect(res.status).toBe(200);
  return res.body as ProjectBody[];
}

/** Start the app again over the same data dir with a freshly rebuilt database. */
async function restart(h: Harness): Promise<Harness> {
  h.db.close();
  return setup({ dataDir: h.dataDir });
}

async function emptyDataDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'backlogger-api-'));
}

describe('Inbox: designation and creation at start', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
  });
  afterEach(() => teardown(h));

  it('creates one writable Inbox and records it in workspace.json', async () => {
    const projects = await listProjects(h);
    expect(projects).toEqual([
      expect.objectContaining({ id: 'inbox', name: 'Inbox', readOnly: false, isInbox: true }),
    ]);
    expect(await readWorkspaceFile(h)).toEqual({ inbox_project_id: 'inbox' });
    const stat = await fs.stat(path.join(h.dataDir, 'projects', 'inbox'));
    expect(stat.isDirectory()).toBe(true);
  });
});

describe('Inbox: restart, rebuild and existing projects', () => {
  let h: Harness;
  afterEach(() => teardown(h));

  it('a restart with a rebuilt database keeps the same writable Inbox, never a second', async () => {
    h = await setup();
    const renamed = await request(h.app).put('/api/projects/inbox').send({ name: 'Inbox (renamed)' });
    expect(renamed.status).toBe(200);
    h = await restart(h);
    h = await restart(h);
    expect(await listProjects(h)).toEqual([
      expect.objectContaining({ id: 'inbox', name: 'Inbox', readOnly: false, isInbox: true }),
    ]);
    expect(await readWorkspaceFile(h)).toEqual({ inbox_project_id: 'inbox' });
  });

  it('never adopts an existing project folder called inbox', async () => {
    const dataDir = await emptyDataDir();
    await fs.mkdir(path.join(dataDir, 'projects', 'inbox', 'backlog'), { recursive: true });
    h = await setup({ dataDir });
    const projects = await listProjects(h);
    expect(projects.find((p) => p.id === 'inbox')).toMatchObject({ isInbox: false, readOnly: true });
    expect(projects.find((p) => p.isInbox)).toMatchObject({ id: 'inbox-2', name: 'Inbox' });
    expect(await readWorkspaceFile(h)).toEqual({ inbox_project_id: 'inbox-2' });
  });

  it('a project created and named Inbox is not the Inbox', async () => {
    h = await setup();
    const res = await request(h.app).post('/api/projects').send({ id: 'my-inbox', name: 'Inbox' });
    expect(res.status).toBe(201);
    expect(res.body.isInbox).toBe(false);
    h = await restart(h);
    expect((await listProjects(h)).filter((p) => p.isInbox).map((p) => p.id)).toEqual(['inbox']);
  });

  it('recreates an empty Inbox with the recorded id when its folder is missing', async () => {
    const dataDir = await emptyDataDir();
    await fs.writeFile(path.join(dataDir, 'workspace.json'), '{ "inbox_project_id": "my-inbox" }');
    h = await setup({ dataDir });
    expect(await listProjects(h)).toEqual([
      expect.objectContaining({ id: 'my-inbox', name: 'Inbox', readOnly: false, isInbox: true }),
    ]);
    const stat = await fs.stat(path.join(dataDir, 'projects', 'my-inbox', 'backlog'));
    expect(stat.isDirectory()).toBe(true);
  });
});

describe('Inbox: protection', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
  });
  afterEach(() => teardown(h));

  it('refuses deleting the Inbox with 409 INBOX_PROTECTED and keeps its folder', async () => {
    const res = await request(h.app).delete('/api/projects/inbox');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INBOX_PROTECTED');
    expect((await fs.stat(path.join(h.dataDir, 'projects', 'inbox'))).isDirectory()).toBe(true);
    expect((await listProjects(h)).map((p) => p.id)).toEqual(['inbox']);
  });

  it('refuses making the Inbox read-only with 409 INBOX_PROTECTED', async () => {
    const res = await request(h.app).put('/api/projects/inbox').send({ readOnly: true });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INBOX_PROTECTED');
    expect((await listProjects(h))[0]).toMatchObject({ readOnly: false });
  });

  it('allows renaming the Inbox; its id is unchanged', async () => {
    const res = await request(h.app).put('/api/projects/inbox').send({ name: 'Capture' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'inbox', name: 'Capture', isInbox: true });
  });
});
