---
id: f686ae02-0f11-40c9-aa96-7169e07d1273
title: Overengineering Analysis
project: backlogger-docs
type: finding
status: active
created_at: '2026-06-02T00:00:00.000Z'
updated_at: '2026-06-02T00:00:00.000Z'
tags: ["analysis", "yagni", "kiss"]
---

# Overengineering Analysis

> Project: backlogger-docs
> Created: 2026-06-02

---

## Purpose

This report identifies places where the implementation may be more complex
than the assignment requires. Overengineering is not the same as quality.
Professional quality means choosing the smallest design that reliably meets
requirements.

---

## Key Principles Applied

| Principle | How it applies here |
|-----------|---------------------|
| YAGNI | Avoid features and abstractions that current users do not need. |
| KISS | Prefer direct, readable code over clever generality. |
| Assignment Focus | Keep the app centered on Markdown document management. |
| Professional Quality | Preserve tests, validation, and safety where they matter. |
| Maintainability | Reduce moving parts when they are not earning their cost. |

---

## Findings

### 1. Knowledge graph is the largest scope-expansion risk

Files:

- `packages/web/src/components/KnowledgeGraph.tsx`
- `packages/api/src/services/graph-service.ts`
- `packages/web/src/lib/graph.ts`

The graph feature adds visualization, a new dependency, full-screen UI,
filtering, hover state, node sizing, broken-link rendering, and API support.

Why it may be overengineered:

For a Markdown workspace assignment, search, tags, links, import/export, and
folders are core. A graph is useful, but it can become a feature family of its
own.

Recommendation:

Keep the graph as a read-only link overview if it is already accepted. Do not
add layout controls, saved graph settings, clustering, custom colors, or graph
editing unless explicitly required.

Priority: Medium.

---

### 2. Health subsystem is thorough for a single-user app

Files:

- `packages/api/src/services/health-service.ts`
- `packages/api/src/health/schema.ts`
- `packages/api/src/health/probes/*.ts`
- `docs/operations/monitoring.md`

The health endpoint checks API, database, storage, templates, FTS, version,
uptime, and schema.

Why it may be overengineered:

For local single-user use, a simple `/health` could be enough. However, the
docs indicate Home System monitoring is a requirement, so the current design is
defensible.

Recommendation:

Keep it. Do not expand it with metrics, tracing, or alerting inside Backlogger.
External monitoring can consume the current endpoint.

Priority: Low.

---

### 3. Template hot reload and watcher may be more than basic needs

Files:

- `packages/api/src/templates/registry.ts`
- `packages/api/src/templates/watcher.ts`
- `packages/web/src/components/SettingsDialog.tsx`

User templates, reload, source badges, and watcher support are polished.

Why it may be overengineered:

If the assignment only requires built-in templates, user template hot reload is
extra scope.

Why it may be justified:

Backlogger is a documentation tool. Reusable templates are central to its
workflow, and the reload mechanism avoids restarts.

Recommendation:

Keep the current feature. Avoid adding a template editor UI unless it becomes a
clear requirement.

Priority: Low.

---

### 4. Import/export behavior is appropriately scoped

Files:

- `packages/api/src/services/import-service.ts`
- `packages/web/src/components/ImportDialog.tsx`
- `packages/api/src/routes/documents.ts`

Import handles frontmatter, duplicate IDs, title derivation, tags, status, and
type. Export streams the raw Markdown.

Assessment:

This is not overengineered. The behavior is necessary for a filesystem-backed
Markdown app, and the service delegates writes through `DocumentService`.

Recommendation:

Do not add sync providers, batch conflict UI, or external storage integrations.

Priority: Keep as-is.

---

### 5. Reindex/reload is complex but aligned with filesystem source of truth

Files:

- `packages/api/src/services/reindex-service.ts`
- `packages/web/src/lib/projects.ts`
- `packages/web/src/App.tsx`

Reindex supports global rebuild and per-project reload with added, updated,
removed, skipped, duration, and removed IDs.

Assessment:

This is complexity serving a core design principle. If the filesystem is source
of truth, reindex is not optional.

Recommendation:

Keep it. Avoid making reload automatic via filesystem watchers unless current
users need live external edits.

Priority: Keep as-is.

---

### 6. Component extraction could become overengineering

Potential targets:

- generic CRUD hooks
- generic resource tables
- broad design system
- global state store

Assessment:

The app needs a few components, not a framework. Over-abstracting now would
make the code harder for assignment reviewers to follow.

Recommendation:

Extract only:

- modal shell
- topbar action styling/component
- folder field or folder dialog
- small root workflow hooks

Leave everything else explicit.

Priority: High as a restraint.

---

## Recommended Next Steps

1. Freeze graph scope.
2. Keep health, templates, import/export, and reload as-is unless requirements
   change.
3. Avoid global state management.
4. Extract small UI pieces only where duplication is already visible.
5. Treat any new feature proposal as guilty until it maps to current
   requirements.

---

## What Not To Do

- Do not add authentication, RBAC, collaboration, notifications, AI, Git sync,
  or kanban features for this assignment.
- Do not create a design system package.
- Do not add automatic background sync when manual reload satisfies the
  filesystem workflow.

