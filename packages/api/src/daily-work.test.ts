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

const UUID = {
  a: '0a1b2c3d-1111-4111-8111-111111111111',
  b: '0b1b2c3d-2222-4222-8222-222222222222',
  c: '0c1b2c3d-3333-4333-8333-333333333333',
};

interface DocBody {
  id: string;
  title: string;
  project_id: string;
  path: string;
  status: string;
  type: string;
  revision: string;
  task_state?: string;
}

function capture(h: Harness, body: Record<string, unknown>) {
  return request(h.app).post('/api/capture').send(body);
}

function readDisk(h: Harness, relPath: string): Promise<string> {
  return fs.readFile(path.join(h.dataDir, 'projects', relPath), 'utf8');
}

async function createProject(h: Harness, id: string, name = id): Promise<void> {
  const res = await request(h.app).post('/api/projects').send({ id, name });
  expect(res.status).toBe(201);
}

describe('Capture: POST /api/capture', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
  });
  afterEach(() => teardown(h));

  it('S1: a title-only capture becomes a draft To do backlog item in the Inbox', async () => {
    const res = await capture(h, { id: UUID.a, title: 'Buy milk' });
    expect(res.status).toBe(201);
    const doc = res.body as DocBody;
    expect(doc).toMatchObject({
      id: UUID.a,
      title: 'Buy milk',
      project_id: 'inbox',
      type: 'backlog_item',
      status: 'draft',
      path: 'inbox/backlog/buy-milk-0a1b2c3d.md',
    });
    const disk = await readDisk(h, doc.path);
    expect(disk).toMatch(
      new RegExp(
        [
          '^---',
          `id: ${UUID.a}`,
          'title: Buy milk',
          'project: inbox',
          'type: backlog_item',
          'status: draft',
          'task_state: todo',
          "created_at: '[^']+'",
          "updated_at: '[^']+'",
          'tags: \\[\\]',
          '---',
          '',
          '$',
        ].join('\\n'),
      ),
    );
    const board = await request(h.app).get('/api/projects/inbox/board');
    expect(board.body.columns.todo.map((c: { id: string }) => c.id)).toEqual([UUID.a]);
  });

  it('S2: a capture with a project id goes to that project', async () => {
    await createProject(h, 'work');
    const res = await capture(h, { id: UUID.a, title: 'Write report', project_id: 'work' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ project_id: 'work', path: 'work/backlog/write-report-0a1b2c3d.md' });
  });

  it('S3: a capture resent after a lost response creates one item and both replies agree', async () => {
    const first = await capture(h, { id: UUID.a, title: 'Call plumber' });
    const second = await capture(h, { id: UUID.a, title: 'Call plumber' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.revision).toBe(first.body.revision);
    expect(await fs.readdir(path.join(h.dataDir, 'projects', 'inbox', 'backlog'))).toEqual([
      'call-plumber-0a1b2c3d.md',
    ]);
  });

  it('overlapping identical captures still create one item', async () => {
    const [a, b] = await Promise.all([
      capture(h, { id: UUID.a, title: 'Twice' }),
      capture(h, { id: UUID.a, title: 'Twice' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(await fs.readdir(path.join(h.dataDir, 'projects', 'inbox', 'backlog'))).toHaveLength(1);
  });

  it('reusing an id with a different title returns 409 CAPTURE_ID_CONFLICT and writes nothing', async () => {
    await capture(h, { id: UUID.a, title: 'First' });
    const res = await capture(h, { id: UUID.a, title: 'Second' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CAPTURE_ID_CONFLICT');
    expect(await fs.readdir(path.join(h.dataDir, 'projects', 'inbox', 'backlog'))).toEqual([
      'first-0a1b2c3d.md',
    ]);
  });

  it('reusing the id of another document type returns 409 CAPTURE_ID_CONFLICT', async () => {
    await createProject(h, 'work');
    const note = await request(h.app)
      .post('/api/projects/work/documents')
      .send({ type: 'note', title: 'A note' });
    const res = await capture(h, { id: note.body.id, title: 'A note' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CAPTURE_ID_CONFLICT');
  });

  it('refuses unknown, read-only and sidecar projects', async () => {
    const unknown = await capture(h, { id: UUID.a, title: 'X', project_id: 'nope' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('PROJECT_NOT_FOUND');

    await createProject(h, 'frozen');
    await request(h.app).put('/api/projects/frozen').send({ readOnly: true });
    const frozen = await capture(h, { id: UUID.b, title: 'X', project_id: 'frozen' });
    expect(frozen.status).toBe(409);
    expect(frozen.body.error.code).toBe('PROJECT_NOT_WRITABLE');

    await createProject(h, 'side');
    await request(h.app).put('/api/projects/side').send({ metadataMode: 'sidecar' });
    const side = await capture(h, { id: UUID.c, title: 'X', project_id: 'side' });
    expect(side.status).toBe(409);
    expect(side.body.error.code).toBe('PROJECT_NOT_WRITABLE');
  });

  it('validates the id and title', async () => {
    for (const body of [
      { title: 'No id' },
      { id: 'not-a-uuid', title: 'Bad id' },
      { id: UUID.a, title: '' },
      { id: UUID.a, title: 'x'.repeat(201) },
    ]) {
      const res = await capture(h, body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('S4: a failed write leaves no partial file, and a retry with the same id then succeeds', async () => {
    const backlog = path.join(h.dataDir, 'projects', 'inbox', 'backlog');
    await fs.rm(backlog, { recursive: true });
    await fs.writeFile(backlog, 'not a folder');
    const failed = await capture(h, { id: UUID.a, title: 'Will fail' });
    expect(failed.status).toBe(500);
    expect(await fs.readdir(path.join(h.dataDir, 'projects', 'inbox'))).not.toContain(
      'will-fail-0a1b2c3d.md',
    );

    await fs.rm(backlog);
    const retried = await capture(h, { id: UUID.a, title: 'Will fail' });
    expect(retried.status).toBe(201);
    expect(await fs.readdir(backlog)).toEqual(['will-fail-0a1b2c3d.md']);
  });
});

describe('Capture: Inbox unavailable', () => {
  let h: Harness;
  afterEach(() => teardown(h));

  it('a capture without a project returns 500 INBOX_UNAVAILABLE; project captures still work', async () => {
    const dataDir = await emptyDataDir();
    await fs.writeFile(path.join(dataDir, 'workspace.json'), 'not json');
    h = await setup({ dataDir });
    const res = await capture(h, { id: UUID.a, title: 'Lost?' });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INBOX_UNAVAILABLE');

    await createProject(h, 'work');
    const ok = await capture(h, { id: UUID.b, title: 'Fine', project_id: 'work' });
    expect(ok.status).toBe(201);
    expect(await fs.readFile(path.join(dataDir, 'workspace.json'), 'utf8')).toBe('not json');
  });
});

function file(h: Harness, id: string, body: Record<string, unknown>) {
  return request(h.app).post(`/api/documents/${id}/file`).send(body);
}

async function listFiles(h: Harness, projectId: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(rel: string): Promise<void> {
    const entries = await fs.readdir(path.join(h.dataDir, 'projects', rel), { withFileTypes: true });
    for (const e of entries) {
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) await walk(child);
      else out.push(child);
    }
  }
  await walk(projectId);
  return out.sort();
}

describe('Filing: POST /api/documents/:id/file', () => {
  let h: Harness;
  let item: DocBody;
  beforeEach(async () => {
    h = await setup();
    await createProject(h, 'work', 'Work');
    item = (await capture(h, { id: UUID.a, title: 'Fix the gate' })).body as DocBody;
  });
  afterEach(() => teardown(h));

  it('S5: keeps the id and every byte except the project line, and removes the source file', async () => {
    // Hand-edit the captured file so unrecognised frontmatter and a body ride along.
    const sourcePath = item.path;
    const original = (await readDisk(h, sourcePath))
      .replace('tags: []\n', 'tags: []\nmood: hopeful\n')
      .replace(/---\n\n$/, '---\nSee [[Hinge spec]] for sizes.\n');
    await fs.writeFile(path.join(h.dataDir, 'projects', sourcePath), original);
    await request(h.app).post('/api/projects/inbox/reload');
    const current = await request(h.app).get(`/api/documents/${UUID.a}`);

    const res = await file(h, UUID.a, { target_project_id: 'work', revision: current.body.revision });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: UUID.a,
      project_id: 'work',
      path: 'work/backlog/fix-the-gate-0a1b2c3d.md',
    });
    expect(res.body.revision).not.toBe(current.body.revision);

    const moved = await readDisk(h, 'work/backlog/fix-the-gate-0a1b2c3d.md');
    expect(moved).toBe(original.replace('project: inbox\n', 'project: work\n'));
    expect(await listFiles(h, 'inbox')).toEqual([]);

    const fetched = await request(h.app).get(`/api/documents/${UUID.a}`);
    expect(fetched.body).toMatchObject({ project_id: 'work', revision: res.body.revision });
    const workBoard = await request(h.app).get('/api/projects/work/board');
    expect(workBoard.body.columns.todo.map((c: { id: string }) => c.id)).toEqual([UUID.a]);
    const inboxBoard = await request(h.app).get('/api/projects/inbox/board');
    expect(inboxBoard.body.columns.todo).toEqual([]);
  });

  it('S5: links, backlinks and search follow the filed item', async () => {
    const note = await request(h.app)
      .post('/api/projects/work/documents')
      .send({ type: 'note', title: 'Weekend', body: 'Remember [[Fix the gate]].' });
    expect(note.status).toBe(201);

    const res = await file(h, UUID.a, { target_project_id: 'work', revision: item.revision });
    expect(res.status).toBe(200);

    const backlinks = await request(h.app).get(`/api/documents/${UUID.a}/backlinks`);
    expect(backlinks.body.map((b: { id?: string; source_id?: string }) => b.id ?? b.source_id)).toEqual([
      note.body.id,
    ]);
    const hits = await request(h.app).get('/api/search').query({ q: 'gate' });
    expect(hits.body.filter((x: { id: string }) => x.id === UUID.a)).toEqual([
      expect.objectContaining({ project_id: 'work' }),
    ]);
    const inWork = await request(h.app).get('/api/search').query({ q: 'gate', projectId: 'work' });
    expect(inWork.body.map((x: { id: string }) => x.id)).toContain(UUID.a);
  });

  it('S6: filing into the project it is already in changes nothing, even with a stale revision', async () => {
    const before = await readDisk(h, item.path);
    const res = await file(h, UUID.a, { target_project_id: 'inbox', revision: 'stale' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ project_id: 'inbox', revision: item.revision });
    expect(await readDisk(h, item.path)).toBe(before);
  });

  it('S6: a resent filing after a lost response returns the item at its new place', async () => {
    const first = await file(h, UUID.a, { target_project_id: 'work', revision: item.revision });
    const again = await file(h, UUID.a, { target_project_id: 'work', revision: item.revision });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ project_id: 'work', revision: first.body.revision });
  });

  it('S6: a stale revision returns 409 REVISION_CONFLICT with the current revision and changes no files', async () => {
    const edited = await request(h.app)
      .put(`/api/documents/${UUID.a}`)
      .set('If-Match', item.revision)
      .send({ body: 'More detail' });
    const before = await readDisk(h, item.path);
    const res = await file(h, UUID.a, { target_project_id: 'work', revision: item.revision });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'REVISION_CONFLICT',
      details: { currentRevision: edited.body.revision, currentProjectId: 'inbox' },
    });
    expect(await readDisk(h, item.path)).toBe(before);
    expect(await listFiles(h, 'work')).toEqual([]);
  });

  it('S7: refuses read-only and sidecar targets, and unknown projects', async () => {
    await createProject(h, 'frozen');
    await request(h.app).put('/api/projects/frozen').send({ readOnly: true });
    await createProject(h, 'side');
    await request(h.app).put('/api/projects/side').send({ metadataMode: 'sidecar' });
    const before = await readDisk(h, item.path);

    for (const target of ['frozen', 'side']) {
      const res = await file(h, UUID.a, { target_project_id: target, revision: item.revision });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PROJECT_NOT_WRITABLE');
      expect(await listFiles(h, target)).toEqual([]);
    }
    const unknown = await file(h, UUID.a, { target_project_id: 'nope', revision: item.revision });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('PROJECT_NOT_FOUND');
    expect(await readDisk(h, item.path)).toBe(before);
  });

  it('refuses a read-only source', async () => {
    await capture(h, { id: UUID.b, title: 'Stuck', project_id: 'work' });
    const doc = await request(h.app).get(`/api/documents/${UUID.b}`);
    await request(h.app).put('/api/projects/work').send({ readOnly: true });
    const res = await file(h, UUID.b, { target_project_id: 'inbox', revision: doc.body.revision });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PROJECT_NOT_WRITABLE');
  });

  it('files backlog items only and requires a revision', async () => {
    const note = await request(h.app)
      .post('/api/projects/inbox/documents')
      .send({ type: 'note', title: 'Just a note' });
    const res = await file(h, note.body.id, { target_project_id: 'work', revision: note.body.revision });
    expect(res.status).toBe(400);

    const missing = await file(h, UUID.a, { target_project_id: 'work' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('a capture resent after filing returns the item where it now lives', async () => {
    const filed = await file(h, UUID.a, { target_project_id: 'work', revision: item.revision });
    const res = await capture(h, { id: UUID.a, title: 'Fix the gate' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ project_id: 'work', revision: filed.body.revision });
    expect(await listFiles(h, 'inbox')).toEqual([]);
  });

  it('keeps an archived item archived in the same project-relative folder', async () => {
    const archived = await request(h.app)
      .put(`/api/documents/${UUID.a}`)
      .set('If-Match', item.revision)
      .send({ status: 'archived' });
    expect(archived.status).toBe(200);
    const res = await file(h, UUID.a, { target_project_id: 'work', revision: archived.body.revision });
    expect(res.status).toBe(200);
    expect(res.body.path).toBe(archived.body.path.replace(/^inbox\//, 'work/'));
    expect(res.body.status).toBe('archived');
  });
});

describe('Filing interrupted between write and delete (S12)', () => {
  let h: Harness;
  let leftover: string;
  beforeEach(async () => {
    h = await setup();
    await createProject(h, 'work');
    const item = (await capture(h, { id: UUID.a, title: 'Half moved' })).body as DocBody;
    // The state a crash leaves: the rewritten copy in the target, the source still in place.
    leftover = item.path;
    const source = await readDisk(h, leftover);
    const target = path.join(h.dataDir, 'projects', 'work', 'backlog', 'half-moved-0a1b2c3d.md');
    await fs.writeFile(target, source.replace('project: inbox\n', 'project: work\n'));
  });
  afterEach(() => teardown(h));

  async function expectOneItemInWork(app: Harness['app']): Promise<void> {
    const doc = await request(app).get(`/api/documents/${UUID.a}`);
    expect(doc.body).toMatchObject({ project_id: 'work', path: 'work/backlog/half-moved-0a1b2c3d.md' });
    const inbox = await request(app).get('/api/projects/inbox/documents');
    expect(inbox.body).toEqual([]);
    const work = await request(app).get('/api/projects/work/documents');
    expect(work.body.map((d: { id: string }) => d.id)).toEqual([UUID.a]);
  }

  it('a full reindex indexes the target copy and reports the leftover under duplicates', async () => {
    const res = await request(h.app).post('/api/admin/reindex');
    expect(res.status).toBe(200);
    expect(res.body.duplicates).toEqual([
      { id: UUID.a, path: leftover, keptPath: 'work/backlog/half-moved-0a1b2c3d.md' },
    ]);
    await expectOneItemInWork(h.app);
  });

  it('per-project reloads converge on the target copy and report the leftover', async () => {
    // The Inbox alone cannot see the copy in work: still one indexed item.
    const inboxFirst = await request(h.app).post('/api/projects/inbox/reload');
    expect(inboxFirst.body.duplicates).toEqual([]);
    const doc = await request(h.app).get(`/api/documents/${UUID.a}`);
    expect(doc.body.project_id).toBe('inbox');

    for (const projectId of ['work', 'inbox']) {
      const res = await request(h.app).post(`/api/projects/${projectId}/reload`);
      expect(res.status).toBe(200);
      expect(res.body.duplicates).toEqual([
        { id: UUID.a, path: leftover, keptPath: 'work/backlog/half-moved-0a1b2c3d.md' },
      ]);
      await expectOneItemInWork(h.app);
    }
  });

  it('a restart with a rebuilt database indexes exactly one item for the id', async () => {
    h = await restart(h);
    await expectOneItemInWork(h.app);
  });

  it('when neither copy is in the Inbox, the lexicographically first path wins', async () => {
    await createProject(h, 'alpha');
    await fs.rename(
      path.join(h.dataDir, 'projects', leftover),
      path.join(h.dataDir, 'projects', 'alpha', 'backlog', 'half-moved-0a1b2c3d.md'),
    );
    const alphaCopy = path.join(h.dataDir, 'projects', 'alpha', 'backlog', 'half-moved-0a1b2c3d.md');
    await fs.writeFile(alphaCopy, (await fs.readFile(alphaCopy, 'utf8')).replace('project: inbox', 'project: alpha'));
    const res = await request(h.app).post('/api/admin/reindex');
    expect(res.body.duplicates).toEqual([
      {
        id: UUID.a,
        path: 'work/backlog/half-moved-0a1b2c3d.md',
        keptPath: 'alpha/backlog/half-moved-0a1b2c3d.md',
      },
    ]);
    const doc = await request(h.app).get(`/api/documents/${UUID.a}`);
    expect(doc.body.project_id).toBe('alpha');
  });
});
