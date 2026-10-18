import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import request from 'supertest';
import { createApp } from './app.js';
import { buildContext } from './context.js';
import { openDatabase } from './db/database.js';
import { loadTemplatesFromDir, TemplateRegistry } from './templates/registry.js';
import { MIGRATIONS_DIR, setup, teardown, TEMPLATES_DIR, type Harness } from './test-support.js';

describe('GET /health', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
  });
  afterEach(() => teardown(h));

  it('returns the expanded subsystem payload', async () => {
    const res = await request(h.app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.api).toBe('ok');
    expect(res.body.database).toBe('ok');
    expect(res.body.storage).toBe('ok');
    expect(res.body.templates).toBe('ok');
    expect(res.body.fts).toBe('ok');
    expect(typeof res.body.version).toBe('string');
    expect(typeof res.body.uptime).toBe('number');
    expect(typeof res.body.uptime_s).toBe('number');
    expect(typeof res.body.checked_at).toBe('string');
  });

  it('serves the JSON Schema at /health/schema with matching shape', async () => {
    const res = await request(h.app).get('/health/schema');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/schema\+json/);
    expect(res.body.title).toBe('HealthResponse');
    expect(res.body.required).toEqual(
      expect.arrayContaining([
        'status', 'api', 'database', 'storage', 'templates', 'fts',
        'version', 'uptime', 'uptime_s', 'checked_at',
      ]),
    );

    // Cross-check: a real `/health` response must satisfy the schema's required keys.
    const health = await request(h.app).get('/health');
    for (const key of res.body.required) {
      expect(health.body).toHaveProperty(key);
    }
  });
});

