import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import request from 'supertest';
import { restart, setup, teardown, type Harness } from './test-support.js';

/**
 * Recoverable filing that carries comments (#72, spec #58 "Filing
 * (transfer)"). Real routes over a temp data dir; a "crash" is a failure
 * injected at one persisted phase or file change, followed by a restart over
 * the same data dir and database. Content is asserted on the Markdown bytes,
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

async function comment(h: Harness, taskId: string, n: number, body: string): Promise<void> {
  const res = await request(h.app)
    .post(`/api/documents/${taskId}/comments`)
    .set('Idempotency-Key', uuid(1000 + n))
    .send({ id: uuid(n), body });
  expect(res.status).toBe(201);
}

function file(h: Harness, taskId: string, key: string | undefined, body: object) {
  const req = request(h.app).post(`/api/documents/${taskId}/file`);
  if (key !== undefined) req.set('Idempotency-Key', key);
  return req.send(body);
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

/** Every file under `<projects>/<rel>`, relative to the projects root, sorted. */
async function tree(h: Harness, rel: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(abs(h, dir), { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const child = `${dir}/${e.name}`;
      if (e.isDirectory()) await walk(child);
      else out.push(child);
    }
  }
  await walk(rel);
  return out.sort();
}

/** Every file's bytes under `<projects>/<rel>`, keyed by path relative to `rel`. */
async function snapshot(h: Harness, rel: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const p of await tree(h, rel)) out[p.slice(rel.length + 1)] = await disk(h, p);
  return out;
}

function operation(h: Harness, id: string): { state: string; outcome: string | null } | undefined {
  return h.db.prepare(`SELECT state, outcome FROM operations WHERE operation_id = ?`).get(id) as
    | { state: string; outcome: string | null }
    | undefined;
}

