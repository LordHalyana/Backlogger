import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import request from 'supertest';
import { restart, setup, teardown, type Harness } from './test-support.js';

/**
 * Resumable permanent deletion of tasks and projects with their comments
 * (#73, spec #58 "Permanent deletion"). Real routes over a temp data dir; a
 * "crash" is a failure injected at one file removal or transaction, followed
 * by a restart over the same data dir and database. Content is asserted on
 * the bytes on disk, operation state on the operational tables.
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

async function createItem(
  h: Harness,
  projectId: string,
  title: string,
  extra: object = {},
): Promise<DocBody> {
  const res = await request(h.app)
    .post(`/api/projects/${projectId}/documents`)
    .send({ type: 'backlog_item', title, ...extra });
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

function deleteDoc(h: Harness, id: string, key: string | undefined) {
  const req = request(h.app).delete(`/api/documents/${id}`);
  if (key !== undefined) req.set('Idempotency-Key', key);
  return req;
}

function deleteProject(h: Harness, id: string, key: string | undefined) {
  const req = request(h.app).delete(`/api/projects/${id}`);
  if (key !== undefined) req.set('Idempotency-Key', key);
  return req;
}

function abs(h: Harness, rel: string): string {
  return path.join(h.dataDir, 'projects', rel);
}

async function exists(h: Harness, rel: string): Promise<boolean> {
  return fs
    .lstat(abs(h, rel))
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

/** Every file's bytes under `<projects>/<rel>`, keyed by path relative to the projects root. */
async function snapshot(h: Harness, rel: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const p of await tree(h, rel)) {
    const st = await fs.lstat(abs(h, p));
    out[p] = st.isSymbolicLink()
      ? `-> ${await fs.readlink(abs(h, p))}`
      : await fs.readFile(abs(h, p), 'utf8');
  }
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

function rowsWhere(h: Harness, table: string, where: string, arg: string): number {
  return (
    h.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(arg) as { n: number }
  ).n;
}

