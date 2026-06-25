---
id: 7b3e1c9a-2d6f-4a51-9c8e-1f0a4b8d2e33
title: Sidecar Metadata
project: backlogger-docs
type: design_doc
status: active
created_at: '2026-06-26T00:00:00.000Z'
updated_at: '2026-06-26T00:00:00.000Z'
tags: ['design', 'mounted-docs']
---

# Sidecar Metadata

Date: 2026-06-26

Status: **implemented** (Phases 1-4) — the "separate source metadata from
Backlogger metadata" item in [Data Storage And Project Mounts](../operations/data-storage.md).
Enable it per project with the **Frontmatter / Sidecar** toggle in the project switcher.

## Motivation

Today a file becomes a fully editable Backlogger document only when Backlogger
frontmatter (`id`, `type`, `status`, `tags`, timestamps) is written **into** the
`.md` file. For a project's own notes that is fine. For a **mounted external
docs folder** it is intrusive: editing a doc rewrites the upstream file and adds
fields the source repository never asked for.

Sidecar metadata lets a mounted project stay editable in Backlogger while
keeping its source `.md` files pristine: the Backlogger-only metadata lives in a
separate on-disk store keyed by the document's project-relative path.

## Current Model (recap)

- Markdown files under `data/projects/<id>/**/*.md` are the source of truth.
- SQLite is a rebuildable index derived from those files.
- `DocumentService` owns the single write path; `FsRepository.write` re-serializes
  frontmatter + body on every save.
- Identity: a real document carries a UUID in frontmatter; a plain-Markdown file
  without frontmatter gets a **path-derived** id and is **read-only** until
  adopted (`DERIVED_DOCUMENT_READ_ONLY`).
- Archive state is encoded in the **path** (`<id>/archived/<rest>`), kept in sync
  with `status` by `DocumentService.update` and `paths.ts`.

See [Architecture](architecture.md) and [Derived Data](derived-data.md).

## Proposed Model

### The store

Each project that opts in gets a hidden, on-disk sidecar index:

```text
data/projects/<project-id>/.backlogger/index.json
```

Shape (one entry per document, keyed by project-relative path **without** the
project id):

```json
{
  "version": 1,
  "entries": {
    "guide/getting-started.md": {
      "id": "5f8c5b7b-7d9e-4b4d-a017-d3ab3e1d9d31",
      "type": "note",
      "status": "active",
      "tags": ["api"],
      "created_at": "2026-06-26T00:00:00.000Z",
      "updated_at": "2026-06-26T00:00:00.000Z"
    }
  }
}
```

The sidecar lives **on disk**, so the "filesystem is the source of truth"
contract holds: SQLite is still fully rebuildable from `.md` content **plus**
the sidecar. `title` may be stored as an optional override; when absent it stays
derived from the first `#` heading or filename, so the upstream file remains the
source of the title.

### Per-project metadata mode

A new project field selects how metadata is stored:

- `metadataMode: "frontmatter"` — current behavior (default; unchanged).
- `metadataMode: "sidecar"` — metadata is read from and written to the sidecar;
  source `.md` files are never modified for metadata.

Migration `0008_project_metadata_mode.sql` adds
`projects.metadata_mode TEXT NOT NULL DEFAULT 'frontmatter'`. Auto-discovered
mounted projects may be created in `sidecar` mode so a later edit never injects
frontmatter.

### Metadata precedence (read path)

For each `.md` file, resolve metadata in this order:

1. **In-file Backlogger frontmatter** — if valid, it wins (lets sidecar projects
   still contain native Backlogger docs).
2. **Sidecar entry** for the file's path — the document is editable; its id is
   the sidecar id.
3. **Derived** (path/heading/file stats) — read-only, exactly as today.

This means a sidecar-adopted document is editable **without** any frontmatter in
the file.

### Identity

The id is stored in the sidecar, keyed by project-relative path. It is stable
while the path is stable. An **external** move/rename (outside Backlogger) breaks
the key — the same limitation frontmatter has today when a file is renamed and
the project is reindexed. In-app move (`DocumentService.move`) updates the
sidecar key atomically, so it stays stable.

