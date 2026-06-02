---
id: ed4f17c7-7f01-47a4-896e-b6419db51d87
title: "Block — Folder Management"
project: backlogger-docs
type: design_doc
status: archived
created_at: "2026-06-01T03:57:59.402Z"
updated_at: "2026-06-01T03:59:18.508Z"
tags: ["p4"]
---

# Block — Folder Management

> Phase 4 / Block 1 · Surface area: API + Web sidebar + NewDocumentDialog
> Status: ✅ Done (2026-06-01)

---

## 1. Problem

Through P1–P3 the on-disk layout was hard-coded: every project got the
same five subfolders (`ideas/`, `design-docs/`, `implementation-plans/`,
`backlog/`, `notes/`) and `DocumentService.create()` chose the folder
strictly from the document's `type` via `DOCUMENT_TYPE_TO_SUBDIR`. This
broke down the first time we tried to dogfood the app with our own
docs: a real project wants a project-specific hierarchy
(`phases/p3/blocks/…`, `design/`, `reports/`), not five generic
buckets.

## 2. Goals

1. Decouple `type` from on-disk grouping entirely. Folders become the
   only on-disk grouping; `type` stays as a metadata facet on the
   document.
2. Let the user create and delete arbitrary folders, including nested
   paths (`phases/p3/blocks`), from the sidebar.
3. Keep the legacy behaviour as a fallback: if the caller doesn't pass
   a `folder`, fall back to `DOCUMENT_TYPE_TO_SUBDIR[type]` so all
   pre-existing API clients and tests still work.
4. No surprises in the security model: folder paths share the same
   resolver guardrails as filenames (no `..`, no absolute paths, no
   symlink traversal, no escaping the project root).

## 3. Non-goals

- Drag-and-drop reorganisation. Move/rename of existing documents
  between folders is deferred — for now the user picks the folder at
  creation time.
- Folder rename. Deferred (the user can create a new folder and move
  files manually on disk, then click Reload).
- Per-folder ACLs, metadata, or custom icons.

## 4. Shape on disk

```
data/projects/<projectId>/
  ideas/                  ← still created by ensureProjectSkeleton for back-compat
  design-docs/
  implementation-plans/
  backlog/
  notes/
  <user-defined>/         ← anything matching FolderPathSchema
  phases/p3/blocks/       ← nested paths allowed, up to depth 8
```

The skeleton subfolders remain so the type→subdir fallback always has
a target. New folders the user creates live alongside; the SQLite
schema is untouched (the `documents.path` column already stored
`projectId/<arbitrary>/<file>.md`).

## 5. API

### 5.1 Validation (shared)

`FolderPathSchema` (in `@backlogger/shared`) — string, 1–255 chars, no
leading/trailing `/`, depth ≤ 8, each segment matches
`/^[a-z0-9][a-z0-9-_]{0,63}$/`. `CreateDocumentRequest.folder?: string`
is added; when omitted, `DocumentService` falls back to the legacy
type→subdir map.

`PathResolver.assertFolderPath(folder)` performs the same validation
server-side and `PathResolver.projectFolderPath(projectId, folder)`
returns the absolute path, throwing `InvalidRelativePathError` on any
violation.

### 5.2 Endpoints (under `/api/projects/:id`)

| Method | Path                  | Body / Result                                           |
|--------|-----------------------|---------------------------------------------------------|
| GET    | `/folders`            | `string[]` — every subfolder, sorted, project-relative  |
| POST   | `/folders`            | `{ folder: string }` → 201 `{ folder }`; idempotent     |
| DELETE | `/folders/*`          | wildcard captures nested path → 204 / 404 / 409         |

`DELETE` refuses to remove a folder that contains any files or any
subfolders → `409 FOLDER_NOT_EMPTY`. Missing folder → `404
FOLDER_NOT_FOUND`. Invalid path → `400 VALIDATION_FAILED`.

`POST /api/projects/:id/documents` accepts an optional `folder` field
in addition to the existing fields. The service writes to
`projectId/folder/<slug>-<id>.md` and `FsRepository.write()` does the
`mkdir -p` for the parent.

## 6. Web

### 6.1 Hooks

`packages/web/src/lib/folders.ts` exposes `useFolders(projectId)`,
`useCreateFolder()`, and `useDeleteFolder()`. The delete hook also
invalidates `documents/<projectId>` so the tree refreshes if any docs
were affected.

