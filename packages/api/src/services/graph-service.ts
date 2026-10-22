import type { Db } from '../db/database.js';
import { pendingDeletionCovers } from '../db/operations-repo.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GraphNode {
  id: string;
  kind: 'document' | 'broken';
  title: string;
  type?: string;
  status?: string;
  tags?: string[];
  inDegree: number;
  outDegree: number;
}

export interface GraphEdge {
  sourceId: string;
  targetId: string;
  display: string;
}

export interface GraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// In-memory LRU cache with TTL
// ---------------------------------------------------------------------------

const MAX_ENTRIES = 8;
const TTL_MS = 10_000;

interface CacheEntry {
  data: GraphPayload;
  expiresAt: number;
}

class GraphCache {
  private readonly store = new Map<string, CacheEntry>();

  get(key: string): GraphPayload | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    // Move to end (most-recently-used)
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.data;
  }

  set(key: string, data: GraphPayload): void {
    // Evict oldest entry when at capacity
    if (this.store.size >= MAX_ENTRIES && !this.store.has(key)) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { data, expiresAt: Date.now() + TTL_MS });
  }

  invalidate(projectId?: string): void {
    if (projectId === undefined) {
      this.store.clear();
    } else {
      this.store.delete(projectId);
    }
  }
}

// ---------------------------------------------------------------------------
// GraphService
// ---------------------------------------------------------------------------

export class GraphService {
  private readonly db: Db;
  private readonly cache = new GraphCache();

  constructor(db: Db) {
    this.db = db;
  }

  getGraph(projectId: string): GraphPayload {
    const cached = this.cache.get(projectId);
    if (cached) return cached;

    const result = this.buildGraph(projectId);
    this.cache.set(projectId, result);
    return result;
  }

  invalidate(projectId?: string): void {
    this.cache.invalidate(projectId);
  }

  private buildGraph(projectId: string): GraphPayload {
    // -- Document nodes with degree counts --
    const docRows = this.db
      .prepare<[string], DocRow>(
        `SELECT
          d.id,
          d.title,
          d.type,
          d.status,
          d.tags,
          (SELECT COUNT(*) FROM links WHERE source_id = d.id) AS out_degree,
          (SELECT COUNT(*) FROM links WHERE target_id = d.id) AS in_degree
        FROM documents d
        WHERE d.project_id = ? AND NOT ${pendingDeletionCovers('d')}`,
      )
      .all(projectId);

    // -- Broken-link sink nodes --
    const brokenRows = this.db
      .prepare<[string], BrokenRow>(
        `SELECT
          'broken:' || l.target_title_norm AS id,
          l.target_title                   AS title,
          COUNT(*)                         AS in_degree
        FROM links l
        JOIN documents d ON d.id = l.source_id
        WHERE d.project_id = ? AND l.target_id IS NULL AND NOT ${pendingDeletionCovers('d')}
        GROUP BY l.target_title_norm`,
      )
      .all(projectId);

    // -- Edge list --
    const edgeRows = this.db
      .prepare<[string], EdgeRow>(
        `SELECT
          l.source_id                                              AS sourceId,
          COALESCE(l.target_id, 'broken:' || l.target_title_norm) AS targetId,
          l.display
        FROM links l
        JOIN documents d ON d.id = l.source_id
        LEFT JOIN documents t ON t.id = l.target_id
        WHERE d.project_id = ? AND NOT ${pendingDeletionCovers('d')}
          AND (t.id IS NULL OR NOT ${pendingDeletionCovers('t')})`,
      )
      .all(projectId);

    const nodes: GraphNode[] = [
      ...docRows.map((r) => ({
        id: r.id,
        kind: 'document' as const,
        title: r.title,
        type: r.type,
        status: r.status,
        tags: JSON.parse(r.tags) as string[],
        inDegree: r.in_degree,
        outDegree: r.out_degree,
      })),
      ...brokenRows.map((r) => ({
        id: r.id,
        kind: 'broken' as const,
        title: r.title,
        inDegree: r.in_degree,
        outDegree: 0,
      })),
    ];

    const edges: GraphEdge[] = edgeRows.map((r) => ({
      sourceId: r.sourceId,
      targetId: r.targetId,
      display: r.display,
    }));

    return { nodes, edges, generatedAt: new Date().toISOString() };
  }
}

// ---------------------------------------------------------------------------
// Internal row types (SQLite returns plain objects)
// ---------------------------------------------------------------------------

interface DocRow {
  id: string;
  title: string;
  type: string;
  status: string;
  tags: string; // JSON
  out_degree: number;
  in_degree: number;
}

interface BrokenRow {
  id: string;
  title: string;
  in_degree: number;
}

interface EdgeRow {
  sourceId: string;
  targetId: string;
  display: string;
}
