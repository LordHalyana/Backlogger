---
id: 3cde7423-42c9-41af-8368-46514fd0d51a
title: Design Flaws Analysis
project: backlogger-docs
type: findings
status: active
created_at: '2026-06-02T00:00:00.000Z'
updated_at: '2026-06-02T00:00:00.000Z'
tags: ["analysis", "design", "maintainability"]
---

# Design Flaws Analysis

> Project: backlogger-docs
> Created: 2026-06-02

---

## Purpose

This report identifies design choices that are not broken, but are likely to
cause friction as Backlogger evolves. The goal is to protect the current
assignment scope while keeping the app maintainable.

---

## Key Principles Applied

| Principle | How it applies here |
|-----------|---------------------|
| YAGNI | Do not solve team-scale or enterprise problems in a single-user app. |
| KISS | Prefer clear local modules over new architectural layers. |
| Assignment Focus | Keep the app aligned with Markdown workspace requirements. |
| Professional Quality | Address flaws that surface as user-facing inconsistency or reliability risk. |
| Maintainability | Keep source-of-truth rules obvious. |

---

## Findings

### 1. `App.tsx` has too many responsibilities

File: `packages/web/src/App.tsx`

`App` currently owns project selection, document selection, tag filters,
command palette state, settings/import/help/graph state, reload toasts, health
polling, keyboard shortcuts, and wiki-link navigation.

Design flaw:

The root component is acting as a coordinator for unrelated workflows. That
keeps the app simple initially, but makes future changes harder because most
new global behavior wants to land in the same file.

Pragmatic fix:

Extract only workflow hooks, not a global state manager:

- `useHealthStatus`
- `useKeyboardShortcuts`
- `useWikiLinkNavigation`
- `useProjectSelectionReset`

Keep state local where it is still local.

Priority: High.

---

### 2. Archive is modeled as both status and path convention

Files:

- `packages/shared/src/documents.ts`
- `packages/api/src/services/document-service.ts`
- `packages/web/src/components/ProjectTree.tsx`

Archive status is stored in document frontmatter and metadata, but archiving
also moves the file under an `archived/` path segment. The UI then treats
folders starting with `archived/` specially.

Design flaw:

Two representations must remain synchronized: status and path. The current
service handles the transition, but external edits or manual file moves can
create mismatch states that reindex must interpret.

Pragmatic fix:

Keep the current behavior because it is useful and already implemented. Add a
documented invariant and test cases:

- archived status should live under `project/archived/...`
- active/draft status should not live under `project/archived/...`
- reindex should report or repair mismatches intentionally

Priority: Medium.

---

### 3. Folder management is split across filesystem and document metadata

Files:

- `packages/api/src/fs/repository.ts`
- `packages/api/src/routes/projects.ts`
- `packages/api/src/services/document-service.ts`
- `packages/web/src/components/ProjectTree.tsx`

Folders are real directories on disk. Documents also carry paths in the
database. Folder delete checks both filesystem contents and known documents.

Design flaw:

The app has a filesystem-first model, but folder operations have to consider
database state too. This is manageable, but the rules should be explicit
because empty-folder deletion and external edits are easy to misunderstand.

Pragmatic fix:

Create a short "folder invariants" note in design docs and keep the API simple:

- creating a folder creates a directory
- deleting a folder only succeeds when no files or subfolders exist
- moving documents remains out of scope except by external edit plus reload

Priority: Medium.

---

### 4. Document type and folder placement are partly coupled

Files:

- `packages/shared/src/documents.ts`
- `packages/api/src/services/document-service.ts`
- `packages/web/src/components/NewDocumentDialog.tsx`

When no folder is supplied, `DocumentService.create` falls back to
`DOCUMENT_TYPE_TO_SUBDIR`. When a folder is supplied, type no longer determines
path.

Design flaw:

This is a transitional design: type buckets are a legacy default, while the UI
now supports arbitrary folder placement. Users may not understand why "Default
(by type)" behaves differently from choosing a folder.

Pragmatic fix:

Keep the fallback for backwards compatibility. In the UI, make the default
label clearer and consider a single default folder such as root for new
projects if type buckets become unnecessary.

Priority: Low.

---

### 5. Knowledge graph may exceed assignment focus

Files:

- `packages/web/src/components/KnowledgeGraph.tsx`
- `packages/api/src/services/graph-service.ts`
- `packages/web/src/lib/graph.ts`

The knowledge graph is a nice feature, but it adds a third-party rendering
library, graph-specific colors, graph-specific state, and a new API surface.

Design flaw:

For an assignment focused on a maintainable Markdown workspace, the graph is
close to overreach unless it is explicitly required. It also creates a richer
interaction model than the rest of the app.

Pragmatic fix:

Keep it if it is already part of the accepted scope, but avoid expanding it.
Focus graph work on correctness, accessibility basics, and performance
guardrails rather than more visualization features.

Priority: Low to Medium.

---

## Recommended Next Steps

1. Extract root-level workflow hooks from `App.tsx`.
2. Document and test archive path/status invariants.
3. Document folder invariants in the design docs.
4. Clarify "Default (by type)" in the new document flow.
5. Freeze graph scope unless it is required for the assignment.

---

## What Not To Do

- Do not add Redux or another global state library for the current app shape.
- Do not remove filesystem-as-source-of-truth; it is a core design choice.
- Do not build drag/drop folder movement unless requirements explicitly call
  for it.

