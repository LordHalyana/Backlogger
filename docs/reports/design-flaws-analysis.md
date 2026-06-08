---
id: 85a66e68-908d-4903-a0e9-1de70e07d1a2
title: Design Flaws Analysis
project: backlogger-docs
type: finding
status: active
created_at: '2026-06-04T00:00:00.000Z'
updated_at: '2026-06-08T00:00:00.000Z'
tags: []
---

# Design Flaws Analysis

Date: 2026-06-04

## Scope

This report reviews architecture and product design issues that affect correctness, evolvability, and user experience. It does not treat every imperfect tradeoff as a flaw; some current choices are appropriate for a small, single-user Markdown app.

## Executive Summary

Backlogger's core architecture is sound: Markdown files are the source of truth, SQLite stores derived metadata and indexes, and the frontend uses straightforward server-state caching. The new `docs/design/architecture.md` and `docs/design/derived-data.md` now capture the intended contracts. The biggest design risks remain coordination problems introduced by newer features: derived indexes, optional cross-service dependencies, folder/archive semantics, and UI state living almost entirely in `App.tsx`.

## Findings

### 1. `App.tsx` is still the main orchestration hub

Priority: Partially Completed

> **Partially resolved (DF-F1):** Extracted the cohesive selection state into
> `packages/web/src/hooks/useWorkspaceSelection.ts` (selected project, open
> document, tag filters, and the transitions between them). Project-switch
> resets are now modeled explicitly inside the setters, which let us delete the
> old `useProjectSelectionReset` effect hook and remove the `setTimeout(…, 0)`
> selection-handoff workaround in `App.tsx` — `openDocument` now sets the
> project and document in the same batched update so the target document is
> never clobbered. The remaining `Topbar` extraction (health, action buttons,
> dialogs) is left as a follow-up; per the report it is optional and a global
> store was intentionally *not* introduced. Verified by `npm run build` and the
> web test suite.

Evidence:

- `App.tsx` owns selected project, selected document, selected tags, command palette, settings, import, graph, help state, theme, health polling, reload behavior, shortcut setup, wiki navigation, and derived query invalidation.
- The file coordinates `ProjectSwitcher`, `ProjectTree`, `TagExplorer`, `DocumentWorkspace`, `CommandPalette`, `ImportDialog`, `SettingsDialog`, `HelpDrawer`, and `KnowledgeGraph`.

Why it matters:

As features grow, top-level state transitions become hard to reason about. The `setTimeout` selection handoff is a symptom: project/document selection behavior is not modeled explicitly.

Recommendation:

Extract only cohesive state groups:

- `useWorkspaceSelection`: selected project, selected document, tag filters, project reset behavior, open document navigation.
- `Topbar`: health, action buttons, dialogs.

Do not introduce a global store unless routing or multi-pane state becomes more complex.

### 2. Derived data invalidation is documented but still cross-cutting in code

Priority: Completed

> **Resolved (DF-F2):** Closed the concrete freshness gap in the contract: a
> project **reload** rebuilt documents/links/tags but never invalidated the
> graph cache, so `GET /:id/graph` could serve a stale (10s-TTL) payload after a
> reload added, updated, or removed files. `ReindexService` now takes a required
> `graphService` (and required `linkService`/`tagsService`, matching DF-F3) and
> calls `graphService.invalidate(projectId)` after `runProject`, plus a full
> `invalidate()` after the admin `run()` reindex. Added regression tests for
> graph freshness after delete and after a reload that removes a file; link/tag
> freshness after create/update/delete/rename/reload and out-of-band disk edits
> were already covered. Verified by `npm run typecheck` and the 99-test app
> suite.

Evidence:

- `docs/design/derived-data.md` now documents the contract.
- Documents, links, tags, graph, titles, backlinks, search, and FTS are derived from document bodies/frontmatter.
- `DocumentService`, `ReindexService`, and `ImportService` rebuild some derived data.
- The web client invalidates some React Query caches after mutations, but graph cache invalidation is backend-side and title/backlink invalidation is frontend-side.