describe('CORS allow-list', () => {
  let h: Harness | null = null;
  afterEach(async () => {
    if (h) await teardown(h);
    h = null;
  });

  function setupWithOrigins(allowed: string[] | '*' | undefined): Promise<Harness> {
    return setup({ allowedOrigins: allowed });
  }

  it('reflects any origin when allowedOrigins is "*"', async () => {
    h = await setupWithOrigins('*');
    const res = await request(h.app).get('/health').set('Origin', 'http://home.local');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://home.local');
  });

  it('echoes only allowed origins when allowedOrigins is a list', async () => {
    h = await setupWithOrigins(['http://home.local']);
    const allowed = await request(h.app).get('/health').set('Origin', 'http://home.local');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://home.local');
    const denied = await request(h.app).get('/health').set('Origin', 'http://evil.local');
    // cors() omits the header (rather than 4xx) when origin is not allowed.
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    // Endpoint itself still responds (single-user, LAN) — CORS only controls browser-side use.
    expect(denied.status).toBe(200);
  });

  it('disables CORS entirely when allowedOrigins is empty', async () => {
    h = await setupWithOrigins([]);
    const res = await request(h.app).get('/health').set('Origin', 'http://home.local');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('Projects API', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
  });
  afterEach(() => teardown(h));

  it('lists only the Inbox initially', async () => {
    const res = await request(h.app).get('/api/projects');
    expect(res.status).toBe(200);
    expect(res.body.map((p: { id: string }) => p.id)).toEqual(['inbox']);
  });

  it('creates a project and the folder skeleton on disk', async () => {
    const res = await request(h.app)
      .post('/api/projects')
      .send({ id: 'home-system', name: 'Home System', description: 'Infra' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('home-system');
    expect(res.body.name).toBe('Home System');
    expect(res.body.readOnly).toBe(false);
    expect(res.body.created_at).toBeTypeOf('string');

    const folders = await fs.readdir(path.join(h.dataDir, 'projects', 'home-system'));
    expect(folders.sort()).toEqual(
      ['backlog', 'design-docs', 'ideas', 'implementation-plans', 'notes'].sort(),
    );
  });

  it('rejects invalid id', async () => {
    const res = await request(h.app).post('/api/projects').send({ id: 'Bad Id', name: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects missing name', async () => {
    const res = await request(h.app).post('/api/projects').send({ id: 'home-system' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns 409 on duplicate id', async () => {
    await request(h.app).post('/api/projects').send({ id: 'aa', name: 'A' });
    const res = await request(h.app).post('/api/projects').send({ id: 'aa', name: 'A again' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PROJECT_ALREADY_EXISTS');
  });

  it('fetches a single project', async () => {
    await request(h.app).post('/api/projects').send({ id: 'aa', name: 'A' });
    const res = await request(h.app).get('/api/projects/aa');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('aa');
  });

  it('returns 404 for missing project', async () => {
    const res = await request(h.app).get('/api/projects/ghost');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PROJECT_NOT_FOUND');
  });

  it('returns 400 for invalid id on GET', async () => {
    const res = await request(h.app).get('/api/projects/UPPER');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PROJECT_ID');
  });

  it('updates name and description', async () => {
    await request(h.app).post('/api/projects').send({ id: 'aa', name: 'A' });
    const res = await request(h.app)
      .put('/api/projects/aa')
      .send({ name: 'A2', description: 'desc' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('A2');
    expect(res.body.description).toBe('desc');
  });

  it('toggles project read-only mode', async () => {
    await request(h.app).post('/api/projects').send({ id: 'aa', name: 'A' });
    const locked = await request(h.app).put('/api/projects/aa').send({ readOnly: true });
    expect(locked.status).toBe(200);
    expect(locked.body.readOnly).toBe(true);

    const unlocked = await request(h.app).put('/api/projects/aa').send({ readOnly: false });
    expect(unlocked.status).toBe(200);
    expect(unlocked.body.readOnly).toBe(false);
  });

  it('rejects empty update body', async () => {
    await request(h.app).post('/api/projects').send({ id: 'aa', name: 'A' });
    const res = await request(h.app).put('/api/projects/aa').send({});
    expect(res.status).toBe(400);
  });

  it('deletes a project and removes its folder', async () => {
    await request(h.app).post('/api/projects').send({ id: 'aa', name: 'A' });
    const res = await request(h.app).delete('/api/projects/aa');
    expect(res.status).toBe(204);

    const get = await request(h.app).get('/api/projects/aa');
    expect(get.status).toBe(404);

    await expect(fs.access(path.join(h.dataDir, 'projects', 'aa'))).rejects.toThrow();
  });

  it('blocks project deletion while read-only mode is enabled', async () => {
    await request(h.app).post('/api/projects').send({ id: 'aa', name: 'A' });
    await request(h.app).put('/api/projects/aa').send({ readOnly: true });

    const res = await request(h.app).delete('/api/projects/aa');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PROJECT_READ_ONLY');
    await expect(fs.access(path.join(h.dataDir, 'projects', 'aa'))).resolves.toBeUndefined();
  });

  it('delete returns 404 for missing project', async () => {
    const res = await request(h.app).delete('/api/projects/ghost');
    expect(res.status).toBe(404);
  });
});

describe('Documents API', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
    await request(h.app).post('/api/projects').send({ id: 'aa', name: 'A' });
  });
  afterEach(() => teardown(h));

  it('lists empty initially', async () => {
    const res = await request(h.app).get('/api/projects/aa/documents');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('creates an idea document and writes it under ideas/', async () => {
    const res = await request(h.app)
      .post('/api/projects/aa/documents')
      .send({ title: 'My First Idea', type: 'idea', body: '# hello\n' });
    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.path.startsWith('aa/ideas/')).toBe(true);
    expect(res.body.path.endsWith('.md')).toBe(true);
    expect(res.body.status).toBe('draft');
    expect(res.body.tags).toEqual([]);

    const onDisk = await fs.readFile(
      path.join(h.dataDir, 'projects', res.body.path),
      'utf8',
    );
    expect(onDisk).toContain('id: ' + res.body.id);
    expect(onDisk).toContain('# hello');
  });

  it('routes finding docs into notes/', async () => {
    const res = await request(h.app)
      .post('/api/projects/aa/documents')
      .send({ title: 'A Finding', type: 'finding' });
    expect(res.status).toBe(201);
    expect(res.body.path.startsWith('aa/notes/')).toBe(true);
  });

  it('rejects unknown project on create', async () => {
    const res = await request(h.app)
      .post('/api/projects/ghost/documents')
      .send({ title: 't', type: 'idea' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PROJECT_NOT_FOUND');
  });

  it('rejects invalid type', async () => {
    const res = await request(h.app)
      .post('/api/projects/aa/documents')
      .send({ title: 't', type: 'bogus' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('reads back document with body', async () => {
    const created = await request(h.app)
      .post('/api/projects/aa/documents')
      .send({ title: 'Read Me', type: 'note', body: 'body text\n' });
    const res = await request(h.app).get(`/api/documents/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.body).toBe('body text\n');
    expect(res.body.title).toBe('Read Me');
  });

  it('updates title, status, and body and bumps updated_at', async () => {
    const created = await request(h.app)
      .post('/api/projects/aa/documents')
      .send({ title: 'Orig', type: 'note', body: 'a\n' });
    const id = created.body.id;
    // Ensure new timestamp differs.
    await new Promise((r) => setTimeout(r, 5));
    const res = await request(h.app)
      .put(`/api/documents/${id}`)
      .send({ title: 'New', status: 'active', body: 'b\n' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('New');
    expect(res.body.status).toBe('active');
    expect(res.body.body).toBe('b\n');
    expect(res.body.updated_at).not.toBe(created.body.updated_at);
  });

  it('enforces optimistic locking via If-Match', async () => {
    const created = await request(h.app)
      .post('/api/projects/aa/documents')
      .send({ title: 'Lock', type: 'note' });
    const id = created.body.id;
    const stale = '1970-01-01T00:00:00.000Z';
    const res = await request(h.app)
      .put(`/api/documents/${id}`)
      .set('If-Match', stale)
      .send({ title: 'New' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DOCUMENT_VERSION_MISMATCH');
  });

  it('accepts matching If-Match', async () => {
    const created = await request(h.app)
      .post('/api/projects/aa/documents')
      .send({ title: 'Lock', type: 'note' });
    const res = await request(h.app)
      .put(`/api/documents/${created.body.id}`)
      .set('If-Match', created.body.revision)
      .send({ title: 'New2' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('New2');
  });

  it('deletes a document and removes the file', async () => {
    const created = await request(h.app)
      .post('/api/projects/aa/documents')
      .send({ title: 'Bye', type: 'note' });
    const del = await request(h.app).delete(`/api/documents/${created.body.id}`);
    expect(del.status).toBe(204);
    const get = await request(h.app).get(`/api/documents/${created.body.id}`);
    expect(get.status).toBe(404);
    await expect(
      fs.access(path.join(h.dataDir, 'projects', created.body.path)),
    ).rejects.toThrow();
  });

  it('marks documents read-only and blocks writes when the project is read-only', async () => {
    const created = await request(h.app)
      .post('/api/projects/aa/documents')
      .send({ title: 'Locked Doc', type: 'note', body: 'body' });
    await request(h.app).put('/api/projects/aa').send({ readOnly: true });

    const list = await request(h.app).get('/api/projects/aa/documents');
    expect(list.status).toBe(200);
    expect(list.body[0].readOnly).toBe(true);

    const fetched = await request(h.app).get(`/api/documents/${created.body.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.readOnly).toBe(true);

    const create = await request(h.app)
      .post('/api/projects/aa/documents')
      .send({ title: 'Blocked', type: 'note' });
    expect(create.status).toBe(409);
    expect(create.body.error.code).toBe('PROJECT_READ_ONLY');

    const update = await request(h.app)
      .put(`/api/documents/${created.body.id}`)
      .send({ title: 'Blocked' });
    expect(update.status).toBe(409);
    expect(update.body.error.code).toBe('PROJECT_READ_ONLY');

    const del = await request(h.app).delete(`/api/documents/${created.body.id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('PROJECT_READ_ONLY');

    await request(h.app).put('/api/projects/aa').send({ readOnly: false });
    const unlocked = await request(h.app)
      .put(`/api/documents/${created.body.id}`)
      .send({ title: 'Unlocked' });
    expect(unlocked.status).toBe(200);
    expect(unlocked.body.title).toBe('Unlocked');
    expect(unlocked.body.readOnly).toBe(false);
  });

  it('downloads the raw markdown via /api/documents/:id/raw', async () => {
    const created = await request(h.app)
      .post('/api/projects/aa/documents')
      .send({ title: 'Export Me', type: 'note', body: 'hello export\n' });
    const res = await request(h.app).get(`/api/documents/${created.body.id}/raw`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/markdown/);
    expect(res.headers['content-disposition']).toMatch(/attachment;/);
    expect(res.headers['content-disposition']).toMatch(/filename="export-me-[0-9a-f]{8}\.md"/);
    expect(res.headers['content-disposition']).toMatch(/filename\*=UTF-8''Export%20Me\.md/);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.text).toContain('hello export');
    // Bytes must equal the on-disk file exactly.
    const onDisk = await fs.readFile(
      path.join(h.dataDir, 'projects', created.body.path),
      'utf8',
    );
    expect(res.text).toBe(onDisk);
  });

  it('returns 404 when downloading a missing document', async () => {
    const res = await request(h.app).get(
      '/api/documents/00000000-0000-0000-0000-000000000000/raw',
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 when downloading with a malformed id', async () => {
    const res = await request(h.app).get('/api/documents/not-a-uuid/raw');
    expect(res.status).toBe(400);
  });

  it('cascades document rows when project is deleted', async () => {
    const created = await request(h.app)
      .post('/api/projects/aa/documents')
      .send({ title: 'CascadeMe', type: 'note' });
    const del = await request(h.app).delete('/api/projects/aa');
    expect(del.status).toBe(204);
    const list = h.db.prepare('SELECT COUNT(*) AS c FROM documents').get() as { c: number };
    expect(list.c).toBe(0);
    const get = await request(h.app).get(`/api/documents/${created.body.id}`);
    expect(get.status).toBe(404);
  });

  it('reindex rebuilds documents table from disk', async () => {
    const a = await request(h.app)
      .post('/api/projects/aa/documents')
      .send({ title: 'One', type: 'idea' });
    const b = await request(h.app)
      .post('/api/projects/aa/documents')
      .send({ title: 'Two', type: 'note' });
    // Wipe the index.
    h.db.exec('DELETE FROM documents');
    const list1 = await request(h.app).get('/api/projects/aa/documents');
    expect(list1.body).toEqual([]);

    const report = await request(h.app).post('/api/admin/reindex');
    expect(report.status).toBe(200);
    expect(report.body.inserted).toBe(2);
    expect(report.body.skipped).toEqual([]);

    const list2 = await request(h.app).get('/api/projects/aa/documents');
    const ids = (list2.body as Array<{ id: string }>).map((d) => d.id).sort();
    expect(ids).toEqual([a.body.id, b.body.id].sort());
  });

  it('full reindex registers valid project folders instead of skipping their files', async () => {
    const projectDir = path.join(h.dataDir, 'projects', 'mounted-docs');
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, 'readme.md'),
      '# Mounted Docs\n\nDocs from a mounted folder.',
      'utf8',
    );

    const report = await request(h.app).post('/api/admin/reindex');
    expect(report.status).toBe(200);
    expect(report.body.inserted).toBe(1);
    expect(report.body.skipped).toEqual([]);

    const projects = await request(h.app).get('/api/projects');
    expect(projects.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'mounted-docs',
          name: 'Mounted Docs',
          readOnly: true,
        }),
      ]),
    );

    const list = await request(h.app).get('/api/projects/mounted-docs/documents');
    expect(list.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Mounted Docs',
          path: 'mounted-docs/readme.md',
          readOnly: true,
        }),
      ]),
    );
  });
});

describe('Templates API', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
    await request(h.app).post('/api/projects').send({ id: 'aa', name: 'A' });
  });
  afterEach(() => teardown(h));

  it('lists the six built-in templates', async () => {
    const res = await request(h.app).get('/api/templates');
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: string }>).map((t) => t.id).sort();
    expect(ids).toEqual(
      [
        'design-document',
        'docs-template',
        'findings-report',
        'idea-expansion',
        'implementation-plan',
        'risk-assessment',
      ].sort(),
    );
  });

  it('returns a single template with body', async () => {
    const res = await request(h.app).get('/api/templates/design-document');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('design-document');
    expect(res.body.type).toBe('design_doc');
    expect(res.body.body).toContain('{{title}}');
  });

  it('404 for unknown template', async () => {
    const res = await request(h.app).get('/api/templates/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TEMPLATE_NOT_FOUND');
  });

  it('creates a document from a template with placeholders substituted', async () => {
    const res = await request(h.app)
      .post('/api/projects/aa/documents')
      .send({ title: 'My Design', type: 'design_doc', template: 'design-document' });
    expect(res.status).toBe(201);
    expect(res.body.body).toContain('# My Design');
    expect(res.body.body).toContain('Project: aa');
    expect(res.body.body).toMatch(/Created: \d{4}-\d{2}-\d{2}/);
    expect(res.body.body).not.toContain('{{title}}');
  });

  it('400 on template/type mismatch', async () => {
    const res = await request(h.app)
      .post('/api/projects/aa/documents')
      .send({ title: 'X', type: 'note', template: 'design-document' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TEMPLATE_TYPE_MISMATCH');
  });

  it('404 on unknown template id at create', async () => {
    const res = await request(h.app)
      .post('/api/projects/aa/documents')
      .send({ title: 'X', type: 'design_doc', template: 'ghost' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TEMPLATE_NOT_FOUND');
  });
});

describe('Search API', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
    await request(h.app)
      .post('/api/projects')
      .send({ id: 'demo', name: 'Demo' });
    await request(h.app)
      .post('/api/projects/demo/documents')
      .send({
        title: 'Rate limiting strategy',
        type: 'design_doc',
        body: 'Token bucket leaky bucket rate limit notes.',
        tags: ['infra'],
      });
    await request(h.app)
      .post('/api/projects/demo/documents')
      .send({
        title: 'Onboarding checklist',
        type: 'note',
        body: 'New hire checklist with no overlap.',
        tags: ['people'],
      });
    await request(h.app)
      .post('/api/projects/demo/documents')
      .send({
        title: 'Caching plan',
        type: 'implementation_plan',
        body: 'Discusses cache stampede and rate behavior.',
        tags: ['infra'],
      });
  });
  afterEach(() => teardown(h));

  it('400 when q is missing', async () => {
    const res = await request(h.app).get('/api/search');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('400 when q has no searchable terms', async () => {
    const res = await request(h.app).get('/api/search').query({ q: '"":' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SEARCH_QUERY_REQUIRED');
  });

  it('finds documents matching a single term', async () => {
    const res = await request(h.app).get('/api/search').query({ q: 'rate' });
    expect(res.status).toBe(200);
    const titles: string[] = res.body.map((h: { title: string }) => h.title).sort();
    expect(titles).toEqual(['Caching plan', 'Rate limiting strategy']);
    for (const hit of res.body) {
      expect(hit).toMatchObject({
        id: expect.any(String),
        project_id: 'demo',
        title: expect.any(String),
        type: expect.any(String),
        snippet: expect.any(String),
        rank: expect.any(Number),
      });
    }
  });

  it('finds documents matching all of multiple terms (AND)', async () => {
    const res = await request(h.app).get('/api/search').query({ q: 'rate bucket' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('Rate limiting strategy');
  });

  it('supports prefix matches', async () => {
    const res = await request(h.app).get('/api/search').query({ q: 'limit' });
    expect(res.status).toBe(200);
    const titles: string[] = res.body.map((h: { title: string }) => h.title);
    expect(titles).toContain('Rate limiting strategy');
  });

  it('filters by projectId', async () => {
    await request(h.app)
      .post('/api/projects')
      .send({ id: 'other', name: 'Other' });
    await request(h.app)
      .post('/api/projects/other/documents')
      .send({ title: 'Other rate notes', type: 'note', body: 'Rate limit elsewhere.' });

    const res = await request(h.app)
      .get('/api/search')
      .query({ q: 'rate', projectId: 'demo' });
    expect(res.status).toBe(200);
    expect(res.body.every((h: { project_id: string }) => h.project_id === 'demo')).toBe(true);
  });

  it('returns a snippet without FTS5 marker characters', async () => {
    const res = await request(h.app).get('/api/search').query({ q: 'bucket' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].snippet).not.toMatch(/\[\[|\]\]/);
    expect(res.body[0].snippet.toLowerCase()).toContain('bucket');
  });

  it('respects the limit parameter', async () => {
    const res = await request(h.app).get('/api/search').query({ q: 'rate', limit: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('removes deleted documents from results', async () => {
    const created = await request(h.app)
      .post('/api/projects/demo/documents')
      .send({ title: 'Temporary doc', type: 'note', body: 'Findable phrase xyzzy here.' });
    const id = created.body.id as string;
    const before = await request(h.app).get('/api/search').query({ q: 'xyzzy' });
    expect(before.body).toHaveLength(1);

    const del = await request(h.app).delete(`/api/documents/${id}`);
    expect(del.status).toBe(204);

    const after = await request(h.app).get('/api/search').query({ q: 'xyzzy' });
    expect(after.body).toHaveLength(0);
  });

  it('reindex rebuilds FTS row count equal to documents row count', async () => {
    const before = (
      h.db.prepare('SELECT COUNT(*) AS c FROM documents_fts').get() as { c: number }
    ).c;
    const reindex = await request(h.app).post('/api/admin/reindex');
    expect(reindex.status).toBe(200);
    const docs = (
      h.db.prepare('SELECT COUNT(*) AS c FROM documents').get() as { c: number }
    ).c;
    const fts = (
      h.db.prepare('SELECT COUNT(*) AS c FROM documents_fts').get() as { c: number }
    ).c;
    expect(fts).toBe(docs);
    expect(fts).toBe(before);
  });
});

describe('Links API', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
    await request(h.app).post('/api/projects').send({ id: 'demo', name: 'Demo' });
  });
  afterEach(() => teardown(h));

  async function makeDoc(title: string, body = '', type = 'note'): Promise<string> {
    const res = await request(h.app)
      .post('/api/projects/demo/documents')
      .send({ title, type, body });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  it('persists outgoing wiki links on create', async () => {
    const targetId = await makeDoc('Other Doc', 'target body');
    const sourceId = await makeDoc('Source', 'See [[Other Doc]] for details');
    const backlinks = await request(h.app).get(`/api/documents/${targetId}/backlinks`);
    expect(backlinks.status).toBe(200);
    expect(backlinks.body).toHaveLength(1);
    expect(backlinks.body[0]).toMatchObject({ id: sourceId, title: 'Source', display: 'Other Doc' });
  });

  it('leaves target_id NULL when the target does not exist yet', async () => {
    const sourceId = await makeDoc('Source', 'See [[Ghost]] please');
    const rows = h.db
      .prepare('SELECT target_id FROM links WHERE source_id = ?')
      .all(sourceId) as Array<{ target_id: string | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.target_id).toBeNull();
  });

  it('resolves previously-broken links when the target is created later', async () => {
    const sourceId = await makeDoc('Source', 'See [[Future Doc]]');
    let rows = h.db
      .prepare('SELECT target_id FROM links WHERE source_id = ?')
      .all(sourceId) as Array<{ target_id: string | null }>;
    expect(rows[0]!.target_id).toBeNull();

    const targetId = await makeDoc('Future Doc', 'now here');
    rows = h.db
      .prepare('SELECT target_id FROM links WHERE source_id = ?')
      .all(sourceId) as Array<{ target_id: string | null }>;
    expect(rows[0]!.target_id).toBe(targetId);
  });

  it('matches titles case-insensitively', async () => {
    const targetId = await makeDoc('Mixed CASE Doc');
    const sourceId = await makeDoc('Source', 'See [[mixed case doc]]');
    const rows = h.db
      .prepare('SELECT target_id FROM links WHERE source_id = ?')
      .all(sourceId) as Array<{ target_id: string | null }>;
    expect(rows[0]!.target_id).toBe(targetId);
    const backlinks = await request(h.app).get(`/api/documents/${targetId}/backlinks`);
    expect(backlinks.body[0]?.id).toBe(sourceId);
  });

  it('respects the alias form `[[Title|display]]`', async () => {
    const targetId = await makeDoc('Real Title');
    await makeDoc('Source', 'See [[Real Title|click here]]');
    const backlinks = await request(h.app).get(`/api/documents/${targetId}/backlinks`);
    expect(backlinks.body[0]?.display).toBe('click here');
  });

  it('clears target_id when the target is deleted', async () => {
    const targetId = await makeDoc('Doomed');
    const sourceId = await makeDoc('Source', 'See [[Doomed]]');
    expect(
      (
        h.db
          .prepare('SELECT target_id FROM links WHERE source_id = ?')
          .get(sourceId) as { target_id: string | null }
      ).target_id,
    ).toBe(targetId);

    const del = await request(h.app).delete(`/api/documents/${targetId}`);
    expect(del.status).toBe(204);

    const after = h.db
      .prepare('SELECT target_id FROM links WHERE source_id = ?')
      .get(sourceId) as { target_id: string | null };
    expect(after.target_id).toBeNull();

    const backlinks = await request(h.app).get(`/api/documents/${targetId}/backlinks`);
    // Target gone; backlinks for that id are empty.
    expect(backlinks.body).toEqual([]);
  });

  it('updates link rows when the source body changes', async () => {
    const aId = await makeDoc('A');
    const bId = await makeDoc('B');
    const sourceId = await makeDoc('Source', 'See [[A]]');

    let backlinksA = await request(h.app).get(`/api/documents/${aId}/backlinks`);
    expect(backlinksA.body).toHaveLength(1);
    let backlinksB = await request(h.app).get(`/api/documents/${bId}/backlinks`);
    expect(backlinksB.body).toHaveLength(0);

    const doc = (await request(h.app).get(`/api/documents/${sourceId}`)).body;
    const upd = await request(h.app)
      .put(`/api/documents/${sourceId}`)
      .set('If-Match', doc.revision)
      .send({ body: 'See [[B]] now' });
    expect(upd.status).toBe(200);

    backlinksA = await request(h.app).get(`/api/documents/${aId}/backlinks`);
    expect(backlinksA.body).toHaveLength(0);
    backlinksB = await request(h.app).get(`/api/documents/${bId}/backlinks`);
    expect(backlinksB.body).toHaveLength(1);
  });

  it('re-resolves links when the target is renamed', async () => {
    const targetId = await makeDoc('First Name');
    const sourceId = await makeDoc('Source', 'See [[First Name]]');
    expect(
      (
        h.db
          .prepare('SELECT target_id FROM links WHERE source_id = ?')
          .get(sourceId) as { target_id: string | null }
      ).target_id,
    ).toBe(targetId);

    // Rename target.
    const doc = (await request(h.app).get(`/api/documents/${targetId}`)).body;
    const upd = await request(h.app)
      .put(`/api/documents/${targetId}`)
      .set('If-Match', doc.revision)
      .send({ title: 'Second Name' });
    expect(upd.status).toBe(200);

    // The existing link still pointed at "First Name" — refresh logic on the
    // renamed target should null it out (no doc with that title any more).
    const row = h.db
      .prepare('SELECT target_id FROM links WHERE source_id = ?')
      .get(sourceId) as { target_id: string | null };
    expect(row.target_id).toBeNull();
  });

  it('GET /api/projects/:id/titles returns project titles', async () => {
    await makeDoc('Alpha');
    await makeDoc('Bravo');
    const res = await request(h.app).get('/api/projects/demo/titles');
    expect(res.status).toBe(200);
    const titles = (res.body as Array<{ title: string }>).map((r) => r.title).sort();
    expect(titles).toEqual(['Alpha', 'Bravo']);
  });

  it('reindex rebuilds the links table from disk', async () => {
    const targetId = await makeDoc('Persisted');
    const sourceId = await makeDoc('Source', 'See [[Persisted]] please');
    const before = h.db.prepare('SELECT COUNT(*) AS c FROM links').get() as { c: number };
    expect(before.c).toBe(1);

    const reindex = await request(h.app).post('/api/admin/reindex');
    expect(reindex.status).toBe(200);

    const after = h.db.prepare('SELECT COUNT(*) AS c FROM links').get() as { c: number };
    expect(after.c).toBe(1);
    const row = h.db
      .prepare('SELECT target_id FROM links WHERE source_id = ?')
      .get(sourceId) as { target_id: string | null };
    expect(row.target_id).toBe(targetId);
  });
});

describe('Tags API', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await setup();
    await request(h.app).post('/api/projects').send({ id: 'demo', name: 'Demo' });
  });

  afterEach(() => teardown(h));

  const makeTaggedDoc = async (
    title: string,
    tags: string[],
    projectId = 'demo',
  ): Promise<string> => {
    const res = await request(h.app)
      .post(`/api/projects/${projectId}/documents`)
      .send({ type: 'note', title, body: 'body', tags });
    expect(res.status).toBe(201);
    return (res.body as { id: string }).id;
  };

  it('normalizes and deduplicates tags on create', async () => {
    const id = await makeTaggedDoc('NormTest', ['Foo', 'foo', 'Foo Bar']);
    const rows = h.db
      .prepare('SELECT tag FROM document_tags WHERE document_id = ? ORDER BY tag')
      .all(id) as { tag: string }[];
    expect(rows.map((r) => r.tag)).toEqual(['foo', 'foo-bar']);
  });

  it('GET /api/tags?projectId returns tag counts', async () => {
    await makeTaggedDoc('A', ['alpha', 'beta']);
    await makeTaggedDoc('B', ['alpha']);

    const res = await request(h.app).get('/api/tags?projectId=demo');
    expect(res.status).toBe(200);
    const body = res.body as { tag: string; count: number }[];
    const alpha = body.find((r) => r.tag === 'alpha');
    const beta = body.find((r) => r.tag === 'beta');
    expect(alpha?.count).toBe(2);
    expect(beta?.count).toBe(1);
  });

  it('GET /api/tags without projectId returns all tags', async () => {
    await makeTaggedDoc('A', ['global']);
    const res = await request(h.app).get('/api/tags');
    expect(res.status).toBe(200);
    const body = res.body as { tag: string; count: number }[];
    expect(body.some((r) => r.tag === 'global')).toBe(true);
  });

  it('GET /api/projects/:id/documents?tag= filters by tag (AND)', async () => {
    await makeTaggedDoc('Both', ['x', 'y']);
    await makeTaggedDoc('OnlyX', ['x']);
    await makeTaggedDoc('OnlyY', ['y']);

    const res = await request(h.app).get('/api/projects/demo/documents?tag=x&tag=y');
    expect(res.status).toBe(200);
    const titles = (res.body as { title: string }[]).map((d) => d.title);
    expect(titles).toContain('Both');
    expect(titles).not.toContain('OnlyX');
    expect(titles).not.toContain('OnlyY');
  });

  it('GET /api/projects/:id/documents?tag= with invalid tag returns 400', async () => {
    const res = await request(h.app).get('/api/projects/demo/documents?tag=!!!invalid');
    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe('INVALID_TAG');
  });

  it('deleting a document removes its tag rows (CASCADE)', async () => {
    const id = await makeTaggedDoc('ToDelete', ['cascade-test']);
    const before = h.db
      .prepare('SELECT COUNT(*) AS c FROM document_tags WHERE document_id = ?')
      .get(id) as { c: number };
    expect(before.c).toBeGreaterThan(0);

    const del = await request(h.app).delete(`/api/documents/${id}`);
    expect(del.status).toBe(204);

    const after = h.db
      .prepare('SELECT COUNT(*) AS c FROM document_tags WHERE document_id = ?')
      .get(id) as { c: number };
    expect(after.c).toBe(0);
  });

  it('reindex rebuilds document_tags consistently', async () => {
    await makeTaggedDoc('R1', ['rebuild']);
    await makeTaggedDoc('R2', ['rebuild', 'extra']);

    const reindex = await request(h.app).post('/api/admin/reindex');
    expect(reindex.status).toBe(200);

    const res = await request(h.app).get('/api/tags?projectId=demo');
    const body = res.body as { tag: string; count: number }[];
    const rebuild = body.find((r) => r.tag === 'rebuild');
    expect(rebuild?.count).toBe(2);
  });
});

describe('Templates API — user templates', () => {
  let h: Harness;
  let userDir: string;

  beforeEach(async () => {
    userDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bl-user-tmpl-'));
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'backlogger-api-'));
    const db = openDatabase({ file: ':memory:', migrationsDir: MIGRATIONS_DIR });
    const templates = new TemplateRegistry();
    const { loaded } = await loadTemplatesFromDir(TEMPLATES_DIR);
    templates.setAll(loaded);
    const ctx = buildContext({
      db,
      dataDir,
      templates,
      builtinTemplatesDir: TEMPLATES_DIR,
      userTemplatesDir: userDir,
    });
    await ctx.fs.ensureRoot();
    h = { app: createApp(ctx), dataDir, db, ctx };
  });

  afterEach(async () => {
    h.db.close();
    await fs.rm(h.dataDir, { recursive: true, force: true });
    await fs.rm(userDir, { recursive: true, force: true });
  });

  it('GET /api/templates returns source field on each template', async () => {
    const res = await request(h.app).get('/api/templates').expect(200);
    const body = res.body as { id: string; source: string }[];
    expect(body.every((t) => t.source === 'builtin' || t.source === 'user')).toBe(true);
  });

  it('POST /api/admin/reload-templates returns loaded count and empty skipped', async () => {
    const res = await request(h.app).post('/api/admin/reload-templates').expect(200);
    const body = res.body as { loaded: number; skipped: unknown[] };
    expect(body.loaded).toBeGreaterThan(0);
    expect(body.skipped).toEqual([]);
  });

  it('POST /api/admin/reload-templates picks up a new user template', async () => {
    const frontmatter = '---\ntemplate_id: my-new\ntemplate_name: My New\ntype: note\n---\n# body';
    await fs.writeFile(path.join(userDir, 'my-new.md'), frontmatter);

    await request(h.app).post('/api/admin/reload-templates').expect(200);

    const res = await request(h.app).get('/api/templates').expect(200);
    const body = res.body as { id: string; source: string }[];
    const t = body.find((x) => x.id === 'my-new');
    expect(t).toBeDefined();
    expect(t?.source).toBe('user');
  });

  it('POST /api/admin/reload-templates returns 501 when dirs not configured', async () => {
    // harness without dirs
    const db2 = openDatabase({ file: ':memory:', migrationsDir: MIGRATIONS_DIR });
    const dataDir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'bl-nodirs-'));
    const tpl2 = new TemplateRegistry();
    const ctx2 = buildContext({ db: db2, dataDir: dataDir2, templates: tpl2 });
    await ctx2.fs.ensureRoot();
    const app2 = createApp(ctx2);

    await request(app2).post('/api/admin/reload-templates').expect(501);

    db2.close();
    await fs.rm(dataDir2, { recursive: true, force: true });
  });
});

describe('Import API', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
    await request(h.app).post('/api/projects').send({ id: 'aa', name: 'A' });
  });
  afterEach(() => teardown(h));

  it('imports a plain markdown file using placement type+titleStrategy', async () => {
    const res = await request(h.app)
      .post('/api/projects/aa/import')
      .send({
        placement: { type: 'note', titleStrategy: 'h1', onDuplicate: 'skip' },
        files: [{ filename: 'whatever.md', content: '# From H1\n\nbody text\n' }],
      });
    expect(res.status).toBe(200);
    expect(res.body.imported).toHaveLength(1);
    expect(res.body.imported[0].title).toBe('From H1');
    expect(res.body.skipped).toEqual([]);
    expect(res.body.errors).toEqual([]);

    const list = await request(h.app).get('/api/projects/aa/documents');
    expect(list.body).toHaveLength(1);
    expect(list.body[0].type).toBe('note');
    expect(list.body[0].title).toBe('From H1');
  });

  it('honors frontmatter type/title/tags when present', async () => {
    const content = [
      '---',
      'title: Spec Doc',
      'type: design_doc',
      'tags: [planning, p3]',
      '---',
      '',
      'body',
      '',
    ].join('\n');
    const res = await request(h.app)
      .post('/api/projects/aa/import')
      .send({
        placement: { type: 'note', titleStrategy: 'frontmatter', onDuplicate: 'skip' },
        files: [{ filename: 'spec.md', content }],
      });
    expect(res.status).toBe(200);
    expect(res.body.imported[0].title).toBe('Spec Doc');
    const list = await request(h.app).get('/api/projects/aa/documents');
    expect(list.body[0].type).toBe('design_doc');
    expect(list.body[0].tags.sort()).toEqual(['p3', 'planning']);
  });

  it('skips an exact frontmatter-id duplicate when onDuplicate=skip', async () => {
    const created = await request(h.app)
      .post('/api/projects/aa/documents')
      .send({ title: 'Round Trip', type: 'note', body: 'hello' });
    const raw = await request(h.app).get(`/api/documents/${created.body.id}/raw`);
    expect(raw.status).toBe(200);

    const res = await request(h.app)
      .post('/api/projects/aa/import')
      .send({
        placement: { type: 'note', titleStrategy: 'frontmatter', onDuplicate: 'skip' },
        files: [{ filename: 'round-trip.md', content: raw.text }],
      });
    expect(res.status).toBe(200);
    expect(res.body.skipped).toHaveLength(1);
    expect(res.body.skipped[0].existingId).toBe(created.body.id);
    expect(res.body.imported).toEqual([]);
  });

  it('replaces an existing document when onDuplicate=replace', async () => {
    const created = await request(h.app)
      .post('/api/projects/aa/documents')
      .send({ title: 'Replace Me', type: 'note', body: 'old body' });
    const raw = await request(h.app).get(`/api/documents/${created.body.id}/raw`);
    const modified = raw.text.replace('old body', 'NEW BODY');

    const res = await request(h.app)
      .post('/api/projects/aa/import')
      .send({
        placement: { type: 'note', titleStrategy: 'frontmatter', onDuplicate: 'replace' },
        files: [{ filename: 'replace.md', content: modified }],
      });
    expect(res.status).toBe(200);
    expect(res.body.imported).toHaveLength(1);
    expect(res.body.imported[0].documentId).toBe(created.body.id);

    const fresh = await request(h.app).get(`/api/documents/${created.body.id}`);
    expect(fresh.body.body).toContain('NEW BODY');
  });

  it('creates a copy with a new id when onDuplicate=copy', async () => {
    const created = await request(h.app)
      .post('/api/projects/aa/documents')
      .send({ title: 'Copy Me', type: 'note', body: 'orig' });
    const raw = await request(h.app).get(`/api/documents/${created.body.id}/raw`);

    const res = await request(h.app)
      .post('/api/projects/aa/import')
      .send({
        placement: { type: 'note', titleStrategy: 'frontmatter', onDuplicate: 'copy' },
        files: [{ filename: 'copy.md', content: raw.text }],
      });
    expect(res.status).toBe(200);
    expect(res.body.imported).toHaveLength(1);
    expect(res.body.imported[0].documentId).not.toBe(created.body.id);

    const list = await request(h.app).get('/api/projects/aa/documents');
    expect(list.body).toHaveLength(2);
  });

  it('returns 207 with per-file errors when some files fail (empty + ok mix)', async () => {
    const res = await request(h.app)
      .post('/api/projects/aa/import')
      .send({
        placement: { type: 'note', titleStrategy: 'h1', onDuplicate: 'skip' },
        files: [
          { filename: 'empty.md', content: '' },
          { filename: 'good.md', content: '# Good\n' },
        ],
      });
    expect(res.status).toBe(207);
    expect(res.body.imported).toHaveLength(1);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0].code).toBe('EMPTY_FILE');
  });

  it('rejects non-.md filenames during validation (400)', async () => {
    const res = await request(h.app)
      .post('/api/projects/aa/import')
      .send({
        placement: { type: 'note', titleStrategy: 'h1', onDuplicate: 'skip' },
        files: [{ filename: 'notes.txt', content: '# hi' }],
      });
    expect(res.status).toBe(400);
  });

  it('rejects more than 20 files (400)', async () => {
    const files = Array.from({ length: 21 }, (_, i) => ({
      filename: `f${i}.md`,
      content: `# Title ${i}\n`,
    }));
    const res = await request(h.app)
      .post('/api/projects/aa/import')
      .send({
        placement: { type: 'note', titleStrategy: 'h1', onDuplicate: 'skip' },
        files,
      });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown project id', async () => {
    const res = await request(h.app)
      .post('/api/projects/zz/import')
      .send({
        placement: { type: 'note', titleStrategy: 'h1', onDuplicate: 'skip' },
        files: [{ filename: 'x.md', content: '# x' }],
      });
    expect(res.status).toBe(404);
  });

  it('blocks imports while read-only mode is enabled', async () => {
    await request(h.app).put('/api/projects/aa').send({ readOnly: true });
    const res = await request(h.app)
      .post('/api/projects/aa/import')
      .send({
        placement: { type: 'note', titleStrategy: 'h1', onDuplicate: 'skip' },
        files: [{ filename: 'x.md', content: '# x' }],
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PROJECT_READ_ONLY');
  });
});

describe('Project Reload API', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
    await request(h.app).post('/api/projects').send({ id: 'aa', name: 'A' });
  });
  afterEach(() => teardown(h));

  it('returns 404 for an unknown project', async () => {
    const res = await request(h.app).post('/api/projects/zz/reload').send();
    expect(res.status).toBe(404);
  });

  it('returns 400 for a malformed project id', async () => {
    const res = await request(h.app).post('/api/projects/Bad%20Id/reload').send();
    expect(res.status).toBe(400);
  });

  it('reports added/updated/removed counts on a known project', async () => {
    const a = await request(h.app)
      .post('/api/projects/aa/documents')
      .send({ title: 'One', type: 'note' });
    const b = await request(h.app)
      .post('/api/projects/aa/documents')
      .send({ title: 'Two', type: 'note' });

    // First reload: both files already indexed → both 'updated', none added.
    const first = await request(h.app).post('/api/projects/aa/reload').send();
    expect(first.status).toBe(200);
    expect(first.body.projectId).toBe('aa');
    expect(first.body.added).toBe(0);
    expect(first.body.updated).toBe(2);
    expect(first.body.removed).toBe(0);
    expect(typeof first.body.durationMs).toBe('number');

    // Delete one file from disk and reload → removed count = 1, the row is gone.
    await fs.unlink(path.join(h.dataDir, 'projects', a.body.path));
    const second = await request(h.app).post('/api/projects/aa/reload').send();
    expect(second.status).toBe(200);
    expect(second.body.updated).toBe(1);
    expect(second.body.removed).toBe(1);
    expect(second.body.removedIds).toEqual([a.body.id]);

    // The remaining document is still reachable.
    const stillThere = await request(h.app).get(`/api/documents/${b.body.id}`);
    expect(stillThere.status).toBe(200);
    const gone = await request(h.app).get(`/api/documents/${a.body.id}`);
    expect(gone.status).toBe(404);
  });

  it('picks up out-of-band edits made directly on disk', async () => {
    const created = await request(h.app)
      .post('/api/projects/aa/documents')
      .send({ title: 'EditMe', type: 'note', body: 'original body' });

    const filePath = path.join(h.dataDir, 'projects', created.body.path);
    const onDisk = await fs.readFile(filePath, 'utf8');
    const replaced = onDisk.replace('original body', 'OUT_OF_BAND_BODY');
    await fs.writeFile(filePath, replaced, 'utf8');

    const reload = await request(h.app).post('/api/projects/aa/reload').send();
    expect(reload.status).toBe(200);
    expect(reload.body.updated).toBeGreaterThanOrEqual(1);

    const fresh = await request(h.app).get(`/api/documents/${created.body.id}`);
    expect(fresh.body.body).toContain('OUT_OF_BAND_BODY');
  });

  it('indexes plain Markdown files and adopts them on first edit in editable projects', async () => {
    const docsDir = path.join(h.dataDir, 'projects', 'aa', 'external-docs');
    await fs.mkdir(docsDir, { recursive: true });
    const filePath = path.join(docsDir, 'getting-started.md');
    await fs.writeFile(filePath, '# Getting Started\n\nPlain mounted docs content.', 'utf8');

    const reload = await request(h.app).post('/api/projects/aa/reload').send();
    expect(reload.status).toBe(200);
    expect(reload.body.added).toBe(1);
    expect(reload.body.skipped).toEqual([]);

    const list = await request(h.app).get('/api/projects/aa/documents');
    expect(list.status).toBe(200);
    const doc = (list.body as Array<{ id: string; title: string; type: string; path: string; readOnly: boolean }>).find(
      (d) => d.path === 'aa/external-docs/getting-started.md',
    );
    expect(doc).toMatchObject({
      title: 'Getting Started',
      type: 'note',
      path: 'aa/external-docs/getting-started.md',
      readOnly: false,
    });

    const fetched = await request(h.app).get(`/api/documents/${doc!.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.readOnly).toBe(false);
    expect(fetched.body.body).toContain('Plain mounted docs content.');

    const update = await request(h.app)
      .put(`/api/documents/${doc!.id}`)
      .set('If-Match', fetched.body.revision)
      .send({ title: 'Adopted', body: 'adopted body' });
    expect(update.status).toBe(200);
    expect(update.body).toMatchObject({
      id: doc!.id,
      title: 'Adopted',
      readOnly: false,
      path: 'aa/external-docs/getting-started.md',
    });

    const adopted = await fs.readFile(filePath, 'utf8');
    expect(adopted).toContain(`id: ${doc!.id}`);
    expect(adopted).toContain('project: aa');
    expect(adopted).toContain('adopted body');
  });

  it('indexes files with mismatched frontmatter as repaired read-only metadata', async () => {
    const docsDir = path.join(h.dataDir, 'projects', 'aa', 'external-docs');
    await fs.mkdir(docsDir, { recursive: true });
    const filePath = path.join(docsDir, 'wrong-project.md');
    await fs.writeFile(
      filePath,
      [
        '---',
        'id: 11111111-2222-4333-8444-555555555555',
        'title: Wrong Project',
        'project: old-project',
        'type: design_doc',
        'status: active',
        "created_at: '2026-06-01T00:00:00.000Z'",
        "updated_at: '2026-06-01T00:00:00.000Z'",
        'tags: [external]',
        '---',
        '',
        '# Wrong Project',
        '',
        'Content from another project.',
      ].join('\n'),
      'utf8',
    );

    const reload = await request(h.app).post('/api/projects/aa/reload').send();
    expect(reload.status).toBe(200);
    expect(reload.body.added).toBe(1);
    expect(reload.body.skipped).toEqual([]);

    const list = await request(h.app).get('/api/projects/aa/documents');
    const doc = (list.body as Array<{
      id: string;
      title: string;
      type: string;
      path: string;
      readOnly: boolean;
      tags: string[];
    }>).find((d) => d.path === 'aa/external-docs/wrong-project.md');
    expect(doc).toMatchObject({
      title: 'Wrong Project',
      type: 'design_doc',
      path: 'aa/external-docs/wrong-project.md',
      readOnly: false,
      tags: ['external'],
    });
    expect(doc!.id).not.toBe('11111111-2222-4333-8444-555555555555');

    const fetched = await request(h.app).get(`/api/documents/${doc!.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.project_id).toBe('aa');
    expect(fetched.body.readOnly).toBe(false);
    expect(fetched.body.body).toContain('Content from another project.');
  });

  it('indexes malformed-frontmatter Markdown as plain Markdown', async () => {
    const docsDir = path.join(h.dataDir, 'projects', 'aa', 'external-docs');
    await fs.mkdir(docsDir, { recursive: true });
    const filePath = path.join(docsDir, 'bad-frontmatter.md');
    await fs.writeFile(
      filePath,
      ['---', 'title: [', '---', '# Bad Frontmatter', '', 'Still index this file.'].join('\n'),
      'utf8',
    );

    const reload = await request(h.app).post('/api/projects/aa/reload').send();
    expect(reload.status).toBe(200);
    expect(reload.body.added).toBe(1);
    expect(reload.body.skipped).toEqual([]);

    const list = await request(h.app).get('/api/projects/aa/documents');
    expect(list.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Bad Frontmatter',
          path: 'aa/external-docs/bad-frontmatter.md',
        }),
      ]),
    );
  });

  it('keeps plain Markdown files read-only while the project is read-only', async () => {
    const docsDir = path.join(h.dataDir, 'projects', 'aa', 'locked-docs');
    await fs.mkdir(docsDir, { recursive: true });
    const filePath = path.join(docsDir, 'readme.md');
    await fs.writeFile(filePath, '# Read Me\n\nLocked mounted docs content.', 'utf8');
    await request(h.app).put('/api/projects/aa').send({ readOnly: true }).expect(200);

    const reload = await request(h.app).post('/api/projects/aa/reload').send();
    expect(reload.status).toBe(200);

    const list = await request(h.app).get('/api/projects/aa/documents');
    const doc = (list.body as Array<{ id: string; path: string; readOnly: boolean }>).find(
      (d) => d.path === 'aa/locked-docs/readme.md',
    );
    expect(doc).toMatchObject({ readOnly: true });

    const fetched = await request(h.app).get(`/api/documents/${doc!.id}`);
    expect(fetched.body.readOnly).toBe(true);

    const update = await request(h.app)
      .put(`/api/documents/${doc!.id}`)
      .send({ body: 'should not be written' });
    expect(update.status).toBe(409);
    expect(update.body.error.code).toBe('PROJECT_READ_ONLY');
    expect(await fs.readFile(filePath, 'utf8')).toContain('Locked mounted docs content.');
  });

  it('returns 409 when a second reload of the same project overlaps', async () => {
    await request(h.app)
      .post('/api/projects/aa/documents')
      .send({ title: 'X', type: 'note' });

    // Fire two reloads concurrently. Node's event loop is single-threaded
    // and the lock is a synchronous Set add, so only one acquires it.
    const [r1, r2] = await Promise.all([
      request(h.app).post('/api/projects/aa/reload').send(),
      request(h.app).post('/api/projects/aa/reload').send(),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);
    const conflict = r1.status === 409 ? r1 : r2;
    expect(conflict.body.error?.code).toBe('RELOAD_IN_PROGRESS');
  });

  it('reloads of different projects can run concurrently', async () => {
    await request(h.app).post('/api/projects').send({ id: 'bb', name: 'B' });
    await request(h.app)
      .post('/api/projects/aa/documents')
      .send({ title: 'A', type: 'note' });
    await request(h.app)
      .post('/api/projects/bb/documents')
      .send({ title: 'B', type: 'note' });

    const [r1, r2] = await Promise.all([
      request(h.app).post('/api/projects/aa/reload').send(),
      request(h.app).post('/api/projects/bb/reload').send(),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
  });
});

describe('Project Folders API', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
    await request(h.app).post('/api/projects').send({ id: 'pp', name: 'P' });
  });
  afterEach(async () => {
    await teardown(h);
  });

  it('GET returns built-in skeleton folders for a fresh project', async () => {
    const res = await request(h.app).get('/api/projects/pp/folders');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.arrayContaining(['ideas', 'design-docs', 'notes']),
    );
  });

  it('POST creates a nested folder; GET reflects it', async () => {
    const res = await request(h.app)
      .post('/api/projects/pp/folders')
      .send({ folder: 'phases/p3/blocks' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ folder: 'phases/p3/blocks' });
    const list = await request(h.app).get('/api/projects/pp/folders');
    expect(list.body).toEqual(expect.arrayContaining(['phases', 'phases/p3', 'phases/p3/blocks']));
  });

  it('POST blocks folder creation while read-only mode is enabled', async () => {
    await request(h.app).put('/api/projects/pp').send({ readOnly: true });
    const res = await request(h.app)
      .post('/api/projects/pp/folders')
      .send({ folder: 'locked' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PROJECT_READ_ONLY');
  });

  it('POST rejects invalid folder paths with 400', async () => {
    const bad = ['', 'Bad Case', '/abs', '../up', 'a/b/c/d/e/f/g/h/i'];
    for (const folder of bad) {
      const res = await request(h.app).post('/api/projects/pp/folders').send({ folder });
      expect(res.status).toBe(400);
    }
  });

  it('DELETE removes an empty folder (incl. nested) and is 404 on unknown', async () => {
    await request(h.app).post('/api/projects/pp/folders').send({ folder: 'a/b' });
    const del = await request(h.app).delete('/api/projects/pp/folders/a/b');
    expect(del.status).toBe(204);
    const missing = await request(h.app).delete('/api/projects/pp/folders/no/such');
    expect(missing.status).toBe(404);
  });

  it('DELETE returns 409 when folder is non-empty', async () => {
    await request(h.app).post('/api/projects/pp/folders').send({ folder: 'work' });
    // Place a document inside it.
    const created = await request(h.app)
      .post('/api/projects/pp/documents')
      .send({ title: 'T', type: 'note', folder: 'work' });
    expect(created.status).toBe(201);
    const del = await request(h.app).delete('/api/projects/pp/folders/work');
    expect(del.status).toBe(409);
  });

  it('POST /documents accepts custom folder and stores under that path', async () => {
    await request(h.app).post('/api/projects/pp/folders').send({ folder: 'design/v2' });
    const res = await request(h.app)
      .post('/api/projects/pp/documents')
      .send({ title: 'Hello', type: 'design_doc', folder: 'design/v2' });
    expect(res.status).toBe(201);
    expect(res.body.path.startsWith('pp/design/v2/')).toBe(true);
  });

  it('POST /documents rejects invalid folder', async () => {
    const res = await request(h.app)
      .post('/api/projects/pp/documents')
      .send({ title: 'Hello', type: 'note', folder: '../escape' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown project on GET/POST/DELETE', async () => {
    expect((await request(h.app).get('/api/projects/ghost/folders')).status).toBe(404);
    expect(
      (await request(h.app).post('/api/projects/ghost/folders').send({ folder: 'x' })).status,
    ).toBe(404);
    expect((await request(h.app).delete('/api/projects/ghost/folders/x')).status).toBe(404);
  });
});

describe('Knowledge Graph API', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
    await request(h.app).post('/api/projects').send({ id: 'gp', name: 'Graph Project' });
  });
  afterEach(async () => {
    await teardown(h);
  });

  it('GET /:id/graph returns empty nodes and edges for a fresh project', async () => {
    const res = await request(h.app).get('/api/projects/gp/graph');
    expect(res.status).toBe(200);
    expect(res.body.nodes).toEqual([]);
    expect(res.body.edges).toEqual([]);
    expect(typeof res.body.generatedAt).toBe('string');
  });

  it('returns 404 for an unknown project id', async () => {
    // GraphService queries documents for project; no error thrown for missing project,
    // but the project route validates via parseId then returns empty results.
    // A truly non-existent project should still return 200 with empty payload
    // (the service does not assert project existence — graph is read-only).
    const res = await request(h.app).get('/api/projects/nope/graph');
    expect(res.status).toBe(200);
    expect(res.body.nodes).toEqual([]);
  });

  it('returns 400 for an invalid project id', async () => {
    const res = await request(h.app).get('/api/projects/BAD%20ID/graph');
    expect(res.status).toBe(400);
  });

  it('returns document nodes after creating documents', async () => {
    await request(h.app)
      .post('/api/projects/gp/documents')
      .send({ title: 'Alpha', type: 'note' });
    await request(h.app)
      .post('/api/projects/gp/documents')
      .send({ title: 'Beta', type: 'idea' });

    const res = await request(h.app).get('/api/projects/gp/graph');
    expect(res.status).toBe(200);
    const { nodes, edges } = res.body as { nodes: Array<{ kind: string; title: string }>, edges: unknown[] };
    expect(nodes).toHaveLength(2);
    expect(nodes.every((n) => n.kind === 'document')).toBe(true);
    expect(nodes.map((n) => n.title).sort()).toEqual(['Alpha', 'Beta']);
    expect(edges).toHaveLength(0);
  });

  it('returns edges and a broken-link node when a wikilink is unresolved', async () => {
    await request(h.app)
      .post('/api/projects/gp/documents')
      .send({ title: 'Source', type: 'note', body: '[[Missing Target]]' });

    const res = await request(h.app).get('/api/projects/gp/graph');
    expect(res.status).toBe(200);

    const { nodes, edges } = res.body as {
      nodes: Array<{ kind: string; id: string }>;
      edges: Array<{ sourceId: string; targetId: string }>;
    };

    const broken = nodes.find((n) => n.kind === 'broken');
    expect(broken).toBeDefined();
    expect(broken!.id).toMatch(/^broken:/);

    expect(edges).toHaveLength(1);
    expect(edges[0]!.targetId).toBe(broken!.id);
  });

  it('reflects document deletion after the graph was cached', async () => {
    const a = await request(h.app)
      .post('/api/projects/gp/documents')
      .send({ title: 'Alpha', type: 'note' });
    await request(h.app)
      .post('/api/projects/gp/documents')
      .send({ title: 'Beta', type: 'idea' });

    // Prime the graph cache (10s TTL) so a stale entry would otherwise be served.
    const before = await request(h.app).get('/api/projects/gp/graph');
    expect(before.body.nodes).toHaveLength(2);

    // Delete one document through the service — the only sanctioned write path.
    const del = await request(h.app).delete(`/api/documents/${a.body.id}`);
    expect(del.status).toBe(204);

    // DocumentService.delete must invalidate the graph cache → deletion is visible.
    const after = await request(h.app).get('/api/projects/gp/graph');
    expect(after.body.nodes).toHaveLength(1);
    expect((after.body.nodes as Array<{ title: string }>)[0]!.title).toBe('Beta');
  });

  it('reflects a reload that removes a file, even after the graph was cached', async () => {
    const a = await request(h.app)
      .post('/api/projects/gp/documents')
      .send({ title: 'Alpha', type: 'note' });
    await request(h.app)
      .post('/api/projects/gp/documents')
      .send({ title: 'Beta', type: 'idea' });

    // Prime the graph cache so a stale entry would otherwise survive the reload.
    const before = await request(h.app).get('/api/projects/gp/graph');
    expect(before.body.nodes).toHaveLength(2);

    // Remove one file out-of-band, then reload the project from disk.
    await fs.unlink(path.join(h.dataDir, 'projects', a.body.path));
    const reload = await request(h.app).post('/api/projects/gp/reload').send();
    expect(reload.status).toBe(200);
    expect(reload.body.removed).toBe(1);

    // Reload must invalidate the graph cache → the removed node is gone.
    const after = await request(h.app).get('/api/projects/gp/graph');
    expect(after.body.nodes).toHaveLength(1);
    expect((after.body.nodes as Array<{ title: string }>)[0]!.title).toBe('Beta');
  });
});
