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

It is evolving into a local productivity workspace: projects, Kanban tickets, progress notes, documentation and personal planning, with Markdown as the durable record. See [Product direction](product-direction.md) for the target and [Current roadmap](roadmap.md) for progress. This document describes the system as it is now.

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

Projects store Backlogger metadata in one of two modes (`metadataMode`): inside
each file's frontmatter (default), or in a per-project sidecar
(`<project>/.backlogger/index.json`) that keeps mounted source files
frontmatter-free. See [Sidecar Metadata](sidecar-metadata.md).

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
- `BoardService`: the project board (non-archived backlog items by task state, in creation order).
- `WriteCoordinator`: the one commit seam for workspace writes (spec #58). Every document mutation, filing, project create/settings/delete, folder change and project Reload runs through `command()`: the workspace gate (shared), then the project queues in ascending ID order, all taken up front and never re-entered, then the durable guard check (`409 RECOVERY_REQUIRED`), then the command's own preconditions, file writes and one synchronous SQLite transaction, and finally graph-cache invalidation. Retry-safe commands add receipt lookup and claim keyed by the operation ID (`operations` primary key plus re-lookup; no in-memory locks). A full Reindex and the startup pass hold the gate exclusively (`exclusive()`).
- `WorkspaceGate` / `ProjectQueue`: the coordinator's two in-process lock layers. They assume a single server process per data dir.

Document writes should go through `DocumentService` so filesystem, SQLite, links, tags, search, and graph invalidation stay aligned.

### Repositories

Repositories are the only modules that should talk directly to persistence:

- `FsRepository`: safe Markdown file operations.
- `ProjectsRepo`: `projects` table.
- `OperationsRepo`: the protected operational tables (`operations`, `operation_payloads`, `operation_manifest_entries`, `operation_guards`). Only `WriteCoordinator` uses it, and the coordinator owns every SQLite transaction a command commits.
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
- `TaskBoard`

Supporting components include `NewDocumentDialog`, `Modal`, `SegmentedControl`,
`FolderField`, `FolderTreeGroup`, `TagChip`, `TagInput`, `StatusMessage`,
`TopbarAction`, `ReindexResultSum