# Derived Data Contract

Date: 2026-06-04

## Purpose

Backlogger treats Markdown files as the source of truth and SQLite as a derived query layer. This document defines what must be refreshed when documents change.

## Source Data

Source data lives under:

```text
data/projects/<project-id>/**/*.md
```

Each Markdown file contains frontmatter plus body content.

## Derived Data

SQLite and memory-derived data include:

- `projects`: project registry.
- `documents`: document metadata plus indexed body data.
- `documents_fts`: full-text search index maintained from document rows.
- `document_links`: outgoing wiki links and resolved targets.
- `document_tags`: normalized tag rows/counts.
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

- Enforce optimistic locking when `If-Match` is provided.
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
- Upsert present valid Markdown files.
- Rebuild links and tags for each present file.
- Delete database rows whose backing files disappeared.
- Remove deleted document link state.
- Return removed ids so the frontend can clear stale document buffers.

Current gap:

- Graph cache invalidation is not directly wired in `ReindexService`. Project reload callers should ensure graph data is refreshed or `ReindexService` should receive `GraphService`.

### Full Reindex

Path:

```text
ReindexService.run
```

Required updates:

- Truncate document metadata.
- Truncate link and tag indexes.
- Walk all projects.
- Reinsert valid documents.
- Rebuild links and tags.

Current gap:

- Full reindex should also invalidate graph cache if graph caching is active.

## Frontend Cache Rules

Central caches currently include:

- `['projects']`
- `['documents', projectId]`
- `['document', documentId]`
- `['tags', projectId]`
- `['titles', projectId]`
- `['backlinks', documentId]`
- `['graph', projectId]`

When document body/frontmatter changes, invalidate or update:

- document row cache
- document list
- tags
- titles
- backlinks
- graph

Current gap:

Cache keys and invalidation are scattered across `packages/web/src/lib/*`, hooks, and `App.tsx`. A small query-key helper would reduce missed invalidations.

## Recovery Model

If SQLite and disk drift:

1. Use project reload for one project.
2. Use full reindex for all projects.
3. If restoring from backup, restore files first, then run migration/reindex with the app stopped or before serving traffic.

## Test Expectations

Coverage should exist for:

- create/update/delete refreshing links and tags.
- archive/unarchive path movement and status consistency.
- import skip/copy/replace behavior.
- project reload adding, updating, and removing rows.
- graph freshness after document change and reload.
- React Query cache behavior for removed open documents.
