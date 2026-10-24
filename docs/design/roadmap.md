---
id: bd9b2fa8-3946-4280-9f95-7ec08909cd37
title: Current Roadmap
project: backlogger-docs
type: design_doc
status: active
created_at: "2026-05-30T06:50:27.881Z"
updated_at: "2026-10-24T00:00:00.000Z"
tags: ["design", "roadmap"]
---

# Current Roadmap

Date: 2026-10-24

## Purpose

This is the active roadmap. Backlogger is being refactored toward the
**Local Productivity Workspace** described in
[Product direction](product-direction.md) (whitepaper v0.1, 16 October 2026):
a single-user, offline-first workspace for projects, Kanban tickets, progress
notes, documentation and personal planning, with Markdown as the durable
record.

Work is planned with Wayfinder maps in GitHub Issues. A map breaks a milestone
into decision tickets (research, grilling, prototype). Those decisions produce
one spec, and the spec produces small implementation issues. Nothing is built
until its decisions are recorded. The issue tracker is authoritative, and this
page is a summary of it.

## Where we are

| Stage | Status | Tracking |
|---|---|---|
| 1 Durable core | **Hardening.** Core shipped. Backup/restore, the network boundary and record identity are being planned. | #1 map, #13 spec; #93 map (current) |
| 2 Daily use | **Partly shipped.** Quick capture, Inbox filing, Current work and project-local comments are shipped. Checklists, completion notes, presets, project archive and doc links remain. | #28 map, #40 spec; #44 map, #58 spec |
| 3 Planning | Not started. | — |
| 4 Extensions | Not started. | — |
| 5 Future collaboration | Out of scope for the local release. | — |

### Stage 1: durable core

Shipped before the whitepaper:

- Project-based Markdown storage under `data/projects/<project-id>/`, with
  stable UUIDs in frontmatter, or in a per-project sidecar for mounted docs.
- Atomic file writes (temp file, fsync, rename).
- SQLite metadata, full-text search, tags, wiki links, backlinks and a
  knowledge graph, all rebuildable by reindex.
- Import/export of individual documents, templates, folders, archive and restore.
- Auto-discovery of mounted project folders; read-only projects.

Shipped through the first Wayfinder map (#1 → spec #13, PRs #23–#27):

- A per-project **board** for `backlog_item` documents with `task_state`
  To do / In progress / Done, drag and keyboard moves, Archive with Undo,
  and a conflict banner when a move is rejected. Details:
  [First board spec](first-board.md).
- Write safety: a per-project operation queue, distinct revisions per
  mutation, and stale `If-Match` → 409 (#14, #15).
- Autosave keeps newer editor input during a delayed save (#22, PR #38).

### Current focus: local-release hardening

Map: **#93 Wayfinder: local-release hardening — backup, network boundary and
record identity.** Goal: an implementation-ready spec that closes the stage 1
gaps blocking a local release.

- **Backup and restore** (absorbs #57). In-app workspace backup with restore
  demonstrated on an empty install. External mounted projects are recorded,
  not copied. Today backup is "stop and copy `data/`".
- **Network boundary.** Loopback by default with an explicit opt-in to bind
  wider, plus cross-site request protection. The server currently binds
  `0.0.0.0` and CORS reflects any origin. LAN authentication and TLS are out
  of scope.
- **Record identity.** A workspace ID and schema versions on records.

Release gates are automated: a CI restore test and security tests.

### Stage 2: daily use

Shipped through the daily-work map (#28 → spec #40, PR #41):

- Quick capture into a native Inbox project, and same-ID filing into a project.
- A derived Current work overview.

Shipped through the comments map (#44 → spec #58, PRs #77–#92):

- Project-local Markdown comments on backlog items, with a Comments tab,
  grouped task/comment search and direct links to a comment.
- A shared write coordinator with operational storage, idempotent retries
  and `REVISION_CONFLICT` for stale writes.
- Recoverable filing and resumable permanent deletion that carry comments,
  with a Recovery page for interrupted operations.

Remaining for stage 2, not yet mapped: checklists, optional priority and due
dates, completion notes, project presets, project archive and documentation
links.

### Stages 3 to 5

Each later stage gets its own Wayfinder map.

- **3 Planning:** date-only deadlines, simple events, weekly work blocks that
  reference tickets.
- **4 Extensions:** a trusted-code plugin contract, a fixed dashboard layout
  and the MET Norway weather widget.
- **5 Collaboration:** needs a separate design review.

## Carried-over maintenance

These priorities came before the whitepaper and still apply when touching the
affected areas:

- **Mounted docs reliability.** Mounting another project's docs folder must not
  cause unexpected writes. `docs/operations/data-storage.md` is the canonical
  guide.
- **Maintainability.** Archive the numbered `docs/0*_analysis.md` files once the
  cleanup pass is done (see [Analysis lifecycle](../analysis-lifecycle.md)).
  Split large tests only when working in that area.

## Explicit non-priorities

Not planned for the local release (see Product direction → Outside the first
release):

- Team accounts, RBAC, hosted or cloud infrastructure, billing.
- Multi-device sync, external calendar sync, complex recurrence.
- Untrusted or marketplace plugins, and custom plugin UI.
- AI summaries or embedding-based search as a dependency.
- Automation builders, and a template or preset editor.
- A new frontend state library, a CSS framework, or a generic metadata engine.

## Decision rule

When choosing the next task, prefer the smallest change that moves the current
Wayfinder map forward without weakening the stage 1 guarantees: Markdown stays
authoritative, IDs stay stable, stale writes are rejected, and the index can be
rebuilt. Defer anything that belongs to a later stage.
