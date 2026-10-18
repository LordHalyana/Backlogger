import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import request from 'supertest';
import { setup, teardown, type Harness } from './test-support.js';

/**
 * HTTP API tests for the first Kanban board (spec #13) and its write-safety
 * prerequisites. Real routes, temp data dir, in-memory SQLite. The on-disk
 * Markdown is a public contract, so tests read the `.md` files directly.
 */

const PROJECT = 'board';

async function createProject(h: Harness, id = PROJECT): Promise<void> {
  const res = await request(h.app).post('/api/projects').send({ id, name: id });
  expect(res.status).toBe(201);
}

interface CreatedDoc {
  id: string;
  path: string;
  updated_at: string;
  revision: string;
}

async function createDoc(
  h: Harness,
  input: Record<string, unknown>,
  projectId = PROJECT,
): Promise<CreatedDoc> {
  const res = await request(h.app)
    .post(`/api/projects/${projectId}/documents`)
    .send({ type: 'backlog_item', ...input });
  expect(res.status).toBe(201);
  return res.body as CreatedDoc;
}

function diskPath(h: Harness, relPath: string): string {
  return path.join(h.dataDir, 'projects', relPath);
}

function readDisk(h: Harness, relPath: string): Promise<string> {
  return fs.readFile(diskPath(h, relPath), 'utf8');
}

/**
 * Hold every call to `object[name]` until `count` calls have returned, so the
 * callers overlap deterministically (write-safety research, Appendix A).
 */
function barrierAfter(count: number, object: object, name: string): () => void {
  const target = object as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const original = target[name]!;
  let seen = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  target[name] = async (...args: unknown[]) => {
    const result = await original.apply(object, args);
    seen += 1;
    if (seen === count) release();
    await Promise.race([gate, new Promise((r) => setTimeout(r, 200))]);
    return result;
  };
  return () => {
    target[name] = original;
  };
}

/** Resolve (or time out) when the next call to `object[name]` completes. */
function nextCompletion(object: object, name: string): Promise<void> {
  const target = object as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const original = target[name]!;
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 200);
    target[name] = async (...args: unknown[]) => {
      try {
        return await original.apply(object, args);
      } finally {
        target[name] = original;
        setTimeout(resolve, 20);
      }
    };
  });
}

/** Drain an async generator method, then hold its items until `until` settles. */
function holdGenerator(object: object, name: string, until: Promise<void>): () => void {
  const target = object as Record<string, (...args: unknown[]) => AsyncIterable<unknown>>;
  const original = target[name]!;
  target[name] = async function* (...args: unknown[]) {
    const items: unknown[] = [];
    for await (const item of original.apply(object, args)) items.push(item);
    await until;
    yield* items;
  };
  return () => {
    target[name] = original;
  };
}

describe('Write safety: overlapping mutations', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
    await createProject(h);
  });
  afterEach(() => teardown(h));

  it('two overlapping PUTs with the same revision give one 200 and one 409', async () => {
    const doc = await createDoc(h, { title: 'Original', body: 'Original body' });
    const restore = barrierAfter(2, h.ctx.fs, 'read');
    const [a, b] = await Promise.all([
      request(h.app)
        .put(`/api/documents/${doc.id}`)
        .set('If-Match', doc.revision)
        .send({ title: 'Changed title' }),
      request(h.app)
        .put(`/api/documents/${doc.id}`)
        .set('If-Match', doc.revision)
        .send({ body: 'Changed body' }),
    ]);
    restore();

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const winner = a.status === 200 ? a : b;
    const loser = a.status === 200 ? b : a;
    expect(loser.body.error.code).toBe('DOCUMENT_VERSION_MISMATCH');

    const disk = await readDisk(h, winner.body.path);
    if (winner === a) {
      expect(disk).toContain('title: Changed title');
      expect(disk).toContain('Original body');
    } else {
      expect(disk).toContain('title: Original');
      expect(disk).toContain('Changed body');
    }
  });

  it('a reindex overlapping a save ends with SQLite matching the committed file', async () => {
    const doc = await createDoc(h, { title: 'Before' });
    // The reindex snapshots the file, then waits until the save has written
    // before committing its snapshot — unless the two are serialised.
    const written = nextCompletion(h.ctx.fs, 'write');
    const restore = holdGenerator(h.ctx.fs, 'walkProject', written);
    const [reload, save] = await Promise.all([
      request(h.app).post(`/api/projects/${PROJECT}/reload`),
      request(h.app)
        .put(`/api/documents/${doc.id}`)
        .set('If-Match', doc.revision)
        .send({ title: 'After' }),
    ]);
    restore();
    expect(reload.status).toBe(200);
    expect(save.status).toBe(200);

    const disk = await readDisk(h, save.body.path);
    expect(disk).toContain('title: After');
    const listed = await request(h.app).get(`/api/projects/${PROJECT}/documents`);
    expect(listed.body.map((d: { title: string }) => d.title)).toEqual(['After']);
  });

  it('an update overlapping an archive leaves one file and no resurrected path', async () => {
    const doc = await createDoc(h, { title: 'Item', status: 'active' });
    const restore = barrierAfter(2, h.ctx.fs, 'read');
    const [archive, edit] = await Promise.all([
      request(h.app)
        .put(`/api/documents/${doc.id}`)
        .set('If-Match', doc.revision)
        .send({ status: 'archived' }),
      request(h.app).put(`/api/documents/${doc.id}`).send({ body: 'Edited body' }),
    ]);
    restore();
    expect(archive.status).toBe(200);
    expect(edit.status).toBe(200);

    const files = await h.ctx.fs.listProjectFiles(PROJECT);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('/archived/');
    const disk = await readDisk(h, files[0]!);
    expect(disk).toContain('status: archived');
    expect(disk).toContain('Edited body');
    const fetched = await request(h.app).get(`/api/documents/${doc.id}`);
    expect(fetched.body.path).toBe(files[0]);
  });

  it('an update overlapping a delete does not resurrect the document', async () => {
    const doc = await createDoc(h, { title: 'Doomed' });
    const restore = barrierAfter(2, h.ctx.fs, 'read');
    const [del, edit] = await Promise.all([
      request(h.app).delete(`/api/documents/${doc.id}`),
      request(h.app).put(`/api/documents/${doc.id}`).send({ body: 'Too late' }),
    ]);
    restore();
    expect(del.status).toBe(204);
    expect([200, 404]).toContain(edit.status);

    expect(await h.ctx.fs.listProjectFiles(PROJECT)).toEqual([]);
    const fetched = await request(h.app).get(`/api/documents/${doc.id}`);
    expect(fetched.status).toBe(404);
  });
});

