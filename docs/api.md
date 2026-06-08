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

Common codes include:

- `VALIDATION_FAILED`
- `INVALID_PROJECT_ID`
- `INVALID_DOCUMENT_ID`
- `INVALID_TAG`
- `PROJECT_NOT_FOUND`
- `DOCUMENT_NOT_FOUND`
- `DOCUMENT_VERSION_MISMATCH`
- `RELOAD_IN_PROGRESS`
- `GRAPH_UNAVAILABLE`
- `INTERNAL_ERROR`

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

### `PUT /api/projects/:id`

Body:

```json
{
  "name": "New Name",
  "description": "Optional"
}
```

Returns the updated project.

### `DELETE /api/projects/:id`

Deletes the project and attempts to remove its folder.

Returns `204`.

## Documents

### `GET /api/projects/:projectId/documents`

Returns document summaries for a project.

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

Returns `201` with the full document.

### `GET /api/documents/:id`

Returns a full document including `body`.

### `PUT /api/documents/:id`

Body can contain any of:

```json
{
  "title": "New Title",
  "status": "active",
  "tags": ["docs"],
  "body": "Updated body\n"
}
```

Header:

```text
If-Match: <updated_at value>
```

If the header does not match the current `updated_at`, the API returns `409 DOCUMENT_VERSION_MISMATCH`.

### `DELETE /api/documents/:id`

Deletes a document.

Returns `204`.

### `GET /api/documents/:id/raw`

Downloads the raw Markdown file.

Response headers include:

- `Content-Type: text/markdown; charset=utf-8`
- `Content-Disposition: attachment; ...`
- `Cache-Control: private, no-store`

### `GET /api/documents/:id/backlinks`

Returns documents that link to this document.

## Search

### `GET /api/search?q=<query>`

Optional query:

- `projectId`
- `limit`

Returns ranked search hits.

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

## Import

### `POST /api/projects/:projectId/import`

Body:

```json
{
  "placement": {
    "type": "note",
    "titleStrategy": "frontmatter",
    "onDuplicate": "skip"
  },
  "files": [
    {
      "filename": "note.md",
      "content": "---\ntitle: Note\n---\n# Note\n"
    }
  ]
}
```

Limits:

- Max 20 files per request.
- Max 1 MiB per file.

Status:

- `200` when all files import or skip without per-file errors.
- `207` when at least one file has a per-file error.

## Folders

### `GET /api/projects/:id/folders`

Returns project folder paths.

### `POST /api/projects/:id/folders`

Body:

```json
{ "folder": "phases/p3" }
```

Returns `201`.

### `DELETE /api/projects/:id/folders/*`

Deletes an empty folder.

Returns `204`.

Returns `409 FOLDER_NOT_EMPTY` when files or subfolders remain.

## Graph

### `GET /api/projects/:id/graph`

Returns:

```json
{
  "nodes": [],
  "edges": [],
  "generatedAt": "2026-06-04T10:00:00.000Z"
}
```

Returns `503 GRAPH_UNAVAILABLE` if the graph service is not configured.

## Admin

### `POST /api/admin/reindex`

Runs a full reindex from disk.

### `POST /api/admin/reload-templates`

Reloads built-in and user templates.

Returns `501 NOT_CONFIGURED` if template reload paths are not configured.
