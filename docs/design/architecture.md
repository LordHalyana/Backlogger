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
- `DocumentsRepo`: `documents` table and FTS maintenance.

`PathResolver` validates project ids, filenames, folder paths, project-relative paths, path containment, and symlink policy.

## Frontend Shape

`App.tsx` is currently the top-level coordinator for:

- selected project
- selected document
- selected tags
- dialogs and overlays
- health polling
- reload behavior
- wiki-link navigation
- global shortcuts

Server state uses React Query through hooks under `packages/web/src/lib`.

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

- `App.tsx` is still a large coordinator.
- React Query invalidation rules are scattered.
- Some backend services remain optional in constructors/routes even though production context wires them.
- Markdown rendering relies on trusted Markdown content.
- `app.css` is large and mixed-responsibility.

See `docs/reports/*.md` for detailed analysis and cleanup priorities.