Why it matters:

The "filesystem is source of truth" model is correct, but derived state needs a clear invalidation contract. Otherwise reload, import, archive, delete, or external file edits can leave one feature stale while another updates.

Recommendation:

Enforce the documented derived-data contract:

- Any document body/frontmatter change must refresh DB row, links, tags, search, graph cache, and relevant frontend caches.
- Any project reload must remove rows for missing files and refresh all derived indexes.
- Backend service methods should be the only mutation paths for document writes.

Add tests around reload and graph/tag/link freshness after archive, delete, import replace, and external edit.

### 3. Optional backend services blur runtime guarantees

Priority: Completed

> **Resolved (DF-F3):** Made the cross-service dependencies required where
> production always supplies them. `DocumentServiceDeps` now requires
> `templates`, `linkService`, `tagsService`, and `graphService` (the class
> fields and internal calls dropped their `?.` optional-chaining), and
> `projectsRouter` now takes required `linkService`, `reindexService`, `fs`, and
> `graphService` parameters. The unreachable ad hoc degraded responses
> (`RELOAD_UNAVAILABLE`, `FOLDERS_UNAVAILABLE`, and the `503 GRAPH_UNAVAILABLE`)
> were removed, so a misconfigured wiring now fails at construction/compile time
> instead of silently dropping backlinks, tags, or graph data. `buildContext`
> already wired every service, and all tests construct through it, so no test
> doubles were needed. Verified by `npm run build` and the 105-test API suite.

Evidence:

- `DocumentService` accepts optional `templates`, `linkService`, `tagsService`, and `graphService`.
- `projectsRouter` accepts optional `linkService`, `reindexService`, `fs`, and `graphService`.
- Missing services sometimes produce empty arrays and sometimes typed errors or ad hoc 503 responses.

Why it matters:

Optional dependencies are helpful in tests, but they weaken production assumptions. A misconfigured app can appear healthy while silently dropping backlinks or tags.

Recommendation:

Use required dependencies in production context construction. If tests need minimal services, provide test doubles. If a dependency is truly optional, surface its degraded state in `/health`.

### 4. Folder and archive semantics are coupled through path conventions

Priority: Completed

> **Resolved (DF-F4):** Created `packages/shared/src/paths.ts` as the single
> source of truth for the `archived/` path convention: `ARCHIVE_SEGMENT`,
> `isArchivedPath`, `archivePath`, `unarchivePath`, `folderFromDocumentPath`,
> and `isArchivedFolder`. `document-service.ts` now delegates
> `toArchivedPath`/`fromArchivedPath` to the shared helpers (names kept for its
> call sites and tests), and `ProjectTree.tsx` uses `folderFromDocumentPath` and
> `isArchivedFolder` instead of re-implementing the prefix checks. Verified by
> the document-service and 97-test API suites.

Evidence:

- `DocumentService.toArchivedPath` inserts `archived` after the project id.
- `ProjectTree.tsx` identifies archived folders by path prefix `archived/`.
- `docs/design/archive-invariants.md` and `folder-invariants.md` define behavior, but the rules are spread across service, route, and UI logic.

Why it matters:

Path-based semantics are simple, but they can leak into every layer. Folder deletion, creation, display, reload, and status correction all need to agree on the same conventions.

Recommendation:

Centralize folder/archive helpers in shared or API domain modules:

- `isArchivedPath(path)`
- `archivePath(path)`
- `unarchivePath(path)`
- `folderFromDocumentPath(projectId, path)`

Keep the path convention; just avoid reimplementing it.

### 5. No URL-level workspace state

Priority: Completed

