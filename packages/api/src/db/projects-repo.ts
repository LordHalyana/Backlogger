import type { Project } from '@backlogger/shared';
import type { Db } from './database.js';

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface ProjectInsertInput {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectUpdateInput {
  name?: string;
  description?: string | null;
  updated_at: string;
}

export class ProjectsRepo {
  constructor(private readonly db: Db) {}

  list(): Project[] {
    const rows = this.db
      .prepare<[], ProjectRow>(`SELECT * FROM projects ORDER BY id`)
      .all();
    return rows.map(rowToProject);
  }

  find(id: string): Project | undefined {
    const row = this.db
      .prepare<[string], ProjectRow>(`SELECT * FROM projects WHERE id = ?`)
      .get(id);
    return row ? rowToProject(row) : undefined;
  }

  exists(id: string): boolean {
    return (
      this.db.prepare<[string], { c: number }>(`SELECT 1 AS c FROM projects WHERE id = ?`).get(id)
        ?.c === 1
    );
  }

  insert(input: ProjectInsertInput): Project {
    this.db
      .prepare(
        `INSERT INTO projects (id, name, description, created_at, updated_at)
         VALUES (@id, @name, @description, @created_at, @updated_at)`,
      )
      .run(input);
    return this.find(input.id)!;
  }

  update(id: string, input: ProjectUpdateInput): Project | undefined {
    const existing = this.find(id);
    if (!existing) return undefined;
    const next: ProjectInsertInput = {
      id,
      name: input.name ?? existing.name,
      description:
        input.description === undefined ? existing.description : input.description,
      created_at: existing.created_at,
      updated_at: input.updated_at,
    };
    this.db
      .prepare(
        `UPDATE projects
            SET name = @name,
                description = @description,
                updated_at = @updated_at
          WHERE id = @id`,
      )
      .run(next);
    return this.find(id);
  }

  delete(id: string): boolean {
    const info = this.db.prepare(`DELETE FROM projects WHERE id = ?`).run(id);
    return info.changes > 0;
  }
}
