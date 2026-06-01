import {
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
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
  snippet: string;
  rank: number;
}

export interface SearchOptions {
  projectId?: string;
  limit?: number;
}

/**
 * FTS5-backed full-text search across documents.
 *
 * Query strategy: the user-provided string is treated as one or more terms
 * (whitespace-split) and rewritten into an AND-of-prefixes query. This makes
 * "rate limit" match documents containing both terms, with prefix completion
 * so partial words still hit. Reserved FTS5 characters are stripped.
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
    let sql =
      `SELECT documents_fts.id        AS id,
              documents_fts.project_id AS project_id,
              documents.title          AS title,
              documents.type           AS type,
              snippet(documents_fts, 4, '[[', ']]', '…', 12) AS snippet,
              documents_fts.rank       AS rank
       FROM documents_fts
       JOIN documents ON documents.id = documents_fts.id
       WHERE documents_fts MATCH ?`;
    if (opts.projectId) {
      sql += ` AND documents_fts.project_id = ?`;
      params.push(opts.projectId);
    }
    sql += ` ORDER BY rank LIMIT ?`;
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
      snippet: stripSnippetMarkers(row.snippet),
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

/** Remove the `[[`/`]]` markers we asked FTS5 to wrap matches in. */
function stripSnippetMarkers(snippet: string): string {
  return snippet.replace(/\[\[|\]\]/g, '');
}
