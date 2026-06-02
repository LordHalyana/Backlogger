---
id: c42a2bba-0e12-4d48-ad2f-c55fe6be3a45
title: "Phase 3 — Implementation Plan"
project: backlogger-docs
type: implementation_plan
status: archived
created_at: "2026-05-31T13:43:02.218Z"
updated_at: "2026-06-01T02:29:09.813Z"
tags: ["p3"]
---

# Phase 3 — Implementation Plan

> Parent: [../design/roadmap.md](../design/roadmap.md)
> Source design: [./design.md](./design.md)
> Predecessor: [../p2/implementation_plan.md](../p2/implementation_plan.md) — Phase 2 (✅ complete, 134 unit + 8 e2e tests).
> Scope: Phase 3 of the Phase-3 scope doc — integration, usability, and document portability. Git sync, knowledge graphs, AI-assist, and multi-user remain explicitly deferred (Phase 4+).

---

## 1. Objective

Make Backlogger a **daily-use, integrated, portable** documentation platform — without changing the "filesystem is the source of truth" contract:

- A user can monitor the service from Home System with actionable subsystem health.
- A user can drop existing Markdown files into a project and they are searchable, linked, and tagged immediately.
- A user can download any document and walk away with a valid `.md` file.
- A new user can learn the app from inside the app (no external docs).
- A user can reconcile external filesystem changes with a single click.

Phase 3 must remain backwards-compatible with all Phase 1+2 data: opening a P1/P2 `data/` directory in a Phase-3 build must work with no manual migration step beyond the existing startup auto-reindex.

---

## 2. Lego Block Breakdown

Phase 3 is six independent blocks. Each has its own design document under [./blocks/](./blocks/).

| # | Block                          | Design Doc                                                            | Depends on (P3) | Depends on (P1/P2)                |
|---|--------------------------------|-----------------------------------------------------------------------|-----------------|-----------------------------------|
| 1 | Home System Integration        | [block-1-home-system-integration.md](./blocks/block-1-home-system-integration.md) | 2               | API (P1 Block 0)                  |
| 2 | Expanded Health Endpoint       | [block-2-expanded-health.md](./blocks/block-2-expanded-health.md)     | —               | API, DB, FTS, templates           |
| 3 | Markdown Import                | [block-3-markdown-import.md](./blocks/block-3-markdown-import.md)     | —               | DocumentService, links, tags, FTS |
| 4 | Markdown Export                | [block-4-markdown-export.md](./blocks/block-4-markdown-export.md)     | —               | DocumentsRepo, FsRepository       |
| 5 | Help & Documentation Center    | [block-5-help-center.md](./blocks/block-5-help-center.md)             | —               | Dialog primitives (P1 Block 6)    |
| 6 | Project Reload & Reindex       | [block-6-project-reload.md](./blocks/block-6-project-reload.md)       | —               | ReindexService (P1 Block 4)       |

> Blocks 2–6 are independent and can be picked up in any order. Block 1 depends on Block 2 because the integration shows the expanded subsystem health. Build order suggestion: **2 → 1 → 4 → 3 → 6 → 5** (cheap wins first, then import which touches the most subsystems, then the help center once the feature set is final).

---

## 3. Build Order & Milestones

Each milestone delivers a runnable, demoable slice.

### Status

| Milestone | Block | Status         | Notes |
|-----------|-------|----------------|-------|
| M0        | 2     | ✅ Done        | Expanded `/health` returns `{ status, api, database, storage, templates, fts }`. |
| M1        | 1     | ✅ Done        | Home System polls the expanded endpoint and renders a Backlogger tile with subsystem badges. |
| M2        | 4     | ✅ Done        | "Download" button on the document toolbar streams the original `.md`. |
| M3        | 3     | ✅ Done        | Topbar **Import** opens a dialog; user picks `.md` files; imported docs land in the tree, are searchable, and round-trip with frontmatter `id` for dedup. |
| M4        | 6     | ✅ Done | "Reload Project" button in the topbar triggers a per-project reindex pass; toast on completion. |
| M5        | 5     | ✅ Done | Help drawer accessible from a topbar `?` button and from Settings → Help. |

### M0 — Expanded Health
Deliver Block 2. `GET /health` returns subsystem statuses; existing `200/ok` consumers keep working (`status` field unchanged).

### M1 — Home System Integration
Deliver Block 1. Home System scrapes the expanded endpoint at a fixed interval and renders subsystem badges.

### M2 — Export
Deliver Block 4. A user can download any document as a `.md` file with original frontmatter intact.

### M3 — Import
Deliver Block 3. A user can pick or drag-and-drop `.md` files into a target project (with placement controls); files are validated, stored, and joined to the search / link / tag indexes.

### M4 — Project Reload
Deliver Block 6. A user can reconcile external filesystem changes for one project without restarting the server.

### M5 — Help Center
Deliver Block 5. An in-app drawer covers Markdown basics, wiki-links, tags, search, templates, projects, import/export.

---

## 4. Cross-Cutting Concerns

All Phase 1+2 cross-cutting rules still apply. New ones for Phase 3:

- **Health is cheap.** Subsystem probes must run in well under 50 ms total. Probes that need real I/O (FTS query, disk stat) use cached results refreshed in the background.
- **Import is idempotent and atomic.** A failed import leaves no orphans on disk, in the DB, or in derived tables. Duplicate detection by content hash prevents accidental double-imports.
- **Export is byte-faithful where possible.** Downloading a document that was never touched in-app returns the exact bytes that exist on disk. Documents that have been edited in-app are written by the same gray-matter codepath, so the output is normalized YAML + body.
- **Help is generated, not hand-rolled twice.** Source of truth is Markdown files under `packages/web/src/help/`; rendered via the existing `markdown-it` preview so wiki-links and code blocks just work.
- **Reload is per-project.** The existing `POST /api/admin/reindex` is global; the new per-project entrypoint must not block the whole DB.

---

## 5. Definition of Done (Phase 3)

The phase is complete when all of the following hold:

1. All six Phase 3 block design docs are implemented and their per-block exit criteria are met.
2. The Phase-3 scope doc's *Phase Completion Criteria* are demonstrably satisfied:
   - Home System monitors Backlogger.
   - Expanded health endpoint exists.
   - Markdown import works.
   - Markdown export works.
   - Help center exists.
   - Project reload/reindex exists.
3. `npm install && npm run dev` on a fresh clone still works; a Phase-1 or Phase-2 `data/` directory mounts unchanged and the auto-reindex produces populated derived tables.
4. CI green: lint, typecheck, unit/API/component tests, Playwright e2e (chromium). New e2e specs cover import, export, and reload.
5. Initial JS gzip ≤ 220 kB (raises Phase 2 budget of 200 kB by 20 kB to accommodate the help content and import UI).

---

## 6. Out of Scope

Everything listed under the Phase-3 scope doc's *Out of Scope* and *Future Phase Candidates* sections:

- Git synchronization (P4 candidate)
- Knowledge graphs / cross-project link visualization (P4 candidate)
- Document relationships beyond `[[wiki-link]]`
- AI-assisted generation (P5 candidate)
- Multi-user / RBAC / team workspaces / real-time collaboration (P6 candidate)
- Workflow automation
- Filesystem watcher for live external edits (Block 6 button suffices)
- Project / ZIP export (Block 4 keeps single-document scope)

Changes to this scope require an updated scope doc and a new implementation-plan revision.
