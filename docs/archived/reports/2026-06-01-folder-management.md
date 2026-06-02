---
id: d2eefc85-12d0-40af-b335-e69e6136d953
title: "Status — 2026-06-01 · Folder Management"
project: backlogger-docs
type: note
status: archived
created_at: "2026-06-01T03:58:21.772Z"
updated_at: "2026-06-01T03:59:18.508Z"
tags: ["reports", "status"]
---

# Status — 2026-06-01 · Folder Management

> Phase 4 / Block 1 ships. Backlogger now supports arbitrary
> user-managed folder hierarchies per project.

---

## What shipped

- **Schema + path validation** (`@backlogger/shared`,
  `packages/api/src/fs/path-resolver.ts`): `FolderPathSchema`,
  `FOLDER_SEGMENT_RE` (lowercase, depth ≤ 8), `assertFolderPath`,
  `projectFolderPath`.
- **FsRepository folder ops** (`packages/api/src/fs/repository.ts`):
  `listFolders` (recursive, sorted), `createFolder` (idempotent),
  `removeFolder` (refuses non-empty).
- **DocumentService** (`packages/api/src/services/document-service.ts`):
  accepts an optional `folder` on create; falls back to
  `DOCUMENT_TYPE_TO_SUBDIR[type]` when omitted.
- **REST API** (`packages/api/src/routes/projects.ts`):
  - `GET /api/projects/:id/folders`
  - `POST /api/projects/:id/folders`
  - `DELETE /api/projects/:id/folders/*` (wildcard for nested paths)
- **Sidebar UI** (`packages/web/src/components/ProjectTree.tsx`):
  group-by-folder rendering, `+` to add (prompt), **Manage** toggle to
  reveal per-folder `×` delete buttons (disabled when non-empty).
- **NewDocumentDialog** (`packages/web/src/components/NewDocumentDialog.tsx`):
  Folder combobox with inline `+ New folder…` option.
- **Seed script** (`scripts/seed-docs-project.ts`): rewrites the docs
  layout to mirror `docs/` 1:1 — `phases/p1/blocks/…`, `design/…`,
  `reports/…` — using the new folder API.

## Test counts

| Suite | Before | After | Delta |
|-------|--------|-------|-------|
| Unit  | 169    | **184** | +15 |
| E2E   | 13     | **14**  | +1  |

## Backwards compatibility

- The five-subdir project skeleton (`ideas`, `design-docs`,
  `implementation-plans`, `backlog`, `notes`) is still created at
  project bootstrap. Existing data dirs from P1–P3 keep working.
- All pre-existing `POST /api/projects/:id/documents` calls that omit
  `folder` continue to route to the legacy type→subdir map.
- SQLite schema unchanged. `documents.path` already stored arbitrary
  `<projectId>/<...>/file.md` strings.

## Follow-ups deferred

- Folder rename and move-document-between-folders (out of scope for
  this block; users can edit on disk + click Reload).
- Replacing `window.prompt` / `window.confirm` with proper inline
  forms / styled confirmation dialogs.
- Surfacing per-folder document counts in the sidebar.

## Reference docs

- [Block design](../p4/blocks/block-1-folder-management.md)
- [Phase 4 plan](../p4/implementation_plan.md)