describe('Revisions: distinct per mutation, validated against disk', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
    await createProject(h);
  });
  afterEach(async () => {
    vi.useRealTimers();
    await teardown(h);
  });

  it('two writes in the same millisecond produce different revisions', async () => {
    const doc = await createDoc(h, { title: 'Clock' });
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-18T12:00:00.000Z') });
    const first = await request(h.app)
      .put(`/api/documents/${doc.id}`)
      .set('If-Match', doc.revision)
      .send({ title: 'First' });
    const second = await request(h.app)
      .put(`/api/documents/${doc.id}`)
      .set('If-Match', first.body.revision)
      .send({ title: 'Second' });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.updated_at).toBe(second.body.updated_at);
    expect(second.body.revision).not.toBe(first.body.revision);

    // The first write's revision is now stale even though updated_at matches.
    const stale = await request(h.app)
      .put(`/api/documents/${doc.id}`)
      .set('If-Match', first.body.revision)
      .send({ title: 'Third' });
    expect(stale.status).toBe(409);
  });

  it('a body-only edit on disk (no reindex) makes the old revision stale', async () => {
    const doc = await createDoc(h, { title: 'Disk', body: 'Original' });
    const file = diskPath(h, doc.path);
    const edited = (await fs.readFile(file, 'utf8')).replace('Original', 'Edited on disk');
    await fs.writeFile(file, edited, 'utf8');

    const res = await request(h.app)
      .put(`/api/documents/${doc.id}`)
      .set('If-Match', doc.revision)
      .send({ title: 'Overwrite' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DOCUMENT_VERSION_MISMATCH');
    expect(await fs.readFile(file, 'utf8')).toBe(edited);
  });

  it('a sequential stale If-Match gives 409 and leaves the file unchanged', async () => {
    const doc = await createDoc(h, { title: 'Seq' });
    const ok = await request(h.app)
      .put(`/api/documents/${doc.id}`)
      .set('If-Match', doc.revision)
      .send({ title: 'Seq 2' });
    expect(ok.status).toBe(200);
    const before = await readDisk(h, doc.path);

    const stale = await request(h.app)
      .put(`/api/documents/${doc.id}`)
      .set('If-Match', doc.revision)
      .send({ title: 'Seq 3' });
    expect(stale.status).toBe(409);
    expect(await readDisk(h, doc.path)).toBe(before);
  });

  it('GET, list and PUT expose the current revision; a missing If-Match is accepted', async () => {
    const doc = await createDoc(h, { title: 'Rev' });
    const got = await request(h.app).get(`/api/documents/${doc.id}`);
    expect(got.body.revision).toBe(doc.revision);
    const listed = await request(h.app).get(`/api/projects/${PROJECT}/documents`);
    expect(listed.body[0].revision).toBe(doc.revision);

    const unconditional = await request(h.app)
      .put(`/api/documents/${doc.id}`)
      .send({ title: 'No precondition' });
    expect(unconditional.status).toBe(200);
    expect(unconditional.body.revision).not.toBe(doc.revision);
  });
});

const ID = {
  a: '00000000-0000-4000-8000-00000000000a',
  b: '00000000-0000-4000-8000-00000000000b',
  c: '00000000-0000-4000-8000-00000000000c',
  d: '00000000-0000-4000-8000-00000000000d',
  e: '00000000-0000-4000-8000-00000000000e',
  f: '00000000-0000-4000-8000-00000000000f',
};

/**
 * Write a hand-authored Markdown file straight to disk, the way a legacy file
 * or an external editor would. `extra` lines are appended to the frontmatter.
 */
