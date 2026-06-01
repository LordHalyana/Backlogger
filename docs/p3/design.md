# Backlogger Phase 3 — Integration, Usability & Document Portability

## Overview

Phase 3 focuses on improving usability, interoperability, and integration with Home System.

The goal is to make Backlogger a daily-use documentation platform before introducing larger features such as Git sync, AI assistance, knowledge graphs, or multi-user support.

---

# Objectives

## Primary Objectives

- Integrate Backlogger with Home System monitoring
- Improve operational visibility
- Add built-in help/documentation
- Support Markdown import
- Support Markdown export
- Support project reload/reindex

## Secondary Objectives

- Reduce onboarding friction
- Improve discoverability of existing features
- Make Backlogger the documentation hub for all projects

---

# Out of Scope

The following remain deferred:

- AI-assisted document generation
- AI agents
- Knowledge graphs
- Git synchronization
- Multi-user support
- RBAC
- Team workspaces
- Real-time collaboration
- Workflow automation

---

# Block 1 — Home System Integration

## Purpose

Allow Home System to monitor Backlogger as a first-class service.

## Monitoring Targets

### Backend API

GET /health

### Frontend

Web UI availability

### Database

SQLite status

### Storage

Markdown storage path

### Search

FTS availability

## Success Criteria

- Home System displays Backlogger status
- Service failures are visible
- Operational health is easy to identify

---

# Block 2 — Expanded Health Endpoint

## Purpose

Provide richer operational status than a simple HTTP 200 response.

## Example Response

```json
{
  "status": "ok",
  "api": "ok",
  "database": "ok",
  "storage": "ok",
  "templates": "ok",
  "fts": "ok"
}
```

## Success Criteria

- Health endpoint exposes subsystem health
- Monitoring systems receive actionable information

---

# Block 3 — Markdown Import

## Purpose

Allow users to bring existing Markdown documentation into Backlogger.

## Supported Methods

### File Upload

Upload a .md file.

### Drag & Drop

Drag one or more .md files into a project.

### Placement

User chooses:

- Project
- Folder
- Document Type

before import.

## Import Flow

```text
Upload
↓
Validate Markdown
↓
Parse Metadata
↓
Store File
↓
Update Search Index
↓
Update Links
↓
Update Tags
```

## Success Criteria

- Imported files are searchable
- Imported files participate in links
- Imported files participate in tags

---

# Block 4 — Markdown Export

## Purpose

Avoid vendor lock-in and allow documents to leave Backlogger.

## Features

### Download Document

Download original .md file.

### Future

- Export Project
- ZIP Export

Not part of Phase 3.

## Success Criteria

- Documents can be downloaded
- Exported files remain valid Markdown

---

# Block 5 — Help & Documentation Center

## Purpose

Teach users how to use Backlogger without external documentation.

## Access

- Header Help Button
- Settings → Help

## Documentation Sections

### Markdown Basics

- Headings
- Lists
- Tables
- Code blocks

### Wiki Links

Examples:

```md
[[document-name]]
[[document-name|Custom Label]]
```

### Tags

Examples:

```text
#home-system
#design-doc
#implementation
```

### Search

- Search by title
- Search by content
- Search by tag

### Templates

- Built-in templates
- User templates
- Template reload

### Projects

- Creating projects
- Organizing documents
- Folder structure

### Import & Export

- Uploading Markdown files
- Drag & drop
- Downloading files

## Success Criteria

- New users can learn the application internally
- Existing features become easier to discover

---

# Block 6 — Project Reload & Reindex

## Purpose

Handle external filesystem changes safely.

Filesystem watching remains deferred.

## Feature

Add a:

```text
Reload Project
```

button.

## Reload Flow

```text
Scan Files
↓
Update Metadata
↓
Update Search Index
↓
Update Links
↓
Update Tags
```

## Success Criteria

- External changes become visible
- Search remains accurate
- Links remain accurate
- Tags remain accurate

---

# Recommended User Workflow

```text
Idea
↓
Design Document
↓
Implementation Plan
↓
Development
↓
Findings
↓
Archive
```

Backlogger should support this workflow directly.

---

# Phase Completion Criteria

Phase 3 is complete when:

- Home System monitors Backlogger
- Expanded health endpoint exists
- Markdown import works
- Markdown export works
- Help center exists
- Project reload/reindex exists

---

# Future Phase Candidates

## Phase 4

- Git synchronization
- Knowledge graph visualization
- Cross-project links
- Document relationships

## Phase 5

- AI-assisted document expansion
- Design document generation
- Implementation plan generation

## Phase 6

- Multi-user support
- RBAC
- Team workspaces

---

# Guiding Principle

```text
Small block
Real value
Ship
Use
Improve
Repeat
```

Backlogger should continue growing through small, useful, production-ready increments.
