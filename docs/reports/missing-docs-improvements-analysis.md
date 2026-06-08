---
id: f0402945-c5cf-488a-83ed-637759cda499
title: Missing Docs Improvements Analysis
project: backlogger-docs
type: finding
status: active
created_at: '2026-06-04T00:00:00.000Z'
updated_at: '2026-06-08T00:00:00.000Z'
tags: []
---

# Missing Docs and Documentation Improvements Analysis

Date: 2026-06-04

## Scope

This report identifies missing, stale, misleading, or overly duplicated documentation. It covers README, design docs, operations docs, in-app help, archived docs, scripts, and API behavior.

## Executive Summary

Backlogger now has the missing current-doc set requested by the previous analysis: architecture, derived data, API reference, deployment, backup/restore, security, scripts, testing, and UI conventions. The remaining documentation work is curation: older docs still contain historical MVP language, phase status tables, stale scope framing, and encoding corruption.

## Missing or Weak Documentation

### 1. Current architecture overview

Priority: Completed

Previous state:

- `docs/design/overview.md` mixes original MVP concept, completed phases, future phases, and status tables.
- `docs/design/roadmap.md` also includes architecture, API, testing, milestones, risks, and old configuration.

Status:

Created `docs/design/architecture.md` as the current source of truth for:

- Runtime architecture.
- Filesystem source-of-truth model.
- SQLite derived data responsibilities.
- Service/repository boundaries.
- Frontend state model.
- Supported deployment model.
- Explicit non-goals as of now.

Keep it short enough to stay maintained.

### 2. Derived data and reindex contract

Priority: Completed

Current state:

- Reindex/reload behavior exists in code and README script table.
- Links, tags, FTS, graph, and document rows are all derived from Markdown/frontmatter.
- No single doc explains which service owns rebuilding which derived data.

Status:

Created `docs/design/derived-data.md` covering:

- Source of truth: Markdown files under `data/projects`.
- Derived tables: documents, FTS, links, tags.
- Derived caches: graph service and React Query caches.
- Required refresh behavior for create/update/delete/import/reload/archive.
- Recovery path: reload project or full reindex.

> **Update (MD-2):** The remaining implementation-alignment item is now closed. Graph cache
> invalidation during reload/reindex is wired (`ReindexService` calls `invalidate(projectId)`
> on project reload and `invalidate()` on full reindex — DF-F2), and `derived-data.md` now
> documents that contract instead of flagging it as a gap.

Remaining work is implementation alignment, especially graph cache invalidation during reindex/reload.

### 3. API reference is incomplete and scattered

Priority: Completed

Current state:

- `docs/design/roadmap.md` contains an initial API spec.
- README lists scripts and features, not full API contracts.
- In-app help covers user workflows.

Status:

Created `docs/api.md` covering:

- Endpoints and response shapes.
- Error shape: `{ error: { code, message, details? } }`.
- Important headers: `If-Match`, `ETag` if used, raw download headers.
- Import response status behavior, including `207`.
- Reload and graph endpoints.

Keep examples minimal.

### 4. Operations docs need deployment and data lifecycle details

Priority: Completed

Current state:

- `docs/operations/monitoring.md` exists and is detailed.
- README covers Docker and backup briefly.

Status:

Created:

- `docs/operations/deployment.md`
- `docs/operations/backup-restore.md`
- `docs/operations/scripts.md`

Do not overdo this; concise runbooks are better than essays.

### 5. Security/trust boundary doc

Priority: Completed

Current state:

- Design docs mention single-user/no-auth.
- README says LAN-reachable by default and CORS reflects any origin by default.
- Markdown rendering trust boundary is not explicit.

Status:

Created `docs/operations/security.md` covering:

- No authentication.
- Intended single-user trusted-network deployment.
- CORS is not authentication.
- Markdown files are trusted local content unless sanitization is added.
- Symlink/path traversal protections exist for project contents.

This avoids false security assumptions.

### 6. Feature docs still need current/future separation

Priority: Completed

