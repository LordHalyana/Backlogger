import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import request from 'supertest';
import { contentRevision } from './fs/index.js';
import { setup, teardown, type Harness } from './test-support.js';

/**
 * HTTP API tests for posting, reading, listing, editing and deleting comments
 * (#65, #66, spec #58).
 * Real routes over a temp data dir; content is asserted on the Markdown
 * bytes, retry state on the operational tables.
 */

interface DocBody {
  id: string;
  path: string;
  revision: string;
  project_id: string;
}

interface Ack {
  operation_id: string;
  command: string;
  comment_id: string;
  parent_id: string;
  outcome: string;
  result_revision: string | null;
}

interface CommentBody {
  id: string;
  parent_id: string;
  project_id: string;
  body: string;
  created_at: string;
  updated_at: string;
  revision: string;
  writable: boolean;
}

interface PageBody {
  comments: CommentBody[];
  next_cursor: string | null;
  newer_cursor: string | null;
  older_count: number;
  newer_count: number;
  total: number;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Deterministic UUIDs v4: `uuid(7)` → `00000000-0000-4000-8000-000000000007`. */
function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

async function createProject(h: Harness, id: string, extra: Record<string, unknown> = {}) {
  const res = await request(h.app)
    .post('/api/projects')
    .send({ id, name: id, ...extra });
  expect(res.status).toBe(201);
}

async function createDoc(
  h: Harness,
  projectId: string,
  title: string,
  extra: Record<string, unknown> = {},
): Promise<DocBody> {
  const res = await request(h.app)
    .post(`/api/projects/${projectId}/documents`)
    .send({ type: 'backlog_item', title, ...extra });
  expect(res.status).toBe(201);
  return res.body as DocBody;
}

function post(h: Harness, taskId: string, key: string | undefined, body: unknown) {
  const req = request(h.app).post(`/api/documents/${taskId}/comments`);
  if (key !== undefined) req.set('Idempotency-Key', key);
  return req.send(body as object);
}

function disk(h: Harness, rel: string): Promise<string> {
  return fs.readFile(path.join(h.dataDir, 'projects', rel), 'utf8');
}

function commentRel(projectId: string, taskId: string, commentId: string): string {
  return `${projectId}/tickets/${taskId}/comments/${commentId}.md`;
}

async function exists(h: Harness, rel: string): Promise<boolean> {
  return fs
    .stat(path.join(h.dataDir, 'projects', rel))
    .then(() => true)
    .catch(() => false);
}

function operationRows(h: Harness): Array<Record<string, unknown>> {
  return h.db.prepare(`SELECT * FROM operations`).all() as Array<Record<string, unknown>>;
}

function count(h: Harness, table: string): number {
  return (h.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

/** A comment file in the schema-v1 layout, written straight to disk. */
async function seedComment(
  h: Harness,
  rel: string,
  fields: { id: string; parent: string; at: string; body: string },
): Promise<string> {
  const text = [
    '---',
    'schema_version: 1',
    'kind: comment',
    `id: ${fields.id}`,
    `parent_id: ${fields.parent}`,
    `created_at: '${fields.at}'`,
    `updated_at: '${fields.at}'`,
    '---',
    fields.body,
  ].join('\n');
  await writeRaw(h, rel, text);
  return text;
}

async function writeRaw(h: Harness, rel: string, text: string): Promise<void> {
  const abs = path.join(h.dataDir, 'projects', rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, text, 'utf8');
}

describe('POST /api/documents/:taskId/comments', () => {
  let h: Harness;
  let task: DocBody;
  beforeEach(async () => {
    h = await setup();
    await createProject(h, 'work');
    task = await createDoc(h, 'work', 'Investigate the flaky test');
  });
  afterEach(() => teardown(h));

  it('writes the exact expected bytes and leaves the parent task byte-identical', async () => {
    const taskBefore = await disk(h, task.path);
    const body = '  Found it: **race** in setup.\r\n\n- tried A\n- tried B\n\n';
    const res = await post(h, task.id, uuid(100), { id: uuid(1), body });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      operation_id: uuid(100),
      command: 'comment.create',
      comment_id: uuid(1),
      parent_id: task.id,
      outcome: 'created',
      result_revision: expect.any(String),
    });

    const text = await disk(h, commentRel('work', task.id, uuid(1)));
    const at = /created_at: '([^']+)'/.exec(text)?.[1] ?? '';
    expect(at).toMatch(ISO);
    expect(text).toBe(
      [
        '---',
        'schema_version: 1',
        'kind: comment',
        `id: ${uuid(1)}`,
        `parent_id: ${task.id}`,
        `created_at: '${at}'`,
        `updated_at: '${at}'`,
        '---',
        body,
      ].join('\n'),
    );

    expect(await disk(h, task.path)).toBe(taskBefore);
    const parent = await request(h.app).get(`/api/documents/${task.id}`);
    expect(parent.body.revision).toBe(task.revision);
  });

  it('normalises an uppercase comment id and Idempotency-Key', async () => {
    const res = await post(h, task.id, uuid(100).toUpperCase(), {
      id: uuid(0xabc).toUpperCase(),
      body: 'x',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ operation_id: uuid(100), comment_id: uuid(0xabc) });
    expect(await exists(h, commentRel('work', task.id, uuid(0xabc)))).toBe(true);
  });

