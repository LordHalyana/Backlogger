import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import request from 'supertest';
import { setup, teardown, type Harness } from './test-support.js';

/**
 * Backup inventory (#75, spec #58 testing decisions): a full copy of the data
 * directory taken with the app stopped keeps retry behaviour; a Markdown-only
 * rebuild does not. Real routes over temp data dirs with an on-disk SQLite
 * file, as `server.ts` opens it.
 */

/** Deterministic UUIDs v4: `uuid(7)` → `00000000-0000-4000-8000-000000000007`. */
function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

const DB_FILE = 'backlogger.sqlite';

async function start(dataDir?: string): Promise<Harness> {
  dataDir ??= await fs.mkdtemp(path.join(os.tmpdir(), 'backlogger-backup-'));
  return setup({ dataDir, dbFile: path.join(dataDir, DB_FILE) });
}

function post(h: Harness, taskId: string, key: string, body: unknown) {
  return request(h.app)
    .post(`/api/documents/${taskId}/comments`)
    .set('Idempotency-Key', key)
    .send(body as object);
}

function commentsDir(h: Harness, projectId: string, taskId: string): string {
  return path.join(h.dataDir, 'projects', projectId, 'tickets', taskId, 'comments');
}

async function readTree(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    out[path.relative(root, abs)] = await fs.readFile(abs, 'utf8');
  }
  return out;
}

describe('Backup inventory', () => {
  let live: Harness;
  let restored: Harness | undefined;
  let workTask: string;
  const inboxTask = uuid(50);
  const workPost = { id: uuid(1), body: 'Backed up\n\n- with a list' };
  const inboxPost = { id: uuid(2), body: 'From the inbox' };
  let workAck: unknown;
  let inboxAck: unknown;

  beforeEach(async () => {
    live = await start();
    expect(
      (await request(live.app).post('/api/projects').send({ id: 'work', name: 'Client work' }))
        .status,
    ).toBe(201);
    const doc = await request(live.app)
      .post('/api/projects/work/documents')
      .send({ type: 'backlog_item', title: 'Keep my retries' });
    expect(doc.status).toBe(201);
    workTask = doc.body.id as string;
    const captured = await request(live.app)
      .post('/api/capture')
      .send({ id: inboxTask, title: 'Captured thought' });
    expect(captured.status).toBe(201);

    const work = await post(live, workTask, uuid(100), workPost);
    expect(work.status).toBe(201);
    workAck = work.body;
    const inbox = await post(live, inboxTask, uuid(101), inboxPost);
    expect(inbox.status).toBe(201);
    inboxAck = inbox.body;

    // Stop the app: closing the last connection checkpoints the WAL into
    // the database file.
    live.db.close();
  });

  afterEach(async () => {
    await teardown(live);
    if (restored) await teardown(restored);
    restored = undefined;
  });

  it('a full copy holds Markdown, workspace.json and operational state, and replays completed acks', async () => {
    const copyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'backlogger-restore-'));
    await fs.cp(live.dataDir, copyDir, { recursive: true });

    const files = await readTree(copyDir);
    expect(files['workspace.json']).toBeDefined();
    expect(
      files[path.join('projects', 'work', 'tickets', workTask, 'comments', `${uuid(1)}.md`)],
    ).toContain('Backed up');
    expect(files[DB_FILE]).toBeDefined();

    restored = await start(copyDir);
    const receipts = restored.db
      .prepare(`SELECT operation_id FROM operations ORDER BY operation_id`)
      .all() as Array<{ operation_id: string }>;
    expect(receipts.map((r) => r.operation_id)).toEqual([uuid(100), uuid(101)]);
    const markdownBefore = await readTree(path.join(copyDir, 'projects'));

    const workRetry = await post(restored, workTask, uuid(100), workPost);
    expect(workRetry.status).toBe(201);
    expect(workRetry.body).toEqual(workAck);
    const inboxRetry = await post(restored, inboxTask, uuid(101), inboxPost);
    expect(inboxRetry.status).toBe(201);
    expect(inboxRetry.body).toEqual(inboxAck);

    expect(await readTree(path.join(copyDir, 'projects'))).toEqual(markdownBefore);
    expect(await fs.readdir(commentsDir(restored, 'work', workTask))).toEqual([`${uuid(1)}.md`]);

    // The database carries the project row, so name and writability survive.
    const project = await request(restored.app).get('/api/projects/work');
    expect(project.body).toMatchObject({ name: 'Client work', readOnly: false });
  });

  it('a Markdown-only rebuild loses retry history: the same key is treated as new', async () => {
    const rebuiltDir = await fs.mkdtemp(path.join(os.tmpdir(), 'backlogger-rebuild-'));
    await fs.cp(path.join(live.dataDir, 'projects'), path.join(rebuiltDir, 'projects'), {
      recursive: true,
    });
    await fs.copyFile(
      path.join(live.dataDir, 'workspace.json'),
      path.join(rebuiltDir, 'workspace.json'),
    );

    restored = await start(rebuiltDir);
    expect((await request(restored.app).post('/api/admin/reindex')).status).toBe(200);
    const count = restored.db.prepare(`SELECT COUNT(*) AS n FROM operations`).get() as {
      n: number;
    };
    expect(count.n).toBe(0);
    const markdownBefore = await readTree(path.join(rebuiltDir, 'projects'));

    // The comment is back in the index, but its receipt is gone: the retry is
    // a new create whose id is already taken, not a replay of the ack.
    expect((await request(restored.app).get(`/api/comments/${uuid(2)}`)).status).toBe(200);
    const retry = await post(restored, inboxTask, uuid(101), inboxPost);
    expect(retry.status).toBe(409);
    expect(retry.body.error.code).toBe('COMMENT_ID_CONFLICT');
    expect(retry.body).not.toEqual(inboxAck);
    expect(await readTree(path.join(rebuiltDir, 'projects'))).toEqual(markdownBefore);

    // Known limitation: ordinary projects come back read-only under a
    // folder-derived name.
    const project = await request(restored.app).get('/api/projects/work');
    expect(project.body).toMatchObject({ name: 'Work', readOnly: true });
    const workRetry = await post(restored, workTask, uuid(100), workPost);
    expect(workRetry.body.error.code).toBe('COMMENT_NOT_WRITABLE');
  });
});