## Document Lifecycle (sidecar mode)

| Operation | Frontmatter mode (today) | Sidecar mode (new) |
|-----------|--------------------------|--------------------|
| Create    | Write `.md` with frontmatter | Write `.md` (body + optional `# title`), write sidecar entry |
| Read      | Parse frontmatter | Frontmatter → sidecar → derived (precedence above) |
| Update body | Rewrite `.md` | Rewrite `.md` body only; bump sidecar `updated_at` |
| Update meta (status/tags/type) | Rewrite frontmatter | Write sidecar entry only; `.md` untouched |
| Move      | Rename file + DB | Rename file + **re-key sidecar entry** + DB |
| Delete    | Delete file + DB | Delete file + remove sidecar entry + DB |
| Archive   | Move file under `archived/` | Set `status: archived` in sidecar; **do not move the file** |

The archive divergence is deliberate: moving files inside a mounted external
tree is exactly what sidecar mode exists to avoid. In sidecar mode, archive
state is metadata only, so the path-based [archive invariant](archive-invariants.md)
does **not** apply — `isArchivedPath` is ignored for sidecar entries and the
folder tree derives archive state from `status`.

## Reindex Semantics

`ReindexService` (full and per-project) rebuilds SQLite from disk:

- Walk `.md` files (existing behavior), skipping the `.backlogger/` directory.
- For each file, apply the precedence rule to compute metadata.
- Load the project sidecar once per project; use it for files lacking
  frontmatter.
- Prune sidecar entries whose `.md` file no longer exists (report them in the
  reindex summary so the user can see orphaned metadata).
- SQLite `documents.read_only` stays driven by the resolved mode: frontmatter or
  sidecar → editable (subject to project read-only); derived-only → read-only.

## Path Safety

- `.backlogger/` is a **reserved** directory. `PathResolver` must:
  - allow `FsRepository` to read/write `<project>/.backlogger/index.json`;
  - reject it as a document path, folder path, or project id;
  - exclude it from `walkProject`, `listFolders`, and `listProjectFiles`.
- The sidecar is trusted local content (same trust boundary as the `.md` files);
  the Markdown renderer still disables raw HTML. See
  [security](../operations/security.md).

## Read-Only Interaction

Sidecar writes are still gated by `assertProjectWritable`: a read-only project
rejects create/update/move/delete/archive with `PROJECT_READ_ONLY`, whether the
metadata target is frontmatter or the sidecar.

## Phased Implementation Plan

Each phase is independently typecheckable and shippable.

1. **Store + schema (isolated).** `packages/shared/src/sidecar.ts`
   (`SidecarIndexSchema`, `SidecarEntry`), and `packages/api/src/fs/sidecar-store.ts`
   (`SidecarStore`: atomic read/write of `index.json`, `get/set/rename/delete/list`
   keyed by relpath). Unit tests. No wiring into the live path yet.
2. **Project mode.** Migration `0008`, `projects.metadataMode` in the schema and
   `ProjectsRepo`, surfaced read-only on the API. Discovery may create mounted
   projects in `sidecar` mode.
3. **Read path.** Apply the precedence rule in `DocumentService` /
   `ReindexService` metadata resolution; `.backlogger/` exclusion in
   `FsRepository` + `PathResolver`.
4. **Write path.** `create/update/move/delete/archive` honor `metadataMode`;
   sidecar-based adoption replaces frontmatter injection for sidecar projects.
5. **UI + docs.** Mode shown/toggled in the project switcher; "Mount existing
   docs" help chapter; update `architecture.md`, `derived-data.md`,
   `archive-invariants.md`, `folder-invariants.md`, `data-storage.md`, `api.md`.

## Open Decisions

- **Sidecar granularity:** one `index.json` per project (chosen here — fewer
  files, atomic per-project write) vs. one `*.bl.json` per document (smaller
  diffs, more files). Revisit if per-project writes contend.
- **Orphan policy on reindex:** prune vs. retain orphaned entries for a grace
  period. Default: prune and report.
- **Title source:** keep derived-only (chosen) vs. allow an optional sidecar
  `title` override for files with no `#` heading.
