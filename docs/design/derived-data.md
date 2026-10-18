---
id: b52dc415-e6d7-4534-82d0-65027aec5da9
title: Derived Data
project: backlogger-docs
type: design_doc
status: active
created_at: '2026-06-04T00:00:00.000Z'
updated_at: '2026-06-08T00:00:00.000Z'
tags: []
---

# Derived Data Contract

Date: 2026-06-04

## Purpose

Backlogger treats Markdown files as the source of truth and SQLite as a derived query layer. This document defines what must be refreshed when documents change.

## Source Data

Source data lives under:

```text
data/projects/<project-id>/**/*.md
```

Backlogger-authored Markdown files contain frontmatter plus body content. Plain
Markdown files without Backlogger frontmatter can also be indexed with derived
metadata from path, heading, and file stats. In a sidecar-mode project, metadata
comes from `<project>/.backlogger/index.json` instead of file frontmatter (see
[Sidecar Metadata](sidecar-metadata.md)); SQLite stays rebuildable from `.md`
content plus the sidecar.

## Derived Data

SQLite and memory-derived data include:

- `projects`: project registry.
- `documents`: document metadata plus indexed body data, including the
  `read_only` flag derived during indexing, the `revision` fingerprint of the
  persisted content (the `If-Match` token), and the frontmatter `task_state`
  verbatim (the board reads it; `NULL` when absent).
- `documents_fts`: full-text search index maintained from document rows by SQL
  triggers (see `migrations/0003_search.sql`).
- `links`: outgoing wiki links and resolved targets.
- `tags` / `document_tags`: normalized tag rows and per-document tag membership.
- `GraphService` cache: per-project graph payload.
- React Query caches in the web client.

## Mutation Paths

### Create Document

Path:

```text
DocumentService.create
```

Required updates:

- Write Markdown file.
- Upsert `documents`.
- Rebuild links for the new document.
- Rebuild tags for the new document.
- Invalidate graph cache for the project.
- Invalidate frontend document/tag/title/backlink caches.

### Update Document

Path:

```text
DocumentService.update
```

Required updates:

- Inside the project mutation queue, compare `If-Match` (when provided) with the revision of the file on disk; 409 on mismatch.
- Write the updated Markdown file.
- Move file if archive status changes.
- Upsert `documents`.
- Rebuild outgoing links.
- Refresh rows that point to old/new titles.
- Rebuild tags.
- Invalidate graph cache for the project.
- Update the frontend document cache and invalidate derived lists.

### Delete Document

Path:

```text
DocumentService.delete
```

Required updates:

- Delete the document row.
- Remove outgoing/incoming link state for the document.
- Invalidate graph cache.
- Delete the Markdown file best-effort.
- Remove the frontend document cache and invalidate lists.

### Import Markdown

Path:

```text
ImportService.importFiles
```

Rules:

- Imports delegate creation/replacement to `DocumentService`.
- Duplicate detection only uses frontmatter `id`.
- File names are used for title derivation and error reporting, not as direct disk paths.

### Reload Project

Path:

```text
ReindexService.runProject
```

Required updates:

- Walk one project folder on disk.
- Upsert present Backlogger Markdown files and plain Markdown files with
  derived metadata.
- Rebuild links and tags for each present file.
- Delete database rows whose backing files disappeared.
- Remove deleted document link state.
- Invalidate graph cache for the project.
- Return removed ids so the frontend can clear stale document buffers.

Graph cache contract:

- `ReindexService` holds a `GraphService` reference and calls `invalidate(projectId)`
  after the project is re-scanned, so a reload that adds/removes files is reflected
  immediately instead of waiting for the in-memory graph cache TTL to expire.

### Full Reindex

Path:

```text
ReindexService.run
```

Required updates:

- Truncate document metadata.
- Truncate link and tag indexes.
- Walk all projects.
- Reinsert Backlogger Markdown files and plain Markdown files with derived
  metadata.
- Rebuild links and tags.
- Invalidate the entire graph cache.

Graph cache contract:

- Full reindex calls `GraphService.invalidate()` with no argument, clearing every
  cached project graph since all derived data was rebuilt.

## Frontend Cache Rules

Central caches currently include:

- `['projects']`
- `['documents', projectId]`
- `['document', documentId]`
- `['tags', projectId]`
- `['titles', projectId]`
- `['backlinks', documentId]`
- `['graph', projectId]`
- `['folders', projectId]`
- `['board', projectId]` (backlog items by task state; invalidated with the
  document-derived caches and with the project list, since cards carry the
  project's read-only flag)

When document body/frontmatter changes, invalidate or update:

- document row cache
- document list
- tags
- titles
- backlinks
- graph

Query keys and invalidation are centralized in
`packages/web/src/lib/query-keys.ts`. The `queryKeys` factory defines the keys
above, and helpers — `invalidateDocumentDerived`, `invalidateProjectList`,
`invalidateProjectFolders`, `invalidateProjectStructure`, `setDocumentCache`,
`removeDocumentCache`, `invalidateProjectReload`, `invalidateGlobalReindex`, and
`clearDocumentBuffers` — keep mutation paths from missing invalidations. New
mutations should reuse these helpers instead of hand-writing query keys.

## Recovery Model

If SQLite and disk drift:

1. Use project reload for one project.
2. Use full reindex for all projects.
3. If restoring from backup, restore file