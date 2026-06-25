---
id: bd9b2fa8-3946-4280-9f95-7ec08909cd37
title: Current Roadmap
project: backlogger-docs
type: design_doc
status: active
created_at: "2026-05-30T06:50:27.881Z"
updated_at: "2026-06-09T00:00:00.000Z"
tags: ["design", "roadmap"]
---

# Current Roadmap

Date: 2026-06-09

## Purpose

This is the active roadmap for Backlogger. It replaces the old Phase 1
implementation plan that previously lived at this path.

Backlogger is currently a self-hosted Markdown workspace backed by real files
on disk and derived SQLite indexes. The near-term roadmap should stay focused
on reliability, maintainability, and the mounted-docs workflow rather than new
product scope.

Current reference docs:

- [Architecture](architecture.md)
- [Derived data contract](derived-data.md)
- [Data storage and project mounts](../operations/data-storage.md)
- [API reference](../api.md)

## Current Product Shape

Backlogger currently supports:

- Project-based Markdown storage under `data/projects/<project-id>/`.
- SQLite metadata, search, tag, link, and graph indexes.
- Project reload and full reindex from disk.
- Plain Markdown indexing with derived metadata.
- Auto-discovery of mounted project folders.
- Project-level read-only mode with an explicit editable toggle.
- Markdown editing, preview, templates, tags, wiki links, backlinks, graph, and import/export.

## Active Priorities

### 1. Mounted Docs Reliability

Status: in progress.

Goal: users can mount another project's docs folder into Backlogger and browse
the docs without a migration step or accidental writes.

Already done:

- Project folders under `data/projects/` are auto-discovered on startup.
- Project-root symlinks are accepted.
- Plain Markdown files without Backlogger frontmatter are indexed with derived metadata.
- Auto-discovered projects start in read-only mode.
- First edit after explicitly unlocking a project adopts a plain Markdown file by writing Backlogger frontmatter.
- Manual reload and full reindex repair missing/mismatched metadata where possible and surface skipped files only when a file cannot be assigned to a valid project.

Next useful work:

- Consider surfacing startup-discovery skipped-file results in the UI if invalid project folders or skipped symlinks become common in mounted-project testing.
- Consider making first-edit adoption more explicit in the UI copy before saving.
- Keep `docs/operations/data-storage.md` as the canonical storage and mount guide.

### 2. Maintainability Cleanup

Status: in progress.

Goal: keep the assignment implementation easy to review and modify without
adding broad frameworks.

Already done:

- Removed stale report files under `docs/reports/`.
- Added `docs/README.md` as the current documentation index.
- Added top-level analysis docs for cleanup review.
- Centralized document/project cache invalidation helpers in
  `packages/web/src/lib/query-keys.ts`.
- Extracted ProjectTree grouping into a focused helper with tests.
- Split the monolithic `app.css` into per-surface stylesheets.
- Split the project API into focused routers (`project-folders`,
  `project-graph`, `project-reload`, `project-titles`).
- Extracted editor-buffer and shell-overlay state into the `useDocumentBuffer`
  and `useShellOverlays` hooks.
- Removed duplicated docs template body from `docs/docs-template.md`.
- Labeled the original design overview as historical context.

Next useful work:

- Mark temporary analysis docs complete or archive them after the cleanup pass.
- Keep historical plans clearly archived or labeled as docs evolve.
- Split large tests only when touching the relevant feature area.

### 3. Documentation Hygiene

Status: in progress.

Goal: make current behavior easy to find and stale plans hard to mistake for
current requirements.

Current direction:

- `docs/operations/data-storage.md` is the canonical guide for storage paths,
  project mounts, plain Markdown indexing, and read-only behavior.
- `docs/README.md` is the current index for active docs, temporary cleanup
  artifacts, and archived material.
- `docs/api.md` documents the API contract and error codes.
- `docs/design/architecture.md` documents current system shape.
- `docs/design/derived-data.md` documents cache and index refresh contracts.

Next useful work:

- Update README snippets when storage/mount behavior changes.
- Keep archived docs under `docs/archived/`.
- Avoid creating new report folders for temporary review artifacts.

## Explicit Non-Priorities

These are intentionally out of scope for the current cleanup:

- Plugin/provider systems for mounted docs.
- Remote sync engines.
- Multi-user authentication or RBAC.
- A new frontend state library.
- A design-system package or CSS framework.
- A generic metadata engine for every Markdown convention.

## Decision Rule

When choosing the next task, prefer the smallest change that makes mounted docs
safer, current behavior clearer, or the code easier to maintain. Defer features
that add broad architecture before the local filesystem workflow is fully solid.
