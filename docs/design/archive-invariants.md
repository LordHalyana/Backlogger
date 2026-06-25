---
id: 049ac459-0851-4277-ae68-137118244d2a
title: Archive Invariants
project: backlogger-docs
type: design_doc
status: active
created_at: '2026-06-04T00:00:00.000Z'
updated_at: '2026-06-04T00:00:00.000Z'
tags: []
---

# Archive Invariants

> Related code: `packages/shared/src/paths.ts`, `packages/api/src/services/document-service.ts`<br>
> Related tests: `packages/api/src/services/document-service.test.ts`

---

## The Invariant

Archive status is represented in two places: the document's `status` field in
its frontmatter (and in the SQLite metadata cache) and the file's on-disk path.
These two representations **must remain consistent**:

1. A document with `status: archived` **must** be stored under  
   `<project-root>/archived/<original-path>`.
2. A document with `status: active` or `status: draft` **must not** be stored
   under `<project-root>/archived/<…>`.

The `archived/` segment is inserted immediately after the project-id segment
in the project-relative path.

**Example:**

| Status     | On-disk path                                         |
|------------|------------------------------------------------------|
| `active`   | `my-project/notes/design-doc-abc12.md`               |
| `archived` | `my-project/archived/notes/design-doc-abc12.md`      |

---

## Why Two Representations?

- **Filesystem path** — makes archived documents browsable and distinguishable
  when viewing the raw project directory, and lets external tooling or
  git-blame distinguish archived from active work.
- **Frontmatter `status` field** — enables the metadata cache (SQLite) to
  filter documents by status without scanning the filesystem.

Both representations are set atomically by `DocumentService.update()` whenever
the status changes. Because archiving and unarchiving go through
`DocumentService.update()`, they are subject to read-only enforcement: archiving
or unarchiving a document in a read-only project is rejected with
`409 PROJECT_READ_ONLY`.

---

## Mismatch Handling During Reindex

If a file is edited or moved outside Backlogger (e.g. via a text editor or
`git mv`), the two representations can get out of sync. During a `Reload`
operation the **filesystem path wins**:

| Detected condition                                   | Correction applied                    |
|------------------------------------------------------|---------------------------------------|
| Path is under `archived/` but frontmatter says `active` | Status recorded as `archived`         |
| Path is not under `archived/` but frontmatter says `archived` | Status recorded as `active`    |

The path utility functions `archivePath`, `unarchivePath`, and `isArchivedPath`
in `packages/shared/src/paths.ts` are the canonical implementations of this
rule and are tested through `document-service.test.ts`.
