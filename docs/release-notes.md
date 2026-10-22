---
id: 9ff86fa4-5649-44b7-8691-2ed43a4180d6
title: Release Notes
project: backlogger-docs
type: note
status: active
created_at: '2026-10-22T00:00:00.000Z'
updated_at: '2026-10-22T00:00:00.000Z'
tags: ['docs']
---

# Release Notes

## Unreleased

### Breaking changes

1. **Filing and permanent deletion require an `Idempotency-Key`.**
   `POST /api/documents/:id/file`, `DELETE /api/documents/:id` and
   `DELETE /api/projects/:id` now need an `Idempotency-Key` header holding a
   client-generated UUID. Without a valid one they return
   `400 INVALID_COMMAND` and change nothing. The filing body stays
   `{ target_project_id, revision }`. Retrying with the same key returns the
   original acknowledgement, even after the item was deleted or filed again.
2. **Filing returns an acknowledgement, not the document.** A successful filing
   answers `200` with `{ operation_id, command, document_id,
   source_project_id, target_project_id, outcome, result_revision }`. Fetch the
   document afterwards for its current state.
3. **Deletion returns `200` with an acknowledgement instead of `204`.**
   Deleting a document answers `{ operation_id, command: "document.delete",
   document_id, project_id, outcome: "deleted", result_revision: null }`;
   deleting a project answers `{ operation_id, command: "project.delete",
   project_id, outcome: "deleted" }`. Refresh the affected lists afterwards.
4. **Refresh open browser tabs after upgrading.** Tabs loaded before the
   upgrade file and delete items without a key, and the server refuses those
   requests.
5. **A stale document edit returns `REVISION_CONFLICT`.** `PUT
   /api/documents/:id` with an `If-Match` that no longer matches now answers
   `409 REVISION_CONFLICT` with `details: { currentRevision, currentProjectId }`,
   the same code and details as a stale filing. It used to answer
   `409 DOCUMENT_VERSION_MISMATCH` with no details. A missing `If-Match` is
   still accepted.

### Changes

- Switching the designated Inbox to sidecar mode through
  `PUT /api/projects/:id` returns `409 INBOX_PROTECTED` and changes no
  setting, so global capture keeps working. See
  [`PUT /api/projects/:id`](api.md#put-apiprojectsid).

- Filing a backlog item carries all of its comments into the target project,
  byte for byte, with no duplicates at either end. Filing is recoverable: a
  crash at any point is finished forward on restart or by Recheck on the
  Recovery API. A comment directory holding anything but the task's comments
  blocks the filing, with nothing moved. See
  [`POST /api/documents/:id/file`](api.md#post-apidocumentsidfile).
- Reload and Reindex follow a pending filing's manifest, so a task mid-filing
  is never shown twice.
- Deleting a backlog item deletes all of its comments, and the delete dialog
  says so. Deleting a project deletes every task, comment and file in its
  folder. Deletion is resumable: it records an inventory of what it removes
  (paths and fingerprints, no content), then removes only files that still
  match it, and folders only once they are empty. It never follows a
  symlink. A file changed or added in scope while a deletion runs is kept,
  and the deletion stops for review on the Recovery API. Restart, Reload and
  Reindex never bring back an item whose deletion is unfinished. See
  [`DELETE /api/documents/:id`](api.md#delete-apidocumentsid).
- Deleting a project whose folder is a symlink (a mount) removes the link and
  the project's index rows, dangling link or not; the files the link points at
  are never touched. Projects now report `linked`, and the delete dialog says
  which kind of deletion it is. See
  [`DELETE /api/projects/:id`](api.md#delete-apiprojectsid).
- In a sidecar project, a document's sidecar entry is fingerprinted with the
  rest of the deletion: an entry edited by hand while the deletion runs is kept
  and the deletion stops for review, like a changed file.
- When a delete request gets no answer or a server error, the web app no
  longer just says it failed: the toast says the deletion may still be in
  progress and offers Open Recovery on that operation, and the Recovery list
  and banner refresh straight away.
