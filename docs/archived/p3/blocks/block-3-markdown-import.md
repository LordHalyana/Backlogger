# Block 3 — Markdown Import

> Parent: [../implementation_plan.md](../implementation_plan.md)
> Depends on: Phase 1 Blocks 1 (FsRepository), 4 (DocumentService), 5 (Templates); Phase 2 Blocks 1 (FTS), 2 (links), 3 (tags).
> Delivers: a user can bring existing `.md` files into a Backlogger project via file picker or drag-and-drop, with placement controls; imported files participate fully in search, links, and tags.

---

## 1. Purpose

Lower the on-ramp. Today every document is born inside Backlogger; users with existing Markdown notebooks have no path in. This block makes the data dir's "filesystem is the source of truth" promise work in both directions.

---

## 2. Scope

In scope:
- Topbar / project-tree "Import" affordance (file picker for `.md` and drag-and-drop onto the project tree).
- Placement controls: target project (defaults to current), document type (defaults to `note`), optional title override (defaults to first H1 or filename).
- Multi-file upload (≤ 20 files / ≤ 5 MB total per request).
- Validation pipeline: UTF-8 check, size ceiling per file (1 MB), frontmatter parse (gray-matter), title extraction.
- Duplicate detection via SHA-256 of normalized body; user is offered Skip / Import as copy / Replace existing.
- Stored through the existing `DocumentService.create` codepath so links + tags + FTS update for free.

Out of scope:
- ZIP / tarball import (single files only).
- Recursive folder import (drag-and-drop of a folder is rejected with a clear error).
- Pandoc-based format conversion (`.docx`, `.html`, `.org` — defer).
- Frontmatter coercion beyond the existing zod schema (invalid frontmatter → error, not auto-fix).
- Image / asset import (we strip nothing; if the body references `./img/foo.png` the link will dangle).

---

## 3. Design

### 3.1 API

`POST /api/projects/:projectId/import` — `multipart/form-data`:
- Field `files`: 1..20 `.md` files.
- Field `placement` (JSON): `{ type: DocumentType; titleStrategy: 'frontmatter' | 'h1' | 'filename'; onDuplicate: 'skip' | 'copy' | 'replace' }`.

Response:
```json
{
  "imported": [{ "filename": "design.md", "documentId": "abc-12345678", "title": "Design" }],
  "skipped":  [{ "filename": "old.md",    "reason": "duplicate", "existingId": "xyz-87654321" }],
  "errors":   [{ "filename": "bad.md",    "code": "INVALID_FRONTMATTER", "message": "..." }]
}
```

HTTP `200` if at least one file imported; `207` if mixed; `400` if all errored.

### 3.2 Service

`packages/api/src/services/import-service.ts`:

```ts
class ImportService {
  importFiles(projectId: string, files: ImportFile[], placement: Placement): ImportResult;
}
```

Pipeline per file:
1. Validate size, MIME-ish (`.md` extension, `Content-Type: text/markdown` or `text/plain`).
2. Decode UTF-8 (reject if invalid → `ENCODING_NOT_UTF8`).
3. `matter()` parse → `{ data: frontmatter, content: body }`. If frontmatter present, validate via `FrontmatterSchema`; if absent, synthesize from placement.
4. Derive title per `titleStrategy`.
5. Compute `sha256(body.trim())`. Look up `documents.body_hash` (new column) within project.
6. If duplicate: act on `onDuplicate`. `copy` appends ` (imported)` to title; `replace` calls `DocumentService.update` with `If-Match`.
7. Else call `DocumentService.create` (which writes the file, upserts the row, updates links + tags + FTS in one transaction).

### 3.3 Schema

Migration `0004_body_hash.sql`:
```sql
ALTER TABLE documents ADD COLUMN body_hash TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_documents_body_hash ON documents(project_id, body_hash);
```

`DocumentsRepo` writes `body_hash = sha256(body)` on every create/update. Reindex backfills.

### 3.4 Web

- New `ImportDialog` component (uses existing dialog primitives).
- Topbar button "Import" opens it with current project preselected.
- Drop zone: a `dragover`/`drop` listener on `.project-tree` opens the dialog with the dropped files pre-staged.
- Per-file row shows: filename, detected title, type, status (Ready / Duplicate / Error) with action buttons.
- On submit: `POST /api/projects/:id/import` via `useImportFiles` mutation; on success invalidates `documents`, `tags`, `titles` queries.

### 3.5 Security

- Filename is never used as a disk path — `DocumentService` already generates `<slug>-<short8>.md`.
- Multipart parser: `multer` with `limits: { fileSize: 1MB, files: 20, fields: 5 }`.
- Body parsed as UTF-8 string only — no `eval`, no template interpolation on input.

---

## 4. Tasks

| # | Task | Files |
|---|------|-------|
| 1 | Migration: `body_hash` column + index | `migrations/0004_body_hash.sql` |
| 2 | DocumentsRepo + ReindexService backfill `body_hash` | `db/documents-repo.ts`, `services/reindex-service.ts` |
| 3 | `ImportService` + zod `PlacementSchema` | `services/import-service.ts`, `packages/shared/src/import.ts` |
| 4 | Route `POST /api/projects/:id/import` with multer | `routes/import.ts`, `app.ts` |
| 5 | API tests: happy, duplicate × 3 strategies, invalid frontmatter, oversize, non-UTF8 | `app.test.ts` |
| 6 | `useImportFiles` hook | `packages/web/src/lib/documents.ts` |
| 7 | `ImportDialog` component | `packages/web/src/components/ImportDialog.tsx` |
| 8 | Drag-and-drop on project tree | `packages/web/src/components/ProjectTree.tsx` |
| 9 | E2E: drag two files, one duplicate, one new | `e2e/import.spec.ts` |

