import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import request from 'supertest';
import { contentRevision } from './fs/index.js';
import { restart, setup, teardown, type Harness } from './test-support.js';

/**
 * Crash recovery, task-scoped guards and the recovery API for comment
 * operations (#67, spec #58). Real routes over a temp data dir; a "crash" is
 * a failure injected at one persisted phase followed by a restart over the
 * same data dir and database. Content is asserted on the Markdown bytes,
 * operation state on the operational tables.
 */

interface DocBody {
  id: string;
  path: string;
  revision: string;
  project_id: string;
}

/** Deterministic UUIDs v4: `uuid(7)` → `00000000-0000-4000-8000-000000000007`. */
function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
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

function post(h: Harness, taskId: string, key: string, body: unknown) {
  return request(h.app)
    .post(`/api/documents/${taskId}/comments`)
    .set('Idempotency-Key', key)
    .send(body as object);
}

function put(h: Harness, commentId: string, key: string, ifMatch: string, body: unknown) {
  return request(h.app)
    .put(`/api/comments/${commentId}`)
    .set('Idempotency-Key', key)
    .set('If-Match', ifMatch)
    .send(body as object);
}

function del(h: Harness, commentId: string, key: string, ifMatch: string) {
  return request(h.app)
    .delete(`/api/comments/${commentId}`)
    .set('Idempotency-Key', key)
    .set('If-Match', ifMatch);
}

function abandon(h: Harness, operationId: string, key: string | undefined, reviewToken: unknown) {
  const req = request(h.app).post(`/api/recovery/${operationId}/abandon`);
  if (key !== undefined) req.set('Idempotency-Key', key);
  return req.send({ review_token: reviewToken });
}

function commentRel(projectId: string, taskId: string, commentId: string): string {
  return `${projectId}/tickets/${taskId}/comments/${commentId}.md`;
}

function abs(h: Harness, rel: string): string {
  return path.join(h.dataDir, 'projects', rel);
}

function disk(h: Harness, rel: string): Promise<string> {
  return fs.readFile(abs(h, rel), 'utf8');
}

async function exists(h: Harness, rel: string): Promise<boolean> {
  return fs
    .stat(abs(h, rel))
    .then(() => true)
    .catch(() => false);
}

function commentDir(h: Harness, taskId: string): Promise<string[]> {
  return fs.readdir(abs(h, `work/tickets/${taskId}/comments`)).catch(() => []);
}

function operation(h: Harness, id: string): { state: string; outcome: string | null } | undefined {
  return h.db.prepare(`SELECT state, outcome FROM operations WHERE operation_id = ?`).get(id) as
    | { state: string; outcome: string | null }
    | undefined;
}

function payload(h: Harness, id: string): string | undefined {
  return (
    h.db.prepare(`SELECT payload FROM operation_payloads WHERE operation_id = ?`).get(id) as
      | { payload: string }
      | undefined
  )?.payload;
}

