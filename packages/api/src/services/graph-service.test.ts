import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, type Db } from '../db/database.js';
import { DocumentsRepo } from '../db/documents-repo.js';
import { ProjectsRepo } from '../db/projects-repo.js';
import { GraphService } from './graph-service.js';
import { LinkService } from './link-service.js';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'migrations',
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb(): Db {
  return openDatabase({ file: ':memory:', migrationsDir: MIGRATIONS_DIR });
}

function seedProject(db: Db, projectId = 'proj'): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO projects (id, name, description, created_at, updated_at)
     VALUES (?, 'Test', null, ?, ?)`,
  ).run(projectId, now, now);
}

function seedDoc(
  db: Db,
  id: string,
  title: string,
  opts: { projectId?: string; type?: string; status?: string } = {},
): void {
  const { projectId = 'proj', type = 'note', status = 'draft' } = opts;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO documents (id, project_id, title, type, status, path, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?)`,
  ).run(id, projectId, title, type, status, `${projectId}/${type}s/${id}.md`, now, now);
}

function seedLink(
  db: Db,
  sourceId: string,
  targetTitle: string,
  opts: { targetId?: string | null; position?: number } = {},
): void {
  const { targetId = null, position = 0 } = opts;
  const norm = targetTitle.toLowerCase().replace(/\s+/g, '-');
  db.prepare(
    `INSERT INTO links (source_id, target_id, target_title, target_title_norm, display, position)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(sourceId, targetId, targetTitle, norm, targetTitle, position);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GraphService', () => {
  let db: Db;
  let svc: GraphService;

  beforeEach(() => {
    db = makeDb();
    svc = new GraphService(db);
    seedProject(db);
  });

  it('returns empty graph for a project with no documents', () => {
    const { nodes, edges } = svc.getGraph('proj');
    expect(nodes).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });

  it('returns document nodes with correct degree counts', () => {
    seedDoc(db, 'a', 'Alpha');
    seedDoc(db, 'b', 'Beta');
    // a → b  (resolved link)
    seedLink(db, 'a', 'Beta', { targetId: 'b', position: 0 });

    const { nodes, edges } = svc.getGraph('proj');

    const alpha = nodes.find((n) => n.id === 'a')!;
    const beta = nodes.find((n) => n.id === 'b')!;

    expect(alpha.kind).toBe('document');
    expect(alpha.outDegree).toBe(1);
    expect(alpha.inDegree).toBe(0);

    expect(beta.outDegree).toBe(0);
    expect(beta.inDegree).toBe(1);

    expect(edges).toHaveLength(1);
    expect(edges[0]).toEqual({ sourceId: 'a', targetId: 'b', display: 'Beta' });
  });

  it('creates synthetic broken-link sink nodes for unresolved links', () => {
    seedDoc(db, 'a', 'Alpha');
    // a → "Missing Doc" (no target_id)
    seedLink(db, 'a', 'Missing Doc', { targetId: null, position: 0 });

    const { nodes, edges } = svc.getGraph('proj');

    const broken = nodes.find((n) => n.kind === 'broken')!;
    expect(broken).toBeDefined();
    expect(broken.id).toBe('broken:missing-doc');
    expect(broken.title).toBe('Missing Doc');
    expect(broken.inDegree).toBe(1);
    expect(broken.outDegree).toBe(0);

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ sourceId: 'a', targetId: 'broken:missing-doc' });
  });

  it('does not include documents from other projects', () => {
    seedProject(db, 'other');
    seedDoc(db, 'a', 'Alpha', { projectId: 'proj' });
    seedDoc(db, 'x', 'Xray', { projectId: 'other' });

    const { nodes } = svc.getGraph('proj');
    expect(nodes.map((n) => n.id)).toEqual(['a']);
  });

  it('includes generatedAt ISO timestamp', () => {
    const { generatedAt } = svc.getGraph('proj');
    expect(new Date(generatedAt).getTime()).toBeGreaterThan(0);
  });

  it('caches the result on repeated calls', () => {
    seedDoc(db, 'a', 'Alpha');
    const first = svc.getGraph('proj');
    // Insert a new doc without invalidating — should still get cached result
    seedDoc(db, 'b', 'Beta');
    const second = svc.getGraph('proj');
    expect(second).toBe(first); // same reference
  });

  it('invalidate() clears the cache for a specific project', () => {
    seedDoc(db, 'a', 'Alpha');
    const first = svc.getGraph('proj');
    svc.invalidate('proj');
    seedDoc(db, 'b', 'Beta');
    const second = svc.getGraph('proj');
    expect(second).not.toBe(first);
    expect(second.nodes).toHaveLength(2);
  });

  it('invalidate() with no argument clears all cached projects', () => {
    seedProject(db, 'p2');
    seedDoc(db, 'a', 'Alpha', { projectId: 'proj' });
    seedDoc(db, 'x', 'Xray', { projectId: 'p2' });

    const g1 = svc.getGraph('proj');
    const g2 = svc.getGraph('p2');

    svc.invalidate(); // clear all

    seedDoc(db, 'b', 'Beta', { projectId: 'proj' });
    seedDoc(db, 'y', 'Yankee', { projectId: 'p2' });

    const g1b = svc.getGraph('proj');
    const g2b = svc.getGraph('p2');

    expect(g1b).not.toBe(g1);
    expect(g2b).not.toBe(g2);
    expect(g1b.nodes).toHaveLength(2);
    expect(g2b.nodes).toHaveLength(2);
  });

  it('cache respects TTL — returns fresh data after expiry', async () => {
    // Patch Date.now to simulate TTL expiry
    const realNow = Date.now;
    try {
      let fakeTime = realNow();
      vi.spyOn(Date, 'now').mockImplementation(() => fakeTime);

      seedDoc(db, 'a', 'Alpha');
      const first = svc.getGraph('proj');

      // Advance time by 11 seconds (past the 10 s TTL)
      fakeTime += 11_000;

      seedDoc(db, 'b', 'Beta');
      const second = svc.getGraph('proj');

      expect(second).not.toBe(first);
      expect(second.nodes).toHaveLength(2);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('handles multiple broken links to the same title as one sink node', () => {
    seedDoc(db, 'a', 'Alpha');
    seedDoc(db, 'b', 'Beta');
    seedLink(db, 'a', 'Ghost', { targetId: null, position: 0 });
    seedLink(db, 'b', 'Ghost', { targetId: null, position: 0 });

    const { nodes } = svc.getGraph('proj');
    const broken = nodes.filter((n) => n.kind === 'broken');
    expect(broken).toHaveLength(1);
    expect(broken[0]!.inDegree).toBe(2);
  });
});
