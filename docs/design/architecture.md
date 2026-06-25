---
id: ea0dafc9-63d7-443e-8025-a8e72ff2fd3f
title: Architecture
project: backlogger-docs
type: design_doc
status: active
created_at: '2026-06-04T00:00:00.000Z'
updated_at: '2026-06-04T00:00:00.000Z'
tags: []
---

# Backlogger Architecture

Date: 2026-06-04

## Purpose

Backlogger is a single-user, self-hosted Markdown workspace. It stores real Markdown files on disk and uses SQLite for metadata, search, links, tags, and other derived data.

The design goal is a simple documentation workspace, not a project execution platform.

## System Shape

```text
React + Vite web app
  -> Express API
    -> Services
      -> SQLite repositories
      -> Filesystem repository
```

Packages:

- `packages/shared`: zod schemas, shared types, Markdown rendering, wiki-link parsing.
- `packages/api`: Express app, services, SQLite repositories, filesystem repository, health probes.
- `packages/web`: React UI, React Query data hooks, CodeMirror editor, document preview, graph overlay.

Runtime data:

- `data/projects/<project-id>/`: Markdown files. This is the source of truth for document content.
- `data/backlogger.sqlite`: metadata and derived indexes.
- `data/templates/`: user-defined Markdown templates.

## Source Of Truth

Markdown files under `data/projects/` are the durable source of truth for documents.

SQLite is a query and index layer. It can be rebuilt from disk with reindexing.

Document frontmatter carries:

- stable document id
- title
- project id
- document type
- status
- timestamps
- tags

The document body stays in the Markdown file. SQLite stores enough body/index data to support search and derived features.

## Backend Layers

### Express App

`packages/api/src/app.ts` wires routes and global middleware:

- CORS
- JSON body limit
- health endpoints
- API routers
- structured error middleware

All API errors should use:

```json
{ "error": { "code": "CODE", "message": "Message", "details": {} } }
```

Route utilities in `packages/api/src/routes/util.ts`:

- `asyncRoute(handler)` — wraps async handlers and forwards rejected promises to `next(err)`, eliminating manual `try/catch` in every route.
- `validateBody(schema, body)` — parses a Zod schema and throws `BadRequestError('VALIDATION_FAILED')` on failure.

### Services

Services own domain behavior:

- `ProjectService`: project metadata and project folder lifecycle.
- `DocumentService`: create, read, update, delete, archive/unarchive, raw export.
- `ImportService`: import Markdown payloads through document service paths.
- `ReindexService`: rebuild document metadata and derived indexes from disk.
- `SearchService`: FTS query execution.
- `LinkService`: wiki-link and backlink indexes.
- `TagsService`: tag counts and tag filters.
- `GraphService`: graph payload and in-memory cache.
- `HealthService`: subsystem health snapshot.

Document writes should go through `DocumentService` so filesystem, SQLite, links, tags, search, and graph invalidation stay aligned.

### Repositories

Repositories are the only modules that should talk directly to persistence:

- `FsRepository`: safe Markdown file operations.
- `ProjectsRepo`: `projects` table.
- `DocumentsRepo`: `documents` table reads/writes, including the `body_indexed`
  column. The `documents_fts` full-text index is maintained by SQL triggers
  (`documents_ai` / `documents_ad` / `documents_au`) defined in
  `migrations/0003_search.sql`, not by application code.

`PathResolver` validates project ids, filenames, folder paths, project-relative paths, path containment, and symlink policy.

## Frontend Shape

`App.tsx` is a thin shell (~220 lines) that composes hooks and renders the
topbar, sidebar, workspace, and overlays. State that previously lived in
`App.tsx` has been extracted into hooks under `packages/web/src/hooks`:

- `useWorkspaceSelection` — selected project, document, and tags.
- `useShellOverlays` — command palette, settings, import, graph, and help
  overlay state, including help deep-links.
- `useDocumentBuffer` — local editor buffer, debounced autosave, and optimistic
  -lock (`If-Match`) conflict handling.
- `useGlobalShortcuts` — global keyboard shortcuts.
- `useWikiLinkNavigation` — wiki-link click navigation.
- `useReloadToast` — reload/reindex result toasts.

Server state uses React Query. Query functions live under
`packages/web/src/lib`; query keys and cache invalidation helpers are
centralized in `packages/web/src/lib/query-keys.ts`.

Main feature components:

- `ProjectSwitcher`
- `ProjectTree`
- `TagExplorer`
- `DocumentWorkspace`
- `DocumentEditor`
- `DocumentPreview`
- `MetadataPanel`
- `CommandPalette`
- `ImportDialog`
- `SettingsDialog`
- `HelpDrawer`
- `KnowledgeGraph`

Supporting components include `NewDocumentDialog`, `Modal`, `SegmentedControl`,
`FolderField`, `FolderTreeGroup`, `TagChip`, `TagInput`, `StatusMessage`,
`TopbarAction`, `ReindexResultSummary`, `Icon`, and `ErrorBoundary`.

## Read-Only Mode

Projects and documents can be read-only. Both `projects` and `documents` carry a
`read_only` column (migrations `0006_document_readonly.sql` and
`0007_project_readonly.sql`), surfaced as a `readOnly` boolean on API responses
(default `false`).

- Auto-discovered project folders, and documents indexed from plain or
  mismatched Markdown, are stamped read-only during indexing, so mounted docs
  are safe to browse without accidental writes.
- `DocumentService`, `ProjectService`, and `ImportService` call
  `assertProjectWritable` and reject writes to a read-only project with
  `409 PROJECT_READ_ONLY`. The folder routes (`routes/project-folders.ts`)
  enforce the same rule for folder create/delete.
- A document indexed from plain Markdown (no Backlogger frontmatter) is guarded
  by `DERIVED_DOCUMENT_READ_ONLY`; the first edit after the project is made
  editable adopts the file by writing Backlogger frontmatter to the same path.
- A project is unlocked for editing with `PUT /api/projects/:id` and
  `{ "readOnly": false }`.

## Deployment Model

Backlogger is intended for a trusted single-user environment. In development, Vite serves the web app and proxies API calls. In Docker/production, the Express API serves the built web app.

Default bind/CORS behavior is LAN-friendly:

- API host defaults to `0.0.0.0`.
- CORS defaults to `*`.

Lock this down for less trusted networks.

## Current Non-Goals

- Authentication and RBAC.
- Multi-user collaboration.
- Real-time editing.
- Git integration.
- Plugin system.
- Kanban or project execution workflows.
- AI workflow automation.

These are deliberate scope boundaries. New work should justify crossing them explicitly.

## Known Architecture Risks

- Some backend services remain optional in constructors/routes even though the
  production context wires them.
- Markdown rendering relies on trusted Markdown content (raw HTML is disabled in
  the renderer, but there is no separate sanitizer pass).
- Read-only enforcement lives in the service layer (and is duplicated in the
  folder routes); a write path added outside `DocumentService` could bypass it.

Previously listed risks now addressed by the latest refactor:

- `App.tsx` is no longer a large stateful coordinator — selection, overlay, and
  editor-buffer state moved into dedicated hooks (`App.tsx` is ~220 lines).
- React Query keys and invalidation are centralized in
  `packages/web/src/lib/query-keys.ts`.
- The monolithic `app.css` was split into per-surface stylesheets under
  `packages/web/src/styles/`; `app.css` now holds residual app-shell rules.
