import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import request from 'supertest';
import { openDatabase } from './db/database.js';
import { MIGRATIONS_DIR, setup, teardown, type Harness } from './test-support.js';

/**
 * HTTP API tests for the write coordinator (#64, spec #58): the workspace
 * gate, project queues, durable guard rows and the protected operational
 * tables. Real routes over a temp data dir; operational state is asserted on
 * the SQLite tables, content on the Markdown bytes.
 */

const OP = {
  a: '11111111-1111-4111-8111-111111111111',
  b: '22222222-2222-4222-8222-222222222222',
  c: '33333333-3333-4333-8333-333333333333',
} as const;

interface DocBody {
  id: string;
  path: string;
  revision: string;
}

async function createProject(h: Harness, id: string): Promise<void> {
  const res = await request(h.app).post('/api/projects').send({ id, name: id });
  expect(res.status).toBe(201);
}

async function createItem(h: Harness, projectId: string, title: string): Promise<DocBody> {
  const res = await request(h.app)
    .post(`/api/projects/${projectId}/documents`)
    .send({ type: 'backlog_item', title });
  expect(res.status).toBe(201);
  return res.body as DocBody;
}

function readDisk(h: Harness, rel: string): Promise<string> {
  return fs.readFile(path.join(h.dataDir, 'projects', rel), 'utf8');
}

/** A pending operation as a crash leaves it: its row and its guard rows. */
function seedPendingOperation(
  h: Harness,
  operationId: string,
  guards: Array<{ project_id: string; scope: 'project' | 'task' | 'path'; key: string }>,
): void {
  h.db
    .prepare(
      `INSERT INTO operations (operation_id, command, fingerprint, state, created_at)
       VALUES (?, 'comment.edit', 'fp', 'pending', '2026-10-21T00:00:00.000Z')`,
    )
    .run(operationId);
  const insert = h.db.prepare(
    `INSERT INTO operation_guards (operation_id, project_id, scope, key) VALUES (?, ?, ?, ?)`,
  );
  for (const g of guards) insert.run(operationId, g.project_id, g.scope, g.key);
}

function expectRecoveryRequired(res: request.Response, operationId: string): void {
  expect(res.status).toBe(409);
  expect(res.body.error).toMatchObject({
    code: 'RECOVERY_REQUIRED',
    details: { operationId, inspect: `/api/recovery/${operationId}` },
  });
}

describe('Durable guards', () => {
  let h: Harness;
  let guarded: DocBody;
  let other: DocBody;
  beforeEach(async () => {
    h = await setup();
    await createProject(h, 'work');
    guarded = await createItem(h, 'work', 'Guarded');
    other = await createItem(h, 'work', 'Unrelated');
    seedPendingOperation(h, OP.a, [{ project_id: 'work', scope: 'task', key: guarded.id }]);
  });
  afterEach(() => teardown(h));

  it('a task guard makes update, move and delete fail with RECOVERY_REQUIRED and leaves the file as it was', async () => {
    const before = await readDisk(h, guarded.path);
    const update = await request(h.app).put(`/api/documents/${guarded.id}`).send({ body: 'x' });
    const move = await request(h.app)
      .post(`/api/documents/${guarded.id}/move`)
      .send({ folder: 'notes' });
    const del = await request(h.app).delete(`/api/documents/${guarded.id}`);
    for (const res of [update, move, del]) expectRecoveryRequired(res, OP.a);
    expect(await readDisk(h, guarded.path)).toBe(before);
  });

  it('unrelated tasks in the same project are unaffected', async () => {
    const update = await request(h.app).put(`/api/documents/${other.id}`).send({ body: 'fine' });
    expect(update.status).toBe(200);
    const del = await request(h.app).delete(`/api/documents/${other.id}`);
    expect(del.status).toBe(204);
  });
});

