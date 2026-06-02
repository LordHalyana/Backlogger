---
id: 973dadf6-adf0-4408-995f-731961985799
title: "Backlogger — Revised Roadmap & Strategic Direction"
project: backlogger-docs
type: note
status: archived
created_at: "2026-06-01T10:02:02.588Z"
updated_at: "2026-06-01T10:02:02.588Z"
tags: []
---

# Backlogger — Revised Roadmap & Strategic Direction

## Executive Summary

Backlogger has evolved beyond a simple Markdown editor and is becoming a project knowledge platform.

Current priorities should focus on improving knowledge organization, relationships, discoverability, and usability before introducing AI capabilities.

---

# Core Principle

```text
Filesystem First
Markdown First
Knowledge First
AI Later
```

---

# Phase 4 — Dogfooding & External Project Mounts

## Theme

```text
Make daily usage frictionless
```

## Existing Work

- Folder Management
- Folder Groups
- Preview Link Improvements
- Folder Collapse

## Remaining Blocks

### Docker External Project Mounts

Allow external project documentation folders to appear as Backlogger projects.

Example:

```yaml
volumes:
  - /projects/home-system/docs:/data/projects/home-system
```

Features:

- Auto-discover mounted projects
- Display mounted documentation
- Edit mounted Markdown files
- Reindex mounted projects
- Download mounted files

### Folder Rename

- Rename folders
- Update document paths
- Preserve relationships

### Folder Move

- Move folders
- Move nested folders
- Move documents

### Better Dialogs

Replace:

```javascript
window.prompt()
window.confirm()
```

with proper application dialogs.

### Persist Folder State

Store:

- Collapsed folders
- Expanded folders
- Selected folder

in local storage.

---

# Phase 5 — Project Intelligence

## Theme

```text
Understand project relationships
```

No AI.
No LLMs.
No embeddings.

## Block 1 — Document Relationships

Introduce relationship metadata:

```yaml
---
parent:
children:
depends_on:
related:
implements:
supersedes:
---
```

### Relationship Types

- Parent
- Child
- Depends On
- Related
- Implements
- Supersedes

## Block 2 — Relationship Viewer

Display relationships directly in the document view.

Example:

```text
Depends On
├── Folder Design

Related
├── Project Reload
├── External Mounts

Implements
├── Phase 4
```

## Block 3 — Project Dashboard

Example:

```text
Home System

12 Design Docs
4 Implementation Plans
2 Findings
18 Backlog Items
6 Ideas
```

Additional metrics:

- Total documents
- Total tags
- Total relationships
- Dead documents

## Block 4 — Dead Document Detection

Identify:

- No backlinks
- No tags
- No references
- No relationships
- Stale documents

Example:

```text
Orphaned Documents

old-design.md
unused-plan.md
temp-notes.md
```

## Block 5 — Documentation Health Score

Example:

```text
Coverage: 82%
Orphans: 4
Missing Relationships: 7
Active Docs: 56
```

Purpose:

Provide visibility into documentation quality.

---

# Phase 6 — Git Integration

## Theme

```text
Version Awareness
```

## Features

- Git status
- Recent commits
- Commit history
- Open changed documents
- Branch awareness

## Explicit Non-Goals

- GitHub integration
- Pull requests
- Merge management
- Source control replacement

Backlogger remains a documentation platform.

---

# Phase 7 — Knowledge Visualization

## Theme

```text
Visual Navigation
```

## Features

- Document graph
- Project graph
- Relationship graph
- Tag graph

## Dependency

Requires document relationships from Phase 5.

Without relationships, the graph provides little value.

---

# Phase 8 — AI Assistance (Deferred)

## Status

Deferred / Back Burner

## Reasoning

Current bottlenecks are:

- Organization
- Relationships
- Discoverability
- Documentation quality

AI does not solve these core problems.

## Potential Future Features

- Idea expansion
- Design document generation
- Implementation plan generation
- Relationship suggestions
- Documentation analysis

## Requirements Before AI

AI work should not begin until:

- Document relationships exist
- Project dashboards exist
- Dead document detection exists
- Knowledge visualization exists
- Significant project data exists

---

# Recommended Priority Order

```text
Phase 4
↓
Folder Improvements
↓
Docker Project Mounts
↓
Project Intelligence
↓
Git Integration
↓
Knowledge Visualization
↓
AI Assistance
```

---

# Guiding Philosophy

```text
Small Block
Real Value
Ship
Use
Improve
Repeat
```

The roadmap prioritizes practical value and knowledge management over technical complexity.
