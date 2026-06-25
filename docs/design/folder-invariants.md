---
id: d83567ff-63b6-47d0-a829-2c249cfcc187
title: Folder Invariants
project: backlogger-docs
type: design_doc
status: active
created_at: '2026-06-04T00:00:00.000Z'
updated_at: '2026-06-04T00:00:00.000Z'
tags: []
---

# Folder Invariants

> Related code: `packages/api/src/routes/project-folders.ts` (folder lifecycle),
> `packages/api/src/routes/project-reload.ts` (reload)  
> Related concept: [Archive Invariants](./archive-invariants.md)

---

## Overview

Folders are virtual groupings of documents. The authoritative record of which
folders exist is the **filesystem** — a folder exists if and only if at least
one document file lives inside it (directly or in a subfolder). The SQLite
metadata cache records the folder path on each document row; no separate
"folder" table exists.

---

## 1. Folder Creation

- Creating a folder via `POST /api/projects/:id/folders` creates a physical
  directory on disk.
- No row is inserted into the database for the folder itself; folder membership
  is derived from each document's `path` prefix.
- If the folder already exists on disk the API returns `201` with the folder
  path unchanged (idempotent).
- Folder creation is rejected with `409 PROJECT_READ_ONLY` when the project is
  read-only.

---

## 2. Folder Deletion

Deleting a folder only succeeds when **both** of the following are true:

a. **No files remain on disk** inside the folder or any of its subfolders.  
b. **No documents in the database** have a path whose prefix matches the folder.

The `DELETE /api/projects/:id/folders/*` handler enforces both checks before
removing the directory. If either condition is violated it returns
`409 FOLDER_NOT_EMPTY`; a folder that is not present returns `404
FOLDER_NOT_FOUND`. Deletion on a read-only project is rejected with `409
PROJECT_READ_ONLY` before either check runs.

This two-check design prevents the database and filesystem from diverging:
if one is stale (e.g. a manual file move was done outside Backlogger), the
server refuses to delete and the user must `Reload` first.

---

## 3. External Edits

If files are added, moved, or removed outside Backlogger (e.g. via a text
editor, shell commands, or a `git` operation), the database cache can become
stale. A **Reload** (`POST /api/projects/:id/reload`) re-scans the project
directory and rebuilds the cache from the filesystem. After a reload, the
folder listing reflects the current on-disk state.

---

## 4. Moving Documents

There is no "move document" API endpoint. Documents can only be moved by:

1. Editing the file path externally and then running a Reload.
2. Deleting the document and creating a new one in the target folder.

The UI does not expose a move operation at this time.

---

## 5. The `archived/` Folder

The `archived/` subdirectory is a **special** folder managed automatically by
the system. Documents are moved into `archived/<original-folder>/` when their
status is changed to `archived`, and moved back when they are unarchived.

The folder is **not** listed in the normal folder tree and cannot be created
or deleted via the folder API. See [Archive Invariants](./archive-invariants.md)
for the full rules.