function count(h: Harness, table: string): number {
  return (h.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

function indexRow(h: Harness, commentId: string): { body: string; revision: string } | undefined {
  return h.db.prepare(`SELECT body, revision FROM comments WHERE id = ?`).get(commentId) as
    | { body: string; revision: string }
    | undefined;
}

type Phase = 'before' | 'after';

/**
 * Make the next call of `method` fail as a crash would: `before` it does its
 * work, or `after` it did it but before the caller could go on.
 */
function crashOn<T extends object>(target: T, method: keyof T & string, phase: Phase): void {
  const original = (target[method] as (...args: unknown[]) => unknown).bind(target);
  vi.spyOn(target, method as never).mockImplementationOnce((async (...args: unknown[]) => {
    if (phase === 'after') await original(...args);
    throw new Error(`injected crash ${phase} ${method}`);
  }) as never);
}

/** The completion transaction fails: everything in it rolls back. */
function crashInCompletion(h: Harness): void {
  vi.spyOn(h.ctx.operationsRepo, 'markCompleted').mockImplementationOnce(() => {
    throw new Error('injected crash in the completion transaction');
  });
}

function expectRecoveryRequired(res: request.Response, operationId: string): void {
  expect(res.status).toBe(409);
  expect(res.body.error).toMatchObject({
    code: 'RECOVERY_REQUIRED',
    details: { operationId, inspect: `/api/recovery/${operationId}` },
  });
}

/** Nothing is left of the operation but its completed receipt. */
function expectSettled(h: Harness, operationId: string): void {
  expect(operation(h, operationId)?.state).toBe('completed');
  expect(count(h, 'operation_payloads')).toBe(0);
  expect(count(h, 'operation_guards')).toBe(0);
}

describe('Comment crash recovery at each persisted phase', () => {
  let h: Harness;
  let task: DocBody;
  beforeEach(async () => {
    h = await setup();
    await createProject(h, 'work');
    task = await createItem(h, 'work', 'Crash me');
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await teardown(h);
  });

  const createPhases: Array<[string, (h: Harness) => void]> = [
    [
      'after the intent, before the file is written',
      (x) => crashOn(x.ctx.fs, 'createNew', 'before'),
    ],
    ['after the file is written', (x) => crashOn(x.ctx.fs, 'createNew', 'after')],
    ['in the completion transaction', (x) => crashInCompletion(x)],
  ];

  for (const [phase, inject] of createPhases) {
    it(`create: a crash ${phase} ends with exactly one file holding the intended bytes`, async () => {
      const rel = commentRel('work', task.id, uuid(1));
      const taskBefore = await disk(h, task.path);
      inject(h);
      const failed = await post(h, task.id, uuid(100), { id: uuid(1), body: 'Survives' });
      expect(failed.status).toBe(500);
      expect(operation(h, uuid(100))?.state).toBe('pending');
      const intended = JSON.parse(payload(h, uuid(100)) ?? '{}') as { content: string };

      h = await restart(h);

      expect(await commentDir(h, task.id)).toEqual([`${uuid(1)}.md`]);
      expect(await disk(h, rel)).toBe(intended.content);
      expect(intended.content.endsWith('---\nSurvives')).toBe(true);
      expect(indexRow(h, uuid(1))).toEqual({
        body: 'Survives',
        revision: contentRevision(intended.content),
      });
      expectSettled(h, uuid(100));
      expect(await disk(h, task.path)).toBe(taskBefore);

      // The lost reply: a retry with the same key gets the acknowledgement.
      const retry = await post(h, task.id, uuid(100), { id: uuid(1), body: 'Survives' });
      expect(retry.status).toBe(201);
      expect(retry.body).toEqual({
        operation_id: uuid(100),
        command: 'comment.create',
        comment_id: uuid(1),
        parent_id: task.id,
        outcome: 'created',
        result_revision: contentRevision(intended.content),
      });
      expect(await commentDir(h, task.id)).toEqual([`${uuid(1)}.md`]);
    });
  }

  it('create: a reply lost after completion is answered from the receipt after a restart, with one file', async () => {
    const first = await post(h, task.id, uuid(100), { id: uuid(1), body: 'Delivered' });
    expect(first.status).toBe(201);
    h = await restart(h);
    const retry = await post(h, task.id, uuid(100), { id: uuid(1), body: 'Delivered' });
    expect(retry.status).toBe(201);
    expect(retry.body).toEqual(first.body);
    expect(await commentDir(h, task.id)).toEqual([`${uuid(1)}.md`]);
  });

  describe('on an existing comment', () => {
    let rel: string;
    let original: string;
    let r0: string;
    beforeEach(async () => {
      expect((await post(h, task.id, uuid(100), { id: uuid(1), body: 'Original' })).status).toBe(
        201,
      );
      rel = commentRel('work', task.id, uuid(1));
      original = await disk(h, rel);
      r0 = contentRevision(original);
    });

    const editPhases: Array<[string, (h: Harness) => void]> = [
      [
        'after the intent, before the file is written',
        (x) => crashOn(x.ctx.fs, 'writeRaw', 'before'),
      ],
      ['after the file is written', (x) => crashOn(x.ctx.fs, 'writeRaw', 'after')],
      ['in the completion transaction', (x) => crashInCompletion(x)],
    ];

    for (const [phase, inject] of editPhases) {
      it(`edit: a crash ${phase} ends with the intended bytes, once`, async () => {
        inject(h);
        const failed = await put(h, uuid(1), uuid(101), r0, { body: 'Edited' });
        expect(failed.status).toBe(500);
        const intended = JSON.parse(payload(h, uuid(101)) ?? '{}') as { content: string };

        h = await restart(h);

        expect(await disk(h, rel)).toBe(intended.content);
        expect(intended.content.endsWith('---\nEdited')).toBe(true);
        expect(indexRow(h, uuid(1))).toEqual({
          body: 'Edited',
          revision: contentRevision(intended.content),
        });
        expectSettled(h, uuid(101));
        const retry = await put(h, uuid(1), uuid(101), r0, { body: 'Edited' });
        expect(retry.status).toBe(200);
        expect(retry.body).toMatchObject({
          operation_id: uuid(101),
          outcome: 'edited',
          result_revision: contentRevision(intended.content),
        });
        expect(await commentDir(h, task.id)).toEqual([`${uuid(1)}.md`]);
      });
    }

    const deletePhases: Array<[string, (h: Harness) => void]> = [
      [
        'after the intent, before the file is removed',
        (x) => crashOn(x.ctx.fs, 'deleteIfUnchanged', 'before'),
      ],
      ['after the file is removed', (x) => crashOn(x.ctx.fs, 'deleteIfUnchanged', 'after')],
      ['in the completion transaction', (x) => crashInCompletion(x)],
    ];

    for (const [phase, inject] of deletePhases) {
      it(`delete: a crash ${phase} ends deleted, and nothing brings the comment back`, async () => {
        inject(h);
        const failed = await del(h, uuid(1), uuid(101), r0);
        expect(failed.status).toBe(500);

        h = await restart(h);

        expect(await exists(h, rel)).toBe(false);
        expect(indexRow(h, uuid(1))).toBeUndefined();
        expectSettled(h, uuid(101));
        const retry = await del(h, uuid(1), uuid(101), r0);
        expect(retry.status).toBe(200);
        expect(retry.body).toMatchObject({ operation_id: uuid(101), outcome: 'deleted' });

        expect((await request(h.app).post('/api/projects/work/reload')).status).toBe(200);
        expect((await request(h.app).post('/api/admin/reindex')).status).toBe(200);
        h = await restart(h);
        expect(await exists(h, rel)).toBe(false);
        expect(indexRow(h, uuid(1))).toBeUndefined();
      });
    }

    it('edit: a file changed externally mid-operation is a conflict that keeps both versions', async () => {
      crashOn(h.ctx.fs, 'writeRaw', 'before');
      expect((await put(h, uuid(1), uuid(101), r0, { body: 'Mine' })).status).toBe(500);
      const pendingBefore = payload(h, uuid(101));
      const external = original.replace('Original', 'Theirs');
      await fs.writeFile(abs(h, rel), external, 'utf8');

      h = await restart(h);

      expect(await disk(h, rel)).toBe(external);
      expect(operation(h, uuid(101))?.state).toBe('pending');
      expect(payload(h, uuid(101))).toBe(pendingBefore);
      const detail = await request(h.app).get(`/api/recovery/${uuid(101)}`);
      expect(detail.status).toBe(200);
      expect(detail.body).toMatchObject({
        operation_id: uuid(101),
        command: 'comment.edit',
        state: 'pending',
        kind: 'content_conflict',
        reason: 'content_changed',
        task_id: task.id,
        comment_id: uuid(1),
        project_id: 'work',
        current_content: external,
        actions: ['recheck', 'abandon'],
        paths: [
          {
            path: rel,
            before_revision: r0,
            after_revision: (JSON.parse(pendingBefore ?? '{}') as { after: string }).after,
            observed_revision: contentRevision(external),
          },
        ],
      });
      expect(detail.body.pending_content).toBe(
        (JSON.parse(pendingBefore ?? '{}') as { content: string }).content,
      );

      // Recheck resumes the original operation and finds the same conflict.
      const recheck = await request(h.app).post(`/api/recovery/${uuid(101)}/recheck`);
      expect(recheck.status).toBe(200);
      expect(recheck.body).toMatchObject({ operation_id: uuid(101), state: 'pending' });
      expect(await disk(h, rel)).toBe(external);
    });

    it('edit: a file gone missing mid-operation is a conflict and is never recreated', async () => {
      crashOn(h.ctx.fs, 'writeRaw', 'before');
      expect((await put(h, uuid(1), uuid(101), r0, { body: 'Mine' })).status).toBe(500);
      await fs.rm(abs(h, rel));

      h = await restart(h);

      expect(await exists(h, rel)).toBe(false);
      expect(operation(h, uuid(101))?.state).toBe('pending');
      expect(payload(h, uuid(101))).toBeDefined();
      const detail = await request(h.app).get(`/api/recovery/${uuid(101)}`);
      expect(detail.body).toMatchObject({
        kind: 'structural',
        reason: 'file_missing',
        current_content: null,
        paths: [
          {
            path: rel,
            before_revision: r0,
            after_revision: expect.any(String),
            observed_revision: null,
          },
        ],
      });
      await request(h.app).post(`/api/recovery/${uuid(101)}/recheck`);
      expect(await exists(h, rel)).toBe(false);
    });

    it('delete: a file changed externally mid-operation is kept and reported', async () => {
      crashOn(h.ctx.fs, 'deleteIfUnchanged', 'before');
      expect((await del(h, uuid(1), uuid(101), r0)).status).toBe(500);
      const external = original.replace('Original', 'Still wanted');
      await fs.writeFile(abs(h, rel), external, 'utf8');

      h = await restart(h);

      expect(await disk(h, rel)).toBe(external);
      expect(operation(h, uuid(101))?.state).toBe('pending');
      const detail = await request(h.app).get(`/api/recovery/${uuid(101)}`);
      expect(detail.body).toMatchObject({
        kind: 'content_conflict',
        reason: 'content_changed',
        pending_content: null,
      });
    });

    it('a missing parent stops recovery and touches nothing', async () => {
      crashOn(h.ctx.fs, 'writeRaw', 'before');
      expect((await put(h, uuid(1), uuid(101), r0, { body: 'Mine' })).status).toBe(500);
      await fs.rm(abs(h, task.path));
      h.db.prepare(`DELETE FROM documents WHERE id = ?`).run(task.id);

      h = await restart(h);

      expect(await disk(h, rel)).toBe(original);
      expect(operation(h, uuid(101))?.state).toBe('pending');
      const detail = await request(h.app).get(`/api/recovery/${uuid(101)}`);
      expect(detail.body).toMatchObject({ kind: 'structural', reason: 'parent_missing' });
    });
  });
});

describe('Recheck', () => {
  let h: Harness;
  let task: DocBody;
  beforeEach(async () => {
    h = await setup();
    await createProject(h, 'work');
    task = await createItem(h, 'work', 'Recheck me');
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await teardown(h);
  });

  it('resumes the original operation without a restart; the retry then gets the ack', async () => {
    crashOn(h.ctx.fs, 'createNew', 'before');
    expect((await post(h, task.id, uuid(100), { id: uuid(1), body: 'Later' })).status).toBe(500);

    const res = await request(h.app).post(`/api/recovery/${uuid(100)}/recheck`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      operation_id: uuid(100),
      state: 'completed',
      acknowledgement: { operation_id: uuid(100), outcome: 'created', comment_id: uuid(1) },
      recovery: null,
    });
    expectSettled(h, uuid(100));
    expect(await commentDir(h, task.id)).toEqual([`${uuid(1)}.md`]);
    const retry = await post(h, task.id, uuid(100), { id: uuid(1), body: 'Later' });
    expect(retry.status).toBe(201);
    expect(retry.body).toEqual(res.body.acknowledgement);
  });

  it('answers 404 RECOVERY_NOT_FOUND for an unknown operation', async () => {
    const res = await request(h.app).post(`/api/recovery/${uuid(999)}/recheck`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('RECOVERY_NOT_FOUND');
    expect((await request(h.app).get(`/api/recovery/${uuid(999)}`)).status).toBe(404);
  });
});

describe('Task-scoped recovery guards', () => {
  let h: Harness;
  let task: DocBody;
  let other: DocBody;
  let r0: string;
  beforeEach(async () => {
    h = await setup();
    await createProject(h, 'work');
    task = await createItem(h, 'work', 'Blocked');
    other = await createItem(h, 'work', 'Unrelated');
    expect((await post(h, task.id, uuid(100), { id: uuid(1), body: 'Existing' })).status).toBe(201);
    expect((await post(h, other.id, uuid(200), { id: uuid(2), body: 'Other' })).status).toBe(201);
    r0 = contentRevision(await disk(h, commentRel('work', task.id, uuid(1))));
    crashOn(h.ctx.fs, 'createNew', 'after');
    expect((await post(h, task.id, uuid(101), { id: uuid(3), body: 'Stuck' })).status).toBe(500);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await teardown(h);
  });

  it('archive, filing, deletion and every comment write on the task answer RECOVERY_REQUIRED', async () => {
    const taskBytes = await disk(h, task.path);
    const archive = await request(h.app)
      .put(`/api/documents/${task.id}`)
      .send({ status: 'archived' });
    const filing = await request(h.app)
      .post(`/api/documents/${task.id}/file`)
      .set('Idempotency-Key', uuid(105))
      .send({ target_project_id: 'inbox', revision: task.revision });
    const deletion = await request(h.app)
      .delete(`/api/documents/${task.id}`)
      .set('Idempotency-Key', randomUUID());
    const create = await post(h, task.id, uuid(102), { id: uuid(4), body: 'More' });
    const edit = await put(h, uuid(1), uuid(103), r0, { body: 'Changed' });
    const remove = await del(h, uuid(1), uuid(104), r0);
    for (const res of [archive, filing, deletion, create, edit, remove]) {
      expectRecoveryRequired(res, uuid(101));
    }
    expect(await disk(h, task.path)).toBe(taskBytes);
    expect((await commentDir(h, task.id)).sort()).toEqual([`${uuid(1)}.md`, `${uuid(3)}.md`]);
  });

  it('reads stay allowed, and an unrelated task in the same project still accepts writes', async () => {
    expect((await request(h.app).get(`/api/documents/${task.id}/comments`)).status).toBe(200);
    expect((await request(h.app).get(`/api/comments/${uuid(1)}`)).status).toBe(200);
    expect((await request(h.app).get(`/api/documents/${task.id}`)).status).toBe(200);

    expect((await post(h, other.id, uuid(201), { id: uuid(5), body: 'Fine' })).status).toBe(201);
    const r2 = contentRevision(await disk(h, commentRel('work', other.id, uuid(2))));
    expect((await put(h, uuid(2), uuid(202), r2, { body: 'Fine too' })).status).toBe(200);
    const archived = await request(h.app)
      .put(`/api/documents/${other.id}`)
      .send({ status: 'archived' });
    expect(archived.status).toBe(200);
  });

  it('the guard stays in force across a restart until recovery finishes the operation', async () => {
    vi.restoreAllMocks();
    // Recovery would finish it at startup; make the file conflict first.
    await fs.writeFile(abs(h, commentRel('work', task.id, uuid(3))), 'not the intended bytes');
    h = await restart(h);
    expectRecoveryRequired(
      await post(h, task.id, uuid(102), { id: uuid(4), body: 'x' }),
      uuid(101),
    );
    expect((await post(h, other.id, uuid(201), { id: uuid(5), body: 'Fine' })).status).toBe(201);
  });
});

describe('Recovery API', () => {
  let h: Harness;
  let task: DocBody;
  let rel: string;
  let original: string;
  beforeEach(async () => {
    h = await setup();
    await createProject(h, 'work');
    task = await createItem(h, 'work', 'Review me');
    expect((await post(h, task.id, uuid(100), { id: uuid(1), body: 'Original' })).status).toBe(201);
    rel = commentRel('work', task.id, uuid(1));
    original = await disk(h, rel);
    crashOn(h.ctx.fs, 'writeRaw', 'before');
    const failed = await put(h, uuid(1), uuid(101), contentRevision(original), {
      body: 'zebracorn pending text',
    });
    expect(failed.status).toBe(500);
    vi.restoreAllMocks();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await teardown(h);
  });

  it('lists pending operations as summaries without bodies', async () => {
    const list = await request(h.app).get('/api/recovery');
    expect(list.status).toBe(200);
    expect(list.body).toEqual({
      operations: [
        {
          operation_id: uuid(101),
          command: 'comment.edit',
          state: 'pending',
          created_at: expect.any(String),
          kind: 'resumable',
          reason: 'interrupted',
          message: expect.any(String),
          project_id: 'work',
          task_id: task.id,
          comment_id: uuid(1),
          in_progress: false,
        },
      ],
    });
    expect(JSON.stringify(list.body)).not.toContain('zebracorn');
    expect(JSON.stringify(list.body)).not.toContain('Original');
  });

  it('the detail carries pending content, current content and a review token', async () => {
    const detail = await request(h.app).get(`/api/recovery/${uuid(101)}`);
    expect(detail.status).toBe(200);
    expect(detail.body.pending_content).toContain('zebracorn pending text');
    expect(detail.body.current_content).toBe(original);
    expect(detail.body.review_token).toEqual(expect.any(String));
    expect(detail.body.actions).toEqual(['recheck', 'abandon']);
    const again = await request(h.app).get(`/api/recovery/${uuid(101)}`);
    expect(again.body.review_token).toBe(detail.body.review_token);
  });

  it('pending payloads never appear in search, lists or ordinary responses', async () => {
    const responses = await Promise.all([
      request(h.app).get('/api/search').query({ q: 'zebracorn' }),
      request(h.app).get(`/api/documents/${task.id}/comments`),
      request(h.app).get(`/api/comments/${uuid(1)}`),
      request(h.app).get(`/api/documents/${task.id}`),
      request(h.app).get('/api/projects/work/documents'),
      request(h.app).get('/api/projects/work/board'),
    ]);
    for (const res of responses) {
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain('zebracorn');
    }
  });

  it('abandon with a stale review token is refused; a fresh one abandons and keeps the Markdown byte-identical', async () => {
    const stale = (await request(h.app).get(`/api/recovery/${uuid(101)}`)).body.review_token;
    const external = original.replace('Original', 'Edited elsewhere');
    await fs.writeFile(abs(h, rel), external, 'utf8');

    const refused = await abandon(h, uuid(101), uuid(300), stale);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('REVISION_CONFLICT');
    expect(operation(h, uuid(101))?.state).toBe('pending');
    expect(payload(h, uuid(101))).toBeDefined();

    const fresh = (await request(h.app).get(`/api/recovery/${uuid(101)}`)).body;
    expect(fresh.review_token).not.toBe(stale);
    expect(fresh.current_content).toBe(external);
    const done = await abandon(h, uuid(101), uuid(301), fresh.review_token);
    expect(done.status).toBe(200);
    expect(done.body).toEqual({
      operation_id: uuid(301),
      command: 'recovery.abandon',
      target_operation_id: uuid(101),
      outcome: 'abandoned',
    });
    expect(await disk(h, rel)).toBe(external);
    expect(operation(h, uuid(101))?.state).toBe('abandoned');
    expect(operation(h, uuid(301))?.state).toBe('completed');
    expect(payload(h, uuid(101))).toBeUndefined();
    expect(count(h, 'operation_guards')).toBe(0);
    expect((await request(h.app).get('/api/recovery')).body.operations).toEqual([]);

    // The abandon itself is retry-safe.
    const again = await abandon(h, uuid(101), uuid(301), fresh.review_token);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(done.body);

    // The original operation stays abandoned, and the task is writable again.
    const retry = await put(h, uuid(1), uuid(101), contentRevision(original), {
      body: 'zebracorn pending text',
    });
    expect(retry.status).toBe(409);
    expect(retry.body.error.code).toBe('OPERATION_ABANDONED');
    expect(await disk(h, rel)).toBe(external);
    h = await restart(h);
    expect(await disk(h, rel)).toBe(external);
    expect(operation(h, uuid(101))?.state).toBe('abandoned');
    const edit = await put(h, uuid(1), uuid(102), contentRevision(external), { body: 'Next' });
    expect(edit.status).toBe(200);
  });

  it('abandon needs its own Idempotency-Key and a review token', async () => {
    const token = (await request(h.app).get(`/api/recovery/${uuid(101)}`)).body.review_token;
    for (const res of [
      await abandon(h, uuid(101), undefined, token),
      await abandon(h, uuid(101), 'nope', token),
      await abandon(h, uuid(101), uuid(300), undefined),
    ]) {
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_COMMAND');
    }
    expect(operation(h, uuid(101))?.state).toBe('pending');
  });

  it('abandon is refused for operations that are not comment operations, and for completed ones', async () => {
    h.db
      .prepare(
        `INSERT INTO operations (operation_id, command, fingerprint, state, created_at)
         VALUES (?, 'task.transfer', 'fp', 'pending', '2026-10-21T00:00:00.000Z')`,
      )
      .run(uuid(400));
    const transfer = await request(h.app).get(`/api/recovery/${uuid(400)}`);
    expect(transfer.status).toBe(200);
    expect(transfer.body.actions).toEqual(['recheck']);
    const refused = await abandon(h, uuid(400), uuid(300), transfer.body.review_token);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('RECOVERY_ACTION_NOT_ALLOWED');
    expect(operation(h, uuid(400))?.state).toBe('pending');

    const completed = await abandon(h, uuid(100), uuid(301), 'whatever');
    expect(completed.status).toBe(409);
    expect(completed.body.error.code).toBe('RECOVERY_ACTION_NOT_ALLOWED');
  });

  it('Reload and Reindex with a pending operation never apply its payload or drop its rows', async () => {
    const before = h.db.prepare(`SELECT * FROM operations ORDER BY operation_id`).all();
    const pending = payload(h, uuid(101));
    expect((await request(h.app).post('/api/projects/work/reload')).status).toBe(200);
    expect((await request(h.app).post('/api/admin/reindex')).status).toBe(200);
    expect(await disk(h, rel)).toBe(original);
    expect(indexRow(h, uuid(1))?.body).toBe('Original');
    expect(payload(h, uuid(101))).toBe(pending);
    expect(h.db.prepare(`SELECT * FROM operations ORDER BY operation_id`).all()).toEqual(before);
    expect(count(h, 'operation_guards')).toBeGreaterThan(0);
  });
});
