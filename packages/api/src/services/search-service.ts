import {
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
  type DocumentStatus,
  type DocumentType,
  type SearchHit,
} from '@backlogger/shared';
import type { Db } from '../db/database.js';
import { BadRequestError } from '../errors.js';

interface SearchRow {
  id: string;
  project_id: string;
  title: string;
  type: string;
  status: string;
  task_state: string | null;
  record_id: string;
  kind: 'document' | 'comment';
  comment_created_at: string | null;
  snippet: string;
  rank: number;
}

export interface SearchOptions {
  projectId?: string;
  limit?: number;
}

/** Control characters FTS5 wraps matched terms in; they never occur in Markdown we index. */
const OPEN = '\u0001';
const CLOSE = '\u0002';

/**
 * FTS5-backed full-text search across documents and comments on backlog
 * items, one result per document (spec #58).
 *
 * Query strategy: the user-provided string is treated as one or more terms
 * (whitespace-split) and rewritten into an AND-of-prefixes query. This makes
 * "rate limit" match records containing both terms, with prefix completion
 * so partial words still hit. Reserved FTS5 characters are stripped.
 *
 * Every record (a document, or one comment) is a row of the shared
 * `search_fts` projection, so all terms must match within one record and
 * bm25 ranks are comparable across kinds. Each document is ranked by its
 * strongest record, and grouping happens before the limit.
 *
 * Comments count only while their parent is an indexed backlog item, so
 * comments left behind by a deleted task never surface. Invalid and orphaned
 * comment files are never indexed, and recovery payloads live outside the
 * index altogether.
 */
export class SearchService {
  constructor(private readonly db: Db) {}

  search(qRaw: string, opts: SearchOptions = {}): SearchHit[] {
    const query = buildFtsQuery(qRaw);
    if (!query) {
      throw new BadRequestError('SEARCH_QUERY_REQUIRED', 'Search query must contain at least one searchable term');
    }
    const limit = clampLimit(opts.limit);

    const params: unknown[] = [query];
    let matches =
      `SELECT documents.id         AS id,
              documents.project_id AS project_id,
              documents.title      AS title,
              documents.type       AS type,
              documents.status     AS status,
              documents.task_state AS task_state,
              search_fts.record_id AS record_id,
              search_fts.kind      AS kind,
              comments.created_at  AS comment_created_at,
              snippet(search_fts, 5, '${OPEN}', '${CLOSE}', '…', 12) AS snippet,
              search_fts.rank      AS rank
       FROM search_fts
       JOIN documents ON documents.id = search_fts.document_id
       LEFT JOIN comments ON search_fts.kind = 'comment' AND comments.id = search_fts.record_id
       WHERE search_fts MATCH ?
         AND (search_fts.kind = 'document'
              OR (comments.id IS NOT NULL AND documents.type = 'backlog_item'))`;
    if (opts.projectId) {
      matches += ` AND documents.project_id = ?`;
      params.push(opts.projectId);
    }
    const sql =
      `WITH matches AS (${matches}),
       ranked AS (
         SELECT *, ROW_NUMBER() OVER (
           PARTITION BY id ORDER BY rank, kind = 'comment', record_id
         ) AS n
         FROM matches
       )
       SELECT * FROM ranked WHERE n = 1 ORDER BY rank, id LIMIT ?`;
    params.push(limit);

    let rows: SearchRow[];
    try {
      rows = this.db.prepare<unknown[], SearchRow>(sql).all(...params);
    } catch (err) {
      // Malformed FTS5 query (e.g. a stray operator survived sanitization).
      throw new BadRequestError(
        'SEARCH_QUERY_INVALID',
        `Invalid search query: ${(err as Error).message}`,
      );
    }

    return rows.map((row) => ({
      id: row.id,
      project_id: row.project_id,
      title: row.title,
      type: row.type as DocumentType,
      status: row.status as DocumentStatus,
      task_state: row.task_state,
      match:
        row.kind === 'comment'
          ? { kind: 'comment', comment_id: row.record_id, created_at: row.comment_created_at ?? '' }
          : { kind: 'description' },
      ...parseSnippet(row.snippet),
      rank: row.rank,
    }));
  }
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return SEARCH_DEFAULT_LIMIT;
  if (limit < 1) return 1;
  if (limit > SEARCH_MAX_LIMIT) return SEARCH_MAX_LIMIT;
  return Math.floor(limit);
}

/**
 * Build an FTS5 MATCH expression from a user query.
 *
 * - Strips characters with special meaning to FTS5 (`"`, `(`, `)`, `*`, `:`, `-`, `^`).
 * - Splits on whitespace.
 * - Appends `*` to each term for prefix matching.
 * - Joins with implicit AND (FTS5 default).
 */
export function buildFtsQuery(raw: string): string {
  const cleaned = raw.replace(/["()*:^-]+/g, ' ');
  const terms = cleaned.split(/\s+/).filter((t) => t.length > 0);
  if (terms.length === 0) return '';
  return terms.map((t) => `${t}*`).join(' ');
}

/** Split an FTS5 snippet into plain text and the offsets of its marked terms. */
export function parseSnippet(marked: string): Pick<SearchHit, 'snippet' | 'highlights'> {
  let snippet = '';
  const highlights: Array<[number, number]> = [];
  let start = -1;
  for (const ch of marked) {
    if (ch === OPEN) start = snippet.length;
    else if (ch === CLOSE) {
      if (start >= 0) highlights.push([start, snippet.length]);
      start = -1;
    } else snippet += ch;
  }
  return { snippet, highlights };
}