describe('Durable guards on project settings and deletion', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
    await createProject(h, 'work');
    await createProject(h, 'other');
  });
  afterEach(() => teardown(h));

  it('anything pending in a project blocks readOnly and metadataMode changes and deletion, but not a rename', async () => {
    const item = await createItem(h, 'work', 'Pending here');
    seedPendingOperation(h, OP.a, [{ project_id: 'work', scope: 'task', key: item.id }]);

    for (const change of [
      { readOnly: true },
      { metadataMode: 'sidecar' },
      { name: 'W', readOnly: true },
    ]) {
      expectRecoveryRequired(await request(h.app).put('/api/projects/work').send(change), OP.a);
    }
    expectRecoveryRequired(await request(h.app).delete('/api/projects/work'), OP.a);
    const project = await request(h.app).get('/api/projects/work');
    expect(project.body).toMatchObject({
      name: 'work',
      readOnly: false,
      metadataMode: 'frontmatter',
    });

    const renamed = await request(h.app).put('/api/projects/work').send({ name: 'Work' });
    expect(renamed.status).toBe(200);
    const elsewhere = await request(h.app).put('/api/projects/other').send({ readOnly: true });
    expect(elsewhere.status).toBe(200);
  });

  it('a pending project deletion blocks every setting and every write into the project', async () => {
    seedPendingOperation(h, OP.b, [{ project_id: 'work', scope: 'project', key: 'work' }]);
    expectRecoveryRequired(
      await request(h.app).put('/api/projects/work').send({ name: 'W' }),
      OP.b,
    );
    expectRecoveryRequired(
      await request(h.app).post('/api/projects/work/documents').send({ type: 'note', title: 'No' }),
      OP.b,
    );
    expectRecoveryRequired(
      await request(h.app).post('/api/projects/work/folders').send({ folder: 'more' }),
      OP.b,
    );
    const item = await createItem(h, 'inbox', 'Stay out');
    const filed = await request(h.app)
      .post(`/api/documents/${item.id}/file`)
      .send({ target_project_id: 'work', revision: item.revision });
    expectRecoveryRequired(filed, OP.b);
    expect(await readDisk(h, item.path)).toContain('project: inbox');
  });
});

