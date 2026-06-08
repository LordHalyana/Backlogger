---
id: bc81314a-882b-4f72-81f2-e765e95f91f3
title: Overengineering Analysis
project: backlogger-docs
type: finding
status: active
created_at: '2026-06-04T00:00:00.000Z'
updated_at: '2026-06-08T00:00:00.000Z'
tags: []
---

# Overengineering Analysis

Date: 2026-06-04

## Scope

This report identifies places where the implementation may be more complex than the current product requirements justify. It also calls out complexity that is justified by safety, correctness, or user-facing behavior.

## Executive Summary

Backlogger mostly follows a pragmatic architecture. The system is not broadly overengineered. The new docs make the existing complexity easier to navigate. The highest-risk complexity still comes from feature accumulation around a simple Markdown workspace: graph, tags, folders, import/export, templates, health probes, reload/reindex, and in-app help all interact with the same document model.

The right response is not to remove features blindly. It is to keep each feature's integration contract simple and avoid adding infrastructure that does not serve the current single-user assignment.

## Findings

### 1. Optional service wiring adds complexity without clear runtime value

Priority: Completed

> **Resolved (OE-1):** Optional dependencies were made required in app construction.
> `DocumentService`, `ReindexService`, `projectsRouter`, and `documentsRouter` now take
> `linkService`, `tagsService`, and `graphService` (and `templates`/`fs` where applicable) as
> non-optional deps, wired exclusively through `buildContext`. The empty-data fallbacks were
> removed, so production behavior is deterministic and a missing service fails at
> startup/type-check. (Same change tracked as DF-F2/DF-F3, BP-3, DUC-5.)

Evidence:

- `DocumentService` accepts optional `templates`, `linkService`, `tagsService`, and `graphService`.
- `projectsRouter` accepts optional `linkService`, `reindexService`, `fs`, and `graphService`.

Why it may be overengineered:

Optional dependencies make tests easier, but production behavior becomes less deterministic. A simpler production model is "these services exist".

Recommendation:

Require dependencies in real app context. Keep optional or mocked dependencies only in tests. This reduces branches and makes health/degraded behavior clearer.

### 2. Health checks and schema are probably justified, but should stay bounded

Priority: Low

Evidence:

- `/health` reports api, database, storage, templates, fts, version, uptime, and checked_at.
- `/health/schema` serves a JSON Schema.
- Monitoring docs describe polling, CORS, and subsystem states.

Why it is probably justified:

The app is intended for self-hosted LAN use and Home System integration. A richer health endpoint is reasonable.

YAGNI boundary:

Do not add alert routing, notifications, metrics exporters, or dashboards until there is a concrete consumer. Keep `/health` read-only and stable.

### 3. Knowledge graph is feature-rich for a small app

Priority: Completed

> **Resolved (OE-3):** Scope is frozen — no graph layouts, persistence, clustering, editing, or
> analytics will be added without real feedback (see Anti-Scope Recommendations). The cache
> invalidation contract is now fully documented in `docs/design/derived-data.md`: create /
> update / delete invalidate the project graph, `ReindexService.runProject` calls
> `invalidate(projectId)` after a reload, and full reindex calls `invalidate()` to clear all
> cached graphs. The previous "Current gap" notes (reload/full-reindex not invalidating the
> graph) were closed by DF-F2 and the doc updated accordingly.

Evidence:

- Backend graph service with cache.
- Frontend graph overlay using `react-force-graph-2d`.
- Broken-link nodes, filtering, legend, hover/click behavior.
- Bench script for graph latency.

Why it may be overengineered:

For a simple Markdown workspace, a graph can be more product surface than necessary. It also adds a large visual dependency and cache invalidation concerns.

Why it may be justified:

The feature is already implemented and useful for wiki-link-heavy docs.

Recommendation:

Keep it, but freeze scope unless usage proves value. Avoid adding graph layouts, persistence, clustering, editing, or analytics until the current graph has real feedback.

### 4. In-app help duplicates docs, but docs now have clearer ownership

Priority: Medium

Evidence:

- Help content lives under `packages/web/src/help`.
- README and docs also describe the same features.
- Current maintainer docs now exist for architecture, derived data, API, deployment, scripts, backup/restore, testing, security, and UI conventions.

Why it may be overengineered:

Maintaining product help, README, design docs, and templates can become a documentation system inside a small app.

Recommendation:

Keep in-app help because it improves UX, but maintain the ownership split:

- In-app help: user workflows.
- README: setup/deploy/backup.
- Design docs: architecture and invariants.

### 5. Template reload/admin route is useful but should not grow into a plugin system

Priority: Low

Evidence:

- User templates can be dropped into `data/templates`.
- Settings can reload templates.
- API exposes template reload through admin route.

Why it may become overengineered:

Templates are a practical feature. A plugin system, scripting, or dynamic code execution would not match current requirements.

Recommendation:

Keep templates as Markdown files with frontmatter and simple placeholders. Do not add template scripting unless there is a real requirement.

### 6. CSS file structure still carries too much explanation

Priority: Completed

> **Resolved (QW-7):** All `/* ── ... ── */` decorative banners removed from `app.css`
> and replaced with concise single-line section comments.

Evidence:

- `app.css` has a long "Shared button system" comment and large section banners, some with mojibake.
- `docs/design/ui-conventions.md` now records the intended UI conventions.

Why it may be overengineered:

Large decorative comments age poorly and currently contain encoding corruption. The button system itself is useful; the comment style is heavier than needed.

Recommendation:

Keep concise section comments. Remove decorative banners and rely on file splitting plus `ui-conventions.md` for structure.

### 7. Test coverage is broad but one API test file is too monolithic

Priority: Low

Evidence:

- API app integration tests are concentrated in `packages/api/src/app.test.ts`.
- E2E tests are split by feature.

Why it is not exactly overengineering:

Broad tests are valuable. The issue is organization, not excess testing.

Recommendation:

Split the API integration tests as features change. Do not reduce coverage.

## Complexity That Is Justified

- `PathResolver` symlink and traversal protections: justified by filesystem source-of-truth design.
- Optimistic locking with `If-Match`: justified by multiple tabs and reload safety.
- Reindex/reload: justified because external filesystem edits are a supported workflow.
- Shared zod schemas: justified by TypeScript API contracts.
- CodeMirror: justified because Markdown editing is core.

## Anti-Scope Recommendations

Do not add these without a concrete requirement:

- Authentication/RBAC.
- Multi-user collaboration.
- Real-time sync.
- Plugin system.
- Kanban/project execution tracking.
- AI workflow automation.
- Template scripting.
- Full design-system library.
- Global state framework.
- ORM.

## Suggested Cleanup Order

1. ~~Make production service dependencies explicit.~~ (done — OE-1)
2. ~~Freeze graph scope and document its invalidation contract.~~ (done — OE-3)
3. Reduce documentation duplication.
4. ~~Split CSS and remove decorative comments.~~ (done — QW-7)
5. Split monolithic tests only when touching those features.

## Principle Check

- YAGNI: Resist new platform features outside the current single-user Markdown workspace.
- KISS: Prefer explicit services, simple files, and direct APIs.
- Assignment Focus: Meet the current app requirements, not imagined enterprise needs.
- Professional Quality: Keep necessary complexity where it protects data.
- Maintainability: Make complexity easy to find and justify.