  it('works on an Inbox item and on a Done item without changing task state', async () => {
    const captured = await request(h.app)
      .post('/api/capture')
      .send({ id: uuid(50), title: 'Captured thought' });
    expect(captured.status).toBe(201);
    const inboxPost = await post(h, uuid(50), uuid(101), { id: uuid(2), body: 'From the inbox' });
    expect(inboxPost.status).toBe(201);
    expect(await exists(h, commentRel('inbox', uuid(50), uuid(2)))).toBe(true);

    const done = await createDoc(h, 'work', 'Finished', { task_state: 'done' });
    const doneBefore = await disk(h, done.path);
    const donePost = await post(h, done.id, uuid(102), { id: uuid(3), body: 'Outcome: shipped' });
    expect(donePost.status).toBe(201);
    expect(await disk(h, done.path)).toBe(doneBefore);
    const reread = await request(h.app).get(`/api/documents/${done.id}`);
    expect(reread.body.revision).toBe(done.revision);
    expect(await disk(h, done.path)).toContain('task_state: done');
  });

  it('refuses archived parents, read-only projects and non-backlog parents with COMMENT_NOT_WRITABLE', async () => {
    const archived = await createDoc(h, 'work', 'Abandoned');
    const archiving = await request(h.app)
      .put(`/api/documents/${archived.id}`)
      .send({ status: 'archived' });
    expect(archiving.status).toBe(200);

    const note = await createDoc(h, 'work', 'A note', { type: 'note' });

    await createProject(h, 'frozen');
    const frozenTask = await createDoc(h, 'frozen', 'Frozen task');
    expect((await request(h.app).put('/api/projects/frozen').send({ readOnly: true })).status).toBe(
      200,
    );

    const cases = [
      { parent: archived.id, project: 'work' },
      { parent: note.id, project: 'work' },
      { parent: frozenTask.id, project: 'frozen' },
    ];
    for (const [i, c] of cases.entries()) {
      const res = await post(h, c.parent, uuid(200 + i), { id: uuid(20 + i), body: 'no' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('COMMENT_NOT_WRITABLE');
      expect(await exists(h, `${c.project}/tickets/${c.parent}`)).toBe(false);
    }
    expect(count(h, 'operations')).toBe(0);
  });

  it('rejects a missing or invalid key, a missing or invalid id and an empty body with INVALID_COMMAND, writing nothing', async () => {
    const bad: Array<[string | undefined, unknown]> = [
      [undefined, { id: uuid(1), body: 'ok' }],
      ['not-a-uuid', { id: uuid(1), body: 'ok' }],
      [uuid(100), { body: 'ok' }],
      [uuid(100), { id: 'nope', body: 'ok' }],
      [uuid(100), { id: uuid(1) }],
      [uuid(100), { id: uuid(1), body: 42 }],
      [uuid(100), { id: uuid(1), body: '' }],
      [uuid(100), { id: uuid(1), body: ' \n\t\r\n ' }],
    ];
    for (const [key, body] of bad) {
      const res = await post(h, task.id, key, body);
      expect(res.status, JSON.stringify([key, body])).toBe(400);
      expect(res.body.error.code).toBe('INVALID_COMMAND');
    }
    expect(await exists(h, `work/tickets`)).toBe(false);
    expect(count(h, 'operations')).toBe(0);
  });

  it('answers PARENT_NOT_FOUND for an unknown task', async () => {
    const res = await post(h, uuid(999), uuid(100), { id: uuid(1), body: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PARENT_NOT_FOUND');
  });

  it('refuses a comment id that is already taken by another operation', async () => {
    expect((await post(h, task.id, uuid(100), { id: uuid(1), body: 'first' })).status).toBe(201);
    const before = await disk(h, commentRel('work', task.id, uuid(1)));
    const res = await post(h, task.id, uuid(101), { id: uuid(1), body: 'second' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COMMENT_ID_CONFLICT');
    expect(await disk(h, commentRel('work', task.id, uuid(1)))).toBe(before);
    expect(operationRows(h).map((r) => r.operation_id)).toEqual([uuid(100)]);
  });
});

describe('Comment retries', () => {
  let h: Harness;
  let task: DocBody;
  beforeEach(async () => {
    h = await setup();
    await createProject(h, 'work');
    task = await createDoc(h, 'work', 'Retry me');
  });
  afterEach(() => teardown(h));

  it('the same key and input after success returns the original ack and creates no second file', async () => {
    const first = await post(h, task.id, uuid(100), { id: uuid(1), body: 'Once' });
    expect(first.status).toBe(201);
    const bytes = await disk(h, commentRel('work', task.id, uuid(1)));

    const again = await post(h, task.id, uuid(100), { id: uuid(1), body: 'Once' });
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    expect(await disk(h, commentRel('work', task.id, uuid(1)))).toBe(bytes);
    const dir = await fs.readdir(
      path.join(h.dataDir, 'projects', `work/tickets/${task.id}/comments`),
    );
    expect(dir).toEqual([`${uuid(1)}.md`]);
  });

  it('answers a completed retry from its receipt even after the parent was archived', async () => {
    const first = await post(h, task.id, uuid(100), { id: uuid(1), body: 'Once' });
    await request(h.app).put(`/api/documents/${task.id}`).send({ status: 'archived' });
    const again = await post(h, task.id, uuid(100), { id: uuid(1), body: 'Once' });
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
  });

  it('the same key with different input is OPERATION_ID_CONFLICT and writes nothing', async () => {
    await post(h, task.id, uuid(100), { id: uuid(1), body: 'Once' });
    const changedBody = await post(h, task.id, uuid(100), { id: uuid(1), body: 'Once ' });
    const changedId = await post(h, task.id, uuid(100), { id: uuid(2), body: 'Once' });
    for (const res of [changedBody, changedId]) {
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('OPERATION_ID_CONFLICT');
    }
    expect(await exists(h, commentRel('work', task.id, uuid(2)))).toBe(false);
  });

  it('leaves a completed receipt with no body content and no payload', async () => {
    await post(h, task.id, uuid(100), { id: uuid(1), body: 'Secret findings' });
    const rows = operationRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      operation_id: uuid(100),
      command: 'comment.create',
      state: 'completed',
    });
    expect(JSON.stringify(rows[0])).not.toContain('Secret findings');
    expect(count(h, 'operation_payloads')).toBe(0);
    expect(count(h, 'operation_guards')).toBe(0);
  });

  it('concurrent identical requests write one file and return one ack', async () => {
    const results = await Promise.all(
      [0, 1, 2].map(() => post(h, task.id, uuid(100), { id: uuid(1), body: 'Race' })),
    );
    const ok = results.filter((r) => r.status === 201);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    for (const r of ok) expect(r.body).toEqual(ok[0]!.body);
    for (const r of results.filter((x) => x.status !== 201)) {
      expect(r.body.error.code).toBe('OPERATION_IN_PROGRESS');
    }
    const dir = await fs.readdir(
      path.join(h.dataDir, 'projects', `work/tickets/${task.id}/comments`),
    );
    expect(dir).toEqual([`${uuid(1)}.md`]);
  });
});

describe('GET /api/comments/:commentId', () => {
  let h: Harness;
  afterEach(() => teardown(h));

  it('returns identity, parent, current project, body, timestamps, revision and writability', async () => {
    h = await setup();
    await createProject(h, 'work');
    const task = await createDoc(h, 'work', 'Readable');
    const ack = (await post(h, task.id, uuid(100), { id: uuid(1), body: 'Hello\n' })).body as Ack;

    const res = await request(h.app).get(`/api/comments/${uuid(1)}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: uuid(1),
      parent_id: task.id,
      project_id: 'work',
      body: 'Hello\n',
      created_at: expect.stringMatching(ISO),
      updated_at: expect.stringMatching(ISO),
      revision: ack.result_revision,
      writable: true,
    });

    await request(h.app).put(`/api/documents/${task.id}`).send({ status: 'archived' });
    const archived = await request(h.app).get(`/api/comments/${uuid(1)}`);
    expect(archived.body).toMatchObject({ body: 'Hello\n', writable: false });
  });

  it('answers COMMENT_NOT_FOUND for an unknown comment', async () => {
    h = await setup();
    const res = await request(h.app).get(`/api/comments/${uuid(5)}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COMMENT_NOT_FOUND');
  });
});

describe('GET /api/documents/:taskId/comments', () => {
  let h: Harness;
  let task: DocBody;
  beforeEach(async () => {
    h = await setup();
    await createProject(h, 'work');
    task = await createDoc(h, 'work', 'Busy task');
  });
  afterEach(() => teardown(h));

  /** 120 comments, one a minute, seeded on disk and indexed by a Reindex. */
  async function seedMany(n: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const id = uuid(1000 + i);
      const at = new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString();
      await seedComment(h, commentRel('work', task.id, id), {
        id,
        parent: task.id,
        at,
        body: `Comment ${i}`,
      });
      ids.push(id);
    }
    expect((await request(h.app).post('/api/admin/reindex')).status).toBe(200);
    return ids;
  }

  it('returns the newest page oldest first, and the cursor walks older pages', async () => {
    const ids = await seedMany(120);
    const first = await request(h.app).get(`/api/documents/${task.id}/comments`);
    expect(first.status).toBe(200);
    const p1 = first.body as PageBody;
    expect(p1.total).toBe(120);
    expect(p1.comments.map((c) => c.id)).toEqual(ids.slice(70));
    expect(p1.comments[0]).toMatchObject({
      body: 'Comment 70',
      parent_id: task.id,
      writable: true,
    });
    expect(p1.next_cursor).toEqual(expect.any(String));

    const p2 = (
      await request(h.app)
        .get(`/api/documents/${task.id}/comments`)
        .query({ cursor: p1.next_cursor })
    ).body as PageBody;
    expect(p2.comments.map((c) => c.id)).toEqual(ids.slice(20, 70));

    const p3 = (
      await request(h.app)
        .get(`/api/documents/${task.id}/comments`)
        .query({ cursor: p2.next_cursor })
    ).body as PageBody;
    expect(p3.comments.map((c) => c.id)).toEqual(ids.slice(0, 20));
    expect(p3.next_cursor).toBeNull();
  });

  it('orders by created_at then id, and enforces the 200 limit', async () => {
    const at = '2026-10-01T00:00:00.000Z';
    for (const n of [3, 1, 2]) {
      await seedComment(h, commentRel('work', task.id, uuid(n)), {
        id: uuid(n),
        parent: task.id,
        at,
        body: `c${n}`,
      });
    }
    await seedComment(h, commentRel('work', task.id, uuid(9)), {
      id: uuid(9),
      parent: task.id,
      at: '2026-09-01T00:00:00.000Z',
      body: 'earliest',
    });
    await request(h.app).post('/api/admin/reindex');
    const page = (await request(h.app).get(`/api/documents/${task.id}/comments`)).body as PageBody;
    expect(page.comments.map((c) => c.id)).toEqual([uuid(9), uuid(1), uuid(2), uuid(3)]);

    const small = (
      await request(h.app).get(`/api/documents/${task.id}/comments`).query({ limit: 2 })
    ).body as PageBody;
    expect(small.comments.map((c) => c.id)).toEqual([uuid(2), uuid(3)]);

    const max = await request(h.app)
      .get(`/api/documents/${task.id}/comments`)
      .query({ limit: 200 });
    expect(max.status).toBe(200);
    for (const limit of ['201', '0', 'x']) {
      const res = await request(h.app).get(`/api/documents/${task.id}/comments`).query({ limit });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_COMMAND');
    }
    const badCursor = await request(h.app)
      .get(`/api/documents/${task.id}/comments`)
      .query({ cursor: 'garbage' });
    expect(badCursor.status).toBe(400);
  });

  it('lists comments posted through the API, and PARENT_NOT_FOUND for an unknown task', async () => {
    await post(h, task.id, uuid(100), { id: uuid(1), body: 'one' });
    await post(h, task.id, uuid(101), { id: uuid(2), body: 'two' });
    const page = (await request(h.app).get(`/api/documents/${task.id}/comments`)).body as PageBody;
    expect(page.comments.map((c) => c.body)).toEqual(['one', 'two']);
    expect(page).toMatchObject({ total: 2, next_cursor: null });

    const missing = await request(h.app).get(`/api/documents/${uuid(999)}/comments`);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('PARENT_NOT_FOUND');
  });

  function list(query: Record<string, string | number | undefined>) {
    return request(h.app).get(`/api/documents/${task.id}/comments`).query(query);
  }

  it('around a comment returns it with two neighbours either side, and counts both ways', async () => {
    const ids = await seedMany(120);
    const res = await list({ around: ids[10]! });
    expect(res.status).toBe(200);
    const page = res.body as PageBody;
    expect(page.comments.map((c) => c.id)).toEqual(ids.slice(8, 13));
    expect(page).toMatchObject({ total: 120, older_count: 8, newer_count: 107 });
    expect(page.next_cursor).toEqual(expect.any(String));
    expect(page.newer_cursor).toEqual(expect.any(String));

    const older = (await list({ cursor: page.next_cursor! })).body as PageBody;
    expect(older.comments.map((c) => c.id)).toEqual(ids.slice(0, 8));
    expect(older).toMatchObject({ next_cursor: null, older_count: 0, newer_count: 112 });

    const newer = (await list({ after: page.newer_cursor! })).body as PageBody;
    expect(newer.comments.map((c) => c.id)).toEqual(ids.slice(13, 63));
    expect(newer).toMatchObject({ older_count: 13, newer_count: 57 });
    const newest = (await list({ after: newer.newer_cursor! })).body as PageBody;
    expect(newest.comments.map((c) => c.id)).toEqual(ids.slice(63, 113));
    const last = (await list({ after: newest.newer_cursor! })).body as PageBody;
    expect(last.comments.map((c) => c.id)).toEqual(ids.slice(113));
    expect(last).toMatchObject({ newer_cursor: null, newer_count: 0 });
  });

  it('around a comment near either end returns what neighbours exist; limit sets the neighbours', async () => {
    const ids = await seedMany(6);
    const first = (await list({ around: ids[0]! })).body as PageBody;
    expect(first.comments.map((c) => c.id)).toEqual(ids.slice(0, 3));
    expect(first).toMatchObject({ next_cursor: null, older_count: 0, newer_count: 3 });

    const last = (await list({ around: ids[5]! })).body as PageBody;
    expect(last.comments.map((c) => c.id)).toEqual(ids.slice(3));
    expect(last).toMatchObject({ newer_cursor: null, newer_count: 0, older_count: 3 });

    const wide = (await list({ around: ids[3]!, limit: 1 })).body as PageBody;
    expect(wide.comments.map((c) => c.id)).toEqual(ids.slice(2, 5));
  });

  it('the newest page has no newer cursor; an older page has one', async () => {
    await seedMany(60);
    const p1 = (await list({})).body as PageBody;
    expect(p1).toMatchObject({ newer_cursor: null, newer_count: 0, older_count: 10 });
    const p2 = (await list({ cursor: p1.next_cursor! })).body as PageBody;
    expect(p2).toMatchObject({ older_count: 0, newer_count: 50 });
    const back = (await list({ after: p2.newer_cursor! })).body as PageBody;
    expect(back.comments.map((c) => c.id)).toEqual(p1.comments.map((c) => c.id));
  });

  it('around a deleted comment, or one on another task, is COMMENT_NOT_FOUND; mixed paging is refused', async () => {
    const ids = await seedMany(3);
    const other = await createDoc(h, 'work', 'Other task');
    await post(h, other.id, uuid(100), { id: uuid(50), body: 'elsewhere' });

    for (const around of [uuid(51), uuid(50)]) {
      const res = await list({ around });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('COMMENT_NOT_FOUND');
    }
    const page = (await list({ around: ids[1]! })).body as PageBody;
    for (const query of [
      { around: ids[1]!, cursor: page.next_cursor! },
      { after: page.newer_cursor!, cursor: page.next_cursor! },
      { around: 'not-a-uuid' },
      { after: 'garbage' },
    ]) {
      const res = await list(query);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_COMMAND');
    }
  });
});

describe('Comment files stay out of documents', () => {
  let h: Harness;
  afterEach(() => teardown(h));

  it('never show up in document lists, the board, Current work or search, before or after Reload and Reindex', async () => {
    h = await setup();
    await createProject(h, 'work');
    const task = await createDoc(h, 'work', 'Ongoing', { task_state: 'in_progress' });
    await post(h, task.id, uuid(100), { id: uuid(1), body: 'zebracorn finding' });

    const check = async () => {
      const docs = await request(h.app).get('/api/projects/work/documents');
      expect((docs.body as DocBody[]).map((d) => d.id)).toEqual([task.id]);
      const board = await request(h.app).get('/api/projects/work/board');
      expect(JSON.stringify(board.body)).not.toContain(uuid(1));
      const current = await request(h.app).get('/api/current-work');
      expect(JSON.stringify(current.body)).not.toContain(uuid(1));
      const search = await request(h.app).get('/api/search').query({ q: 'zebracorn' });
      expect(JSON.stringify(search.body)).not.toContain('comments/');
      const folders = await request(h.app).get('/api/projects/work/folders');
      expect(JSON.stringify(folders.body)).not.toContain('comments');
    };
    await check();
    expect((await request(h.app).post('/api/projects/work/reload')).status).toBe(200);
    await check();
    expect((await request(h.app).post('/api/admin/reindex')).status).toBe(200);
    await check();
    h.db.close();
    h = await setup({ dataDir: h.dataDir });
    await check();
  });
});

describe('Comment storage folders are reserved', () => {
  let h: Harness;
  afterEach(() => teardown(h));

  it('refuses to create a folder or a document inside tickets/<id>/comments', async () => {
    h = await setup();
    await createProject(h, 'work');
    const folder = await request(h.app)
      .post('/api/projects/work/folders')
      .send({ folder: `tickets/${uuid(1)}/comments` });
    expect(folder.status).toBe(400);
    const doc = await request(h.app)
      .post('/api/projects/work/documents')
      .send({ type: 'note', title: 'Sneaky', folder: `tickets/${uuid(1)}/comments/deeper` });
    expect(doc.status).toBe(400);
    const fine = await request(h.app)
      .post('/api/projects/work/folders')
      .send({ folder: 'tickets' });
    expect(fine.status).toBe(201);
  });
});

describe('Reindex and the comment index', () => {
  let h: Harness;
  afterEach(() => teardown(h));

  it('a fresh database rebuilds the comment index from Markdown', async () => {
    h = await setup();
    await createProject(h, 'work');
    const task = await createDoc(h, 'work', 'Survives a rebuild');
    await post(h, task.id, uuid(100), { id: uuid(1), body: 'first' });
    await post(h, task.id, uuid(101), { id: uuid(2), body: 'second' });
    const before = (await request(h.app).get(`/api/documents/${task.id}/comments`)).body;

    h.db.close();
    h = await setup({ dataDir: h.dataDir });
    const after = await request(h.app).get(`/api/documents/${task.id}/comments`);
    expect(after.status).toBe(200);
    // A rebuilt database rediscovers ordinary projects read-only (spec #58,
    // release gates), so only writability differs.
    const strip = (page: PageBody) => page.comments.map(({ writable: _, ...c }) => c);
    expect(strip(after.body as PageBody)).toEqual(strip(before as PageBody));
    expect((after.body as PageBody).total).toBe(2);
    expect((await request(h.app).get(`/api/comments/${uuid(2)}`)).body.body).toBe('second');
  });

  it('reports malformed, unsupported-version, orphaned and duplicate-id files and leaves them byte-identical', async () => {
    h = await setup();
    await createProject(h, 'work');
    const task = await createDoc(h, 'work', 'Parent');
    const other = await createDoc(h, 'work', 'Other parent');
    const at = '2026-10-01T00:00:00.000Z';

    const good = await seedComment(h, commentRel('work', task.id, uuid(1)), {
      id: uuid(1),
      parent: task.id,
      at,
      body: 'good',
    });
    const files: Record<string, string> = {};
    files[commentRel('work', task.id, uuid(2))] =
      '---\nschema_version: 1\nkind: [unclosed\n---\nbad';
    files[commentRel('work', task.id, uuid(3))] = good
      .replace('schema_version: 1', 'schema_version: 2')
      .replaceAll(uuid(1), uuid(3));
    files[commentRel('work', uuid(777), uuid(4))] = good
      .replaceAll(task.id, uuid(777))
      .replaceAll(uuid(1), uuid(4));
    files[commentRel('work', other.id, uuid(1))] = good.replaceAll(task.id, other.id);
    files[commentRel('work', task.id, uuid(5))] = good; // id does not match its filename
    for (const [rel, text] of Object.entries(files)) await writeRaw(h, rel, text);

    const res = await request(h.app).post('/api/admin/reindex');
    expect(res.status).toBe(200);
    const problems = (res.body.comments.problems as Array<{ path: string; reason: string }>)
      .map((p) => [p.path, p.reason])
      .sort();
    expect(problems).toEqual(
      [
        [commentRel('work', task.id, uuid(2)), 'malformed'],
        [commentRel('work', task.id, uuid(3)), 'unsupported_schema_version'],
        [commentRel('work', uuid(777), uuid(4)), 'missing_parent'],
        [commentRel('work', task.id, uuid(5)), 'malformed'],
        [
          [commentRel('work', task.id, uuid(1)), commentRel('work', other.id, uuid(1))].sort()[1]!,
          'duplicate_id',
        ],
      ].sort(),
    );
    expect(res.body.comments.indexed).toBe(1);

    expect(await disk(h, commentRel('work', task.id, uuid(1)))).toBe(good);
    for (const [rel, text] of Object.entries(files)) expect(await disk(h, rel)).toBe(text);

    const docs = await request(h.app).get('/api/projects/work/documents');
    expect((docs.body as DocBody[]).map((d) => d.id).sort()).toEqual([task.id, other.id].sort());

    const reload = await request(h.app).post('/api/projects/work/reload');
    expect(reload.status).toBe(200);
    expect(reload.body.comments.problems).toHaveLength(5);
  });
});

function put(
  h: Harness,
  commentId: string,
  key: string | undefined,
  ifMatch: string | undefined,
  body: unknown,
) {
  const req = request(h.app).put(`/api/comments/${commentId}`);
  if (key !== undefined) req.set('Idempotency-Key', key);
  if (ifMatch !== undefined) req.set('If-Match', ifMatch);
  return req.send(body as object);
}

function del(h: Harness, commentId: string, key: string | undefined, ifMatch: string | undefined) {
  const req = request(h.app).delete(`/api/comments/${commentId}`);
  if (key !== undefined) req.set('Idempotency-Key', key);
  if (ifMatch !== undefined) req.set('If-Match', ifMatch);
  return req.send();
}

async function revisionOf(h: Harness, commentId: string): Promise<string> {
  const res = await request(h.app).get(`/api/comments/${commentId}`);
  expect(res.status).toBe(200);
  return (res.body as CommentBody).revision;
}

/** Make a comment directory unwritable, so the next file change in it fails. */
async function freezeDir(h: Harness, rel: string): Promise<() => Promise<void>> {
  const abs = path.join(h.dataDir, 'projects', path.dirname(rel));
  await fs.chmod(abs, 0o555);
  return () => fs.chmod(abs, 0o755);
}

describe('PUT /api/comments/:commentId', () => {
  let h: Harness;
  let task: DocBody;
  let rel: string;
  beforeEach(async () => {
    h = await setup();
    await createProject(h, 'work');
    task = await createDoc(h, 'work', 'Edit my comments');
    expect((await post(h, task.id, uuid(100), { id: uuid(1), body: 'First draft' })).status).toBe(
      201,
    );
    rel = commentRel('work', task.id, uuid(1));
  });
  afterEach(() => teardown(h));

  it('changes only the body and updated_at, byte-preserving identity, created_at and unknown keys', async () => {
    const original = await disk(h, rel);
    const at = /created_at: '([^']+)'/.exec(original)?.[1] ?? '';
    // An external tool added keys this version does not know, with a comment.
    const withExtras = original.replace(
      `updated_at: '${at}'\n`,
      `updated_at: '${at}'\nx_source: imported # keep me\nx_meta:\n  tags: [a, b]\n`,
    );
    await writeRaw(h, rel, withExtras);
    const taskBefore = await disk(h, task.path);

    const body = 'Second draft\r\n\n```ts\nconst x = 1;\n```\n';
    const res = await put(h, uuid(1), uuid(101), await revisionOf(h, uuid(1)), { body });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      operation_id: uuid(101),
      command: 'comment.edit',
      comment_id: uuid(1),
      parent_id: task.id,
      outcome: 'edited',
      result_revision: expect.any(String),
    });

    const text = await disk(h, rel);
    const updated = /updated_at: '([^']+)'/.exec(text)?.[1] ?? '';
    expect(updated).toMatch(ISO);
    expect(updated >= at).toBe(true);
    expect(text).toBe(
      [
        '---',
        'schema_version: 1',
        'kind: comment',
        `id: ${uuid(1)}`,
        `parent_id: ${task.id}`,
        `created_at: '${at}'`,
        `updated_at: '${updated}'`,
        'x_source: imported # keep me',
        'x_meta:',
        '  tags: [a, b]',
        '---',
        body,
      ].join('\n'),
    );
    expect(await disk(h, task.path)).toBe(taskBefore);

