import type { Statement } from 'better-sqlite3';
import type { Db } from '../db/database.js';

export interface TagCount {
  tag: string;
  count: number;
}

export class TagsService {
  private readonly stmtDeleteForDoc: Statement;
  private readonly stmtUpsertTag: Statement;
  private readonly stmtInsertDocTag: Statement;

  constructor(private readonly db: Db) {
    this.stmtDeleteForDoc = db.prepare(`DELETE FROM document_tags WHERE document_id = ?`);
    this.stmtUpsertTag = db.prepare(`INSERT OR IGNORE INTO tags (tag) VALUES (?)`);
    this.stmtInsertDocTag = db.prepare(
      `INSERT OR REPLACE INTO document_tags (document_id, tag) VALUES (?, ?)`,
    );
  }

  rebuildForDocument(docId: string, tags: string[]): void {
    this.db.transaction(() => {
      this.stmtDeleteForDoc.run(docId);
      for (const tag of tags) {
        this.stmtUpsertTag.run(tag);
        this.stmtInsertDocTag.run(docId, tag);
      }
    })();
  }

  list(projectId?: string): TagCount[] {
    if (projectId) {
      return this.db
        .prepare<[string], TagCount>(
          `SELECT dt.tag, COUNT(*) AS count
           FROM document_tags dt
           JOIN documents d ON d.id = dt.document_id
           WHERE d.project_id = ?
           GROUP BY dt.tag
           ORDER BY count DESC, dt.tag`,
        )
        .all(projectId);
    }
    return this.db
      .prepare<[], TagCount>(
        `SELECT tag, COUNT(*) AS count
         FROM document_tags
         GROUP BY tag
         ORDER BY count DESC, tag`,
      )
      .all();
  }

  truncate(): void {
    this.db.exec(`DELETE FROM document_tags`);
  }
}