> **Resolved (DF-F5):** Added lightweight, path-based URL synchronization in
> `packages/web/src/lib/workspace-url.ts` (`/projects/:projectId` and
> `/projects/:projectId/documents/:documentId`) and wired it into
> `useWorkspaceSelection`: selection is restored from the URL on load (deep-link
> + refresh), pushed to history on change, and re-applied on `popstate` so
> browser back/forward maps to workspace navigation. The existing `?help=` query
> param and any hash are preserved when the path is rewritten. The production
> SPA fallback and Vite dev `historyApiFallback` already serve `index.html` for
> these paths, so refreshes resolve. No full router was adopted (per the report).
> Covered by 13 new `workspace-url` unit tests; `npm run typecheck` and the web
> suite pass.

Evidence:

- `App.tsx` stores selected project/document/tags in local React state.
- Help slug is encoded in the URL through `help-link.ts`, but project/document selection is not.

Why it matters:

The user cannot deep-link directly to a project/document, refresh restores neither selection nor view mode, and browser navigation does not map to workspace navigation.

Recommendation:

Add lightweight URL synchronization before adding more navigation features:

- `/projects/:projectId`
- `/projects/:projectId/documents/:documentId`
- Optional query string for tags and view mode later.

Avoid adopting a full router unless this grows beyond a few routes.

### 6. Markdown rendering uses raw HTML injection with a documented trust boundary

Priority: Completed

> **Resolved (DF-F6):** No code change needed — the recommended state is already
> in place and now verified. `packages/shared/src/markdown.ts` sets
> `html: false` with an explicit `SECURITY` comment, and
> `packages/shared/src/markdown.test.ts` already locks the invariant in with
> regression tests (`<script>` stripped, `<img onerror>` escaped, raw HTML
> escaped to entities). Per the single-user "Design Choices To Keep", an active
> sanitizer (e.g. DOMPurify) is intentionally deferred until an untrusted /
> multi-user deployment; the trust boundary is documented in
> `docs/operations/security.md`. The `dangerouslySetInnerHTML` sinks only ever
> receive HTML produced by this escaped renderer.

Evidence:

- `DocumentPreview.tsx` renders Markdown HTML via `dangerouslySetInnerHTML`.
- `HelpDrawer.tsx` does the same for help content.
- Shared markdown rendering is in `packages/shared/src/markdown.ts`.
- `docs/operations/security.md` documents the current trust boundary.

Why it matters:

For a single-user local app this may be acceptable, but imported Markdown and mounted external project folders can contain arbitrary content. The current docs should explicitly define the trust boundary.

Recommendation:

Keep raw HTML disabled in the Markdown renderer. Add sanitization before any untrusted or multi-user deployment.

### 7. Search/graph performance limits are measured but not integrated into architecture

Priority: Low

Evidence:

- Scripts exist for `bench-search.ts`, `bench-graph.ts`, and `bundle-audit.ts`.
- The architecture docs mention budgets, but not when they should run or what data shape they assume.

Why it matters:

Performance benchmarks are useful only if maintainers know when failures matter.

Recommendation:

Document budgets in `docs/operations/performance.md` and decide whether they belong in CI or manual release checks.

## Design Choices To Keep

- Filesystem source of truth.
- SQLite as a derived metadata/search/index store.
- Express services and repositories instead of an ORM.
- Shared zod schemas for API contracts.
- Plain React Query for server state.
- Single-user/no-auth assumption for the current scope.

## Suggested Cleanup Order

1. ~~Define a derived-data invalidation contract.~~ (done — DF-F2; graph-cache-on-reload gap closed + freshness tests)
2. ~~Normalize backend optional dependency behavior.~~ (done — DF-F3)
3. ~~Extract workspace selection from `App.tsx`.~~ (done — DF-F1; `Topbar` extraction optional)
4. ~~Centralize archive/folder path helpers.~~ (done — DF-F4)
5. ~~Add URL sync for selected project/document.~~ (done — DF-F5)

## Principle Check

- YAGNI: Keep the current architecture; no need for Redux, ORM, or plugin system.
- KISS: Make state ownership clearer with small hooks/helpers.
- Assignment Focus: Fix coordination risks created by actual implemented features.
- Professional Quality: State, docs, and API behavior should align.
- Maintainability: Reduce hidden coupling around derived indexes and path conventions.
