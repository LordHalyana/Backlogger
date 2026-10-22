import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
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
    const res = await request(h.app)
      .delete('/api/projects/inbox')
      .set('Idempotency-Key', randomUUID());
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

/** File an item, with a fresh Idempotency-Key unless one is given. */
function file(h: Harness, id: string, body: Record<string, unknown>, key: string = randomUUID()) {
  return request(h.app).post(`/api/documents/${id}/file`).set('Idempotency-Key', key).send(body);
}

/** File an item, then fetch it where it now lives (filing answers with an ack only). */
async function fileAndGet(h: Harness, id: string, body: Record<string, unknown>) {
  const res = await file(h, id, body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const doc = await request(h.app).get(`/api/documents/${id}`);
  return { ack: res.body, doc: doc.body as DocBody & { status: string } };
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
      command: 'document.file',
      document_id: UUID.a,
      source_project_id: 'inbox',
      target_project_id: 'work',
      outcome: 'filed',
    });
    expect(res.body.result_revision).not.toBe(current.body.revision);

    const moved = await readDisk(h, 'work/backlog/fix-the-gate-0a1b2c3d.md');
    expect(moved).toBe(original.replace('project: inbox\n', 'project: work\n'));
    expect(await listFiles(h, 'inbox')).toEqual([]);

    const fetched = await request(h.app).get(`/api/documents/${UUID.a}`);
    expect(fetched.body).toMatchObject({
      project_id: 'work',
      path: 'work/backlog/fix-the-gate-0a1b2c3d.md',
      revision: res.body.result_revision,
    });
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
    expect(res.body).toMatchObject({
      outcome: 'already_filed',
      target_project_id: 'inbox',
      result_revision: item.revision,
    });
    expect(await readDisk(h, item.path)).toBe(before);
  });

  it('S6: a resent filing after a lost response returns the item at its new place', async () => {
    const key = randomUUID();
    const first = await file(
      h,
      UUID.a,
      { target_project_id: 'work', revision: item.revision },
      key,
    );
    const again = await file(
      h,
      UUID.a,
      { target_project_id: 'work', revision: item.revision },
      key,
    );
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    // A new key for the same filing finds the item already there.
    const fresh = await file(h, UUID.a, { target_project_id: 'work', revision: item.revision });
    expect(fresh.body).toMatchObject({
      outcome: 'already_filed',
      result_revision: first.body.result_revision,
    });
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

    const unkeyed = await request(h.app)
      .post(`/api/documents/${UUID.a}/file`)
      .send({ target_project_id: 'work', revision: item.revision });
    expect(unkeyed.status).toBe(400);
    expect(unkeyed.body.error.code).toBe('INVALID_COMMAND');
    expect(await listFiles(h, 'work')).toEqual([]);
  });

  it('a capture resent after filing returns the item where it now lives', async () => {
    const { doc: filed } = await fileAndGet(h, UUID.a, {
      target_project_id: 'work',
      revision: item.revision,
    });
    const res = await capture(h, { id: UUID.a, title: 'Fix the gate' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ project_id: 'work', revision: filed.revision });
    expect(await listFiles(h, 'inbox')).toEqual([]);
  });

  it('an update, move or delete queued behind a filing returns 409 REVISION_CONFLICT and changes nothing', async () => {
    // Hold the Inbox queue so the filing and then the mutations line up behind it.
    let release!: () => void;
    const held = h.ctx.queue.run('inbox', () => new Promise<void>((r) => (release = r)));
    const settle = () => new Promise((r) => setTimeout(r, 50));

    const filing = file(h, UUID.a, { target_project_id: 'work', revision: item.revision }).then(
      (res) => res,
    );
    await settle();
    const update = request(h.app)
      .put(`/api/documents/${UUID.a}`)
      .send({ body: 'Late edit' })
      .then((res) => res);
    const move = request(h.app)
      .post(`/api/documents/${UUID.a}/move`)
      .send({ folder: 'notes' })
      .then((res) => res);
    const del = request(h.app)
      .delete(`/api/documents/${UUID.a}`)
      .set('Idempotency-Key', randomUUID())
      .then((res) => res);
    await settle();
    release();
    await held;

    expect((await filing).status).toBe(200);
    const filed = await request(h.app).get(`/api/documents/${UUID.a}`);
    for (const res of [await update, await move, await del]) {
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({
        code: 'REVISION_CONFLICT',
        details: { currentRevision: filed.body.revision, currentProjectId: 'work' },
      });
    }
    const now = await request(h.app).get(`/api/documents/${UUID.a}`);
    expect(now.body).toMatchObject({
      project_id: 'work',
      path: filed.body.path,
      revision: filed.body.revision,
    });
    expect(await listFiles(h, 'work')).toEqual([filed.body.path]);
  });

  it('keeps an archived item archived in the same project-relative folder', async () => {
    const archived = await request(h.app)
      .put(`/api/documents/${UUID.a}`)
      .set('If-Match', item.revision)
      .send({ status: 'archived' });
    expect(archived.status).toBe(200);
    const { doc } = await fileAndGet(h, UUID.a, {
      target_project_id: 'work',
      revision: archived.body.revision,
    });
    expect(doc.path).toBe(archived.body.path.replace(/^inbox\//, 'work/'));
    expect(doc.status).toBe('archived');
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

/** Write a Backlogger backlog item straight to disk (then reload the project). */
async function writeItem(
  h: Harness,
  projectId: string,
  fields: { id: string; title: string; created_at: string; status?: string; task_state?: string },
): Promise<void> {
  const slug = fields.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const folder = fields.status === 'archived' ? 'archived/backlog' : 'backlog';
  const lines = [
    '---',
    `id: ${fields.id}`,
    `title: ${fields.title}`,
    `project: ${projectId}`,
    'type: backlog_item',
    `status: ${fields.status ?? 'active'}`,
    ...(fields.task_state ? [`task_state: ${fields.task_state}`] : []),
    `created_at: '${fields.created_at}'`,
    `updated_at: '${fields.created_at}'`,
    'tags: []',
    '---',
    '',
  ];
  const dir = path.join(h.dataDir, 'projects', projectId, folder);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${slug}.md`), lines.join('\n'));
}

interface CurrentWork {
  groups: Array<{
    project: { id: string; name: string; readOnly: boolean; isInbox: boolean };
    items: Array<{ id: string; readOnly: boolean; task_state: string; revision: string; status: string }>;
  }>;
}

async function currentWork(h: Harness): Promise<CurrentWork> {
  const res = await request(h.app).get('/api/current-work');
  expect(res.status).toBe(200);
  return res.body as CurrentWork;
}

function shape(cw: CurrentWork): Array<[string, string[]]> {
  return cw.groups.map((g) => [g.project.id, g.items.map((i) => i.id)]);
}

const IP = {
  inbox1: '10000000-0000-4000-8000-000000000001',
  zulu1: '20000000-0000-4000-8000-000000000001',
  zulu2: '20000000-0000-4000-8000-000000000002',
  zuluDraft: '20000000-0000-4000-8000-000000000003',
  zuluArchived: '20000000-0000-4000-8000-000000000004',
  zuluTodo: '20000000-0000-4000-8000-000000000005',
  zuluDone: '20000000-0000-4000-8000-000000000006',
  zuluOdd: '20000000-0000-4000-8000-000000000007',
  alpha1: '30000000-0000-4000-8000-000000000001',
  frozen1: '40000000-0000-4000-8000-000000000001',
  side1: '50000000-0000-4000-8000-000000000001',
};

describe('Current work: GET /api/current-work', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
    await createProject(h, 'a-proj', 'Zulu');
    await createProject(h, 'b-proj', 'Alpha');
    await createProject(h, 'frozen', 'Frozen');
    await createProject(h, 'side', 'Side');
    await createProject(h, 'quiet', 'Quiet');
    await writeItem(h, 'inbox', { id: IP.inbox1, title: 'Inbox one', created_at: '2026-01-05T00:00:00.000Z', task_state: 'in_progress' });
    await writeItem(h, 'a-proj', { id: IP.zulu2, title: 'Zulu two', created_at: '2026-01-03T00:00:00.000Z', task_state: 'in_progress' });
    await writeItem(h, 'a-proj', { id: IP.zulu1, title: 'Zulu one', created_at: '2026-01-01T00:00:00.000Z', task_state: 'in_progress' });
    await writeItem(h, 'a-proj', { id: IP.zuluDraft, title: 'Zulu draft', created_at: '2026-01-02T00:00:00.000Z', status: 'draft', task_state: 'in_progress' });
    await writeItem(h, 'a-proj', { id: IP.zuluArchived, title: 'Zulu archived', created_at: '2026-01-01T00:00:00.000Z', status: 'archived', task_state: 'in_progress' });
    await writeItem(h, 'a-proj', { id: IP.zuluTodo, title: 'Zulu todo', created_at: '2026-01-01T00:00:00.000Z', task_state: 'todo' });
    await writeItem(h, 'a-proj', { id: IP.zuluDone, title: 'Zulu done', created_at: '2026-01-01T00:00:00.000Z', task_state: 'done' });
    await writeItem(h, 'a-proj', { id: IP.zuluOdd, title: 'Zulu odd', created_at: '2026-01-01T00:00:00.000Z', task_state: 'Doing' });
    await writeItem(h, 'b-proj', { id: IP.alpha1, title: 'Alpha one', created_at: '2026-01-09T00:00:00.000Z', task_state: 'in_progress' });
    await writeItem(h, 'frozen', { id: IP.frozen1, title: 'Frozen one', created_at: '2026-01-01T00:00:00.000Z', task_state: 'in_progress' });
    await writeItem(h, 'side', { id: IP.side1, title: 'Side one', created_at: '2026-01-01T00:00:00.000Z', task_state: 'in_progress' });
    await request(h.app).put('/api/projects/side').send({ metadataMode: 'sidecar' });
    for (const id of ['inbox', 'a-proj', 'b-proj', 'frozen', 'side']) {
      await request(h.app).post(`/api/projects/${id}/reload`);
    }
    await request(h.app).put('/api/projects/frozen').send({ readOnly: true });
  });
  afterEach(() => teardown(h));

  it('S8: In progress items of native projects, Inbox first then by name, in creation order', async () => {
    const cw = await currentWork(h);
    expect(shape(cw)).toEqual([
      ['inbox', [IP.inbox1]],
      ['b-proj', [IP.alpha1]],
      ['frozen', [IP.frozen1]],
      ['a-proj', [IP.zulu1, IP.zuluDraft, IP.zulu2]],
    ]);
    expect(cw.groups[0]!.project).toEqual({ id: 'inbox', name: 'Inbox', readOnly: false, isInbox: true });
    expect(cw.groups[1]!.project).toEqual({ id: 'b-proj', name: 'Alpha', readOnly: false, isInbox: false });
  });

  it('S8: read-only projects and their items are marked read-only', async () => {
    const cw = await currentWork(h);
    const frozen = cw.groups.find((g) => g.project.id === 'frozen')!;
    expect(frozen.project.readOnly).toBe(true);
    expect(frozen.items.map((i) => i.readOnly)).toEqual([true]);
    const zulu = cw.groups.find((g) => g.project.id === 'a-proj')!;
    expect(zulu.items.map((i) => i.readOnly)).toEqual([false, false, false]);
  });

  it('S9: a state change leaves Current work and updates the board and the file', async () => {
    const before = await currentWork(h);
    const card = before.groups.find((g) => g.project.id === 'a-proj')!.items[0]!;
    const res = await request(h.app)
      .put(`/api/documents/${card.id}`)
      .set('If-Match', card.revision)
      .send({ task_state: 'done' });
    expect(res.status).toBe(200);

    const after = await currentWork(h);
    expect(shape(after).find(([id]) => id === 'a-proj')![1]).toEqual([IP.zuluDraft, IP.zulu2]);
    const board = await request(h.app).get('/api/projects/a-proj/board');
    expect(board.body.columns.done.map((c: { id: string }) => c.id)).toContain(card.id);
    expect(await readDisk(h, 'a-proj/backlog/zulu-one.md')).toContain('task_state: done\n');
  });

  it('a restored In progress item returns to Current work', async () => {
    const archived = await request(h.app).get(`/api/documents/${IP.zuluArchived}`);
    const restored = await request(h.app)
      .put(`/api/documents/${IP.zuluArchived}`)
      .set('If-Match', archived.body.revision)
      .send({ status: 'active' });
    expect(restored.status).toBe(200);
    const cw = await currentWork(h);
    // Same created_at as zulu1, so the id breaks the tie.
    expect(shape(cw).find(([id]) => id === 'a-proj')![1]).toEqual([
      IP.zulu1,
      IP.zuluArchived,
      IP.zuluDraft,
      IP.zulu2,
    ]);
  });

  it('is empty when nothing is In progress', async () => {
    const fresh = await setup();
    try {
      expect(await currentWork(fresh)).toEqual({ groups: [] });
    } finally {
      await teardown(fresh);
    }
  });
});

describe('Restart with a rebuilt database (S10)', () => {
  let h: Harness;
  afterEach(() => teardown(h));

  it('keeps the Inbox, filed items and Current work membership', async () => {
    h = await setup();
    await createProject(h, 'work', 'Work');
    const kept = (await capture(h, { id: UUID.a, title: 'Stays in Inbox' })).body as DocBody;
    const moved = (await capture(h, { id: UUID.b, title: 'Gets filed' })).body as DocBody;
    const started = await request(h.app)
      .put(`/api/documents/${moved.id}`)
      .set('If-Match', moved.revision)
      .send({ task_state: 'in_progress' });
    const { doc: filed } = await fileAndGet(h, moved.id, {
      target_project_id: 'work',
      revision: started.body.revision,
    });
    const keptStarted = await request(h.app)
      .put(`/api/documents/${kept.id}`)
      .set('If-Match', kept.revision)
      .send({ task_state: 'in_progress' });
    expect(keptStarted.status).toBe(200);
    const before = await currentWork(h);

    h = await restart(h);

    const projects = await listProjects(h);
    expect(projects.filter((p) => p.isInbox)).toEqual([
      expect.objectContaining({ id: 'inbox', name: 'Inbox', readOnly: false }),
    ]);
    const doc = await request(h.app).get(`/api/documents/${UUID.b}`);
    expect(doc.body).toMatchObject({ id: UUID.b, project_id: 'work', path: filed.path });
    expect(await readDisk(h, filed.path)).toContain('task_state: in_progress\n');
    expect(shape(await currentWork(h))).toEqual(shape(before));
    // Writability of other projects after a rebuild is a known limitation; not asserted.
  });
});