    const read = await request(h.app).get(`/api/comments/${uuid(1)}`);
    expect(read.body).toMatchObject({
      body,
      created_at: at,
      updated_at: updated,
      revision: res.body.result_revision,
    });
    const page = await request(h.app).get(`/api/documents/${task.id}/comments`);
    expect(page.body.comments).toEqual([read.body]);
    expect(count(h, 'operation_payloads')).toBe(0);
    expect(JSON.stringify(operationRows(h))).not.toContain('Second draft');
  });

  it('requires If-Match (428) and refuses a stale one with REVISION_CONFLICT, leaving bytes unchanged', async () => {
    const before = await disk(h, rel);
    const current = await revisionOf(h, uuid(1));

    const missing = await put(h, uuid(1), uuid(101), undefined, { body: 'x' });
    expect(missing.status).toBe(428);
    expect(missing.body.error.code).toBe('REVISION_REQUIRED');

    const stale = await put(h, uuid(1), uuid(102), 'stale-revision', { body: 'x' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('REVISION_CONFLICT');
    expect(stale.body.error.details).toMatchObject({ currentRevision: current });

    expect(await disk(h, rel)).toBe(before);
    expect(operationRows(h).map((r) => r.operation_id)).toEqual([uuid(100)]);
  });

  it('refuses a file it cannot safely preserve and leaves it byte-identical', async () => {
    const original = await disk(h, rel);
    const at = /created_at: '([^']+)'/.exec(original)?.[1] ?? '';
    const unsafe = [
      // The value continues on the next line.
      original.replace(`updated_at: '${at}'`, `updated_at:\n  '${at}'`),
      // A trailing YAML comment would be lost by rewriting the line.
      original.replace(`updated_at: '${at}'`, `updated_at: '${at}' # by hand`),
      // No longer parses as a comment file at all.
      original.replace('kind: comment', 'kind: [comment'),
    ];
    for (const [i, text] of unsafe.entries()) {
      await writeRaw(h, rel, text);
      const res = await put(h, uuid(1), uuid(110 + i), contentRevision(await disk(h, rel)), {
        body: 'x',
      });
      expect(res.status, text).toBe(409);
      expect(res.body.error.code).toBe('COMMENT_NOT_PRESERVABLE');
      expect(await disk(h, rel)).toBe(text);
    }
    expect(count(h, 'operation_payloads')).toBe(0);
    expect(count(h, 'operation_guards')).toBe(0);
  });

  it('retrying an edit after a later edit returns the original ack without overwriting the newer body', async () => {
    const r0 = await revisionOf(h, uuid(1));
    const first = await put(h, uuid(1), uuid(101), r0, { body: 'Second' });
    expect(first.status).toBe(200);
    const second = await put(h, uuid(1), uuid(102), first.body.result_revision, { body: 'Third' });
    expect(second.status).toBe(200);
    const bytes = await disk(h, rel);

    const retry = await put(h, uuid(1), uuid(101), r0, { body: 'Second' });
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual(first.body);
    expect(await disk(h, rel)).toBe(bytes);
    expect(bytes.endsWith('---\nThird')).toBe(true);

    const reused = await put(h, uuid(1), uuid(101), r0, { body: 'Other' });
    expect(reused.status).toBe(409);
    expect(reused.body.error.code).toBe('OPERATION_ID_CONFLICT');
  });

  it('rejects invalid input with INVALID_COMMAND and unknown comments with COMMENT_NOT_FOUND', async () => {
    const r0 = await revisionOf(h, uuid(1));
    const bad: Array<[string, string | undefined, unknown]> = [
      [uuid(1), undefined, { body: 'ok' }],
      [uuid(1), 'nope', { body: 'ok' }],
      [uuid(1), uuid(101), {}],
      [uuid(1), uuid(101), { body: '  \n' }],
      ['not-a-uuid', uuid(101), { body: 'ok' }],
    ];
    for (const [id, key, body] of bad) {
      const res = await put(h, id, key, r0, body);
      expect(res.status, JSON.stringify([id, key, body])).toBe(400);
      expect(res.body.error.code).toBe('INVALID_COMMAND');
    }
    const unknown = await put(h, uuid(999), uuid(101), r0, { body: 'ok' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('COMMENT_NOT_FOUND');
    expect(operationRows(h)).toHaveLength(1);
  });

  it('keeps the exact intended bytes and before/after revisions while an edit is pending', async () => {
    const r0 = await revisionOf(h, uuid(1));
    const thaw = await freezeDir(h, rel);
    const res = await put(h, uuid(1), uuid(101), r0, { body: 'Pending body' });
    await thaw();
    expect(res.status).toBe(500);

    const op = operationRows(h).find((r) => r.operation_id === uuid(101));
    expect(op).toMatchObject({ command: 'comment.edit', state: 'pending' });
    const { payload } = h.db
      .prepare(`SELECT payload FROM operation_payloads WHERE operation_id = ?`)
      .get(uuid(101)) as { payload: string };
    const pending = JSON.parse(payload) as {
      path: string;
      before: string;
      content: string;
      after: string;
    };
    expect(pending.path).toBe(rel);
    expect(pending.before).toBe(r0);
    expect(pending.content.endsWith('---\nPending body')).toBe(true);
    expect(pending.after).toBe(contentRevision(pending.content));

    const blocked = await put(h, uuid(1), uuid(102), r0, { body: 'Other' });
    expect(blocked.body.error.code).toBe('RECOVERY_REQUIRED');
  });
});

