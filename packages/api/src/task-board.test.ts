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
