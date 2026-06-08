---
id: 59cbe867-1c3c-4529-80bb-48db31eb8fbd
title: Deprecated And Unused Code Analysis
project: backlogger-docs
type: finding
status: active
created_at: '2026-06-04T00:00:00.000Z'
updated_at: '2026-06-08T00:00:00.000Z'
tags: []
---

# Deprecated and Unused Code Analysis

Date: 2026-06-04

## Scope

This report identifies stale, deprecated, unused, or misleading code and docs. It distinguishes active backward compatibility from genuinely dead code.

## Executive Summary

There is no obvious large block of dead application code. The quick-win pass corrected the README feature claim and created active reports under `docs/reports`. The bigger remaining issue is stale historical documentation, legacy compatibility paths that are still active, and scripts whose safety/ownership now need to stay documented.

## Findings

### 1. Active reports now exist under `docs/reports`

Priority: Completed

Evidence:

- Active reports now live in `docs/reports`.
- Previous analysis reports were under `docs/archived/reports`.

Why it matters:

The active location is now clear. Archived reports remain historical artifacts.

Recommendation:

Keep current reports in `docs/reports`. Keep `docs/archived/reports` as history unless a deliberate docs cleanup removes them.

### 2. README stale folder-management claim is fixed

Priority: Completed

Evidence:

- README now describes add/manage/delete/collapse and folder selection behavior.

Why it matters:

The public entry point is now aligned with the current UI.

Recommendation:

If drag/drop or rename is still desired, track it as future work, not a shipped feature.

### 3. Design docs mix MVP, completed phases, future phases, and old non-goals

Priority: Completed

> **Resolved (QW-8):** `Historical note` callouts added to the Non-Goals (MVP) and Phase 1
> Scope sections in `docs/design/overview.md`.

Evidence:

- `docs/design/overview.md` lists search indexing under MVP non-goals, but full-text search is implemented.
- The same doc later marks Phase 2 search complete.
- `docs/design/roadmap.md` still describes initial MVP details and old ports/configuration in places.

Why it matters:

New contributors cannot tell what is current, historical, or planned. This is especially risky for assignment-focused work because stale docs can pull scope in the wrong direction.

Recommendation:

Split design docs into:

- Current architecture.
- Historical roadmap/archive.
- Future backlog.

Do not keep old non-goals beside completed features without labeling them historical.

### 4. Legacy document type to subdirectory mapping is active compatibility code

Priority: Completed

> **Resolved (verify-only):** Kept as active compatibility code per the recommendation. The
> behavior is now clearly documented at the source: `DOCUMENT_TYPE_TO_SUBDIR` in
> `packages/shared/src/documents.ts` carries a "Legacy compatibility default" doc comment
> explaining that it is the fallback used when no explicit folder is supplied, that new UI
> flows should prefer explicit folder selection, and pointing to `NewDocumentDialog.tsx`. No
> deprecation until a migration plan exists.

Evidence:

- `packages/shared/src/documents.ts` defines `DOCUMENT_TYPE_TO_SUBDIR`.
- `DocumentService.create` uses explicit `folder` first, then falls back to the legacy type-to-subdir map.

Why it matters:

This is not unused. It preserves existing behavior for callers that do not supply a folder.

Recommendation:

Keep it for now. If arbitrary folder placement is now the main model, document the compatibility behavior and decide later whether it should be deprecated.

### 5. Optional service fallbacks can hide missing configuration

Priority: Completed

> **Resolved (DUC-5):** All optional-service runtime fallbacks were removed. `linkService`,
> `tagsService`, and `graphService` are now required dependencies of `DocumentService`,
> `ReindexService`, `projectsRouter`, and `documentsRouter`, constructed only via
> `buildContext`. The backlinks route now calls `linkService.backlinksFor(id)` and the titles
> route `linkService.titles(id)` directly (no `?? []`). A missing dependency is now a
> startup/type error instead of a feature that silently appears empty. (Same fix tracked as
> bad-practices BP-3 and design-flaws DF-F2/DF-F3; verified by the backlinks integration tests.)

Evidence:

- `documentsRouter` returns empty backlinks if `linkService` is missing.
- `projectsRouter` returns empty titles if `linkService` is missing.
- `DocumentService` skips link/tag/graph rebuilds when optional dependencies are absent.

Why it matters:

This can look like a feature has no data rather than a feature being disabled. In production, it is better to fail loudly or report degraded health.

Recommendation:

Treat these dependencies as required in app construction. Use test doubles in tests instead of optional runtime behavior where possible.

### 6. Type-only re-export in `projects.ts` looks unnecessary

Priority: Completed

> **Resolved (QW-4):** Confirmed no consumer imports `Request` or `Response` from
> `routes/projects.ts`. Import and re-export removed.

Evidence:

- `packages/api/src/routes/projects.ts` imports Express `Request` and `Response` types and re-exports them at the bottom with a comment about router signature clarity.

Why it matters:

This does not appear harmful, but it is odd surface area. If no consumer imports these types from `routes/projects.ts`, remove it.

Recommendation:

Run `rg "from './routes/projects|from '../routes/projects|Request, Response" packages` before deleting. If unused, remove the import/re-export.

### 7. Scripts are useful and now have basic ownership docs

Priority: Low

Evidence:

- `scripts/seed-docs-project.ts`, `register-docs-project.ts`, `bench-search.ts`, `bench-graph.ts`, and `bundle-audit.ts` exist.
- `docs/operations/scripts.md` now documents when to use the root scripts.

Why it matters:

Scripts tend to become stale unless the script docs stay current with behavior and safety expectations.

Recommendation:

Keep `docs/operations/scripts.md` updated when adding or changing scripts.

### 8. Archived roadmap and historical reports may be useful but need clear labeling

Priority: Completed

> **Resolved (verify-only):** `docs/archived/README.md` already opens with a blockquoted
> "Historical archive" callout stating the folder is not current guidance and pointing readers
> to `docs/design/`, `docs/reports/`, and `docs/operations/`. The labeling the finding asked
> for is in place.

Evidence:

- `docs/archived/backlogger_revised_roadmap.md`
- `docs/archived/reports/*`

Why it matters:

Archived docs can still appear in search and mislead readers if not clearly historical.

Recommendation:

Add a one-paragraph `docs/archived/README.md` policy if it does not already clarify that archived content is historical and not current guidance.

## Verification Commands To Run Before Deletion

Use these before removing anything:

```bash
rg "ThemeToggle|Deprecated|@deprecated|TODO|FIXME" packages scripts docs
rg "DOCUMENT_TYPE_TO_SUBDIR|PROJECT_SUBDIRS|parseId|parseProjectId" packages
rg "from './routes/projects|from '../routes/projects" packages
```

## Suggested Cleanup Order

1. ~~Label or reorganize current vs historical design docs.~~ (done — QW-8 / archived README)
2. ~~Decide whether optional service fallbacks should become required dependencies.~~ (done — DUC-5)
3. ~~Audit type-only exports and script ownership.~~ (done — QW-4 / scripts.md)
4. Leave legacy type-to-subdir behavior until a migration plan exists.

## Principle Check

- YAGNI: Do not remove compatibility code just because it looks old.
- KISS: Delete only confirmed-unused code.
- Assignment Focus: Remove stale claims and misleading surfaces first.
- Professional Quality: Public docs should match the product.
- Maintainability: Make historical docs visibly historical.