describe('Durable guards on imports, folders, create and capture', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
    await createProject(h, 'work');
    await createProject(h, 'other');
  });
  afterEach(() => teardown(h));

  function importFiles(projectId: string, onDuplicate: string, content: string) {
    return request(h.app)
      .post(`/api/projects/${projectId}/import`)
      .send({
        placement: { type: 'backlog_item', titleStrategy: 'frontmatter', onDuplicate },
        files: [{ filename: 'item.md', content }],
      });
  }

  function listDir(rel: string): Promise<string[]> {
    return fs.readdir(path.join(h.dataDir, 'projects', rel)).catch(() => []);
  }

  function expectImportRefused(res: request.Response, operationId: string): void {
    expect(res.status).toBe(207);
    expect(res.body.imported).toEqual([]);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ filename: 'item.md', code: 'RECOVERY_REQUIRED' }),
    ]);
    expect(res.body.errors[0].message).toContain(operationId);
  }

  it('an import replacing a guarded task is refused and leaves its bytes; a copy into a guarded path writes nothing', async () => {
    const item = await createItem(h, 'work', 'Guarded import');
    seedPendingOperation(h, OP.a, [
      { project_id: 'work', scope: 'task', key: item.id },
      { project_id: 'work', scope: 'path', key: 'work/backlog' },
    ]);
    const before = await readDisk(h, item.path);
    const backlogBefore = await listDir('work/backlog');
    const exported = `---\nid: ${item.id}\ntitle: Replaced\n---\nNew body\n`;

    expectImportRefused(await importFiles('work', 'replace', exported), OP.a);
    expectImportRefused(await importFiles('work', 'copy', exported), OP.a);
    expect(await readDisk(h, item.path)).toBe(before);
    expect(await listDir('work/backlog')).toEqual(backlogBefore);

    const note = await request(h.app)
      .post('/api/projects/work/documents')
      .send({ type: 'note', title: 'Moved in' });
    const moved = await request(h.app)
      .post(`/api/documents/${note.body.id}/move`)
      .send({ folder: 'backlog' });
    expectRecoveryRequired(moved, OP.a);
    expect(await listDir('work/backlog')).toEqual(backlogBefore);

    const elsewhere = await importFiles('other', 'copy', '---\ntitle: Fine\n---\nBody\n');
    expect(elsewhere.status).toBe(200);
    expect(elsewhere.body.imported).toHaveLength(1);
  });

  it('an import into a project with a pending deletion is refused as a whole', async () => {
    seedPendingOperation(h, OP.b, [{ project_id: 'work', scope: 'project', key: 'work' }]);
    expectRecoveryRequired(await importFiles('work', 'copy', '---\ntitle: No\n---\nBody\n'), OP.b);
    expect(await listDir('work/backlog')).toEqual([]);
  });

  it('a pending project deletion blocks writes out of the project and reuse of its ID', async () => {
    const item = await createItem(h, 'work', 'Stuck in work');
    seedPendingOperation(h, OP.b, [{ project_id: 'work', scope: 'project', key: 'work' }]);
    const before = await readDisk(h, item.path);
    const filed = await request(h.app)
      .post(`/api/documents/${item.id}/file`)
      .send({ target_project_id: 'other', revision: item.revision });
    const deleted = await request(h.app).delete(`/api/documents/${item.id}`);
    for (const res of [filed, deleted]) expectRecoveryRequired(res, OP.b);
    expect(await readDisk(h, item.path)).toBe(before);

    h.db.prepare(`DELETE FROM projects WHERE id = 'work'`).run();
    const reused = await request(h.app).post('/api/projects').send({ id: 'work', name: 'Again' });
    expectRecoveryRequired(reused, OP.b);
  });

  it('a plain create into a guarded folder is refused and writes nothing', async () => {
    seedPendingOperation(h, OP.a, [{ project_id: 'work', scope: 'path', key: 'work/plans' }]);
    const res = await request(h.app)
      .post('/api/projects/work/documents')
      .send({ type: 'note', title: 'Blocked', folder: 'plans' });
    expectRecoveryRequired(res, OP.a);
    expect(await listDir('work/plans')).toEqual([]);
  });

  it('a folder holding a guarded comment path can still be created', async () => {
    const item = await createItem(h, 'work', 'Has a pending comment');
    seedPendingOperation(h, OP.a, [
      { project_id: 'work', scope: 'task', key: item.id },
      { project_id: 'work', scope: 'path', key: `work/tickets/${item.id}/comments/c.md` },
    ]);
    for (const folder of [`tickets/${item.id}`, 'tickets']) {
      const res = await request(h.app).post('/api/projects/work/folders').send({ folder });
      expect(res.status).toBe(201);
    }

    const sibling = await request(h.app)
      .post('/api/projects/work/folders')
      .send({ folder: 'notes/sub' });
    expect(sibling.status).toBe(201);
    const elsewhere = await request(h.app)
      .post('/api/projects/other/folders')
      .send({ folder: `tickets/${item.id}` });
    expect(elsewhere.status).toBe(201);
  });

  it('removing a folder that holds a guarded path is refused', async () => {
    expect(
      (await request(h.app).post('/api/projects/work/folders').send({ folder: 'plans' })).status,
    ).toBe(201);
    seedPendingOperation(h, OP.a, [
      { project_id: 'work', scope: 'path', key: 'work/plans/pending.md' },
    ]);
    expectRecoveryRequired(await request(h.app).delete('/api/projects/work/folders/plans'), OP.a);
    expect(await listDir('work')).toContain('plans');
  });

  it('capture and create reusing the ID or path of a pending task deletion are refused', async () => {
    const id = 'abcdef12-0000-4000-8000-000000000001';
    const captured = await request(h.app)
      .post('/api/capture')
      .send({ id, title: 'Going away', project_id: 'work' });
    expect(captured.status).toBe(201);
    const goneRel = captured.body.path as string;
    expect((await request(h.app).delete(`/api/documents/${id}`)).status).toBe(204);
    seedPendingOperation(h, OP.c, [
      { project_id: 'work', scope: 'task', key: id },
      { project_id: 'work', scope: 'path', key: goneRel },
    ]);

    const sameId = await request(h.app)
      .post('/api/capture')
      .send({ id, title: 'Back again', project_id: 'work' });
    expectRecoveryRequired(sameId, OP.c);
    // A different ID whose file name collides with the guarded path.
    const samePath = await request(h.app).post('/api/capture').send({
      id: 'abcdef12-0000-4000-8000-000000000002',
      title: 'Going away',
      project_id: 'work',
    });
    expectRecoveryRequired(samePath, OP.c);
    expect(await listDir('work/backlog')).toEqual([]);

    const unrelated = await request(h.app)
      .post('/api/capture')
      .send({ id: '99999999-0000-4000-8000-000000000003', title: 'Unrelated', project_id: 'work' });
    expect(unrelated.status).toBe(201);
    const created = await request(h.app)
      .post('/api/projects/work/documents')
      .send({ type: 'note', title: 'Note' });
    expect(created.status).toBe(201);
  });
});

