import type { Db } from './database.js';

/** One row of the derived comment index (migration 0012). */
export interface CommentRow {
  id: string;
  task_id: string;
  project_id: string;
  /** Relative to `<dataDir>/projects/`, like documents.path. */
  path: string;
  body: string;
  created_at: string;
  updated_at: string;
  revision: string;
}

/** Position in a task's history: `created_at`, then id. */
export interface CommentPosition {
  created_at: string;
  id: string;
}

export class CommentsRepo {
  constructor(private readonly db: Db) {}

  find(id: string): CommentRow | undefined {
    return this.db.prepare<[string], CommentRow>(`SELECT * FROM comments WHERE id = ?`).get(id);
  }

  upsert(row: CommentRow): void {
    this.db
      .prepare(
        `INSERT INTO comments (id, task_id, project_id, path, body, created_at, updated_at, revision)
         VALUES (@id, @task_id, @project_id, @path, @body, @created_at, @updated_at, @revision)
         ON CONFLICT(id) DO UPDATE SET
           task_id = excluded.task_id, project_id = excluded.project_id, path = excluded.path,
           body = excluded.body, created_at = excluded.created_at,
           updated_at = excluded.updated_at, revision = excluded.revision`,
      )
      .run(row);
  }

  delete(id: string): void {
    this.db.prepare(`DELETE FROM comments WHERE id = ?`).run(id);
  }

  countForTask(taskId: string): number {
    return (
      this.db
        .prepare<[string], { n: number }>(`SELECT COUNT(*) AS n FROM comments WHERE task_id = ?`)
        .get(taskId)?.n ?? 0
    );
  }

  /**
   * Up to `limit` comments of a task that sort before `before` (or the newest
   * ones without it), newest first.
   */
  listNewestBefore(
    taskId: string,
    before: CommentPosition | undefined,
    limit: number,
  ): CommentRow[] {
    if (!before) {
      return this.db
        .prepare<[string, number], CommentRow>(
          `SELECT * FROM comments WHERE task_id = ?
           ORDER BY created_at DESC, id DESC LIMIT ?`,
        )
        .all(taskId, limit);
    }
    return this.db
      .prepare<[string, string, string, string, number], CommentRow>(
        `SELECT * FROM comments
         WHERE task_id = ? AND (created_at < ? OR (created_at = ? AND id < ?))
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(taskId, before.created_at, before.created_at, before.id, limit);
  }

  /** Up to `limit` comments of a task that sort after `after`, oldest first. */
  listOldestAfter(taskId: string, after: CommentPosition, limit: number): CommentRow[] {
    return this.db
      .prepare<[string, string, string, string, number], CommentRow>(
        `SELECT * FROM comments
         WHERE task_id = ? AND (created_at > ? OR (created_at = ? AND id > ?))
         ORDER BY created_at ASC, id ASC LIMIT ?`,
      )
      .all(taskId, after.created_at, after.created_at, after.id, limit);
  }

  /** How many of a task's comments sort before (`older`) or after (`newer`) `at`. */
  countAround(taskId: string, at: CommentPosition): { older: number; newer: number } {
    const row = this.db
      .prepare<
        [string, string, string, string, string, string, string],
        { older: number; newer: number }
      >(
        `SELECT
           COALESCE(SUM(created_at < ? OR (created_at = ? AND id < ?)), 0) AS older,
           COALESCE(SUM(created_at > ? OR (created_at = ? AND id > ?)), 0) AS newer
         FROM comments WHERE task_id = ?`,
      )
      .get(at.created_at, at.created_at, at.id, at.created_at, at.created_at, at.id, taskId);
    return { older: row?.older ?? 0, newer: row?.newer ?? 0 };
  }

  /** Every comment row of a project, except those of the tasks in `keepTasks`. */
  deleteByProject(projectId: string, keepTasks: Iterable<string> = []): void {
    const keep = [...keepTasks];
    const marks = keep.map(() => '?').join(', ');
    this.db
      .prepare(
        `DELETE FROM comments WHERE project_id = ?${keep.length > 0 ? ` AND task_id NOT IN (${marks})` : ''}`,
      )
      .run(projectId, ...keep);
  }

  truncate(): void {
    this.db.exec(`DELETE FROM comments`);
  }
}
