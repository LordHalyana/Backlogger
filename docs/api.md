---
id: 4fdc81ce-2364-4be2-941b-abca982f0311
title: API Reference
project: backlogger-docs
type: note
status: active
created_at: '2026-06-04T00:00:00.000Z'
updated_at: '2026-06-04T00:00:00.000Z'
tags: []
---

# Backlogger API Reference

Date: 2026-06-04

Base URL in development:

```text
http://127.0.0.1:3333
```

All API responses are JSON unless a route explicitly streams a file.

## Errors

Structured errors use:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Invalid request body",
    "details": {}
  }
}
```

`details` is optional. It is present mainly on `VALIDATION_FAILED`, where it
carries the field-level validation errors.

Common codes include:

- `VALIDATION_FAILED`
- `INVALID_PROJECT_ID`
- `INVALID_DOCUMENT_ID`
- `INVALID_TAG`
- `PROJECT_NOT_FOUND`
- `PROJECT_READ_ONLY`
- `DOCUMENT_NOT_FOUND`
- `DOCUMENT_VERSION_MISMATCH`
- `REVISION_CONFLICT` (filing, and an update, move or delete whose document was filed into another project while it waited; `details: { currentRevision, currentProjectId }`)
- `RECOVERY_REQUIRED` (a write blocked by an unfinished operation; `details: { operationId, inspect }`, where `inspect` is the operation's `/api/recovery/:operationId` link)
- `CAPTURE_ID_CONFLICT`
- `INVALID_COMMAND`, `REVISION_REQUIRED` (`428`), `OPERATION_ID_CONFLICT`, `OPERATION_IN_PROGRESS`, `OPERATION_ABANDONED`, `COMMENT_NOT_WRITABLE`, `COMMENT_ID_CONFLICT`, `COMMENT_NOT_PRESERVABLE`, `PARENT_NOT_FOUND`, `COMMENT_NOT_FOUND` (see [Comments](#comments))
- `RECOVERY_NOT_FOUND` (`404`), `RECOVERY_ACTION_NOT_ALLOWED` (see [Recovery](#recovery))
- `PROJECT_NOT_WRITABLE`
- `NOT_A_BACKLOG_ITEM`
- `TARGET_PATH_TAKEN`
- `INBOX_PROTECTED`
- `INBOX_UNAVAILABLE` (`500`)
- `DERIVED_DOCUMENT_READ_ONLY`
- `RELOAD_IN_PROGRESS`
- `FOLDER_NOT_FOUND`
- `FOLDER_NOT_EMPTY`
- `INVALID_FOLDER`
- `TEMPLATE_NOT_FOUND`
- `GRAPH_UNAVAILABLE`
- `NOT_CONFIGURED`
- `INTERNAL_ERROR`

Filesystem validation also produces `PATH_OUTSIDE_DATA_DIR`, `INVALID_FILENAME`,
`INVALID_RELATIVE_PATH`, and `SYMLINK_NOT_ALLOWED` (all `400`).

## Health

### `GET /health`

Returns subsystem health:

```json
{
  "status": "ok",
  "api": "ok",
  "database": "ok",
  "storage": "ok",
  "templates": "ok",
  "fts": "ok",
  "version": "0.3.0",
  "uptime": 12.34,
  "uptime_s": 12,
  "checked_at": "2026-06-04T10:00:00.000Z"
}
```

HTTP status:

- `200` for `ok` or `degraded`.
- `503` for `error`.

### `GET /health/schema`

Returns the JSON Schema for health payloads.

## Projects

### `GET /api/projects`

Returns all projects.

Project objects include:

```json
{
  "id": "home-system",
  "name": "Home System",
  "description": "Optional",
  "readOnly": false,
  "metadataMode": "frontmatter",
  "isInbox": false,
  "created_at": "2026-06-04T10:00:00.000Z",
  "updated_at": "2026-06-04T10:00:00.000Z"
}
```

`isInbox` is `true` for the one designated Inbox. The designation is stored only
in `<dataDir>/workspace.json` (`{ "inbox_project_id": "inbox" }`); the server
creates the Inbox at start when that file is missing (`inbox`, or `inbox-2`, …
if the id is taken) and never adopts an existing project because of its id or
name. Deleting the Inbox or making it read-only returns `409 INBOX_PROTECTED`;
renaming it is allowed.

### `POST /api/projects`

Body:

```json
{
  "id": "home-system",
  "name": "Home System",
  "description": "Optional"
}
```

Returns `201` with the created project.

### `GET /api/projects/:id`

Returns one project.

### `GET /api/projects/:id/titles`

Returns the project's document id-to-title list, used for wiki-link resolution
in the editor and graph.

### `PUT /api/projects/:id`

Body:

```json
{
  "name": "New Name",
  "description": "Optional",
  "readOnly": true,
  "metadataMode": "sidecar"
}
```

All fields are optional, but at least one field is required. Use `readOnly` to protect a project from Backlogger writes or to deliberately unlock a mounted project for editing. Set `metadataMode` to `"sidecar"` to store Backlogger metadata in `<project>/.backlogger/index.json` (keeps mounted source files frontmatter-free) or `"frontmatter"` (default) to write it into each file.

Returns the updated project.

While any operation is pending in the project, changing `readOnly` or `metadataMode` returns `409 RECOVERY_REQUIRED`; a request that mixes those with allowed changes is refused as a whole. While a project deletion is pending, every setting is refused.

### `DELETE /api/projects/:id`

Deletes the project and attempts to remove its folder.

Returns `204`.

Returns `409 PROJECT_READ_ONLY` while read-only mode is enabled, and `409 RECOVERY_REQUIRED` while any operation is pending in the project.

## Documents

### `GET /api/projects/:projectId/documents`

Returns document summaries for a project.

Summary objects include `readOnly`. `readOnly: true` means the document cannot currently be edited because the containing project is in read-only mode. Plain Markdown files without Backlogger frontmatter are indexed with derived metadata; when the project is editable, the first update adopts the file by writing Backlogger frontmatter to the same path.

Optional query:

```text
?tag=docs&tag=active
```

Multiple tags use AND semantics.

### `POST /api/projects/:projectId/documents`

Body:

```json
{
  "title": "Design Notes",
  "type": "note",
  "status": "draft",
  "tags": ["design"],
  "body": "# Notes\n",
  "template": "design-document",
  "folder": "notes"
}
```

`folder` is optional. When omitted, the API falls back to the legacy type-to-folder mapping.

Valid `type` values are `idea`, `note`, `design_doc`, `implementation_plan`,
`backlog_item`, and `finding` (note underscores). Valid `status` values are
`draft`, `active`, and `archived`. `status`, `task_state`, `tags`, `body`,
`template`, and `folder` are all optional.

New backlog items (blank or from a template) are written with
`task_state: todo` right after `status`, unless the request sets `task_state`
to `in_progress` or `done`. Any other value returns `400 VALIDATION_FAILED`;
`task_state` on any other type returns `400 TASK_STATE_NOT_ALLOWED`.

Returns `201` with the full document.

Returns `409 PROJECT_READ_ONLY` while the project is in read-only mode.

### `GET /api/documents/:id`

Returns a full document including `body`.

Full document responses also include `readOnly` and `revision` (see `PUT` below).

### `PUT /api/documents/:id`

Body can contain any of:

```json
{
  "title": "New Title",
  "status": "active",
  "task_state": "in_progress",
  "tags": ["docs"],
  "body": "Updated body\n"
}
```

At least one field is required. `type` cannot be changed through an update.

`task_state` moves a backlog item between board columns. Only `todo`, `in_progress` and `done` are accepted (`400 VALIDATION_FAILED` otherwise), and only on a `backlog_item` (`400 TASK_STATE_NOT_ALLOWED` on other types and on sidecar-backed documents). It is written to the frontmatter immediately after `status`. An update without `task_state` keeps the stored value as written, including unrecognised values. Archiving or restoring (`status`) never changes it.

Header:

```text
If-Match: <revision value>
```

`revision` is an opaque fingerprint of the persisted document (the `.md` file, plus its sidecar entry for sidecar-backed documents). Every summary and full document response carries it, and it changes with every successful write and with any out-of-band edit of the file on disk. `updated_at` is for display only and is not a valid `If-Match` value.

The check runs inside the project's mutation queue against the file as it is on disk at that moment. If the header does not match the current revision, the API returns `409 DOCUMENT_VERSION_MISMATCH` and leaves the file unchanged. Of two overlapping updates sent with the same revision, exactly one succeeds and the other gets `409`.

A missing `If-Match` header is accepted: the update is applied unconditionally, as before. The web editor (and the board) always send it.

If the document was filed into another project while the update waited in the queue, the API returns `409 REVISION_CONFLICT` with `details: { currentRevision, currentProjectId }`, with or without `If-Match`, and changes nothing.

If the project is in read-only mode, the API returns `409 PROJECT_READ_ONLY`.

If an unfinished operation guards the document (or its whole project), the API returns `409 RECOVERY_REQUIRED` with `details: { operationId, inspect }` and changes nothing. The same applies to delete, move, filing and creating documents in a guarded project, and to a create, move or archive whose file would land on a guarded path. Other documents are unaffected.

If the document was indexed from plain Markdown without Backlogger frontmatter and the project is editable, the first successful update writes Backlogger frontmatter to the same file and returns the adopted editable document.

### `DELETE /api/documents/:id`

Deletes a document.

Returns `204`.

Returns `409 PROJECT_READ_ONLY` while the project is in read-only mode.

Derived plain-Markdown documents can be deleted only when the containing project is editable. While the project is read-only, deletion returns `409 PROJECT_READ_ONLY`.

Returns `409 REVISION_CONFLICT` with `details: { currentRevision, currentProjectId }` if the document was filed into another project while the delete waited in the queue.

### `POST /api/documents/:id/move`

Moves a document to a different project-relative folder, preserving its id, title, body, and archive state.

Body:

```json
{ "folder": "notes/ideas" }
```

`folder` is a folder path (lowercase, `/`-separated), or an empty string to move the document to the project root. Returns the updated document.

- `409 PROJECT_READ_ONLY` while the project is in read-only mode.
- `409 DERIVED_DOCUMENT_READ_ONLY` for a document indexed from plain Markdown (adopt it first by editing it in an editable project).
- `400 INVALID_FOLDER` when the target is the reserved `archived/` folder (archive via `status` instead).
- `409 REVISION_CONFLICT` (`details: { currentRevision, currentProjectId }`) if the document was filed into another project while the move waited in the queue.

### `GET /api/documents/:id/raw`

Downloads the raw Markdown file.

Response headers include:

- `Content-Type: text/markdown; charset=utf-8`
- `Content-Disposition: attachment; ...`
- `Cache-Control: private, no-store`

### `GET /api/documents/:id/backlinks`

Returns documents that link to this document.

### `POST /api/documents/:id/file`

Files a backlog item into another writable, frontmatter-mode project, keeping
its id.

```json
{ "target_project_id": "work", "revision": "<current revision>" }
```

- Only the frontmatter `project:` value changes; every other byte of the file
  is kept, and the file keeps its project-relative path.
- Already in the target project: `200` with the current document, no write,
  revision not checked (so a resend after a lost reply is safe).
- Stale revision: `409 REVISION_CONFLICT` with
  `details: { currentRevision, currentProjectId }`; no files change.
- Read-only or sidecar source or target: `409 PROJECT_NOT_WRITABLE`; unknown
  target: `404 PROJECT_NOT_FOUND`; not a backlog item: `400 NOT_A_BACKLOG_ITEM`.
- The target is written first, then the source deleted, then the index
  updated. If the process stops in between, reindex resolves the two copies
  (see `duplicates` in [Operations](api/operations.md)).

## Comments

Backlog items have Markdown comments, one file per comment at
`<dataDir>/projects/<project-id>/tickets/<task-id>/comments/<comment-id>.md`:

```yaml
---
schema_version: 1
kind: comment
id: <comment-uuid>
parent_id: <task-uuid>
created_at: '2026-10-19T16:00:00.000Z'
updated_at: '2026-10-19T16:00:00.000Z'
---
Markdown comment body.
```

The server sets both timestamps; the body follows the closing `---` line
exactly as submitted. Comments are indexed separately from documents: they
never appear in document lists, the board, Current work or folder listings,
and `tickets/<id>/comments` folders are reserved (`400` when creating a
folder or document there). Commands carry no project ID: the server finds the
parent task's current project and rechecks it once the write holds that
project. Comment writes never touch the parent task's file or revision.

Every comment write needs an `Idempotency-Key` header: a client-generated
operation UUID, unique across the workspace, reused unchanged when retrying.

- A retry of a completed operation returns its original acknowledgement and
  status without doing anything again, even if the comment or its task has
  changed since. This is checked before writability or the parent's location.
- The same key with different input: `409 OPERATION_ID_CONFLICT`.
- The same key while that request is still running: `409 OPERATION_IN_PROGRESS`;
  retry the identical request with backoff.
- An operation left unfinished (for example by a crash or a storage failure)
  blocks the task: `409 RECOVERY_REQUIRED`. A storage failure is never proof
  that nothing was written.

Acknowledgements carry no body content:

```json
{
  "operation_id": "<Idempotency-Key>",
  "command": "comment.create",
  "comment_id": "<comment-uuid>",
  "parent_id": "<task-uuid>",
  "outcome": "created",
  "result_revision": "<revision of the new file>"
}
```

`command` is `comment.create`, `comment.edit` or `comment.delete`, with
`outcome` `created`, `edited` or `deleted`. `result_revision` is the revision
the command left the file at, and `null` after a delete. Clients fetch the
current comment separately.

### `POST /api/documents/:taskId/comments`

```json
{ "id": "<client-generated comment UUID>", "body": "Markdown" }
```

`201` with the acknowledgement.

- Missing or invalid `Idempotency-Key`, missing or invalid `id`, or a missing
  or whitespace-only `body`: `400 INVALID_COMMAND`; nothing is written.
- Unknown task: `404 PARENT_NOT_FOUND`.
- Archived task, read-only project, or a document that is not a backlog item:
  `409 COMMENT_NOT_WRITABLE`. Done items accept comments; posting never
  changes task state or document status.
- A comment id already in use: `409 COMMENT_ID_CONFLICT`.
- The task was filed into another project while the request waited:
  `409 REVISION_CONFLICT` with `details: { currentRevision, currentProjectId }`.

### `GET /api/comments/:commentId`

One comment, read from its file:

```json
{
  "id": "<comment-uuid>",
  "parent_id": "<task-uuid>",
  "project_id": "work",
  "body": "Markdown",
  "created_at": "2026-10-19T16:00:00.000Z",
  "updated_at": "2026-10-19T16:00:00.000Z",
  "revision": "<revision>",
  "writable": true
}
```

`project_id` is the parent task's current project. `writable` is false while
the task is archived, its project is read-only, or it is not a backlog item.
Unknown comment: `404 COMMENT_NOT_FOUND`.

### `PUT /api/comments/:commentId`

Headers `Idempotency-Key` and `If-Match: <revision>`:

```json
{ "body": "Markdown" }
```

`200` with the acknowledgement. The body is replaced exactly as submitted and
`updated_at` set to now; the comment keeps its place in the history
(`created_at`), and readers can compare the two timestamps to show it was
edited. Every other byte of the frontmatter is kept, including keys this
version does not know. The parent task's file is not touched.

- Missing `If-Match`: `428 REVISION_REQUIRED`.
- `If-Match` is not the file's current revision: `409 REVISION_CONFLICT` with
  `details: { currentRevision }`; nothing is written.
- A file whose frontmatter cannot be kept byte for byte (it no longer parses,
  `updated_at` is not one plain `updated_at: '<timestamp>'` line, or rewriting
  it would change another key): `409 COMMENT_NOT_PRESERVABLE`. The file is left
  untouched; fix it by hand to edit it here.
- Missing or invalid `Idempotency-Key` or comment id, or a missing or
  whitespace-only `body`: `400 INVALID_COMMAND`.
- Unknown comment: `404 COMMENT_NOT_FOUND`. Archived task or read-only project:
  `409 COMMENT_NOT_WRITABLE`; Done items accept edits.

### `DELETE /api/comments/:commentId`

Headers `Idempotency-Key` and `If-Match: <revision>`. `200` with the
acknowledgement (`result_revision: null`). The file and its index entry are
removed, permanently within the app: there is no trash or version history.
Retrying a completed delete returns the same acknowledgement and never brings
the comment back.

Errors as for `PUT`, without `COMMENT_NOT_PRESERVABLE` and the body checks.

### `GET /api/documents/:taskId/comments?cursor=|after=|around=&limit=`

A page of the task's comments, ordered by `created_at` then id, oldest first
within the page:

```json
{
  "comments": [/* as GET /api/comments/:commentId */],
  "next_cursor": "…",
  "newer_cursor": null,
  "older_count": 70,
  "newer_count": 0,
  "total": 120
}
```

- Without a position: the newest page.
- `cursor`: the next older page. `next_cursor` is `null` on the page holding
  the oldest comment.
- `after`: the next newer page. `newer_cursor` is `null` on the page holding
  the newest comment (always on the default newest page).
- `around=<commentId>`: that comment with up to `limit` neighbours either side
  (default 2), for landing on a comment beyond the newest page. Its
  `next_cursor` and `newer_cursor` page outwards from there. A comment that is
  deleted or belongs to another task is `404 COMMENT_NOT_FOUND`.
- `older_count` and `newer_count` count the comments before and after the
  page; `total` counts all the task's comments.
- `limit` defaults to 50; 1–200 accepted. Anything else, more than one of
  `cursor`, `after` and `around`, a cursor this server did not issue or an
  `around` that is not a UUID is `400 INVALID_COMMAND`.
- Unknown task: `404 PARENT_NOT_FOUND`.

Lists come from the comment index, which Reload and Reindex rebuild from the
files (see [Operations](api/operations.md#admin)).

## Recovery

A crash or storage failure can leave a write pending. Its operation row,
payload and guards stay in SQLite until the operation is finished or, for
a comment operation, abandoned. While it is pending:

- A pending comment operation blocks its parent task and all of the task's
  comments, including archiving, filing and deletion of the task, with
  `409 RECOVERY_REQUIRED` (`details: { operationId, inspect }`). Reads,
  recovery actions and other tasks are not blocked. Unresolved conflicts
  restrict only the resources involved, not the whole app.
- Retrying the original request with the same `Idempotency-Key` answers
  `RECOVERY_REQUIRED` until recovery finishes the operation. After that it
  returns the original acknowledgement. After an abandon it returns
  `409 OPERATION_ABANDONED`.
- A pending task deletion or transfer reserves the task's ID and paths:
  creating or capturing a document with that ID, or one whose file would
  land on a guarded path, returns `409 RECOVERY_REQUIRED`. A path guard
  covers the path itself, anything under it, and the folders above it.
  Imports and folder changes check the same guards.
- While anything is pending in a project, project deletion and `readOnly`
  or `metadataMode` changes are refused. A pending project deletion blocks
  every write into or out of the project, every setting, and reuse of the
  project ID.
- Reload and Reindex never apply a payload or drop a pending row.

On startup, before serving requests, the server tries to finish every pending
operation from what it knows:

- If the files are still in the state they had before the operation, it
  writes the intended bytes again.
- If they are already in the state the operation leaves, it finishes only
  the bookkeeping.
- Anything else keeps the files and the payload and is reported here.

A missing parent, a changed owner or an ambiguous path stops recovery. A
missing file is expected before a create and after a delete. During an edit,
a missing file is a conflict, and the file is never recreated.

### `GET /api/recovery`

Summaries of the pending operations, oldest first. They never include
content:

```json
{
  "operations": [
    {
      "operation_id": "<uuid>",
      "command": "comment.edit",
      "state": "pending",
      "created_at": "…",
      "kind": "content_conflict",
      "reason": "content_changed",
      "message": "The comment file was changed outside this operation.",
      "project_id": "work",
      "task_id": "<task uuid>",
      "comment_id": "<comment uuid>",
      "in_progress": false
    }
  ]
}
```

- `kind` is one of:
  - `resumable`: the files are in a known state, and Recheck finishes the
    operation.
  - `content_conflict`: a file holds content the operation did not expect.
  - `structural`: something must be repaired by hand first. See
    [Backup and Restore](operations/backup-restore.md#manual-structural-repair).
- `reason` is one of `interrupted`, `content_changed`, `file_missing`,
  `parent_missing`, `owner_changed`, `ambiguous_path` or `unsupported`. An
  operation this version cannot inspect reports `unsupported`.
- `in_progress` is true while a request for the operation is running in
  the server.

### `GET /api/recovery/:operationId`

The summary plus:

- `paths`: each file as
  `{ path, before_revision, after_revision, observed_revision }`. These are
  the known states before and after the operation and the file as it is now.
  Paths are relative to `<dataDir>/projects/`, and a `null` revision means
  the file is absent.
- `actions`: `["recheck", "abandon"]` for comment operations,
  `["recheck"]` for everything else.
- `review_token`: changes whenever the reviewed state changes.
- `pending_content`: the exact Markdown the operation meant to write. It is
  `null` for a delete.
- `current_content`: the file as it is now, or `null` when it is absent.

An unknown operation, or one that is no longer pending, gets
`404 RECOVERY_NOT_FOUND`.

### `POST /api/recovery/:operationId/recheck`

Resumes the original operation from where its files stand now. It never
starts a new operation.

```json
{ "operation_id": "<uuid>", "state": "completed", "acknowledgement": { /* the original ack */ }, "recovery": null }
```

While the operation is still pending, `state` is `"pending"` and `recovery`
holds the detail described above. Unknown operation:
`404 RECOVERY_NOT_FOUND`.

### `POST /api/recovery/:operationId/abandon`

Comment operations only. The request needs its own `Idempotency-Key` and the
review token from the detail you reviewed:

```json
{ "review_token": "<from GET /api/recovery/:operationId>" }
```

One transaction records the abandon acknowledgement, marks the original
operation `abandoned` and removes its payload and guards. The Markdown files
are left exactly as they are.

```json
{ "operation_id": "<abandon key>", "command": "recovery.abandon", "target_operation_id": "<uuid>", "outcome": "abandoned" }
```

- Missing or invalid key, or a missing review token:
  `400 INVALID_COMMAND`.
- The reviewed state has changed: `409 REVISION_CONFLICT` with
  `details.reviewToken`. Review the operation again before abandoning it.
- A non-comment or completed operation:
  `409 RECOVERY_ACTION_NOT_ALLOWED`.
- An operation that was already abandoned: `409 OPERATION_ABANDONED`.
- Retrying with the same key returns the same acknowledgement.

## Capture

### `POST /api/capture`

Creates a draft To do backlog item from a title alone.

```json
{ "id": "<client-generated lowercase uuid v4>", "title": "1–200 chars", "project_id": "optional" }
```

- Omitted `project_id` → the designated Inbox (`500 INBOX_UNAVAILABLE` if it
  could not be created at start).
- `201` with the document when created. Resending the same id and title
  returns `200` with the item as it is now, wherever it lives. The same id with
  a different title or type returns `409 CAPTURE_ID_CONFLICT`.
- Clients generate a new id per capture and reuse it only on Retry.
- Unknown project: `404 PROJECT_NOT_FOUND`; read-only or sidecar project:
  `409 PROJECT_NOT_WRITABLE`.
- An id or file path reserved by an unfinished operation, or a project with a
  pending deletion: `409 RECOVERY_REQUIRED`.

## Current work

### `GET /api/current-work`

Backlog items whose task state is `in_progress`, across native projects.

```json
{
  "groups": [
    {
      "project": { "id": "inbox", "name": "Inbox", "readOnly": false, "isInbox": true },
      "items": [ /* board cards, as in GET /api/projects/:projectId/board */ ]
    }
  ]
}
```

- Follows the board's rules: drafts included, archived items and sidecar-mode
  projects excluded. Read-only projects are included and marked.
- Groups: Inbox first, then by project name; projects with nothing In progress
  are omitted. Items are ordered by `created_at`, then id.
- Change a task state with `PUT /api/documents/:id` and `If-Match`, as the board does.

## Board

### `GET /api/projects/:projectId/board`

Returns the project board: every non-archived `backlog_item` (drafts included), grouped by task state.

```json
{
  "columns": {
    "todo": [
      {
        "id": "…",
        "title": "Write the spec",
        "tags": ["docs"],
        "status": "draft",
        "readOnly": false,
        "revision": "…",
        "task_state": null,
        "created_at": "2026-10-18T08:00:00.000Z"
      }
    ],
    "in_progress": [],
    "done": []
  }
}
```

- `task_state` is the frontmatter value, verbatim (`null` when absent). Recognised values are exactly `todo`, `in_progress` and `done`. Absent or unrecognised values (e.g. `Doing`) place the card in `todo` and are kept as written until the card is moved.
- Each column is ordered by `created_at` ascending, then by document ID. No order is persisted.
- `readOnly` is `true` when the project is read-only (or the document is a derived, read-only document).
- Sidecar-mode projects return empty columns; the first board covers frontmatter-mode projects only.
- Returns `404 PROJECT_NOT_FOUND` for an unknown project.

## Search

### `GET /api/search?q=<query>`

`q` is required (1–500 characters). Missing or invalid parameters return
`400 VALIDATION_FAILED`.

Optional query:

- `projectId` — restrict results to one project.
- `limit` — integer 1–200 (default 50).

Returns one hit per document, ranked by its strongest matching record. A
record is the document itself (title, tags and body) or one comment on a
backlog item; every query term (prefix-matched) must occur within the same
record. Grouping happens before `limit`, so many matching comments on one task
take one slot. Archived documents are included (`status: "archived"`);
comments of deleted tasks, invalid or orphaned comment files and recovery
payloads never appear.

```json
[
  {
    "id": "5f8c5b7b-7d9e-4b4d-a017-d3ab3e1d9d31",
    "project_id": "home-system",
    "title": "Investigate the flaky test",
    "type": "backlog_item",
    "status": "active",
    "task_state": "in_progress",
    "match": {
      "kind": "comment",
      "comment_id": "0b5e1c2a-3f4d-4e6a-9b7c-8d9e0f1a2b3c",
      "created_at": "2026-10-19T16:00:00.000Z"
    },
    "snippet": "Found it: the fixture leaks a socket…",
    "highlights": [[14, 21]],
    "rank": -1.23
  }
]
```

- `id` is the document; for a comment match it is the parent task.
- `match` is `{ "kind": "description" }` or `{ "kind": "comment", "comment_id", "created_at" }`.
- `snippet` is plain text; `highlights` are `[start, end)` offsets of the matched terms in it.
- `task_state` is the frontmatter value verbatim, `null` when absent.

## Tags

### `GET /api/tags`

Returns all tag counts.

Optional query:

```text
?projectId=home-system
```

## Templates

### `GET /api/templates`

Returns template summaries.

### `GET /api/templates/:id`

Returns a template with body.

## Operations endpoints

Import, folder management, the knowledge graph, and admin endpoints (reload,
reindex, reload-templates) are documented separately in
[API Reference — Operations](api/operations.md).