function expectRecoveryRequired(res: request.Response, operationId: string): void {
  expect(res.status, JSON.stringify(res.body)).toBe(409);
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
function crashInTransaction(h: Harness, method: 'markCompleted'): void {
  vi.spyOn(h.ctx.operationsRepo, method).mockImplementationOnce(() => {
    throw new Error(`injected crash in ${method}`);
  });
}

/**
 * Where a task shows up in ordinary views: the board, lists, Current work,
 * search, the graph, link titles and tag counts (its tag is `term`).
 */
async function visibility(h: Harness, projectId: string, taskId: string, term: string) {
  const board = await request(h.app).get(`/api/projects/${projectId}/board`);
  const cards = board.status === 200 ? Object.values(board.body.columns).flat() : [];
  const list = await request(h.app).get(`/api/projects/${projectId}/documents`);
  const work = await request(h.app).get('/api/current-work');
  const search = await request(h.app).get('/api/search').query({ q: term });
  const graph = await request(h.app).get(`/api/projects/${projectId}/graph`);
  const titles = await request(h.app).get(`/api/projects/${projectId}/titles`);
  const tags = await request(h.app).get('/api/tags');
  return {
    board: (cards as Array<{ id: string }>).some((c) => c.id === taskId),
    list: list.status === 200 && (list.body as Array<{ id: string }>).some((d) => d.id === taskId),
    currentWork: (work.body.groups as Array<{ items: Array<{ id: string }> }>).some((g) =>
      g.items.some((i) => i.id === taskId),
    ),
    search: (search.body as Array<{ id: string }>).some((r) => r.id === taskId),
    graph:
      graph.status === 200 &&
      (graph.body.nodes as Array<{ id: string }>).some((n) => n.id === taskId),
    titles:
      titles.status === 200 && (titles.body as Array<{ id: string }>).some((t) => t.id === taskId),
    tag: (tags.body as Array<{ tag: string }>).some((t) => t.tag === term),
  };
}

const HIDDEN = {
  board: false,
  list: false,
  currentWork: false,
  search: false,
  graph: false,
  titles: false,
  tag: false,
};
const SHOWN = {
  board: true,
  list: true,
  currentWork: true,
  search: true,
  graph: true,
  titles: true,
  tag: true,
};

const KEY = uuid(500);

describe('Permanently deleting a commented task', () => {
  let h: Harness;
  let task: DocBody;
  let other: DocBody;
  let ticketDir: string;

  beforeEach(async () => {
    h = await setup();
    await createProject(h, 'work');
    task = await createItem(h, 'work', 'Quokka gate', {
      task_state: 'in_progress',
      tags: ['quokka'],
    });
    other = await createItem(h, 'work', 'Unrelated');
    await comment(h, task.id, 1, 'First quokka finding');
    await comment(h, task.id, 2, '## Decision\n\n- keep it\n');
    task = (await request(h.app).get(`/api/documents/${task.id}`)).body as DocBody;
    ticketDir = `work/tickets/${task.id}`;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await teardown(h);
  });

  /** The completed deletion: no file, folder or derived row left, the rest untouched. */
  async function expectDeleted(): Promise<void> {
    expect(await exists(h, task.path)).toBe(false);
    expect(await exists(h, ticketDir)).toBe(false);
    expect(await exists(h, other.path)).toBe(true);
    expect((await request(h.app).get(`/api/documents/${task.id}`)).status).toBe(404);
    expect(rowsWhere(h, 'documents', 'id = ?', task.id)).toBe(0);
    expect(rowsWhere(h, 'comments', 'task_id = ?', task.id)).toBe(0);
    expect(rowsWhere(h, 'search_fts', 'document_id = ?', task.id)).toBe(0);
    expect(await visibility(h, 'work', task.id, 'quokka')).toEqual(HIDDEN);
  }

  it('removes the task, all its comments and its emptied folders, and returns an ack', async () => {
    expect(await visibility(h, 'work', task.id, 'quokka')).toEqual(SHOWN);
    const res = await deleteDoc(h, task.id, KEY);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({
      operation_id: KEY,
      command: 'document.delete',
      document_id: task.id,
      project_id: 'work',
      outcome: 'deleted',
      result_revision: null,
    });
    await expectDeleted();
    expectSettled(h, KEY);
  });

  it('a missing or invalid Idempotency-Key is 400 INVALID_COMMAND with nothing removed', async () => {
    const before = await snapshot(h, 'work');
    for (const key of [undefined, 'not-a-uuid']) {
      const res = await deleteDoc(h, task.id, key);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_COMMAND');
    }
    expect(await snapshot(h, 'work')).toEqual(before);
    expect(rowsWhere(h, 'documents', 'id = ?', task.id)).toBe(1);
  });

  it('a retry after success returns the original ack; the key on other input is OPERATION_ID_CONFLICT', async () => {
    const first = await deleteDoc(h, task.id, KEY);
    expect(first.status).toBe(200);
    const again = await deleteDoc(h, task.id, KEY);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    const reused = await deleteDoc(h, other.id, KEY);
    expect(reused.status).toBe(409);
    expect(reused.body.error.code).toBe('OPERATION_ID_CONFLICT');
    expect(await exists(h, other.path)).toBe(true);
  });

  it('an unknown file in the comment directory blocks deletion with nothing removed', async () => {
    await fs.writeFile(abs(h, `${ticketDir}/comments/notes.txt`), 'mine');
    const before = await snapshot(h, 'work');
    const res = await deleteDoc(h, task.id, KEY);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DELETION_BLOCKED');
    expect(res.body.error.details.paths).toEqual([`${ticketDir}/comments/notes.txt`]);
    expect(await snapshot(h, 'work')).toEqual(before);
    expect(operation(h, KEY)).toBeUndefined();
  });

  it('a symlink inside the scope is not followed: deletion is refused and its target kept', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'backlogger-outside-'));
    await fs.writeFile(path.join(outside, 'keep.md'), 'outside');
    await fs.symlink(outside, abs(h, `${ticketDir}/comments/linked`));
    const res = await deleteDoc(h, task.id, KEY);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DELETION_BLOCKED');
    expect(await fs.readFile(path.join(outside, 'keep.md'), 'utf8')).toBe('outside');
    expect(await exists(h, task.path)).toBe(true);
    await fs.rm(outside, { recursive: true, force: true });
  });

  it('a pending transfer of the task blocks its deletion', async () => {
    await createProject(h, 'elsewhere');
    crashOn(h.ctx.fs, 'createNew', 2, 'after');
    const filing = await request(h.app)
      .post(`/api/documents/${task.id}/file`)
      .set('Idempotency-Key', uuid(600))
      .send({ target_project_id: 'elsewhere', revision: task.revision });
    expect(filing.status).toBe(500);
    vi.restoreAllMocks();

    expectRecoveryRequired(await deleteDoc(h, task.id, KEY), uuid(600));
    expect(operation(h, KEY)).toBeUndefined();
    expect(await exists(h, task.path)).toBe(true);
  });

  // Each persisted phase and file change of a deletion with two comments:
  // the comment removals, the task file, the emptied folders and the
  // completion transaction.
  const phases: Array<[string, (h: Harness) => void]> = [
    ['before the first removal', (x) => crashOn(x.ctx.fs, 'deleteIfUnchanged', 1, 'before')],
    ['after the first comment removal', (x) => crashOn(x.ctx.fs, 'deleteIfUnchanged', 1, 'after')],
    ['after the task file removal', (x) => crashOn(x.ctx.fs, 'deleteIfUnchanged', 3, 'after')],
    ['while removing emptied folders', (x) => crashOn(x.ctx.fs, 'removeEmptyDir', 1, 'after')],
    ['in the completion transaction', (x) => crashInTransaction(x, 'markCompleted')],
  ];
  for (const [phase, inject] of phases) {
    it(`a crash ${phase} never resurrects the task; restart finishes the deletion`, async () => {
      inject(h);
      const failed = await deleteDoc(h, task.id, KEY);
      expect(failed.status).toBe(500);
      expect(operation(h, KEY)?.state).toBe('pending');
      vi.restoreAllMocks();

      // Pending deletion wins over indexing.
      for (const run of [
        () => request(h.app).post('/api/projects/work/reload'),
        () => request(h.app).post('/api/admin/reindex'),
      ]) {
        expect((await run()).status).toBe(200);
        expect(await visibility(h, 'work', task.id, 'quokka')).toEqual(HIDDEN);
      }
      const recovery = await request(h.app).get('/api/recovery');
      expect(recovery.body.operations).toMatchObject([
        { operation_id: KEY, command: 'document.delete', task_id: task.id, project_id: 'work' },
      ]);

      h = await restart(h);

      await expectDeleted();
      expectSettled(h, KEY);
      for (const run of [
        () => request(h.app).post('/api/projects/work/reload'),
        () => request(h.app).post('/api/admin/reindex'),
      ]) {
        expect((await run()).status).toBe(200);
        await expectDeleted();
      }
      // The lost reply: a retry with the same key gets the acknowledgement.
      const retry = await deleteDoc(h, task.id, KEY);
      expect(retry.status).toBe(200);
      expect(retry.body).toMatchObject({ operation_id: KEY, outcome: 'deleted' });
    });
  }

  it('while pending, the task and its comments are blocked; unrelated tasks stay writable', async () => {
    crashOn(h.ctx.fs, 'deleteIfUnchanged', 1, 'after');
    expect((await deleteDoc(h, task.id, KEY)).status).toBe(500);
    vi.restoreAllMocks();

    const blocked = [
      await request(h.app).put(`/api/documents/${task.id}`).send({ body: 'x' }),
      await request(h.app)
        .post(`/api/documents/${task.id}/comments`)
        .set('Idempotency-Key', uuid(601))
        .send({ id: uuid(5), body: 'Blocked' }),
      await deleteDoc(h, task.id, uuid(602)),
      await deleteProject(h, 'work', uuid(603)),
    ];
    for (const res of blocked) expectRecoveryRequired(res, KEY);

    const edited = await request(h.app).put(`/api/documents/${other.id}`).send({ body: 'Fine' });
    expect(edited.status).toBe(200);
  });

  it('a file changed mid-deletion is kept and reported; recovery offers only inspect and recheck', async () => {
    crashOn(h.ctx.fs, 'deleteIfUnchanged', 1, 'after');
    expect((await deleteDoc(h, task.id, KEY)).status).toBe(500);
    vi.restoreAllMocks();
    const changed = `${ticketDir}/comments/${uuid(2)}.md`;
    await fs.appendFile(abs(h, changed), '\nEdited by hand\n');
    const before = await snapshot(h, 'work');

    h = await restart(h);

    expect(operation(h, KEY)?.state).toBe('pending');
    expect(await snapshot(h, 'work')).toEqual(before);
    expect(await visibility(h, 'work', task.id, 'quokka')).toEqual(HIDDEN);
    const detail = await request(h.app).get(`/api/recovery/${KEY}`);
    expect(detail.body).toMatchObject({
      command: 'document.delete',
      kind: 'content_conflict',
      reason: 'content_changed',
      task_id: task.id,
      task_title: 'Quokka gate',
      actions: ['recheck'],
    });
    expect(detail.body.paths).toContainEqual({
      path: changed,
      before_revision: expect.any(String),
      after_revision: null,
      observed_revision: expect.any(String),
    });

    const abandoned = await request(h.app)
      .post(`/api/recovery/${KEY}/abandon`)
      .set('Idempotency-Key', uuid(604))
      .send({ review_token: detail.body.review_token });
    expect(abandoned.status).toBe(409);
    expect(abandoned.body.error.code).toBe('RECOVERY_ACTION_NOT_ALLOWED');
    const recheck = await request(h.app).post(`/api/recovery/${KEY}/recheck`);
    expect(recheck.body.state).toBe('pending');
    expect(await snapshot(h, 'work')).toEqual(before);
  });

  it('a file added to the scope mid-deletion is kept and reported; recheck finishes once it is moved out', async () => {
    crashOn(h.ctx.fs, 'deleteIfUnchanged', 1, 'after');
    expect((await deleteDoc(h, task.id, KEY)).status).toBe(500);
    vi.restoreAllMocks();
    const added = `${ticketDir}/comments/${uuid(9)}.md`;
    await fs.writeFile(abs(h, added), 'A new comment written by hand');

    h = await restart(h);

    expect(operation(h, KEY)?.state).toBe('pending');
    expect(await fs.readFile(abs(h, added), 'utf8')).toBe('A new comment written by hand');
    const detail = await request(h.app).get(`/api/recovery/${KEY}`);
    expect(detail.body).toMatchObject({ kind: 'structural', reason: 'unexpected_file' });
    expect(detail.body.paths).toContainEqual({
      path: added,
      before_revision: null,
      after_revision: null,
      observed_revision: expect.any(String),
    });

    await fs.rm(abs(h, added));
    const recheck = await request(h.app).post(`/api/recovery/${KEY}/recheck`);
    expect(recheck.body).toMatchObject({
      state: 'completed',
      acknowledgement: { outcome: 'deleted', document_id: task.id },
    });
    await expectDeleted();
    expectSettled(h, KEY);
  });

  it('a symlink placed in the scope mid-deletion is not followed and stops recovery', async () => {
    crashOn(h.ctx.fs, 'deleteIfUnchanged', 1, 'after');
    expect((await deleteDoc(h, task.id, KEY)).status).toBe(500);
    vi.restoreAllMocks();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'backlogger-outside-'));
    await fs.writeFile(path.join(outside, 'keep.md'), 'outside');
    await fs.symlink(outside, abs(h, `${ticketDir}/comments/linked`));

    h = await restart(h);

    expect(operation(h, KEY)?.state).toBe('pending');
    expect(await fs.readFile(path.join(outside, 'keep.md'), 'utf8')).toBe('outside');
    expect(await exists(h, `${ticketDir}/comments/linked`)).toBe(true);
    const detail = await request(h.app).get(`/api/recovery/${KEY}`);
    expect(detail.body).toMatchObject({ kind: 'structural', reason: 'unexpected_file' });
    await fs.rm(outside, { recursive: true, force: true });
  });

  it('a ticket folder replaced by a symlink mid-deletion is not followed and stops recovery', async () => {
    crashOn(h.ctx.fs, 'deleteIfUnchanged', 1, 'after');
    expect((await deleteDoc(h, task.id, KEY)).status).toBe(500);
    vi.restoreAllMocks();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'backlogger-outside-'));
    await fs.rename(abs(h, ticketDir), path.join(outside, 'moved'));
    await fs.symlink(path.join(outside, 'moved'), abs(h, ticketDir));

    h = await restart(h);

    expect(operation(h, KEY)?.state).toBe('pending');
    const detail = await request(h.app).get(`/api/recovery/${KEY}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ kind: 'structural', reason: 'unexpected_file' });
    const recheck = await request(h.app).post(`/api/recovery/${KEY}/recheck`);
    expect(recheck.body.state).toBe('pending');
    expect(await fs.readdir(path.join(outside, 'moved', 'comments'))).toHaveLength(1);
    await fs.rm(outside, { recursive: true, force: true });
  });

  it('an orphaned comment found by Reindex is kept and reported', async () => {
    const orphanDir = abs(h, `work/tickets/${uuid(77)}/comments`);
    await fs.mkdir(orphanDir, { recursive: true });
    const orphan = (await fs.readFile(abs(h, `${ticketDir}/comments/${uuid(1)}.md`), 'utf8'))
      .replace(`id: ${uuid(1)}`, `id: ${uuid(78)}`)
      .replace(`parent_id: ${task.id}`, `parent_id: ${uuid(77)}`);
    await fs.writeFile(path.join(orphanDir, `${uuid(78)}.md`), orphan);

    const report = await request(h.app).post('/api/admin/reindex');
    expect(report.body.comments.problems).toContainEqual(
      expect.objectContaining({
        path: `work/tickets/${uuid(77)}/comments/${uuid(78)}.md`,
        reason: 'missing_parent',
      }),
    );
    expect(await fs.readFile(path.join(orphanDir, `${uuid(78)}.md`), 'utf8')).toBe(orphan);
  });
});

describe('Permanently deleting a project', () => {
  let h: Harness;
  let task: DocBody;

  beforeEach(async () => {
    h = await setup();
    await createProject(h, 'work');
    task = await createItem(h, 'work', 'Wombat task', {
      task_state: 'in_progress',
      tags: ['wombat'],
    });
    await createItem(h, 'work', 'Second task');
    await comment(h, task.id, 1, 'Wombat comment');
    await fs.writeFile(abs(h, 'work/notes.txt'), 'not markdown');
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await teardown(h);
  });

  async function expectProjectDeleted(): Promise<void> {
    expect(await exists(h, 'work')).toBe(false);
    expect(rowsWhere(h, 'projects', 'id = ?', 'work')).toBe(0);
    expect(rowsWhere(h, 'documents', 'project_id = ?', 'work')).toBe(0);
    expect(rowsWhere(h, 'comments', 'project_id = ?', 'work')).toBe(0);
    expect((await request(h.app).get('/api/projects/work')).status).toBe(404);
    const search = await request(h.app).get('/api/search').query({ q: 'wombat' });
    expect(search.body).toEqual([]);
  }

  it('removes every task, comment and file of the project, and returns an ack', async () => {
    const res = await deleteProject(h, 'work', KEY);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({
      operation_id: KEY,
      command: 'project.delete',
      project_id: 'work',
      outcome: 'deleted',
    });
    await expectProjectDeleted();
    expectSettled(h, KEY);
    const again = await deleteProject(h, 'work', KEY);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(res.body);
  });

  it('a missing or invalid Idempotency-Key is 400 INVALID_COMMAND with nothing removed', async () => {
    const before = await snapshot(h, 'work');
    for (const key of [undefined, 'nope']) {
      const res = await deleteProject(h, 'work', key);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_COMMAND');
    }
    expect(await snapshot(h, 'work')).toEqual(before);
  });

  it('a symlink inside the project is not followed: deletion is refused and its target kept', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'backlogger-outside-'));
    await fs.writeFile(path.join(outside, 'keep.md'), 'outside');
    await fs.symlink(outside, abs(h, 'work/ideas/linked'));
    const before = await snapshot(h, 'work');
    const res = await deleteProject(h, 'work', KEY);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DELETION_BLOCKED');
    expect(res.body.error.details.paths).toEqual(['work/ideas/linked']);
    expect(await snapshot(h, 'work')).toEqual(before);
    expect(await fs.readFile(path.join(outside, 'keep.md'), 'utf8')).toBe('outside');
    await fs.rm(outside, { recursive: true, force: true });
  });

  it('a pending transfer into the project blocks its deletion', async () => {
    const inboxTask = await createItem(h, 'inbox', 'Moving in');
    crashOn(h.ctx.fs, 'createNew', 1, 'after');
    const filing = await request(h.app)
      .post(`/api/documents/${inboxTask.id}/file`)
      .set('Idempotency-Key', uuid(600))
      .send({ target_project_id: 'work', revision: inboxTask.revision });
    expect(filing.status).toBe(500);
    vi.restoreAllMocks();

    expectRecoveryRequired(await deleteProject(h, 'work', KEY), uuid(600));
    expect(await exists(h, task.path)).toBe(true);
  });

  for (const [phase, inject] of [
    ['before the first removal', (x: Harness) => crashOn(x.ctx.fs, 'deleteIfUnchanged', 1, 'before')],
    ['after the first removal', (x: Harness) => crashOn(x.ctx.fs, 'deleteIfUnchanged', 1, 'after')],
    ['after the third removal', (x: Harness) => crashOn(x.ctx.fs, 'deleteIfUnchanged', 3, 'after')],
    ['while removing folders', (x: Harness) => crashOn(x.ctx.fs, 'removeEmptyDir', 2, 'after')],
    ['in the completion transaction', (x: Harness) => crashInTransaction(x, 'markCompleted')],
  ] as const) {
    it(`a crash ${phase} hides the project, blocks it, and restart finishes the deletion`, async () => {
      inject(h);
      expect((await deleteProject(h, 'work', KEY)).status).toBe(500);
      vi.restoreAllMocks();

      for (const run of [
        () => request(h.app).post('/api/admin/reindex'),
        () => request(h.app).post('/api/projects/work/reload'),
      ]) {
        await run();
        const projects = await request(h.app).get('/api/projects');
        expect(projects.body.map((p: { id: string }) => p.id)).not.toContain('work');
        expect(await visibility(h, 'work', task.id, 'wombat')).toEqual(HIDDEN);
      }
      expectRecoveryRequired(
        await request(h.app).post('/api/projects').send({ id: 'work', name: 'Again' }),
        KEY,
      );
      expectRecoveryRequired(
        await request(h.app).put('/api/projects/work').send({ name: 'Renamed' }),
        KEY,
      );
      expectRecoveryRequired(
        await request(h.app)
          .post('/api/projects/work/documents')
          .send({ type: 'backlog_item', title: 'New' }),
        KEY,
      );

      h = await restart(h);

      await expectProjectDeleted();
      expectSettled(h, KEY);
      await request(h.app).post('/api/admin/reindex');
      await expectProjectDeleted();
    });
  }

  it('a file added to the project mid-deletion is kept and reported', async () => {
    crashOn(h.ctx.fs, 'deleteIfUnchanged', 1, 'after');
    expect((await deleteProject(h, 'work', KEY)).status).toBe(500);
    vi.restoreAllMocks();
    await fs.writeFile(abs(h, 'work/ideas/late.md'), '# Late arrival\n');

    h = await restart(h);

    expect(operation(h, KEY)?.state).toBe('pending');
    expect(await fs.readFile(abs(h, 'work/ideas/late.md'), 'utf8')).toBe('# Late arrival\n');
    const detail = await request(h.app).get(`/api/recovery/${KEY}`);
    expect(detail.body).toMatchObject({
      command: 'project.delete',
      kind: 'structural',
      reason: 'unexpected_file',
      project_id: 'work',
      actions: ['recheck'],
    });
    const projects = await request(h.app).get('/api/projects');
    expect(projects.body.map((p: { id: string }) => p.id)).not.toContain('work');
  });
});