describe('DELETE /api/comments/:commentId', () => {
  let h: Harness;
  let task: DocBody;
  let rel: string;
  beforeEach(async () => {
    h = await setup();
    await createProject(h, 'work');
    task = await createDoc(h, 'work', 'Delete my comments');
    expect((await post(h, task.id, uuid(100), { id: uuid(1), body: 'Doomed' })).status).toBe(201);
    rel = commentRel('work', task.id, uuid(1));
  });
  afterEach(() => teardown(h));

  it('removes the file and index row; a retry returns the original ack and resurrects nothing', async () => {
    const taskBefore = await disk(h, task.path);
    const r0 = await revisionOf(h, uuid(1));
    const res = await del(h, uuid(1), uuid(101), r0);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      operation_id: uuid(101),
      command: 'comment.delete',
      comment_id: uuid(1),
      parent_id: task.id,
      outcome: 'deleted',
      result_revision: null,
    });
    expect(await exists(h, rel)).toBe(false);
    expect(count(h, 'comments')).toBe(0);
    expect((await request(h.app).get(`/api/comments/${uuid(1)}`)).status).toBe(404);
    expect(await disk(h, task.path)).toBe(taskBefore);

    const reused = await del(h, uuid(1), uuid(101), 'other-revision');
    expect(reused.status).toBe(409);
    expect(reused.body.error.code).toBe('OPERATION_ID_CONFLICT');
    const sameRetry = await del(h, uuid(1), uuid(101), r0);
    expect(sameRetry.status).toBe(200);
    expect(sameRetry.body).toEqual(res.body);
    expect(await exists(h, rel)).toBe(false);
    expect(count(h, 'comments')).toBe(0);
    expect(count(h, 'operation_payloads')).toBe(0);
    expect(count(h, 'operation_guards')).toBe(0);
  });

  it('requires If-Match (428) and refuses a stale one with REVISION_CONFLICT, keeping the file', async () => {
    const before = await disk(h, rel);
    const missing = await del(h, uuid(1), uuid(101), undefined);
    expect(missing.status).toBe(428);
    expect(missing.body.error.code).toBe('REVISION_REQUIRED');
    const stale = await del(h, uuid(1), uuid(102), 'stale-revision');
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('REVISION_CONFLICT');
    expect(stale.body.error.details).toMatchObject({
      currentRevision: await revisionOf(h, uuid(1)),
    });
    expect(await disk(h, rel)).toBe(before);
    expect(count(h, 'comments')).toBe(1);
  });

  it('keeps only identity, path and expected revision while a delete is pending', async () => {
    const r0 = await revisionOf(h, uuid(1));
    const thaw = await freezeDir(h, rel);
    const res = await del(h, uuid(1), uuid(101), r0);
    await thaw();
    expect(res.status).toBe(500);
    const { payload } = h.db
      .prepare(`SELECT payload FROM operation_payloads WHERE operation_id = ?`)
      .get(uuid(101)) as { payload: string };
    expect(JSON.parse(payload)).toEqual({
      comment_id: uuid(1),
      parent_id: task.id,
      path: rel,
      expected_revision: r0,
    });
    expect(await exists(h, rel)).toBe(true);
  });
});

