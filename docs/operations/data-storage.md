---
id: 28d368e7-aca0-4796-8552-33fc061921e8
title: Data Storage And Project Mounts
project: backlogger-docs
type: note
status: active
created_at: '2026-06-08T00:00:00.000Z'
updated_at: '2026-06-09T00:00:00.000Z'
tags: ['operations', 'storage']
---

# Data Storage And Project Mounts

Date: 2026-06-09

## Purpose

Backlogger is designed to work with real Markdown files on disk. The practical goal is that a user can mount a `docs/` folder from another project into Backlogger, let Backlogger index it, and browse those docs without copying them into an app-specific format.

This document describes the current storage contract, how mounted folders work today, and what should improve to make external project documentation a smoother first-class workflow.

## Storage Roots

All runtime state lives under `BACKLOGGER_DATA_DIR`.

Default local value:

```text
./data
```

Docker default:

```text
/app/data
```

Directory layout:

```text
<BACKLOGGER_DATA_DIR>/
  backlogger.sqlite
  projects/
    <project-id>/
      <folders-and-markdown-files>
      tickets/<task-id>/comments/<comment-id>.md
  templates/
    <user-template>.md
```

The `projects/` directory is the important boundary. Every Backlogger project maps to exactly one folder directly under `projects/`.

## Source Of Truth

Markdown files are the source of truth for document content.

SQLite holds project rows (display name, read-only flag, metadata mode), which
are not stored in Markdown, and derived state used for:

- document metadata
- the comment index (comment files are indexed separately from documents)
- full-text search
- wiki-link and backlink indexes
- tag indexes
- graph data inputs

If SQLite is stale, Backlogger can rebuild document metadata and indexes from Markdown files with reindexing. If it is missing, rediscovered projects come back read-only under folder-derived names. The Markdown files matter more than the database for durability.

