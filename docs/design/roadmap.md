---
id: bd9b2fa8-3946-4280-9f95-7ec08909cd37
title: Current Roadmap
project: backlogger-docs
type: design_doc
status: active
created_at: "2026-05-30T06:50:27.881Z"
updated_at: "2026-10-18T00:00:00.000Z"
tags: ["design", "roadmap"]
---

# Current Roadmap

Date: 2026-10-18

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
| 1 Durable core | **Mostly done.** Projects, documents, Markdown storage, search, reindex and the first Kanban board are shipped. Backup/restore and the security defaults remain gaps. | #1 map, #13 spec (closed) |
| 2 Daily use | **Planning.** Decision tickets are in progress; no implementation yet. | #28 map |
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

Still open against the stage 1 exit condition and the local-release
acceptance criteria:

- **Backup and restore** (#5 research is closed; implementation is not
  planned). There is no workspace export, and restore onto an empty install
  is not demonstrated.
- **Security defaults.** The server binds `0.0.0.0`, CORS reflects any origin,
  and there is no cross-site request protection or explicit Markdown
  sanitizer. The whitepaper requires loopback by default and opt-in LAN mode.
  No issue exists yet.
- **Schema version and workspace ID** in records. No issue exists yet.

### Stage 2: daily use (current focus)

Map: **#28 Wayfinder: daily capture, Today and searchable work history.**
Goal: an implementation-ready spec for capture → file into project → pick for
Today → keep progress notes → retrieve later.

Decided:

- **#30 Inbox capture and filing.** Use a native Markdown-backed Inbox project,
  plus direct capture into a known project. Filing is a same-ID transfer, not
  copy-and-delete. Commands must be UI-independent, revision-aware and
  retry-safe, so a future API/MCP client can use them.

Open (in dependency order):

1. #29 The milestone scope: the smallest useful daily-work milestone. This is
   the **next human decision** and it unblocks #31 and #32.
2. #33 Quick capture and inbox triage UX. This can proceed now that #30 is
   decided.
3. #31 Today persistence research → #34 Today semantics (rollover, day change).
4. #32 Progress notes research → #35 What work history a task keeps.
5. #36 Prototype of the capture → Today → review interface (needs #33–#35).
6. #37 Public checks that prove the milestone is ready to implement (needs #36).

After #37: write the stage 2 spec and split it into implementation issues.

Out of scope for this map: planner and deadlines, plugins and weather, MCP
implementation, teams, priority and manual ordering, new task states, sidecar
board support, and a general backup product.

### Stages 3 to 5

Each later stage gets its own Wayfinder map once stage 2 is specified.

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
