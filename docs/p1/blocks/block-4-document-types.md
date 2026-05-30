# Block 4 — Document Types

> Parent: [../implementation_plan.md](../implementation_plan.md)
> Depends on: Blocks 1, 2.
> Delivers: typed Markdown documents with enforced frontmatter, SQLite indexing, and document CRUD API.

---

## 1. Purpose

Turn raw `.md` files into typed, indexed *documents*. Establish the frontmatter schema once and reuse it everywhere.

---

## 2. Scope

In scope:
- Frontmatter schema (zod) for all six document types.
- `documents` table (schema v2 migration).
- `DocumentService` coordinating `FsRepository` + `MetadataRepository`.
- REST routes for document CRUD.
- `POST /api/admin/reindex` endpoint that rebuilds the `documents` table from disk.
- Reindex on startup if the table is empty.

Out of scope: editor UI (Block 3), templates (Block 5).

---

## 3. Design

### 3.1 Document types

`idea | note | design_doc | implementation_plan | backlog_item | finding`

Mapping `type` → subfolder:

| Type                   | Folder                  |
|------------------------|-------------------------|
| `idea`                 | `ideas/`                |
| `note`                 | `notes/`                |
| `design_doc`           | `design-docs/`          |
| `implementation_plan`  | `implementation-plans/` |
| `backlog_item`         | `backlog/`              |
| `finding`              | `notes/`                |

(`finding` lives under `notes/` for MVP; promoted to its own folder later if volume justifies it.)

### 3.2 Frontmatter schema (zod)

```ts
const DocumentType = z.enum([
  "idea", "note", "design_doc",
  "implementation_plan", "backlog_item", "finding",
]);
const DocumentStatus = z.enum(["draft", "active", "archived"]);

const Frontmatter = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
  project: ProjectId,
  type: DocumentType,
  status: DocumentStatus.default("draft"),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tags: z.array(z.string().min(1).max(40)).default([]),
});
```

### 3.3 SQLite migration (`0002_documents.sql`)

```sql
CREATE TABLE documents (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  type       TEXT NOT NULL,
  status     TEXT NOT NULL,
  path       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_documents_project ON documents(project_id);
CREATE INDEX idx_documents_type    ON documents(type);
```

### 3.4 Document filename

`<slug>-<short-id>.md` where `<slug>` is derived from title (kebab-case, ≤ 60 chars) and `<short-id>` is the first 8 chars of the UUID. Filename stays stable on title change (no rename in MVP).

### 3.5 Service behavior

- **Create:** generate UUID + timestamps, build frontmatter, write file atomically, insert row.
- **Update:** read current frontmatter, merge incoming fields, bump `updated_at`, optimistic-lock check on `updated_at`, write, update row.
- **Delete:** delete row, delete file.
- **Reindex:** truncate `documents`, walk disk, insert one row per valid file, log skipped files with reason.

### 3.6 API

| Method | Path                                              |
|--------|---------------------------------------------------|
| GET    | `/api/projects/:projectId/documents`              |
| POST   | `/api/projects/:projectId/documents`              |
| GET    | `/api/documents/:documentId`                      |
| PUT    | `/api/documents/:documentId`                      |
| DELETE | `/api/documents/:documentId`                      |
| POST   | `/api/admin/reindex`                              |

`PUT` accepts `If-Match: <updated_at>` header; mismatch → 409.

---

## 4. Tasks

1. Add `uuid` dependency.
2. Define shared zod schemas (`Frontmatter`, request/response DTOs).
3. Write migration `0002_documents.sql`.
4. Implement `MetadataRepository.documents.*`.
5. Implement `DocumentService` with optimistic locking.
6. Add Express routes + tests (happy path, validation, 404, 409).
7. Implement `ReindexService` and admin route.
8. Add startup hook: if `documents` table is empty and `data/projects/` has files, run reindex.

---

## 5. Exit Criteria

- All document types can be created, read, updated, deleted via API.
- Files written contain valid frontmatter that reparses cleanly.
- Reindex on an existing `data/` reconstructs the table exactly.
- Optimistic-lock conflict produces a deterministic 409.
- API tests cover all routes and the reindex endpoint.

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| Invalid frontmatter on disk (hand-edited) | Reindex logs and skips; document the recovery path in README. |
| UUID collisions | UUID v4; unique index enforces. |
| Title renames orphan filenames | Out of scope for MVP; document limitation. |
