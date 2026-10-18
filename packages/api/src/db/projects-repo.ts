import type { MetadataMode, Project } from '@backlogger/shared';
import type { Db } from './database.js';

/** A project as stored; the Inbox designation is not part of it. */
export type ProjectRecord = Omit<Project, 'isInbox'>;

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  read_only: number;
  metadata_mode: string;
  created_at: string;
  updated_at: string;
}

function rowToProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    readOnly: row.read_only === 1,
    metadataMode: row.metadata_mode === 'sidecar' ? 'sidecar' : 'frontmatter',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface ProjectInsertInput {
  id: string;
  name: string;
  description: string | null;
  readOnly?: boolean;
  metadataMode?: MetadataMode;
  created_at: string;
  updated_at: string;
}

export interface ProjectUpdateInput {
  name?: string;
  description?: string | null;
  readOnly?: boolean;
  metadataMode?: MetadataMode;
  updated_at: string;
}

export class ProjectsRepo {
  constructor(private readonly db: Db) {}

  list(): ProjectRecord[] {
    const rows = this.db
      .prepare<[], ProjectRow>(`SELECT * FROM projects ORDER BY id`)
      .all();
    return rows.map(rowToProject);
  }

  find(id: string): ProjectRecord | undefined {
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

  insert(input: ProjectInsertInput): ProjectRecord {
    this.db
      .prepare(
        `INSERT INTO projects (id, name, description, read_only, metadata_mode, created_at, updated_at)
         VALUES (@id, @name, @description, @read_only, @metadata_mode, @created_at, @updated_at)`,
      )
      .run({
        ...input,
        read_only: input.readOnly ? 1 : 0,
        metadata_mode: input.metadataMode ?? 'frontmatter',
      });
    return this.find(input.id)!;
  }

  update(id: string, input: ProjectUpdateInput): ProjectRecord | undefined {
    const existing = this.find(id);
    if (!existing) return undefined;
    const next: ProjectInsertInput = {
      id,
      name: input.name ?? existing.name,
      description:
        input.description === undefined ? existing.description : input.description,
      readOnly: input.readOnly ?? existing.readOnly,
      metadataMode: input.metadataMode ?? existing.metadataMode,
      created_at: existing.created_at,
      updated_at: input.updated_at,
    };
    this.db
      .prepare(
        `UPDATE projects
            SET name = @name,
                description = @description,
                read_only = @read_only,
                metadata_mode = @metadata_mode,
                updated_at = @updated_at
          WHERE id = @id`,
      )
      .run({
        ...next,
        read_only: next.readOnly ? 1 : 0,
        metadata_mode: next.metadataMode ?? 'frontmatter',
      });
    return this.find(id);
  }

  delete(id: string): boolean {
    const info = this.db.prepare(`DELETE FROM projects WHERE id = ?`).run(id);
    return info.changes > 0;
  }
}
