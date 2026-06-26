---
id: b2c4e6a8-1d3f-4a5b-8c7d-9e0f1a2b3c4d
title: API Reference — Operations
project: backlogger-docs
type: note
status: active
created_at: '2026-06-26T00:00:00.000Z'
updated_at: '2026-06-26T00:00:00.000Z'
tags: []
---

# Backlogger API Reference — Operations

Import, folder management, the knowledge graph, and admin endpoints. See the
main [API Reference](../api.md) for errors, health, projects, documents,
search, tags, and templates.

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

Returns `409 PROJECT_READ_ONLY` while the project is in read-only mode.

## Folders

### `GET /api/projects/:id/folders`

Returns project folder paths.

### `POST /api/projects/:id/folders`

Body:

```json
{ "folder": "phases/p3" }
```

Returns `201`.

Returns `409 PROJECT_READ_ONLY` while the project is in read-only mode.

### `DELETE /api/projects/:id/folders/*`

Deletes an empty folder. The folder path is the URL-decoded wildcard segment.

Returns `204`.

Returns `404 FOLDER_NOT_FOUND` when the folder does not exist.

Returns `409 FOLDER_NOT_EMPTY` when files or subfolders remain.

Returns `409 PROJECT_READ_ONLY` while the project is in read-only mode.

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

### `POST /api/projects/:id/reload`

Reloads one project from disk. This is the preferred endpoint after changing or mounting files for a single project.

Plain Markdown files without Backlogger frontmatter are indexed with derived metadata. They remain protected while the project is read-only; if the project is later switched to editable, the first update adopts the file by writing Backlogger frontmatter. Files with valid Backlogger frontmatter whose `project` does not match the folder are repaired for indexing: the folder project wins, a path-derived id is used, and usable title/type/tags/timestamps are retained.

Example response:

```json
{
  "projectId": "docs-site",
  "added": 3,
  "updated": 10,
  "removed": 1,
  "skipped": [],
  "durationMs": 24,
  "removedIds": ["5f8c5b7b-7d9e-4b4d-a017-d3ab3e1d9d31"]
}
```

### `POST /api/admin/reindex`

Runs a full reindex from disk. Valid project folders found on disk but missing from SQLite are registered as read-only projects before indexing.

The response includes `scanned`, `inserted`, and `skipped` counts. `skipped` is reserved for files that cannot be assigned to a valid project folder.

```json
{
  "scanned": 12,
  "inserted": 12,
  "skipped": []
}
```

### `POST /api/admin/reload-templates`

Reloads built-in and user templates from disk.

Returns `501 NOT_CONFIGURED` if template reload paths are not configured.