### 6.2 NewDocumentDialog

Adds a **Folder** combobox below the **Type** select. Options:
`Default (by type)` (no `folder` field is sent — legacy fallback);
every existing folder from `useFolders`; `+ New folder…` which reveals
an inline text input. When the user submits with `+ New folder…`, the
dialog first POSTs to `/folders` then chains the document create with
`folder: <newName>`.

### 6.3 ProjectTree

The tree is regrouped by folder (instead of by type). Each folder
becomes a group header with:

- `+` button in the **Folders** toolbar → `window.prompt` → POST
- **Manage** toggle reveals a `×` button on every folder row; clicking
  it confirms and DELETEs. Non-empty folders show the `×` disabled
  with a tooltip explaining why.

Documents inside each folder render with a small type badge (the type
moved from group-by axis to inline metadata).

## 7. Implementation Notes

### 7.1 Decision: keep the skeleton

We considered deleting `ensureProjectSkeleton`'s five subdirs entirely
to make folders 100% user-defined, but the type→subdir fallback would
then need to lazily `mkdir -p` for every type, and every existing
test/script would silently start writing into ad-hoc folders. Easier
to keep the skeleton and treat it as "the default folder per type".

### 7.2 Decision: prompt + confirm for MVP UI

A full inline-edit / drag UX was scoped out. `window.prompt` for
create and `window.confirm` for delete keep the change surface small
and the e2e deterministic. The sidebar styling is intentionally
restrained — a single Manage toggle reveals the destructive affordances.

### 7.3 DELETE wildcard route

Express's `*` capture lands the rest of the path in `req.params[0]`,
which we URL-decode and re-validate via `FolderPathSchema`. Empty-folder
enforcement does two checks: `listProjectFiles` for any `.md` under the
folder prefix, and `listFolders` for any subfolder — either yields 409.

### 7.4 No schema migration

`documents.path` already stored arbitrary `projectId/<folder>/<file>.md`
strings (the column is a plain TEXT) and `walkProject` already recursed
into subdirectories, so the existing reindex picks up nested folders
without any DB or repository changes.

### 7.5 Accessibility

The new sidebar buttons (`+`, `Manage`, per-folder `×`) all have
explicit `aria-label`s. The Manage toggle uses `aria-pressed`. Doc
buttons in the tree got an explicit `aria-label={d.title}` so existing
e2es that look up documents by accessible name continue to work after
we added the inline type/status badges.

### 7.6 Test-suite collisions

Adding aria-labels to the dialog selects (e.g.
`aria-label="Document type"`) meant `getByLabel('Type')` in older e2es
still matched (substring), so no spec updates were needed there. The
ProjectTree's badge spans got `aria-hidden="true"` so the doc button's
accessible name stays exactly `d.title` — `import.spec.ts` and
friends use `getByRole('button', { name: <title>, exact: true })`.

### 7.7 Files touched

- `packages/shared/src/documents.ts` — `FolderPathSchema`, `folder?` on `CreateDocumentRequest`.
- `packages/api/src/fs/path-resolver.ts` — `FOLDER_SEGMENT_RE`, `FOLDER_MAX_DEPTH`, `assertFolderPath`, `projectFolderPath`.
- `packages/api/src/fs/repository.ts` — `listFolders`, `createFolder`, `removeFolder`, `projectExists`.
- `packages/api/src/services/document-service.ts` — folder fallback in `create`.
- `packages/api/src/routes/projects.ts` — three new routes, `FsRepository` injection.
- `packages/api/src/app.ts` — pass `ctx.fs` into router.
- `packages/web/src/lib/folders.ts` (new).
- `packages/web/src/components/NewDocumentDialog.tsx` — folder combobox + inline new-folder input.
- `packages/web/src/components/ProjectTree.tsx` — group-by-folder + Manage toggle.
- `packages/web/src/styles/app.css` — folder toolbar, folder row, type badge.
- `packages/api/src/fs/path-resolver.test.ts` — +2 tests (assertFolderPath).
- `packages/api/src/fs/repository.test.ts` — +5 tests (folder management).
- `packages/api/src/app.test.ts` — +8 Project Folders API tests.
- `e2e/folders.spec.ts` (new).
- `scripts/seed-docs-project.ts` — mirror the `docs/` tree into nested folders.

### 7.8 Test counts

- Unit: 169 → **184** (+15).
- E2E: 13 → **14** (+1 `folders.spec.ts`).
