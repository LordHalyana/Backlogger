---
id: 5507f8b0-8fcb-40fa-a138-1e4cbb38fe6c
title: "Backlogger — Design Document"
project: backlogger-docs
type: design_doc
status: active
created_at: "2026-05-30T02:32:58.120Z"
updated_at: "2026-06-02T09:42:32.072Z"
tags: ["design"]
---

# Backlogger — Design Document

> **Historical context.** This document captures the original product design.
> It is superseded by [Product direction](product-direction.md); in particular,
> Kanban boards and a plugin system are now in scope. Use [Architecture](architecture.md),
> [Current Roadmap](roadmap.md), and
> [Data Storage](../operations/data-storage.md) for current implementation
> guidance.

## Project Overview

### Purpose

Backlogger is a lightweight self-hosted service for storing, editing, organizing, and expanding Markdown-based project documentation.

The primary purpose is to provide a low-energy workspace where ideas, notes, design documents, implementation plans, and backlog items can be captured and expanded without requiring immediate implementation.

Think of Backlogger as:

```text
Obsidian-lite + Project Backlog + Design Document Workspace
```

Backlogger is intentionally focused on documentation and planning rather than project execution.

---

# Goals

## Primary Goals

- Store Markdown files
- Edit Markdown files
- Organize documents by project
- Create design documents
- Create implementation plans
- Capture ideas before implementation
- Provide a centralized thinking workspace

## Secondary Goals

- Link documents together
- Generate templates
- Support future AI-assisted planning
- Support project documentation standards

---

# Non-Goals (MVP)

> **Historical note:** This section reflects the original MVP scope. Several items listed
> below (search indexing, in particular) are now fully implemented. See
> [[Architecture]] for the current feature set and non-goals.
- AI agents
- Multi-user collaboration
- Real-time editing
- Git integration
- Workflow automation
- Plugin system
- Kanban boards
- Project execution tracking
- Notifications
- Search indexing

---

# Core Concept

Backlogger stores real Markdown files on disk.

The filesystem is the source of truth.

The database only stores metadata and indexing information.

---

# Phase 1 Scope

> **Historical note:** This section records the original phased build plan. All blocks
> below are complete. Current architecture is documented in [[Architecture]].

## Block 1 — Markdown Storage

### Features

- Create Markdown file
- Read Markdown file
- Update Markdown file
- Delete Markdown file
- List Markdown files

### Storage Layout

```text
data/
└── projects/
    └── home-system/
        ├── ideas/
        ├── design-docs/
        ├── implementation-plans/
        ├── backlog/
        └── notes/
```

---

## Block 2 — Project Registry

### Example

```json
{
  "id": "home-system",
  "name": "Home System",
  "description": "Infrastructure and service platform"
}
```

---

## Block 3 — Markdown Editor

### Layout

```text
+------------------------------------------------------+
| Project Tree | Markdown Editor | Preview / Metadata |
+------------------------------------------------------+
```

---

## Block 4 — Document Types

Supported types:

- idea
- note
- design_doc
- implementation_plan
- backlog_item
- finding

Example frontmatter:

```md
---
title: Backlogger MVP
project: home-system
type: design_doc
status: draft
---

# Backlogger MVP
```

---

## Block 5 — Templates

Initial templates:

- Design Document
- Implementation Plan
- Idea Expansion
- Risk Assessment
- Findings Report

---

# High-Level Architecture

```text
+---------------------+
|     React UI        |
+---------------------+
           |
           v
+---------------------+
|    Express API      |
+---------------------+
           |
    +------+------+ 
    |             |
    v             v
Filesystem     SQLite
(Markdown)     (Metadata)
```

---

# Repository Structure

```text
services/
└── backlogger/
    ├── src/
    ├── web/
    ├── data/
    ├── docs/
    ├── package.json
    └── README.md
```

---

# API Design

## Health

GET /health

## Projects

GET /api/projects

POST /api/projects

PUT /api/projects/:id

DELETE /api/projects/:id

## Documents

GET /api/projects/:projectId/documents

POST /api/projects/:projectId/documents

GET /api/documents/:documentId

PUT /api/documents/:documentId

DELETE /api/documents/:documentId

---

# Future Expansion

## Phase 2

- Full-text search
- Document linking
- Tag explorer
- User-defined templates

### Phase 2 Status

| Block | Feature                     | Status      |
|-------|-----------------------------|-------------|
| 1     | Full-text Search            | ✅ Complete |
| 2     | Document Linking & Backlinks| ✅ Complete |
| 3     | Tag Explorer                | ✅ Complete |
| 4     | User-defined Templates      | ✅ Complete |
| 5     | Phase 2 Hardening           | ✅ Complete |

## Phase 3

Integration, usability, and document portability — without changing the "filesystem is source of truth" contract.

- Home System integration (health tile with subsystem badges)
- Expanded `/health` endpoint (per-subsystem `ok / degraded / error`)
- Markdown import (drop `.md` files into any project)
- Markdown export (download any document as a valid `.md` file)
- Help & Documentation Center (in-app `?` drawer)
- Project Reload & Reindex (reconcile external filesystem changes)

### Phase 3 Status

| Block | Feature                         | Status      |
|-------|---------------------------------|-------------|
| 1     | Home System Integration         | ✅ Complete |
| 2     | Expanded Health Endpoint        | ✅ Complete |
| 3     | Markdown Import                 | ✅ Complete |
| 4     | Markdown Export                 | ✅ Complete |
| 5     | Help & Documentation Center     | ✅ Complete |
| 6     | Project Reload & Reindex        | ✅ Complete |

## Phase 4

Dogfooding improvements driven by using Backlogger to manage its own documentation.

- Folder Management — arbitrary nested folders in the project tree (decoupled from document `type`)

### Phase 4 Status

| Block | Feature            | Status      |
|-------|--------------------|-------------|
| 1     | Folder Management  | ✅ Complete |

## Phase 5

Interactive knowledge graph and hardening.

- Knowledge Graph — interactive canvas overlay; nodes = documents (coloured by type), edges = wiki-links; filter bar; node-click navigation; broken-link (red) nodes
- Archived documents — `archived/` folder mirrors the project tree; Archive/Unarchive button in metadata panel moves files automatically
- Performance hardening — graph latency bench (p95 ≤ 50 ms), bundle audit (≤ 220 kB gzip)

### Phase 5 Status

| Block | Feature                     | Status      |
|-------|-----------------------------|-------------|
| 4     | Knowledge Graph             | ✅ Complete |
| 5     | Phase 5 Hardening           | ✅ Complete |

## Phase 6 — AI assistance

> **⏸ On hold** — deferred; adds complexity beyond current scope.

## Phase 7 — Multi-user & RBAC

> **⏸ On hold** — deferred; adds complexity beyond current scope.

---

# Success Criteria

Backlogger MVP is complete when:

- Documents can be created
- Documents can be edited
- Documents can be saved
- Markdown previews work
- Projects can be created
- Templates can be generated
- Data survives restart

---

# First Milestone

Support:

1. One project
2. One Markdown editor
3. Markdown preview
4. Save to disk

Everything else comes later.