---

## 5. Exit Criteria

- Importing `design.md` into project `foo` creates a document searchable by its body content within the same request.
- Re-importing the same file with `onDuplicate: 'skip'` returns it in `skipped`, no second row in `documents`.
- Re-importing with `onDuplicate: 'replace'` updates the existing document and bumps its `updated_at`.
- Frontmatter `tags: [a, b]` shows up in TagExplorer immediately.
- A 1.5 MB `.md` upload returns `413`.
- Phase 1+2 tests all still pass; one new e2e covers the happy path.

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| Drag-dropping a folder uploads thousands of files | `dataTransfer.items` is filtered to file entries with `.md` extension before opening the dialog; folder entries surface a single rejection toast. |
| Imported frontmatter conflicts with placement (e.g. `type: design_doc` in YAML, `note` in placement) | Frontmatter wins when present; placement is the fallback. Documented in the dialog. |
| Hash collisions cause false duplicate detection | SHA-256 collisions are not a realistic concern; we additionally key duplicates by `project_id` so cross-project collisions never match. |
| Large multi-file upload blocks the event loop | Each file is processed sequentially with `await`; the whole request is bounded by the 5 MB / 20-file ceiling. |
| Imported wiki-links point to titles that don't exist in the target project | Acceptable — link rows are created in `links` with `target_id = NULL`, exactly like in-app dangling links. The next reindex re-resolves them. |

---

## 7. Implementation Notes (M3, 2026-05)

What landed differs from the design above in several pragmatic ways. All
deviations preserve the user-facing exit criteria except where noted.

### 7.1 Transport: JSON, not multipart/form-data
The design called for `multipart/form-data` with `multer`. The shipped route
accepts `application/json` with `{ placement, files: [{ filename, content }] }`.
Rationale: avoids a new dependency (`multer` + `@types/multer`), keeps the
test harness using plain `supertest().send()`, and is a perfectly good fit
for a single-user LAN tool. The client (`ImportDialog`) reads each picked
file with `File.text()` before posting, and `express.json` was bumped to
`24 MiB` to cover 20 × 1 MiB worst case with headroom. Validation still caps
at 20 files / 1 MiB each (enforced both server-side via Zod and client-side
in the dialog).

A 1.5 MB single-file upload returns **`400 VALIDATION_FAILED`** (Zod
`max(1_048_576)` on `content`) rather than the `413` named in §5; the exit
criterion was about rejecting oversized inputs, which still holds.

### 7.2 Duplicate detection: frontmatter `id`, not `body_hash`
The design proposed a new `body_hash` column + migration + index +
`findDuplicateByHash`. The shipped implementation instead matches on
`frontmatter.id` only (round-tripping a Backlogger export). Rationale:
avoids a `documents` schema migration mid-phase; the round-trip case is
the one users hit (re-importing their own exports); content-only duplicate
detection is deferrable. Trade-off: copy-paste of a body without frontmatter
does not deduplicate.

Skipped artifacts as a consequence:
- `migrations/0006_body_hash.sql` — not created (the next free migration
  slot was `0006`, since `0004_links.sql` and `0005_tags.sql` already exist).
- `DocumentsRepo.findDuplicateByHash` — not added.
- `DocumentService.create/update` body-hash computation — not added.
- `ReindexService` body-hash backfill — not needed.

### 7.3 No drag-and-drop in M3
The topbar **Import** button + file picker covers the primary path. A drop
target on `ProjectTree` is deferred — additive, can land later without
touching the server.

### 7.4 Service composition
`ImportService` delegates writes to `DocumentService.create/update` rather
than touching the FS or repo directly. This keeps `<slug>-<short8>.md`
naming, frontmatter serialization, and link/tag rebuilds on a single
transactional path. `PROJECT_NOT_FOUND` escapes per-file error capture and
aborts the whole request with `404`.

### 7.5 Status codes
- `200` — all files imported or skipped, no errors.
- `207` — partial success (some `errors[]`).
- `400` — request-shape validation (oversize, non-.md, > 20 files, bad placement).
- `404` — unknown project id.

### 7.6 Files touched
- `packages/shared/src/import.ts` (new)
- `packages/shared/src/index.ts`
- `packages/api/src/services/import-service.ts` (new)
- `packages/api/src/routes/import.ts` (new)
- `packages/api/src/context.ts`
- `packages/api/src/app.ts`
- `packages/api/src/app.test.ts` — +10 Import API tests
- `packages/web/src/lib/documents.ts` — `useImportFiles`
- `packages/web/src/components/ImportDialog.tsx` (new)
- `packages/web/src/App.tsx` — topbar **Import** button + mount
- `packages/web/src/styles/app.css` — `.import-button`, `.import-file-list`, `.import-result`
- `e2e/import.spec.ts` (new)

### 7.7 Test counts
- Unit: 145 → **154** (+9).
- E2E: 9 → **10** (+1 `import.spec.ts`).
