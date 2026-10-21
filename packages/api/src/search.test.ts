import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import request from 'supertest';
import type { SearchHit } from '@backlogger/shared';
import { setup, teardown, type Harness } from './test-support.js';

/**
 * Grouped task/comment search (#70, spec #58): one result per parent task,
 * labelled with its strongest matching record. Real routes over a temp data
 * dir; comments are posted through the API or written straight to disk and
 * picked up by Reload.
 */

interface DocBody {
  id: string;
  project_id: string;
}

/** Deterministic UUIDs v4: `uuid(7)` → `00000000-0000-4000-8000-000000000007`. */
function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

async function createProject(h: Harness, id: string): Promise<void> {
  expect((await request(h.app).post('/api/projects').send({ id, name: id })).status).toBe(201);
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

let opSeq = 1000;
async function comment(h: Harness, taskId: string, id: string, body: string): Promise<void> {
  const res = await request(h.app)
    .post(`/api/documents/${taskId}/comments`)
    .set('Idempotency-Key', uuid(opSeq++))
    .send({ id, body });
  expect(res.status).toBe(201);
}

async function search(
  h: Harness,
  q: string,
  extra: Record<string, unknown> = {},
): Promise<SearchHit[]> {
  const res = await request(h.app)
    .get('/api/search')
    .query({ q, ...extra });
  expect(res.status).toBe(200);
  return res.body as SearchHit[];
}

async function writeRaw(h: Harness, rel: string, text: string): Promise<void> {
  const abs = path.join(h.dataDir, 'projects', rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, text, 'utf8');
}

function commentFile(id: string, parent: string, at: string, body: string): string {
  return [
    '---',
    'schema_version: 1',
    'kind: comment',
    `id: ${id}`,
    `parent_id: ${parent}`,
    `created_at: '${at}'`,
    `updated_at: '${at}'`,
    '---',
    body,
  ].join('\n');
}

/** The highlighted substrings of a hit's snippet. */
function highlighted(hit: SearchHit): string[] {
  return hit.highlights.map(([start, end]) => hit.snippet.slice(start, end));
}

describe('GET /api/search over tasks and their comments', () => {
  let h: Harness;
  let task: DocBody;
  beforeEach(async () => {
    h = await setup();
    await createProject(h, 'work');
    task = await createDoc(h, 'work', 'Investigate the flaky test', {
      body: 'The login suite fails on CI.\n',
    });
  });
  afterEach(() => teardown(h));

  it('finds a task through the text of one of its comments, labelled Comment match with its date', async () => {
    await comment(h, task.id, uuid(1), 'Found it: the zebracorn fixture leaks a socket.\n');
    const created = (await request(h.app).get(`/api/comments/${uuid(1)}`)).body.created_at;

    const hits = await search(h, 'zebracorn');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      id: task.id,
      project_id: 'work',
      title: 'Investigate the flaky test',
      type: 'backlog_item',
      status: expect.any(String),
      task_state: 'todo',
      match: { kind: 'comment', comment_id: uuid(1), created_at: created },
    });
    expect(hits[0]!.snippet).toContain('zebracorn fixture');
    expect(highlighted(hits[0]!)).toEqual(['zebracorn']);
  });

  it('labels a description match and highlights every prefix-matched term', async () => {
    const hits = await search(h, 'logi fail');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.match).toEqual({ kind: 'description' });
    expect(hits[0]!.snippet).toContain('login suite fails');
    expect(highlighted(hits[0]!)).toEqual(['login', 'fails']);
  });

  it('returns a task matching in its description and two comments once, with the strongest snippet', async () => {
    const both = await createDoc(h, 'work', 'Cache warmup', { body: 'Mentions quokka once.\n' });
    await comment(h, both.id, uuid(1), 'quokka\n');
    await comment(
      h,
      both.id,
      uuid(2),
      `A long note. ${'filler words here. '.repeat(40)}quokka at the end.\n`,
    );

    const hits = await search(h, 'quokka');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.id).toBe(both.id);
    // The one-word comment is the densest match, so it ranks strongest.
    expect(hits[0]!.match).toMatchObject({ kind: 'comment', comment_id: uuid(1) });
  });

  it('groups by task before the limit applies', async () => {
    const busy = await createDoc(h, 'work', 'Busy task');
    for (let i = 1; i <= 5; i++) await comment(h, busy.id, uuid(i), `wombat note ${i}\n`);
    const quiet = await createDoc(h, 'work', 'Quiet task', { body: 'One wombat mention.\n' });

    const hits = await search(h, 'wombat', { limit: 2 });
    expect(hits.map((hit) => hit.id).sort()).toEqual([busy.id, quiet.id].sort());
  });

  it('needs all terms inside one comment; terms split across two comments do not match', async () => {
    await comment(h, task.id, uuid(1), 'The pelican was here.\n');
    await comment(h, task.id, uuid(2), 'And a narwhal too.\n');
    expect(await search(h, 'pelican narwhal')).toEqual([]);

    await comment(h, task.id, uuid(3), 'Both pelican and narwhal in one place.\n');
    const hits = await search(h, 'pelican narwhal');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.match).toMatchObject({ kind: 'comment', comment_id: uuid(3) });
  });

  it('does not combine a description term with a comment term', async () => {
    await comment(h, task.id, uuid(1), 'Mentions axolotl only.\n');
    expect(await search(h, 'login axolotl')).toEqual([]);
  });

  it("finds an archived task's comment and marks the result archived", async () => {
    await comment(h, task.id, uuid(1), 'The capybara theory holds.\n');
    expect(
      (await request(h.app).put(`/api/documents/${task.id}`).send({ status: 'archived' })).status,
    ).toBe(200);

    const hits = await search(h, 'capybara');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ id: task.id, status: 'archived', match: { kind: 'comment' } });
  });

  it('makes a new comment searchable immediately, follows an edit, and drops it after delete', async () => {
    await comment(h, task.id, uuid(1), 'First draft mentions ocelot.\n');
    expect(await search(h, 'ocelot')).toHaveLength(1);

    const current = (await request(h.app).get(`/api/comments/${uuid(1)}`)).body;
    const edited = await request(h.app)
      .put(`/api/comments/${uuid(1)}`)
      .set('Idempotency-Key', uuid(2000))
      .set('If-Match', current.revision)
      .send({ body: 'Rewritten to mention lynx.\n' });
    expect(edited.status).toBe(200);
    expect(await search(h, 'ocelot')).toEqual([]);
    expect(await search(h, 'lynx')).toHaveLength(1);

    const deleted = await request(h.app)
      .delete(`/api/comments/${uuid(1)}`)
      .set('Idempotency-Key', uuid(2001))
      .set('If-Match', edited.body.result_revision);
    expect(deleted.status).toBe(200);
    expect(await search(h, 'lynx')).toEqual([]);
  });

  it('never returns orphaned or malformed comment files, before or after Reload and Reindex', async () => {
    const at = '2026-10-19T16:00:00.000Z';
    await writeRaw(
      h,
      `work/tickets/${uuid(999)}/comments/${uuid(1)}.md`,
      commentFile(uuid(1), uuid(999), at, 'Orphaned dingo note.\n'),
    );
    await writeRaw(h, `work/tickets/${task.id}/comments/${uuid(2)}.md`, 'no frontmatter dingo\n');
    await writeRaw(
      h,
      `work/tickets/${task.id}/comments/${uuid(3)}.md`,
      commentFile(uuid(3), task.id, at, 'Valid dingo note.\n').replace(
        'schema_version: 1',
        'schema_version: 9',
      ),
    );

    expect((await request(h.app).post('/api/projects/work/reload')).status).toBe(200);
    expect(await search(h, 'dingo')).toEqual([]);
    expect((await request(h.app).post('/api/admin/reindex')).status).toBe(200);
    expect(await search(h, 'dingo')).toEqual([]);
  });

  it('indexes comment files picked up by Reload and Reindex', async () => {
    const at = '2026-10-19T16:00:00.000Z';
    await writeRaw(
      h,
      `work/tickets/${task.id}/comments/${uuid(1)}.md`,
      commentFile(uuid(1), task.id, at, 'Written outside the app: meerkat.\n'),
    );
    expect(await search(h, 'meerkat')).toEqual([]);

    expect((await request(h.app).post('/api/projects/work/reload')).status).toBe(200);
    expect((await search(h, 'meerkat'))[0]?.match).toEqual({
      kind: 'comment',
      comment_id: uuid(1),
      created_at: at,
    });
    expect((await request(h.app).post('/api/admin/reindex')).status).toBe(200);
    expect(await search(h, 'meerkat')).toHaveLength(1);
  });

  it('drops comments of a deleted task', async () => {
    await comment(h, task.id, uuid(1), 'Notes about a gecko.\n');
    expect((await request(h.app).delete(`/api/documents/${task.id}`)).status).toBe(204);
    expect(await search(h, 'gecko')).toEqual([]);
  });

  it('filters comment matches by the project the task lives in', async () => {
    await createProject(h, 'other');
    await comment(h, task.id, uuid(1), 'A heron sighting.\n');
    expect(await search(h, 'heron', { projectId: 'other' })).toEqual([]);
    expect(await search(h, 'heron', { projectId: 'work' })).toHaveLength(1);
  });
});