SQLite also holds **operational state** that is not derived from Markdown and cannot be rebuilt from it: the `operations` table (pending operations and completed retry receipts), `operation_payloads`, `operation_manifest_entries` and `operation_guards`. Reload and Reindex never touch these tables, and deleting a document never cascades into them. Losing the database loses retry history and any pending recovery state. Never edit these tables by hand. See [Rebuilding The Index Versus Losing The Database](backup-restore.md#rebuilding-the-index-versus-losing-the-database).

The database runs in WAL mode with `synchronous=FULL`, and Backlogger fsyncs the directory after every file rename, delete and directory creation.

## Project Folder Rules

A project folder must live at:

```text
<BACKLOGGER_DATA_DIR>/projects/<project-id>
```

The `<project-id>` must match:

```text
^[a-z0-9][a-z0-9-]{1,62}$
```

Examples:

```text
good: docs-site
good: billing-api
bad: Docs Site
bad: my_project
bad: a
```

Backlogger stores document paths relative to the `projects/` root. For example:

```text
data/projects/billing-api/reference/auth.md
```

is stored as:

```text
billing-api/reference/auth.md
```

The first path segment identifies the Backlogger project.

## Mounting An External Docs Folder

The recommended Docker pattern is to mount the external docs folder as a Backlogger project:

```bash
docker run -d \
  -p 3002:3002 \
  -v backlogger-data:/app/data \
  -v /path/to/other-repo/docs:/app/data/projects/other-repo-docs \
  backlogger
```

The host path can be any documentation folder. The container path must be:

```text
/app/data/projects/<project-id>
```

On startup, Backlogger scans `projects/`. If it finds a directory or project-root symlink whose name is a valid project id and that project is missing from SQLite, it creates the project row and runs a project reload for that folder.

Existing projects are also synced on startup, so files added while Backlogger was stopped are picked up after restart.

## Local Symlink Pattern

For local development, a project can also be a symlink:

```text
data/projects/backlogger-docs -> ../../docs
```

Backlogger intentionally allows a symlink at the project root. This supports mounting or linking an entire external docs folder as one project.

Symlinks inside a mounted project are not allowed for document read/write paths. Nested symlinks are rejected or skipped to avoid path traversal and accidental indexing outside the intended project tree.

## Indexing Behavior

Backlogger indexes Markdown files under:

```text
<BACKLOGGER_DATA_DIR>/projects/<project-id>/**/*.md
```

Indexing happens through:

- startup project discovery
- startup sync for known projects
- the project file watcher while the server is running
- the topbar project reload action
- `POST /api/projects/:id/reload`
- `POST /api/admin/reindex`
- `npm run reindex` (CLI full reindex)

Project reload updates one project. Full reindex rebuilds all document metadata, links, tags, and search indexes.

## Markdown File Indexing

Backlogger indexes both Backlogger-authored Markdown and plain Markdown.

Plain Markdown files without valid Backlogger frontmatter are indexed with derived metadata:

- `title` comes from the first `#` heading, falling back to the filename.
- `id` is a stable UUID derived from the project-relative path.
- `type` defaults to `note`.
- `status` is derived from the path; files under `archived/` are archived.
- timestamps come from filesystem metadata.
- tags default to an empty list.

Derived plain-Markdown documents are stored internally with derived metadata. In a read-only project they are read-only through the API. They can be listed, opened, searched, linked in the graph, and downloaded raw, but update and delete requests return `PROJECT_READ_ONLY`. This avoids rewriting mounted external docs unexpectedly.

If the project is explicitly switched to editable in Backlogger, a derived plain-Markdown document becomes adoptable. The first save writes Backlogger frontmatter to the same file, keeps the path stable, and clears the document-level read-only flag. After that, the file behaves like a normal Backlogger-owned document.

Backlogger frontmatter is still required when a file should be fully editable through Backlogger.

Minimum frontmatter shape:

```yaml
---
id: 5f8c5b7b-7d9e-4b4d-a017-d3ab3e1d9d31
title: Authentication
project: other-repo-docs
type: note
status: active
created_at: '2026-06-08T00:00:00.000Z'
updated_at: '2026-06-08T00:00:00.000Z'
tags: ['api']
---
```

Important rules:

- `project` must match the containing `<project-id>` folder.
- `id` must be stable and unique.
- `type` must be one of `idea`, `note`, `design_doc`, `implementation_plan`, `backlog_item`, or `finding`.
- `status` must be `draft`, `active`, or `archived`.
- If valid Backlogger frontmatter has a `project` value that does not match the containing project folder, the file is still indexed. The filesystem folder wins, Backlogger uses the file's usable title/type/tags/timestamps, assigns a path-derived id to avoid cross-project id collisions, and treats the row as derived metadata until first adoption.

Adding valid Backlogger frontmatter is what makes a file a normal Backlogger-owned document. Backlogger can now add that frontmatter automatically on the first save after a user explicitly switches the containing project to editable mode.

## Archive Path Rule

Archive state is encoded in both metadata and path.

An archived document lives under:

```text
<project-id>/archived/<original-path>.md
```

If the path and frontmatter disagree during reindex, the filesystem path wins:

- under `archived/` means archived
- outside `archived/` means not archived

This matters for mounted docs folders because Backlogger may move adopted editable files when a user archives or unarchives a document. Plain-Markdown files remain protected while the project is read-only; after a user unlocks the project and saves a derived document, the file is adopted and archive moves become possible.

## Current Fit For External Project Docs

What works well today:

- Mounting a whole external docs folder as one Backlogger project.
- Startup auto-discovery of valid project folders.
- Startup sync after offline changes.
- Live reload/reindex when files change while Backlogger is running.
- Rebuilding SQLite/search/link/tag state from disk.
- Displaying plain Markdown files without Backlogger frontmatter through derived metadata.
- Showing project read-only state in the document tree, workspace status, and metadata panel.
- Auto-discovered mounted projects start in project-level read-only mode.
- The project switcher exposes a read-only/editable toggle so a user can deliberately unlock a project for Backlogger writes.
- Project read-only mode blocks document creates, updates, deletes, imports, folder mutation, and project deletion while still allowing list/search/graph/reload.
- Switching a project to editable allows derived plain Markdown to be adopted on first save by writing Backlogger frontmatter into the file.
- Showing skipped-file details after project reload or full reindex.

Current limitations:

- Project ids are derived from the mount folder name, not from a config file.
- Project-root symlinks are supported, but nested symlinks are not.
- Backlogger edits in an editable project can adopt plain Markdown by writing valid Backlogger frontmatter on first save.
- Skipped-file reporting is available after manual reload/reindex. Startup discovery, startup sync, startup full reindex, and watcher-triggered sync report skipped counts plus capped path/reason details in server logs.

## Improvement Suggestions

### 1. Index Frontmatterless Markdown

Status: done for browse/search/display.

Backlogger now indexes plain Markdown with derived metadata:

- derive title from the first `#` heading or filename
- derive id from a stable hash of project id plus relative path
- default `type` to `note`
- default `status` from path
- default `created_at` and `updated_at` from file stats
- store derived metadata in SQLite without rewriting the source file

The UI shows read-only state when the containing project is read-only. Once the project is editable, a derived plain-Markdown document can be saved and adopted in place.

### 2. Add Read-Only Mounted Projects

Status: done for the project row, API write guards, and UI toggle.

Backlogger now stores `readOnly` on each project row. Auto-discovered project folders are created with `readOnly: true`, while projects created inside Backlogger start editable. The project switcher shows the current state and lets the user toggle between read-only and editable.

Read-only projects allow browsing, search, graph, tags derived from content, and reload. They block create, editor saves, archive moves, deletes, imports, folder mutation, and project deletion until the user disables read-only mode.

This is important for users who want Backlogger as a documentation browser across many repos, not as the owner of those files. It also keeps the unlock path explicit when a mounted docs folder should be edited through Backlogger.

### 3. Add Explicit Mount Configuration

Instead of requiring users to place folders directly under `projects/`, support a config file:

```yaml
mounts:
  - id: billing-api
    name: Billing API
    path: /repos/billing/docs
    mode: read-only
```

Backlogger could register these paths on startup, validate them with the same path-safety model, and make project setup clearer in Docker Compose.

### 4. Improve Skipped File Visibility

Status: partially done.

Manual project reload and full reindex show skipped files in an alert with path and reason when a file cannot be assigned to a valid project. Normal Markdown, malformed-frontmatter Markdown, and files whose frontmatter points at a different project are indexed with derived or repaired metadata instead of being skipped. Automatic startup and watcher reindex paths log skipped-file details with the same path/reason shape. A UI history for background skipped-file reports is optional polish after mounted-project testing.

- file path
- reason
- suggested fix
- button to copy valid frontmatter

For mounted docs, this turns "files did not appear" into an actionable migration path.

### 5. Separate Source Metadata From Backlogger Metadata

Status: done (opt-in per project).

A project can be switched to **sidecar** metadata mode via the project switcher toggle, or `PUT /api/projects/:id {"metadataMode":"sidecar"}`. In sidecar mode, Backlogger-only metadata (id, type, status, tags, optional title) lives in `<project>/.backlogger/index.json` keyed by the document's project-relative path, so source `.md` files stay frontmatter-free. Plain Markdown is adopted on first edit by writing a sidecar entry instead of injecting frontmatter, archive state is metadata-only (the file is not moved), and SQLite remains rebuildable from `.md` content plus the sidecar. See [Sidecar Metadata](../design/sidecar-metadata.md).

### 6. Treat Folder Mounts As A First-Class UX

Add a "Mount Existing Docs" flow that documents:

- Docker bind mount target
- required project id
- read-only vs editable mode
- indexing status
- skipped files
- reload controls

The feature already exists at the filesystem level. The product should expose it directly so users do not need to infer the contract from deployment docs.

## Recommended Direction

The current foundation now supports the realistic use case: mount another project's `docs/` folder, let Backlogger auto-discover it as read-only, and browse/search it without modifying that repo. If users deliberately unlock that project, Backlogger can adopt plain Markdown files on first edit.

The next best improvements are optional upgrade paths:

- First edit after unlocking writes Backlogger frontmatter and adopts the file.
- The read-only toggle enables writes and archive moves for adopted files.