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
  "created_at": "2026-06-04T10:00:00.000Z",
  "updated_at": "2026-06-04T10:00:00.000Z"
}
```

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

### `DELETE /api/projects/:id`

Deletes the project and attempts to remove its folder.

Returns `204`.

Returns `409 PROJECT_READ_ONLY` while read-only mode is enabled.

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
`draft`, `active`, and `archived`. `status`, `tags`, `body`, `template`, and
`folder` are all optional.

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

If the project is in read-only mode, the API returns `409 PROJECT_READ_ONLY`.

If the document was indexed from plain Markdown without Backlogger frontmatter and the project is editable, the first successful update writes Backlogger frontmatter to the same file and returns the adopted editable document.

### `DELETE /api/documents/:id`

Deletes a document.

Returns `204`.

Returns `409 PROJECT_READ_ONLY` while the project is in read-only mode.

Derived plain-Markdown documents can be deleted only when the containing project is editable. While the project is read-only, deletion returns `409 PROJECT_READ_ONLY`.

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

### `GET /api/documents/:id/raw`

Downloads the raw Markdown file.

Response headers include:

- `Content-Type: text/markdown; charset=utf-8`
- `Content-Disposition: attachment; ...`
- `Cache-Control: private, no-store`

### `GET /api/documents/:id/backlinks`

Returns documents that link to this document.

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

Returns ranked search hits:

```json
[
  {
    "id": "5f8c5b7b-7d9e-4b4d-a017-d3ab3e1d9d31",
    "project_id": "home-system",
    "title": "Design Notes",
    "type": "design_doc",
    "snippet": "matched <b>text</b> ...",
    "rank": -1.23
  }
]
```

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