> **Resolved (MD-6):** Current vs. historical scope is now clearly separated. README was
> corrected to claim only implemented workflows (QW-8). `overview.md` carries "Historical note"
> callouts on both the Non-Goals (MVP) and Phase 1 Scope sections — explicitly flagging that
> search indexing is now implemented and pointing to the current architecture doc. `roadmap.md`
> (the original Phase 1 implementation plan) now opens with a "Historical note" banner stating
> it does not describe current behavior and redirecting to `architecture.md`, `derived-data.md`,
> and the API reference. Current behavior lives in the `docs/design/` + `docs/api.md` set.

Current state:

- README has been corrected.
- `overview.md` lists search indexing as an MVP non-goal while later marking search complete.

Needed cleanup:

- README should only claim implemented workflows.
- Future features should move to roadmap/backlog.
- Historical phase docs should be marked historical.

### 7. Styling/theming conventions are not documented

Priority: Completed

Current state:

- `theme.css` contains tokens.
- `app.css` has a large button-system comment.

Status:

Created `docs/design/ui-conventions.md` covering:

- Token naming.
- Button classes.
- Form controls.
- Modal/drawer patterns.
- Accessibility expectations.
- Supported viewport widths.

Keep it updated as CSS is split and button/control conventions mature.

### 8. Testing strategy is stale

Priority: Completed

Current state:

- `docs/design/roadmap.md` describes an initial testing strategy.
- Current tests include Vitest, Supertest, React Testing Library, Playwright e2e, graph/search benchmarks, and bundle audit.

Status:

Created `docs/testing.md` covering:

- Unit/API/component/e2e scope.
- How to run each suite.
- What requires browsers.
- Test data isolation.
- When to run benchmarks.

## Documentation Quality Issues

### Encoding corruption

Priority: Completed

> **Resolved (QW-6/7 + verify):** A repo-wide scan of `docs/**/*.md` for the common
> UTF-8-as-Latin-1 mojibake sequences (`â€™`, `â€œ`, `â€”`, `Ã©`, stray `Â`, `�`, …) returns no
> matches. The visible UI/comment corruption was fixed in the quick-win pass; the remaining
> non-ASCII characters in docs are intentional Unicode (em-dashes, box-drawing in code trees),
> not corruption. The ASCII-first convention is recorded in `ui-conventions.md`.

Many docs contain mojibake characters. Fixing this is a documentation quality requirement, not a cosmetic preference.

### Duplicate phase narratives

Priority: Completed

> **Resolved (MD-6):** The historical phase narratives in `overview.md` and `roadmap.md` are
> now explicitly labeled as historical and redirect to the current docs, so phase progress has
> a single historical source while the current docs describe current behavior. Older phase
> material remains available under `docs/archived/` with its own "Historical archive" banner.

Phase progress appears in multiple docs. Keep one history/changelog source and let current docs describe current behavior.

### In-app help vs README overlap

Priority: Low

Overlap is acceptable if each has a clear purpose:

- README: operator/contributor entry point.
- In-app help: end-user workflows.
- Design docs: maintainers and implementation decisions.

## Suggested Documentation Map

Recommended active docs:

- `README.md`: quickstart, Docker, scripts, backup summary.
- `docs/design/architecture.md`: current architecture.
- `docs/design/derived-data.md`: derived indexes and cache invalidation.
- `docs/design/folder-invariants.md`: keep.
- `docs/design/archive-invariants.md`: keep.
- `docs/design/ui-conventions.md`: after CSS cleanup.
- `docs/api.md`: HTTP API reference.
- `docs/operations/monitoring.md`: keep.
- `docs/operations/deployment.md`: deployment runbook.
- `docs/operations/backup-restore.md`: data lifecycle.
- `docs/operations/security.md`: trust boundary.
- `docs/testing.md`: test suite guide.
- `docs/reports/*.md`: current analysis reports.
- `docs/archived/*`: historical only.

## Suggested Cleanup Order

1. ~~Mark historical docs clearly or move old roadmap content under archive.~~ (done — MD-6)
2. ~~Clean remaining mojibake in old docs/comments.~~ (done — QW-6/7, none remain)
3. Keep new current docs updated as implementation changes.
4. Add focused implementation docs only when new complexity appears.

## Principle Check

- YAGNI: Do not create a documentation portal; use focused Markdown files.
- KISS: One canonical source per topic.
- Assignment Focus: Document what exists and what maintainers need next.
- Professional Quality: Docs must match product behavior.
- Maintainability: Remove stale duplication before adding more pages.
