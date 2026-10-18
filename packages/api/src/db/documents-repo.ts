import type { DocumentStatus, DocumentSummary, DocumentType } from '@backlogger/shared';
import type { Db } from './database.js';

interface DocumentRow {
  id: string;
  project_id: string;
  title: string;
  type: string;
  status: string;
  path: string;
  tags: string;
  read_only: number;
  created_at: string;
  updated_at: string;
  revision: string;
  task_state: string | null;
}

function rowToSummary(row: DocumentRow): DocumentSummary {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row.tags) as unknown;
    if (Array.isArray(parsed)) tags = parsed.filter((t): t is string => typeof t === 'string');
  } catch {
    // Treat unparseable tag blobs as empty rather than failing the read.
  }
  return {
    id: row.id,
    project_id: row.project_id,
    title: row.title,
    type: row.type as DocumentType,
    status: row.status as DocumentStatus,
    path: row.path,
    tags,
    readOnly: row.read_only === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    revision: row.revision,
  };
}

export interface DocumentUpsertInput {
  id: string;
  project_id: string;
  title: string;
  type: DocumentType;
  status: DocumentStatus;
  path: string;
  tags: string[];
  readOnly?: boolean;
  body: string;
  created_at: string;
  updated_at: string;
  revision: string;
  /** Frontmatter `task_state`, verbatim; `null` when absent. */
  task_state: string | null;
}

/** A document summary plus its task state, as the board needs it. */
export interface BoardItem extends DocumentSummary {
  task_state: string | null;
}

export class DocumentsRepo {
  constructor(private readonly db: Db) {}

  listByProject(projectId: string): DocumentSummary[] {
    const rows = this.db
      .prepare<[string], DocumentRow>(
        `SELECT * FROM documents WHERE project_id = ? ORDER BY type, title`,
      )
      .all(projectId);
    return rows.map(rowToSummary);
  }

  /** AND-filter: only documents that carry every tag in the array. */
  listByProjectAndTags(projectId: string, tags: string[]): DocumentSummary[] {
    if (tags.length === 0) return this.listByProject(projectId);
    const placeholders = tags.map(() => '?').join(', ');
    const rows = this.db
      .prepare<unknown[], DocumentRow>(
        `SELECT d.* FROM documents d
         WHERE d.project_id = ?
           AND (
             SELECT COUNT(DISTINCT dt.tag)
             FROM document_tags dt
             WHERE dt.document_id = d.id AND dt.tag IN (${placeholders})
           ) = ${tags.length}
         ORDER BY d.type, d.title`,
      )
      .all(projectId, ...tags);
    return rows.map(rowToSummary);
  }

  /** Non-archived backlog items of a project, by `created_at` then id. */
  listBoardItems(projectId: string): BoardItem[] {
    const rows = this.db
      .prepare<[string], DocumentRow>(
        `SELECT * FROM documents
         WHERE project_id = ? AND type = 'backlog_item' AND status != 'archived'
         ORDER BY created_at, id`,
      )
      .all(projectId);
    return rows.map((row) => ({ ...rowToSummary(row), task_state: row.task_state }));
  }

  find(id: string): DocumentSummary | undefined {
    const row = this.db
      .prepare<[string], DocumentRow>(`SELECT * FROM documents WHERE id = ?`)
      .get(id);
    return row ? rowToSummary(row) : undefined;
  }

  findByPath(relPath: string): DocumentSummary | undefined {
    const row = this.db
      .prepare<[string], DocumentRow>(`SELECT * FROM documents WHERE path = ?`)
      .get(relPath);
    return row ? rowToSummary(row) : undefined;
  }

  upsert(input: DocumentUpsertInput): DocumentSummary {
    this.db
      .prepare(
        `INSERT INTO documents
           (id, project_id, title, type, status, path, tags, read_only, body_indexed, created_at, updated_at, revision, task_state)
         VALUES
           (@id, @project_id, @title, @type, @status, @path, @tags, @read_only, @body_indexed, @created_at, @updated_at, @revision, @task_state)
         ON CONFLICT(id) DO UPDATE SET
           project_id   = excluded.project_id,
           title        = excluded.title,
           type         = excluded.type,
           status       = excluded.status,
           path         = excluded.path,
           tags         = excluded.tags,
           read_only    = excluded.read_only,
           body_indexed = excluded.body_indexed,
           updated_at   = excluded.updated_at,
           revision     = excluded.revision,
           task_state   = excluded.task_state`,
      )
      .run({
        ...input,
        tags: JSON.stringify(input.tags),
        read_only: input.readOnly ? 1 : 0,
        body_indexed: input.body,
      });
    return this.find(input.id)!;
  }

  delete(id: string): boolean {
    const info = this.db.prepare(`DELETE FROM documents WHERE id = ?`).run(id);
    return info.changes > 0;
  }

  /** Truncate the table; used by reindex. */
  truncate(): void {
    this.db.exec(`DELETE FROM documents`);
  }

  /** Count rows (used by startup auto-reindex trigger). */
  count(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS c FROM documents`).get() as { c: number }).c;
  }
}