async function writeMarkdown(
  h: Harness,
  relPath: string,
  fm: { id: string; title: string; type?: string; status?: string; created_at: string },
  extra: string[] = [],
  projectId = PROJECT,
): Promise<string> {
  const content = [
    '---',
    `id: ${fm.id}`,
    `title: ${fm.title}`,
    `project: ${projectId}`,
    `type: ${fm.type ?? 'backlog_item'}`,
    `status: ${fm.status ?? 'active'}`,
    ...extra,
    `created_at: '${fm.created_at}'`,
    `updated_at: '${fm.created_at}'`,
    'tags:',
    '  - board',
    '---',
    '',
    `# ${fm.title}`,
    '',
  ].join('\n');
  const file = diskPath(h, `${projectId}/${relPath}`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf8');
  return content;
}

/** The exact bytes the app writes for a document with this frontmatter. */
function expectedFile(
  doc: {
    id: string;
    title: string;
    type: string;
    status: string;
    task_state?: string;
    created_at: string;
    updated_at: string;
  },
  body: string,
): string {
  return [
    '---',
    `id: ${doc.id}`,
    `title: ${doc.title}`,
    `project: ${PROJECT}`,
    `type: ${doc.type}`,
    `status: ${doc.status}`,
    ...(doc.task_state ? [`task_state: ${doc.task_state}`] : []),
    `created_at: '${doc.created_at}'`,
    `updated_at: '${doc.updated_at}'`,
    'tags: []',
    '---',
    body,
  ].join('\n');
}

async function reload(h: Harness, projectId = PROJECT): Promise<void> {
  const res = await request(h.app).post(`/api/projects/${projectId}/reload`);
  expect(res.status).toBe(200);
}

interface Card {
  id: string;
  title: string;
  status: string;
  task_state: string | null;
  readOnly: boolean;
  revision: string;
  tags: string[];
}

async function getBoard(
  h: Harness,
  projectId = PROJECT,
): Promise<{ todo: Card[]; in_progress: Card[]; done: Card[] }> {
  const res = await request(h.app).get(`/api/projects/${projectId}/board`);
  expect(res.status).toBe(200);
  return res.body.columns;
}

function ids(cards: Card[]): string[] {
  return cards.map((c) => c.id);
}

async function getDoc(
  h: Harness,
  id: string,
): Promise<{ path: string; revision: string; updated_at: string }> {
  const res = await request(h.app).get(`/api/documents/${id}`);
  expect(res.status).toBe(200);
  return res.body;
}

async function revisionOf(h: Harness, id: string): Promise<string> {
  return (await getDoc(h, id)).revision;
}

/** A `writeMarkdown` file as the app re-stamps it: only `updated_at` differs. */
function restamped(written: string, updatedAt: string): string {
  return written.replace("updated_at: '2026-01-01T00:00:00.000Z'", `updated_at: '${updatedAt}'`);
}

describe('Board read: GET /api/projects/:projectId/board', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
    await createProject(h);
  });
  afterEach(() => teardown(h));

  it('assigns columns by task_state; absent and unrecognised values show as To do', async () => {
    await writeMarkdown(
      h,
      'backlog/todo.md',
      { id: ID.a, title: 'Todo', created_at: '2026-01-01T00:00:00.000Z' },
      ['task_state: todo'],
    );
    await writeMarkdown(
      h,
      'backlog/doing.md',
      { id: ID.b, title: 'Doing', created_at: '2026-01-02T00:00:00.000Z' },
      ['task_state: in_progress'],
    );
    await writeMarkdown(
      h,
      'backlog/done.md',
      { id: ID.c, title: 'Done', created_at: '2026-01-03T00:00:00.000Z' },
      ['task_state: done'],
    );
    await writeMarkdown(h, 'backlog/legacy.md', {
      id: ID.d,
      title: 'Legacy',
      created_at: '2026-01-04T00:00:00.000Z',
    });
    await writeMarkdown(
      h,
      'backlog/invalid.md',
      { id: ID.e, title: 'Invalid', created_at: '2026-01-05T00:00:00.000Z' },
      ['task_state: Doing'],
    );
    await reload(h);

    const board = await getBoard(h);
    expect(ids(board.todo)).toEqual([ID.a, ID.d, ID.e]);
    expect(ids(board.in_progress)).toEqual([ID.b]);
    expect(ids(board.done)).toEqual([ID.c]);

    const invalid = board.todo.find((c) => c.id === ID.e)!;
    expect(invalid).toMatchObject({
      title: 'Invalid',
      task_state: 'Doing',
      status: 'active',
      readOnly: false,
      tags: ['board'],
    });
    expect(invalid.revision).toEqual(expect.any(String));
    expect(board.todo.find((c) => c.id === ID.d)!.task_state).toBeNull();
  });

  it('includes drafts, excludes archived items and non-backlog types', async () => {
    await writeMarkdown(h, 'backlog/draft.md', {
      id: ID.a,
      title: 'Draft',
      status: 'draft',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    await writeMarkdown(
      h,
      'archived/backlog/old.md',
      { id: ID.b, title: 'Old', status: 'archived', created_at: '2026-01-02T00:00:00.000Z' },
      ['task_state: done'],
    );
    const noteContent = await writeMarkdown(
      h,
      'notes/note.md',
      { id: ID.c, title: 'Note', type: 'note', created_at: '2026-01-03T00:00:00.000Z' },
      ['task_state: in_progress'],
    );
    await reload(h);

    const board = await getBoard(h);
    expect(ids(board.todo)).toEqual([ID.a]);
    expect(board.todo[0]!.status).toBe('draft');
    expect(board.in_progress).toEqual([]);
    expect(board.done).toEqual([]);
    expect(await readDisk(h, `${PROJECT}/notes/note.md`)).toBe(noteContent);
  });

  it('orders a column by created_at, then by document ID', async () => {
    await writeMarkdown(h, 'backlog/late.md', {
      id: ID.a,
      title: 'Late',
      created_at: '2026-03-01T00:00:00.000Z',
    });
    await writeMarkdown(h, 'backlog/tie-2.md', {
      id: ID.c,
      title: 'Tie 2',
      created_at: '2026-02-01T00:00:00.000Z',
    });
    await writeMarkdown(h, 'backlog/tie-1.md', {
      id: ID.b,
      title: 'Tie 1',
      created_at: '2026-02-01T00:00:00.000Z',
    });
    await writeMarkdown(h, 'backlog/early.md', {
      id: ID.f,
      title: 'Early',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    await reload(h);

    expect(ids((await getBoard(h)).todo)).toEqual([ID.f, ID.b, ID.c, ID.a]);
  });

  it('shows no items for a sidecar-mode project', async () => {
    await createProject(h, 'side');
    await request(h.app).put('/api/projects/side').send({ metadataMode: 'sidecar' });
    await createDoc(h, { title: 'Sidecar item' }, 'side');

    const board = await getBoard(h, 'side');
    expect([...board.todo, ...board.in_progress, ...board.done]).toEqual([]);
  });

  it('marks cards read-only in a read-only project', async () => {
    await writeMarkdown(h, 'backlog/ro.md', {
      id: ID.a,
      title: 'RO',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    await reload(h);
    await request(h.app).put(`/api/projects/${PROJECT}`).send({ readOnly: true });

    const board = await getBoard(h);
    expect(board.todo[0]!.readOnly).toBe(true);
  });

  it('returns 404 for an unknown project', async () => {
    const res = await request(h.app).get('/api/projects/nope/board');
    expect(res.status).toBe(404);
  });

  it('keeps legacy and unrecognised files byte-identical through read and reindex', async () => {
    const legacy = await writeMarkdown(h, 'backlog/legacy.md', {
      id: ID.a,
      title: 'Legacy',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    const invalid = await writeMarkdown(
      h,
      'backlog/invalid.md',
      { id: ID.b, title: 'Invalid', created_at: '2026-01-02T00:00:00.000Z' },
      ['task_state: Doing'],
    );
    await reload(h);
    await getBoard(h);
    await request(h.app).get(`/api/documents/${ID.a}`);
    await request(h.app).get(`/api/documents/${ID.b}`);
    await request(h.app).post('/api/admin/reindex');
    await reload(h);

    expect(await readDisk(h, `${PROJECT}/backlog/legacy.md`)).toBe(legacy);
    expect(await readDisk(h, `${PROJECT}/backlog/invalid.md`)).toBe(invalid);
  });

  it('reindex leaves the board unchanged; a fresh DB over the same data dir gives the same board', async () => {
    await writeMarkdown(
      h,
      'backlog/a.md',
      { id: ID.a, title: 'A', created_at: '2026-01-01T00:00:00.000Z' },
      ['task_state: done'],
    );
    await writeMarkdown(
      h,
      'backlog/b.md',
      { id: ID.b, title: 'B', created_at: '2026-01-02T00:00:00.000Z' },
      ['task_state: in_progress'],
    );
    await writeMarkdown(
      h,
      'backlog/c.md',
      { id: ID.c, title: 'C', created_at: '2026-01-03T00:00:00.000Z' },
      ['task_state: Doing'],
    );
    await writeMarkdown(h, 'backlog/d.md', {
      id: ID.d,
      title: 'D',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    await reload(h);
    const before = await getBoard(h);

    await reload(h);
    expect(await getBoard(h)).toEqual(before);

    const project = (column: Card[]) => column.map((c) => [c.id, c.task_state, c.revision]);
    const fresh = await setup({ dataDir: h.dataDir });
    try {
      const reindexed = await request(fresh.app).post('/api/admin/reindex');
      expect(reindexed.status).toBe(200);
      const after = await getBoard(fresh);
      expect(project(after.todo)).toEqual(project(before.todo));
      expect(project(after.in_progress)).toEqual(project(before.in_progress));
      expect(project(after.done)).toEqual(project(before.done));
    } finally {
      fresh.db.close();
    }
  });
});

describe('Moving a card: PUT task_state', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
    await createProject(h);
  });
  afterEach(() => teardown(h));

  it('writes only task_state (after status) and updated_at, byte for byte', async () => {
    const before = await writeMarkdown(h, 'backlog/legacy.md', {
      id: ID.a,
      title: 'Legacy',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    await reload(h);

    const res = await request(h.app)
      .put(`/api/documents/${ID.a}`)
      .set('If-Match', await revisionOf(h, ID.a))
      .send({ task_state: 'in_progress' });
    expect(res.status).toBe(200);

    const expected = restamped(before, res.body.updated_at).replace(
      'status: active\n',
      'status: active\ntask_state: in_progress\n',
    );
    expect(await readDisk(h, `${PROJECT}/backlog/legacy.md`)).toBe(expected);
    expect(ids((await getBoard(h)).in_progress)).toEqual([ID.a]);
  });

  it('a moved card takes its creation-order place in the new column', async () => {
    // IDs and titles both run against creation order, so only created_at puts Zed first.
    await writeMarkdown(h, 'backlog/zed.md', {
      id: ID.b,
      title: 'Zed',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    await writeMarkdown(
      h,
      'backlog/alpha.md',
      { id: ID.a, title: 'Alpha', created_at: '2026-03-01T00:00:00.000Z' },
      ['task_state: done'],
    );
    await reload(h);

    const res = await request(h.app)
      .put(`/api/documents/${ID.b}`)
      .set('If-Match', await revisionOf(h, ID.b))
      .send({ task_state: 'done' });
    expect(res.status).toBe(200);

    expect(ids((await getBoard(h)).done)).toEqual([ID.b, ID.a]);
  });

  it('replaces an unrecognised value in place on a state change', async () => {
    const before = await writeMarkdown(
      h,
      'backlog/doing.md',
      { id: ID.a, title: 'Doing', created_at: '2026-01-01T00:00:00.000Z' },
      ['task_state: Doing'],
    );
    await reload(h);

    const res = await request(h.app)
      .put(`/api/documents/${ID.a}`)
      .set('If-Match', await revisionOf(h, ID.a))
      .send({ task_state: 'done' });
    expect(res.status).toBe(200);

    const expected = restamped(before, res.body.updated_at).replace(
      'task_state: Doing\n',
      'task_state: done\n',
    );
    expect(await readDisk(h, `${PROJECT}/backlog/doing.md`)).toBe(expected);
  });

  it('keeps the value, unrecognised included, through title/body/tags edits and a folder move', async () => {
    await writeMarkdown(
      h,
      'backlog/keep.md',
      { id: ID.a, title: 'Keep', created_at: '2026-01-01T00:00:00.000Z' },
      ['task_state: Doing'],
    );
    await writeMarkdown(
      h,
      'backlog/keep-done.md',
      { id: ID.b, title: 'Keep done', created_at: '2026-01-02T00:00:00.000Z' },
      ['task_state: done'],
    );
    await reload(h);

    for (const id of [ID.a, ID.b]) {
      const edit = await request(h.app)
        .put(`/api/documents/${id}`)
        .set('If-Match', await revisionOf(h, id))
        .send({ title: 'Renamed', body: 'New body\n', tags: ['moved'] });
      expect(edit.status).toBe(200);
      const moved = await request(h.app)
        .post(`/api/documents/${id}/move`)
        .send({ folder: 'later' });
      expect(moved.status).toBe(200);
    }

    const keep = await readDisk(h, (await request(h.app).get(`/api/documents/${ID.a}`)).body.path);
    expect(keep).toContain('status: active\ntask_state: Doing\n');
    const done = await readDisk(h, (await request(h.app).get(`/api/documents/${ID.b}`)).body.path);
    expect(done).toContain('status: active\ntask_state: done\n');
    expect(ids((await getBoard(h)).done)).toEqual([ID.b]);
  });

  it('rejects an unrecognised task_state with 400', async () => {
    const doc = await createDoc(h, { title: 'Blocked?' });
    const before = await readDisk(h, doc.path);
    const res = await request(h.app)
      .put(`/api/documents/${doc.id}`)
      .set('If-Match', doc.revision)
      .send({ task_state: 'blocked' });
    expect(res.status).toBe(400);
    expect(await readDisk(h, doc.path)).toBe(before);
  });

  it('rejects task_state on a non-backlog document with 400', async () => {
    const note = await createDoc(h, { title: 'A note', type: 'note' });
    const before = await readDisk(h, note.path);
    const res = await request(h.app)
      .put(`/api/documents/${note.id}`)
      .set('If-Match', note.revision)
      .send({ task_state: 'done' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TASK_STATE_NOT_ALLOWED');
    expect(await readDisk(h, note.path)).toBe(before);
  });

  it('preserves task_state on a non-backlog document through edits, without the board showing it', async () => {
    await writeMarkdown(
      h,
      'notes/note.md',
      { id: ID.a, title: 'Note', type: 'note', created_at: '2026-01-01T00:00:00.000Z' },
      ['task_state: in_progress'],
    );
    await reload(h);
    const edit = await request(h.app)
      .put(`/api/documents/${ID.a}`)
      .set('If-Match', await revisionOf(h, ID.a))
      .send({ body: 'Edited\n' });
    expect(edit.status).toBe(200);
    expect(await readDisk(h, `${PROJECT}/notes/note.md`)).toContain('task_state: in_progress\n');
    expect((await getBoard(h)).in_progress).toEqual([]);
  });

  it('refuses a move in a read-only project with 409 and leaves the file unchanged', async () => {
    const before = await writeMarkdown(h, 'backlog/ro.md', {
      id: ID.a,
      title: 'RO',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    await reload(h);
    const revision = await revisionOf(h, ID.a);
    await request(h.app).put(`/api/projects/${PROJECT}`).send({ readOnly: true });

    const res = await request(h.app)
      .put(`/api/documents/${ID.a}`)
      .set('If-Match', revision)
      .send({ task_state: 'done' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PROJECT_READ_ONLY');
    expect(await readDisk(h, `${PROJECT}/backlog/ro.md`)).toBe(before);
  });

  it('refuses a stale move with 409 and leaves the file unchanged', async () => {
    const doc = await createDoc(h, { title: 'Stale' });
    const first = await request(h.app)
      .put(`/api/documents/${doc.id}`)
      .set('If-Match', doc.revision)
      .send({ task_state: 'in_progress' });
    expect(first.status).toBe(200);
    const before = await readDisk(h, doc.path);

    const stale = await request(h.app)
      .put(`/api/documents/${doc.id}`)
      .set('If-Match', doc.revision)
      .send({ task_state: 'done' });
    expect(stale.status).toBe(409);
    expect(await readDisk(h, doc.path)).toBe(before);
  });
});

describe('Folder moves keep the file byte for byte', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
    await createProject(h);
  });
  afterEach(() => teardown(h));

  async function moveTo(id: string, folder: string): Promise<string> {
    const res = await request(h.app).post(`/api/documents/${id}/move`).send({ folder });
    expect(res.status).toBe(200);
    return res.body.path as string;
  }

  it('moves a backlog item, unrecognised task_state included, changing only updated_at', async () => {
    const before = await writeMarkdown(
      h,
      'backlog/doing.md',
      { id: ID.a, title: 'Doing', created_at: '2026-01-01T00:00:00.000Z' },
      ['task_state: Doing'],
    );
    await reload(h);

    const moved = await moveTo(ID.a, 'later');
    expect(moved).toBe(`${PROJECT}/later/doing.md`);
    expect(await readDisk(h, moved)).toBe(restamped(before, (await getDoc(h, ID.a)).updated_at));
    expect(await h.ctx.fs.listProjectFiles(PROJECT)).toEqual([moved]);
    expect((await getBoard(h)).todo).toMatchObject([{ id: ID.a, task_state: 'Doing' }]);
  });

  it('keeps task_state on a non-backlog document through a move and a reindex', async () => {
    const before = await writeMarkdown(
      h,
      'notes/note.md',
      { id: ID.a, title: 'Note', type: 'note', created_at: '2026-01-01T00:00:00.000Z' },
      ['task_state: in_progress'],
    );
    await reload(h);
    expect(await readDisk(h, `${PROJECT}/notes/note.md`)).toBe(before);

    const moved = await moveTo(ID.a, 'elsewhere');
    const afterMove = restamped(before, (await getDoc(h, ID.a)).updated_at);
    expect(await readDisk(h, moved)).toBe(afterMove);

    await reload(h);
    expect(await readDisk(h, moved)).toBe(afterMove);
    expect(await h.ctx.fs.listProjectFiles(PROJECT)).toEqual([moved]);
  });
});

describe('New and imported backlog items carry task_state', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
    await createProject(h);
  });
  afterEach(() => teardown(h));

  it('a blank backlog item is written with task_state: todo right after status', async () => {
    const res = await request(h.app)
      .post(`/api/projects/${PROJECT}/documents`)
      .send({ title: 'Blank', type: 'backlog_item', body: 'Body\n' });
    expect(res.status).toBe(201);
    expect(await readDisk(h, res.body.path)).toBe(
      expectedFile({ ...res.body, task_state: 'todo' }, 'Body\n'),
    );
    expect(ids((await getBoard(h)).todo)).toEqual([res.body.id]);
    expect((await getBoard(h)).todo[0]!.task_state).toBe('todo');
  });

  it('a backlog item from a template is written with task_state: todo', async () => {
    h.ctx.templates.setAll([
      ...h.ctx.templates.list().map((t) => h.ctx.templates.getOrThrow(t.id)),
      { id: 'story', name: 'Story', type: 'backlog_item', source: 'user', body: '# {{title}}\n' },
    ]);
    const res = await request(h.app)
      .post(`/api/projects/${PROJECT}/documents`)
      .send({ title: 'From template', type: 'backlog_item', template: 'story' });
    expect(res.status).toBe(201);
    expect(await readDisk(h, res.body.path)).toBe(
      expectedFile({ ...res.body, task_state: 'todo' }, '# From template\n'),
    );
  });

  it('create accepts an explicit task_state and rejects invalid ones', async () => {
    const ok = await request(h.app)
      .post(`/api/projects/${PROJECT}/documents`)
      .send({ title: 'Started', type: 'backlog_item', task_state: 'in_progress' });
    expect(ok.status).toBe(201);
    expect(await readDisk(h, ok.body.path)).toContain('status: draft\ntask_state: in_progress\n');
    expect(ids((await getBoard(h)).in_progress)).toEqual([ok.body.id]);

    const invalid = await request(h.app)
      .post(`/api/projects/${PROJECT}/documents`)
      .send({ title: 'Nope', type: 'backlog_item', task_state: 'Doing' });
    expect(invalid.status).toBe(400);

    const onNote = await request(h.app)
      .post(`/api/projects/${PROJECT}/documents`)
      .send({ title: 'Note', type: 'note', task_state: 'done' });
    expect(onNote.status).toBe(400);
    expect(onNote.body.error.code).toBe('TASK_STATE_NOT_ALLOWED');
    expect(await h.ctx.fs.listProjectFiles(PROJECT)).toHaveLength(1);
  });

  it('other document types are never written with task_state', async () => {
    const res = await request(h.app)
      .post(`/api/projects/${PROJECT}/documents`)
      .send({ title: 'Plain note', type: 'note', body: 'Body\n' });
    expect(res.status).toBe(201);
    expect(await readDisk(h, res.body.path)).toBe(expectedFile(res.body, 'Body\n'));
  });

  function importFile(content: string, onDuplicate: 'skip' | 'copy' | 'replace' = 'skip') {
    return request(h.app)
      .post(`/api/projects/${PROJECT}/import`)
      .send({
        placement: { type: 'backlog_item', titleStrategy: 'frontmatter', onDuplicate },
        files: [{ filename: 'item.md', content }],
      });
  }

  function exported(title: string, extra: string[], id = ID.a): string {
    return [
      '---',
      `id: ${id}`,
      `title: ${title}`,
      'type: backlog_item',
      'status: active',
      ...extra,
      '---',
      '',
      `# ${title}`,
      '',
    ].join('\n');
  }

  async function imported(res: request.Response): Promise<{ id: string; path: string }> {
    expect(res.status).toBe(200);
    const id = res.body.imported[0].documentId as string;
    return { id, path: (await request(h.app).get(`/api/documents/${id}`)).body.path as string };
  }

  async function importedPath(res: request.Response): Promise<string> {
    return (await imported(res)).path;
  }

  it('import (new) keeps the value verbatim, recognised or not, and absent stays absent', async () => {
    const cases: Array<[string, string[], string, string | undefined]> = [
      ['Doing', ['task_state: Doing'], ID.a, 'Doing'],
      ['Done', ['task_state: done'], ID.b, 'done'],
      ['Absent', [], ID.c, undefined],
    ];
    for (const [title, extra, id, taskState] of cases) {
      const { id: newId, path: file } = await imported(
        await importFile(exported(title, extra, id)),
      );
      const doc = (await request(h.app).get(`/api/documents/${newId}`)).body;
      expect(await readDisk(h, file)).toBe(
        expectedFile({ ...doc, task_state: taskState }, `\n# ${title}\n`),
      );
    }
  });

  it('import (copy) of a duplicate keeps the incoming value verbatim', async () => {
    const original = await importedPath(await importFile(exported('Orig', ['task_state: done'])));
    const exportedBytes = await readDisk(h, original);
    const copy = await importedPath(
      await importFile(exportedBytes.replace('task_state: done', 'task_state: Later'), 'copy'),
    );
    expect(copy).not.toBe(original);
    expect(await readDisk(h, copy)).toContain('task_state: Later\n');
    expect(await readDisk(h, original)).toBe(exportedBytes);
  });

  it('import (replace) overwrites task_state only when the incoming file has one', async () => {
    const { id, path: target } = await imported(
      await importFile(exported('Target', ['task_state: in_progress'])),
    );

    const without = await importFile(exported('Target v2', [], id), 'replace');
    expect(without.status).toBe(200);
    expect(await readDisk(h, target)).toContain('title: Target v2\n');
    expect(await readDisk(h, target)).toContain('task_state: in_progress\n');

    const withValue = await importFile(exported('Target v3', ['task_state: done'], id), 'replace');
    expect(withValue.status).toBe(200);
    expect(await readDisk(h, target)).toContain('status: active\ntask_state: done\n');
    expect(ids((await getBoard(h)).done)).toHaveLength(1);
  });

  it('import (skip) of a duplicate changes nothing', async () => {
    const { id, path: target } = await imported(
      await importFile(exported('Kept', ['task_state: done'])),
    );
    const before = await readDisk(h, target);
    const res = await importFile(exported('Ignored', ['task_state: todo'], id), 'skip');
    expect(res.status).toBe(200);
    expect(res.body.skipped).toHaveLength(1);
    expect(await readDisk(h, target)).toBe(before);
  });

  it('raw export returns the file as stored, task_state included', async () => {
    const doc = await createDoc(h, { title: 'Export me', task_state: 'done' });
    const res = await request(h.app)
      .get(`/api/documents/${doc.id}/raw`)
      .buffer(true)
      .parse((r, cb) => {
        let text = '';
        r.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
        r.on('end', () => cb(null, text));
      });
    expect(res.status).toBe(200);
    expect(res.body).toBe(await readDisk(h, doc.path));
    expect(res.body).toContain('task_state: done\n');
  });
});

describe('Archive and restore keep task_state', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
    await createProject(h);
  });
  afterEach(() => teardown(h));

  it('archiving keeps task_state; restoring returns the card to its column with the same id', async () => {
    const older = await createDoc(h, { title: 'Older', status: 'active', task_state: 'done' });
    const newer = await createDoc(h, { title: 'Newer', status: 'active', task_state: 'done' });
    const asCreated = await readDisk(h, older.path);
    const withUpdatedAt = (updatedAt: string): string =>
      asCreated.replace(`updated_at: '${older.updated_at}'`, `updated_at: '${updatedAt}'`);

    const archived = await request(h.app)
      .put(`/api/documents/${older.id}`)
      .set('If-Match', older.revision)
      .send({ status: 'archived' });
    expect(archived.status).toBe(200);
    expect(archived.body.path).toContain('/archived/');
    expect(await readDisk(h, archived.body.path)).toBe(
      withUpdatedAt(archived.body.updated_at).replace(
        'status: active\ntask_state: done\n',
        'status: archived\ntask_state: done\n',
      ),
    );
    expect(ids((await getBoard(h)).done)).toEqual([newer.id]);

    const restored = await request(h.app)
      .put(`/api/documents/${older.id}`)
      .set('If-Match', archived.body.revision)
      .send({ status: 'active' });
    expect(restored.status).toBe(200);
    expect(restored.body.id).toBe(older.id);
    expect(restored.body.path).toBe(older.path);
    expect(await readDisk(h, older.path)).toBe(withUpdatedAt(restored.body.updated_at));
    expect(await h.ctx.fs.listProjectFiles(PROJECT)).toHaveLength(2);
    expect(ids((await getBoard(h)).done)).toEqual([older.id, newer.id]);
  });

  it('archiving a non-Done card abandons it without changing its task state', async () => {
    const doc = await createDoc(h, { title: 'Abandoned', task_state: 'in_progress' });
    const archived = await request(h.app)
      .put(`/api/documents/${doc.id}`)
      .set('If-Match', doc.revision)
      .send({ status: 'archived' });
    expect(archived.status).toBe(200);
    expect(await readDisk(h, archived.body.path)).toContain('task_state: in_progress\n');
    expect((await getBoard(h)).in_progress).toEqual([]);
  });

  it('archive and restore keep an unrecognised task_state verbatim, byte for byte', async () => {
    const before = await writeMarkdown(
      h,
      'backlog/someday.md',
      { id: ID.a, title: 'Someday', created_at: '2026-01-01T00:00:00.000Z' },
      ['task_state: Someday'],
    );
    await reload(h);
    const revision = await revisionOf(h, ID.a);

    const archived = await request(h.app)
      .put(`/api/documents/${ID.a}`)
      .set('If-Match', revision)
      .send({ status: 'archived' });
    expect(archived.status).toBe(200);
    expect(await readDisk(h, archived.body.path)).toBe(
      restamped(before, archived.body.updated_at).replace(
        'status: active\ntask_state: Someday\n',
        'status: archived\ntask_state: Someday\n',
      ),
    );
    expect((await getBoard(h)).todo).toEqual([]);

    const restored = await request(h.app)
      .put(`/api/documents/${ID.a}`)
      .set('If-Match', archived.body.revision)
      .send({ status: 'active' });
    expect(restored.status).toBe(200);
    expect(restored.body.path).toBe(`${PROJECT}/backlog/someday.md`);
    expect(await readDisk(h, restored.body.path)).toBe(restamped(before, restored.body.updated_at));
    expect(await h.ctx.fs.listProjectFiles(PROJECT)).toEqual([restored.body.path]);
    const [card] = (await getBoard(h)).todo;
    expect(card).toMatchObject({ id: ID.a, task_state: 'Someday' });
  });

  it('refuses archiving in a read-only project with 409 and leaves the file unchanged', async () => {
    const doc = await createDoc(h, { title: 'Mounted', status: 'active', task_state: 'done' });
    const before = await readDisk(h, doc.path);
    await request(h.app).put(`/api/projects/${PROJECT}`).send({ readOnly: true });

    const res = await request(h.app)
      .put(`/api/documents/${doc.id}`)
      .set('If-Match', doc.revision)
      .send({ status: 'archived' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PROJECT_READ_ONLY');
    expect(await readDisk(h, doc.path)).toBe(before);
    expect(await h.ctx.fs.listProjectFiles(PROJECT)).toEqual([doc.path]);
  });
});

describe('Sidecar-mode projects have no task state', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
    await createProject(h, 'side');
    await request(h.app).put('/api/projects/side').send({ metadataMode: 'sidecar' });
  });
  afterEach(() => teardown(h));

  it('create with task_state is refused with 400, like update', async () => {
    const res = await request(h.app)
      .post('/api/projects/side/documents')
      .send({ title: 'Side item', type: 'backlog_item', task_state: 'done' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TASK_STATE_NOT_ALLOWED');
    expect(await h.ctx.fs.listProjectFiles('side')).toEqual([]);
  });

  it('update with task_state is refused with 400 and leaves the file unchanged', async () => {
    const doc = await createDoc(h, { title: 'Side item' }, 'side');
    const before = await readDisk(h, doc.path);
    const indexBefore = await readDisk(h, 'side/.backlogger/index.json');

    const res = await request(h.app)
      .put(`/api/documents/${doc.id}`)
      .set('If-Match', doc.revision)
      .send({ task_state: 'done' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TASK_STATE_NOT_ALLOWED');
    expect(await readDisk(h, doc.path)).toBe(before);
    expect(await readDisk(h, 'side/.backlogger/index.json')).toBe(indexBefore);
  });
});
