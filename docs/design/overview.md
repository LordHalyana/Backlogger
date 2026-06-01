# Backlogger — Design Document

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

- Git synchronization
- Knowledge graphs
- AI-assisted document expansion

## Phase 4

- Multi-user support
- RBAC
- Team workspaces

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