function count(h: Harness, table: string): number {
  return (h.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

function commentRows(h: Harness, taskId: string): Array<{ project_id: string; path: string }> {
  return h.db
    .prepare(`SELECT project_id, path FROM comments WHERE task_id = ? ORDER BY id`)
    .all(taskId) as Array<{ project_id: string; path: string }>;
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
  expect(count(h, 'operation_manifest_entries')).toBe(0);
}

type Phase = 'before' | 'after';

/**
 * Make the `nth` (1-based) next call of `method` fail as a crash would:
 * `before` it does its work, or `after` it did it but before the caller
 * could go on. Earlier calls run normally.
 */
function crashOn<T extends object>(target: T, method: keyof T & string, nth: number, phase: Phase) {
  const original = (target[method] as (...args: unknown[]) => unknown).bind(target);
  let calls = 0;
  vi.spyOn(target, method as never).mockImplementation((async (...args: unknown[]) => {
    calls += 1;
    if (calls !== nth) return original(...args);
    if (phase === 'after') await original(...args);
    throw new Error(`injected crash ${phase} ${method} #${nth}`);
  }) as never);
}

/** A synchronous operational write fails once, rolling back its transaction. */
function crashInTransaction(h: Harness, method: 'replacePayload' | 'markCompleted'): void {
  vi.spyOn(h.ctx.operationsRepo, method).mockImplementationOnce(() => {
    throw new Error(`injected crash in ${method}`);
  });
}

const KEY = uuid(500);
const C1 = 'First finding.\r\nWith CRLF and trailing space ';
const C2 = '## Decision\n\n- keep the hinge\n- ```\ncode\n```\n';

describe('Filing a commented task', () => {
  let h: Harness;
  let task: DocBody;
  let source: Record<string, string>;

  beforeEach(async () => {
    h = await setup();
    await createProject(h, 'work');
    task = await createItem(h, 'inbox', 'Fix the gate');
    await comment(h, task.id, 1, C1);
    await comment(h, task.id, 2, C2);
    task = (await request(h.app).get(`/api/documents/${task.id}`)).body as DocBody;
    source = await snapshot(h, 'inbox');
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await teardown(h);
  });

  /** The completed transfer: every byte at the target, nothing at the source. */
  async function expectFiled(): Promise<void> {
    const target = await snapshot(h, 'work');
    const expected: Record<string, string> = {};
    for (const [rel, bytes] of Object.entries(source)) {
      expected[rel] = rel.startsWith('tickets/')
        ? bytes
        : bytes.replace('project: inbox\n', 'project: work\n');
    }
    expect(target).toEqual(expected);
    expect(await tree(h, 'inbox')).toEqual([]);
    expect(await exists(h, `inbox/tickets/${task.id}`)).toBe(false);

    const doc = await request(h.app).get(`/api/documents/${task.id}`);
    expect(doc.body).toMatchObject({ project_id: 'work', path: `work/${task.path.slice(6)}` });
    expect(commentRows(h, task.id)).toEqual([
      { project_id: 'work', path: `work/tickets/${task.id}/comments/${uuid(1)}.md` },
      { project_id: 'work', path: `work/tickets/${task.id}/comments/${uuid(2)}.md` },
    ]);
    const list = await request(h.app).get(`/api/documents/${task.id}/comments`);
    expect(list.body.comments.map((c: { body: string }) => c.body)).toEqual([C1, C2]);
    expect(list.body.comments.every((c: { project_id: string }) => c.project_id === 'work')).toBe(
      true,
    );
  }

  it('moves every comment byte for byte, changes only the project line, and returns an ack', async () => {
    const res = await file(h, task.id, KEY, { target_project_id: 'work', revision: task.revision });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const doc = await request(h.app).get(`/api/documents/${task.id}`);
    expect(res.body).toEqual({
      operation_id: KEY,
      command: 'document.file',
      document_id: task.id,
      source_project_id: 'inbox',
      target_project_id: 'work',
      outcome: 'filed',
      result_revision: doc.body.revision,
    });
    await expectFiled();
    expectSettled(h, KEY);

    // A comment written after filing lands with the task.
    const later = await request(h.app)
      .post(`/api/documents/${task.id}/comments`)
      .set('Idempotency-Key', uuid(600))
      .send({ id: uuid(3), body: 'After the move' });
    expect(later.status).toBe(201);
    expect(await exists(h, `work/tickets/${task.id}/comments/${uuid(3)}.md`)).toBe(true);
  });

  it('a missing or invalid Idempotency-Key is 400 INVALID_COMMAND with nothing changed', async () => {
    for (const key of [undefined, 'not-a-uuid']) {
      const res = await file(h, task.id, key, {
        target_project_id: 'work',
        revision: task.revision,
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_COMMAND');
    }
    expect(await snapshot(h, 'inbox')).toEqual(source);
    expect(await tree(h, 'work')).toEqual([]);
    expect(count(h, 'operations')).toBe(2);
  });

  it('the same key retried after success returns the original ack; different input is OPERATION_ID_CONFLICT', async () => {
    const first = await file(h, task.id, KEY, {
      target_project_id: 'work',
      revision: task.revision,
    });
    expect(first.status).toBe(200);
    await request(h.app).put(`/api/documents/${task.id}`).send({ body: 'Edited after filing' });

    const again = await file(h, task.id, KEY, {
      target_project_id: 'work',
      revision: task.revision,
    });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);

    const other = await file(h, task.id, KEY, {
      target_project_id: 'inbox',
      revision: task.revision,
    });
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe('OPERATION_ID_CONFLICT');
  });

  it('filing into the project it is already in changes nothing and acknowledges', async () => {
    const res = await file(h, task.id, KEY, { target_project_id: 'inbox', revision: 'stale' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ outcome: 'already_filed', target_project_id: 'inbox' });
    expect(await snapshot(h, 'inbox')).toEqual(source);
  });

  const blockers: Array<[string, (dir: string) => Promise<void>]> = [
    ['an unknown file', (dir) => fs.writeFile(path.join(dir, 'notes.txt'), 'stray')],
    [
      'a malformed comment',
      (dir) => fs.writeFile(path.join(dir, `${uuid(9)}.md`), '---\nkind: comment\n---\nNo schema'),
    ],
    ['a subdirectory', (dir) => fs.mkdir(path.join(dir, 'nested'))],
  ];
  for (const [what, plant] of blockers) {
    it(`${what} in the comment directory blocks filing with nothing moved`, async () => {
      await plant(abs(h, `inbox/tickets/${task.id}/comments`));
      const before = await snapshot(h, 'inbox');
      const res = await file(h, task.id, KEY, {
        target_project_id: 'work',
        revision: task.revision,
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('COMMENTS_NOT_TRANSFERABLE');
      expect(res.body.error.details.paths[0]).toContain(`inbox/tickets/${task.id}/comments/`);
      expect(await snapshot(h, 'inbox')).toEqual(before);
      expect(await tree(h, 'work')).toEqual([]);
      expect(operation(h, KEY)).toBeUndefined();
    });
  }

  it('an unexpected file at the destination is never overwritten', async () => {
    const squatter = `work/tickets/${task.id}/comments/${uuid(1)}.md`;
    await fs.mkdir(path.dirname(abs(h, squatter)), { recursive: true });
    await fs.writeFile(abs(h, squatter), 'squatter');
    const res = await file(h, task.id, KEY, { target_project_id: 'work', revision: task.revision });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TARGET_PATH_TAKEN');
    expect(await disk(h, squatter)).toBe('squatter');
    expect(await snapshot(h, 'inbox')).toEqual(source);
  });

  // Each persisted phase and file change of a transfer with two comments:
  // three copies (task, then comments), the checkpoint, three source
  // removals, the emptied directories, and the completion transaction.
  const phases: Array<[string, (h: Harness) => void]> = [
    ['before the first copy', (x) => crashOn(x.ctx.fs, 'createNew', 1, 'before')],
    ['after the task copy', (x) => crashOn(x.ctx.fs, 'createNew', 1, 'after')],
    ['after the first comment copy', (x) => crashOn(x.ctx.fs, 'createNew', 2, 'after')],
    ['after the last copy', (x) => crashOn(x.ctx.fs, 'createNew', 3, 'after')],
    ['in the checkpoint transaction', (x) => crashInTransaction(x, 'replacePayload')],
    ['before the first source removal', (x) => crashOn(x.ctx.fs, 'deleteIfUnchanged', 1, 'before')],
    ['after the first source removal', (x) => crashOn(x.ctx.fs, 'deleteIfUnchanged', 1, 'after')],
    ['after the last source removal', (x) => crashOn(x.ctx.fs, 'deleteIfUnchanged', 3, 'after')],
    ['while removing emptied folders', (x) => crashOn(x.ctx.fs, 'removeEmptyDir', 1, 'after')],
    ['in the completion transaction', (x) => crashInTransaction(x, 'markCompleted')],
  ];
  for (const [phase, inject] of phases) {
    it(`a crash ${phase} completes forward on restart with a complete, duplicate-free set`, async () => {
      inject(h);
      const failed = await file(h, task.id, KEY, {
        target_project_id: 'work',
        revision: task.revision,
      });
      expect(failed.status).toBe(500);
      expect(operation(h, KEY)?.state).toBe('pending');
      vi.restoreAllMocks();

      h = await restart(h);

      await expectFiled();
      expectSettled(h, KEY);
      // The lost reply: a retry with the same key gets the acknowledgement.
      const retry = await file(h, task.id, KEY, {
        target_project_id: 'work',
        revision: task.revision,
      });
      expect(retry.status).toBe(200);
      expect(retry.body).toMatchObject({ operation_id: KEY, outcome: 'filed' });
    });
  }

  it('a temp file a killed copy left behind does not stop recovery, and is removed', async () => {
    crashOn(h.ctx.fs, 'createNew', 2, 'before');
    expect(
      (await file(h, task.id, KEY, { target_project_id: 'work', revision: task.revision })).status,
    ).toBe(500);
    vi.restoreAllMocks();
    // What a process killed between the temp write and the link leaves.
    const leftover = `work/tickets/${task.id}/comments/${uuid(1)}.md.tmp.4242.0123456789ab`;
    await fs.mkdir(path.dirname(abs(h, leftover)), { recursive: true });
    await fs.writeFile(abs(h, leftover), 'partial');

    h = await restart(h);

    await expectFiled();
    expectSettled(h, KEY);
  });

  it('recheck finishes a stopped transfer, which offers only inspect and recheck; abandon is refused', async () => {
    crashOn(h.ctx.fs, 'deleteIfUnchanged', 1, 'before');
    expect(
      (await file(h, task.id, KEY, { target_project_id: 'work', revision: task.revision })).status,
    ).toBe(500);
    vi.restoreAllMocks();

    const detail = await request(h.app).get(`/api/recovery/${KEY}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      command: 'document.file',
      kind: 'resumable',
      task_id: task.id,
      project_id: 'inbox',
      actions: ['recheck'],
    });
    expect(detail.body.paths).toContainEqual({
      path: `work/tickets/${task.id}/comments/${uuid(1)}.md`,
      before_revision: null,
      after_revision: expect.any(String),
      observed_revision: expect.any(String),
    });

    const abandoned = await request(h.app)
      .post(`/api/recovery/${KEY}/abandon`)
      .set('Idempotency-Key', uuid(501))
      .send({ review_token: detail.body.review_token });
    expect(abandoned.status).toBe(409);
    expect(abandoned.body.error.code).toBe('RECOVERY_ACTION_NOT_ALLOWED');

    const recheck = await request(h.app).post(`/api/recovery/${KEY}/recheck`);
    expect(recheck.body).toMatchObject({
      state: 'completed',
      acknowledgement: { outcome: 'filed' },
    });
    await expectFiled();
    expectSettled(h, KEY);
  });

  it('while pending, the task and its comments are blocked; unrelated tasks in both projects stay writable', async () => {
    const inboxOther = await createItem(h, 'inbox', 'Unrelated in inbox');
    const workOther = await createItem(h, 'work', 'Unrelated in work');
    crashOn(h.ctx.fs, 'createNew', 2, 'after');
    expect(
      (await file(h, task.id, KEY, { target_project_id: 'work', revision: task.revision })).status,
    ).toBe(500);
    vi.restoreAllMocks();

    const blocked = [
      await request(h.app).put(`/api/documents/${task.id}`).send({ body: 'x' }),
      await request(h.app).put(`/api/documents/${task.id}`).send({ status: 'archived' }),
      await request(h.app).delete(`/api/documents/${task.id}`),
      await file(h, task.id, uuid(502), { target_project_id: 'work', revision: task.revision }),
      await request(h.app)
        .post(`/api/documents/${task.id}/comments`)
        .set('Idempotency-Key', uuid(503))
        .send({ id: uuid(5), body: 'Blocked' }),
    ];
    for (const res of blocked) expectRecoveryRequired(res, KEY);

    for (const other of [inboxOther, workOther]) {
      const edited = await request(h.app).put(`/api/documents/${other.id}`).send({ body: 'Fine' });
      expect(edited.status).toBe(200);
      const commented = await request(h.app)
        .post(`/api/documents/${other.id}/comments`)
        .set('Idempotency-Key', other === inboxOther ? uuid(504) : uuid(505))
        .send({ id: other === inboxOther ? uuid(6) : uuid(7), body: 'Fine' });
      expect(commented.status).toBe(201);
    }
    // Reads stay allowed.
    expect((await request(h.app).get(`/api/documents/${task.id}/comments`)).status).toBe(200);
  });

  it('a source comment changed mid-transfer stops recovery as a conflict; nothing is overwritten or deleted', async () => {
    crashOn(h.ctx.fs, 'deleteIfUnchanged', 1, 'after');
    expect(
      (await file(h, task.id, KEY, { target_project_id: 'work', revision: task.revision })).status,
    ).toBe(500);
    vi.restoreAllMocks();
    const changed = `inbox/tickets/${task.id}/comments/${uuid(2)}.md`;
    await fs.writeFile(abs(h, changed), `${source[changed.slice(6)]}\nEdited by hand`);
    const before = { inbox: await snapshot(h, 'inbox'), work: await snapshot(h, 'work') };

    h = await restart(h);

    expect(operation(h, KEY)?.state).toBe('pending');
    expect({ inbox: await snapshot(h, 'inbox'), work: await snapshot(h, 'work') }).toEqual(before);
    const detail = await request(h.app).get(`/api/recovery/${KEY}`);
    expect(detail.body).toMatchObject({ kind: 'content_conflict', reason: 'content_changed' });
    const recheck = await request(h.app).post(`/api/recovery/${KEY}/recheck`);
    expect(recheck.body.state).toBe('pending');
    expect({ inbox: await snapshot(h, 'inbox'), work: await snapshot(h, 'work') }).toEqual(before);
  });

  it('a source comment changed before the checkpoint also stops, keeping both copies', async () => {
    crashInTransaction(h, 'replacePayload');
    expect(
      (await file(h, task.id, KEY, { target_project_id: 'work', revision: task.revision })).status,
    ).toBe(500);
    vi.restoreAllMocks();
    const changed = `inbox/tickets/${task.id}/comments/${uuid(1)}.md`;
    await fs.writeFile(abs(h, changed), 'changed');
    const before = { inbox: await snapshot(h, 'inbox'), work: await snapshot(h, 'work') };

    h = await restart(h);

    expect(operation(h, KEY)?.state).toBe('pending');
    expect({ inbox: await snapshot(h, 'inbox'), work: await snapshot(h, 'work') }).toEqual(before);
    const detail = await request(h.app).get(`/api/recovery/${KEY}`);
    expect(detail.body).toMatchObject({ kind: 'content_conflict', reason: 'content_changed' });
  });

  it('a file added to the source comment directory mid-transfer stops recovery', async () => {
    crashInTransaction(h, 'replacePayload');
    await file(h, task.id, KEY, { target_project_id: 'work', revision: task.revision });
    vi.restoreAllMocks();
    await fs.writeFile(abs(h, `inbox/tickets/${task.id}/comments/extra.txt`), 'added');

    h = await restart(h);

    expect(operation(h, KEY)?.state).toBe('pending');
    expect(await exists(h, `inbox/tickets/${task.id}/comments/extra.txt`)).toBe(true);
    const detail = await request(h.app).get(`/api/recovery/${KEY}`);
    expect(detail.body).toMatchObject({ kind: 'structural', reason: 'unexpected_file' });
  });

  for (const [when, inject] of [
    ['before the checkpoint', (x: Harness) => crashInTransaction(x, 'replacePayload')],
    ['after the checkpoint', (x: Harness) => crashOn(x.ctx.fs, 'deleteIfUnchanged', 2, 'before')],
  ] as const) {
    it(`Reload and Reindex during a pending transfer (${when}) pick no duplicate winner`, async () => {
      inject(h);
      expect(
        (await file(h, task.id, KEY, { target_project_id: 'work', revision: task.revision }))
          .status,
      ).toBe(500);
      vi.restoreAllMocks();

      for (const run of [
        () => request(h.app).post('/api/projects/inbox/reload'),
        () => request(h.app).post('/api/projects/work/reload'),
        () => request(h.app).post('/api/admin/reindex'),
        () => request(h.app).post('/api/projects/work/reload'),
        () => request(h.app).post('/api/projects/inbox/reload'),
      ]) {
        const report = await run();
        expect(report.status).toBe(200);
        expect(report.body.duplicates).toEqual([]);
        expect(report.body.comments.problems).toEqual([]);
        const doc = await request(h.app).get(`/api/documents/${task.id}`);
        expect(doc.status).toBe(200);
        expect(commentRows(h, task.id)).toHaveLength(2);
        const hits = await request(h.app).get('/api/search').query({ q: 'gate' });
        expect(hits.body.filter((r: { id: string }) => r.id === task.id)).toHaveLength(1);
      }
      expect(operation(h, KEY)?.state).toBe('pending');

      const recheck = await request(h.app).post(`/api/recovery/${KEY}/recheck`);
      expect(recheck.body.state).toBe('completed');
      await expectFiled();
    });
  }
});

describe('Archiving a commented task', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
  });
  afterEach(() => teardown(h));

  it('archive then restore leaves comment files in place', async () => {
    const task = await createItem(h, 'inbox', 'Keep my history');
    await comment(h, task.id, 1, 'Finding');
    const before = await snapshot(h, `inbox/tickets/${task.id}`);

    const archived = await request(h.app)
      .put(`/api/documents/${task.id}`)
      .send({ status: 'archived' });
    expect(archived.status).toBe(200);
    expect(await snapshot(h, `inbox/tickets/${task.id}`)).toEqual(before);

    const restored = await request(h.app)
      .put(`/api/documents/${task.id}`)
      .send({ status: 'active' });
    expect(restored.status).toBe(200);
    expect(await snapshot(h, `inbox/tickets/${task.id}`)).toEqual(before);
    const list = await request(h.app).get(`/api/documents/${task.id}/comments`);
    expect(list.body.comments.map((c: { body: string }) => c.body)).toEqual(['Finding']);
  });
});