describe('Operational tables are protected', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
  });
  afterEach(() => teardown(h));

  function operationalRows(): unknown[] {
    return [
      'operations',
      'operation_payloads',
      'operation_manifest_entries',
      'operation_guards',
    ].map((table) => h.db.prepare(`SELECT * FROM ${table} ORDER BY 1, 2`).all());
  }

  it('Reload, full Reindex and deleting the task keep receipts, pending rows, payloads, manifests and guards', async () => {
    const done = await createItem(h, 'inbox', 'Has a receipt');
    const pendingFor = await createItem(h, 'inbox', 'Has a pending comment');
    h.db
      .prepare(
        `INSERT INTO operations (operation_id, command, fingerprint, state, outcome, created_at, completed_at)
         VALUES (?, 'comment.create', 'fp-done', 'completed', ?, '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:01.000Z')`,
      )
      .run(OP.b, JSON.stringify({ operation_id: OP.b, parent_id: done.id, outcome: 'created' }));
    seedPendingOperation(h, OP.a, [{ project_id: 'inbox', scope: 'task', key: pendingFor.id }]);
    h.db
      .prepare(`INSERT INTO operation_payloads VALUES (?, ?)`)
      .run(OP.a, '---\nkind: comment\n---\nDraft');
    h.db
      .prepare(`INSERT INTO operation_manifest_entries VALUES (?, ?, 'source', 'abc')`)
      .run(OP.a, pendingFor.path);
    const before = operationalRows();

    expect((await request(h.app).post('/api/projects/inbox/reload')).status).toBe(200);
    expect((await request(h.app).post('/api/admin/reindex')).status).toBe(200);
    expect((await request(h.app).delete(`/api/documents/${done.id}`)).status).toBe(204);

    expect(operationalRows()).toEqual(before);
    expect(operationalRows().every((rows) => (rows as unknown[]).length > 0)).toBe(true);
  });
});

describe('Lock order', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
    await createProject(h, 'work');
  });
  afterEach(() => teardown(h));

  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 50));

  it('two filings across the same projects in opposite directions both complete', async () => {
    const a = await createItem(h, 'inbox', 'Inbox to work');
    const b = await createItem(h, 'work', 'Work to inbox');
    // Hold both queues, then free them together: taken in request order, each
    // filing would get its source queue and wait forever for the other's.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const held = Promise.all(['inbox', 'work'].map((p) => h.ctx.queue.run(p, () => gate)));
    const toWork = request(h.app)
      .post(`/api/documents/${a.id}/file`)
      .send({ target_project_id: 'work', revision: a.revision })
      .then((res) => res);
    const toInbox = request(h.app)
      .post(`/api/documents/${b.id}/file`)
      .send({ target_project_id: 'inbox', revision: b.revision })
      .then((res) => res);
    await settle();
    release();
    await held;

    const [first, second] = await Promise.all([toWork, toInbox]);
    expect(first.status).toBe(200);
    expect(first.body.project_id).toBe('work');
    expect(second.status).toBe(200);
    expect(second.body.project_id).toBe('inbox');
  });

  it('a full Reindex holds the workspace gate exclusively: commands wait for it', async () => {
    const item = await createItem(h, 'inbox', 'Edited after reindex');
    let release!: () => void;
    const blocker = new Promise<void>((r) => (release = r));
    const order: string[] = [];
    const reindex = h.ctx.coordinator.exclusive(async () => {
      await blocker;
      order.push('reindex');
    });
    const edit = request(h.app)
      .put(`/api/documents/${item.id}`)
      .send({ body: 'later' })
      .then((res) => {
        order.push('edit');
        return res;
      });
    await settle();
    expect(order).toEqual([]);
    release();
    await reindex;
    expect((await edit).status).toBe(200);
    expect(order).toEqual(['reindex', 'edit']);
  });
});

describe('Database durability', () => {
  it('opens the database file in WAL mode with synchronous=FULL', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'backlogger-db-'));
    const db = openDatabase({
      file: path.join(dir, 'backlogger.sqlite'),
      migrationsDir: MIGRATIONS_DIR,
    });
    try {
      expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
      // 2 = FULL
      expect(db.pragma('synchronous', { simple: true })).toBe(2);
    } finally {
      db.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
