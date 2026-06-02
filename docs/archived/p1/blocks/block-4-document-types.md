---
id: 0f43d84b-6a20-4756-89b2-8d5532828d73
title: "Block 4 — Document Types"
project: backlogger-docs
type: design_doc
status: archived
created_at: "2026-05-30T07:02:10.273Z"
updated_at: "2026-05-30T10:39:50.631Z"
tags: ["p1"]
---

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

---

## 7. Implementation Notes

> Status: ✅ Done. All exit criteria met. 72/72 tests pass; lint, typecheck, and build are clean.

### What shipped

- **Shared schemas** (`packages/shared/src/documents.ts`): `DocumentTypeSchema`, `DocumentStatusSchema`, `FrontmatterSchema` (with defaults for `status` and `tags`), `DOCUMENT_TYPE_TO_SUBDIR` map, plus `CreateDocumentRequestSchema` / `UpdateDocumentRequestSchema` / `DocumentSchema` / `DocumentSummarySchema`. Re-exported from `@backlogger/shared`.
- **Migration** `migrations/0002_documents.sql`: `documents` table with `project_id` FK `ON DELETE CASCADE`, `path` UNIQUE, JSON-encoded `tags` column, indexes on `project_id` and `type`.
- **Repo** `packages/api/src/db/documents-repo.ts`: `listByProject`, `find`, `findByPath`, `upsert` (idempotent — `INSERT ... ON CONFLICT(id) DO UPDATE`), `delete`, `truncate`, `count`. Tags round-trip through JSON.
- **Service** `packages/api/src/services/document-service.ts`:
  - `create` → generate UUID + timestamps → build frontmatter via `FrontmatterSchema` → atomic write → upsert row. Rolls back the file on DB failure.
  - `update` → optional `If-Match` against current `updated_at` → 409 `DOCUMENT_VERSION_MISMATCH` on mismatch → read+merge+write → upsert.
  - `delete` → row delete then `fs.delete().catch(() => undefined)` (FS missing is tolerated, matches Block 2 project-delete pattern).
  - `get` → returns full document (frontmatter + body read fresh from disk).
  - `buildFilename(title, uuid)` → `<slug≤60>-<first8>.md`; slug uses NFKD-normalized lowercase `[a-z0-9-]+`, falls back to `"untitled"`.
- **Reindex service** `packages/api/src/services/reindex-service.ts`: truncates and re-walks via `fs.walk()`. Skips files whose `frontmatter.project` doesn't match the on-disk folder, unknown projects, or invalid frontmatter; returns `{ scanned, inserted, skipped[] }`.
- **Routes**:
  - `routes/documents.ts` → `projectDocumentsRouter` (GET/POST under `/api/projects/:projectId/documents`) and `documentsRouter` (GET/PUT/DELETE under `/api/documents/:id`). `PUT` reads `If-Match` header.
  - `routes/admin.ts` → `POST /api/admin/reindex`.
- **App + server**: `app.ts` mounts the three new routers; `server.ts` runs reindex on startup when `documentsRepo.count() === 0` AND `data/projects/` contains any `.md` file (recursive `hasAnyMarkdown` helper).
- **Context** updated to construct `DocumentsRepo`, `DocumentService`, `ReindexService` once per app.
- **Tests** (12 new in `app.test.ts`, 72 total): empty list, idea created under `ideas/`, `finding` routed to `notes/`, unknown project on create → 404, invalid type → 400 `VALIDATION_FAILED`, read returns body, update bumps `updated_at`, stale `If-Match` → 409 `DOCUMENT_VERSION_MISMATCH`, matching `If-Match` succeeds, delete removes file, project delete cascades document rows (via FK), and reindex round-trip rebuilds the table from disk.

### Deviations from the design

- `tags` are stored as a JSON string in SQLite (single TEXT column) rather than a join table. Phase 1 has no tag query — when we add one, switch to `document_tags(document_id, tag)` and reindex.
- `finding` → `notes/` is implemented; design doc notes this is a deliberate MVP folding.
- Filename slug falls back to `"untitled"` if the title strips to empty (e.g. emoji-only); design didn't specify the empty-slug case.
- `DELETE /api/documents/:id` tolerates a missing on-disk file (succeeds with 204) — matches the project-delete behavior shipped in M2.

### Verification

```bash
npm run typecheck   # clean
npm run lint        # clean (after dropping unused BadRequestError import)
npm test            # 72/72 (path-resolver 31 + repository 16 + app 25)
npm run build       # api + shared + web (188 KB JS / 60 KB gzip)
```

### Follow-ups for later blocks

- M4 (editor) consumes `GET /api/documents/:id` for read and `PUT` with `If-Match` for save; surface 409 to the user with a "reload" affordance.
- M5 (templates) populates `body` and possibly `tags` on `POST .../documents` via the optional `template` field already accepted by `CreateDocumentRequestSchema` (currently ignored by the service).
- Reindex skip list is not yet surfaced in the UI; M6 hardening should add a small admin panel that calls `POST /api/admin/reindex` and shows the report.