describe('Comment edit and delete writability', () => {
  let h: Harness;
  afterEach(() => teardown(h));

  it('refuses both on an archived parent and in a read-only project with COMMENT_NOT_WRITABLE', async () => {
    h = await setup();
    await createProject(h, 'work');
    await createProject(h, 'frozen');
    const archived = await createDoc(h, 'work', 'Archived');
    const frozen = await createDoc(h, 'frozen', 'Frozen');
    await post(h, archived.id, uuid(100), { id: uuid(1), body: 'a' });
    await post(h, frozen.id, uuid(101), { id: uuid(2), body: 'b' });
    const revisions = [await revisionOf(h, uuid(1)), await revisionOf(h, uuid(2))];
    expect(
      (await request(h.app).put(`/api/documents/${archived.id}`).send({ status: 'archived' }))
        .status,
    ).toBe(200);
    expect((await request(h.app).put('/api/projects/frozen').send({ readOnly: true })).status).toBe(
      200,
    );

    const rels = [
      commentRel('work', archived.id, uuid(1)),
      commentRel('frozen', frozen.id, uuid(2)),
    ];
    const before = await Promise.all(rels.map((r) => disk(h, r)));
    for (const [i, id] of [uuid(1), uuid(2)].entries()) {
      const edit = await put(h, id, uuid(200 + i), revisions[i], { body: 'no' });
      const remove = await del(h, id, uuid(210 + i), revisions[i]);
      for (const res of [edit, remove]) {
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('COMMENT_NOT_WRITABLE');
      }
    }
    expect(await Promise.all(rels.map((r) => disk(h, r)))).toEqual(before);
    expect(operationRows(h)).toHaveLength(2);
  });

  it('allows both on a Done item', async () => {
    h = await setup();
    await createProject(h, 'work');
    const done = await createDoc(h, 'work', 'Done', { task_state: 'done' });
    await post(h, done.id, uuid(100), { id: uuid(1), body: 'a' });
    const edit = await put(h, uuid(1), uuid(101), await revisionOf(h, uuid(1)), { body: 'b' });
    expect(edit.status).toBe(200);
    const remove = await del(h, uuid(1), uuid(102), edit.body.result_revision);
    expect(remove.status).toBe(200);
  });
});
