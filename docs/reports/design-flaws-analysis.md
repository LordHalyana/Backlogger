# Design Flaws Analysis

Date: 2026-06-04

## Scope

This report reviews architecture and product design issues that affect correctness, evolvability, and user experience. It does not treat every imperfect tradeoff as a flaw; some current choices are appropriate for a small, single-user Markdown app.

## Executive Summary

Backlogger's core architecture is sound: Markdown files are the source of truth, SQLite stores derived metadata and indexes, and the frontend uses straightforward server-state caching. The new `docs/design/architecture.md` and `docs/design/derived-data.md` now capture the intended contracts. The biggest design risks remain coordination problems introduced by newer features: derived indexes, optional cross-service dependencies, folder/archive semantics, and UI state living almost entirely in `App.tsx`.

## Findings

### 1. `App.tsx` is still the main orchestration hub

Priority: Medium

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

Priority: High

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

Priority: Medium

Evidence:

- `DocumentService` accepts optional `templates`, `linkService`, `tagsService`, and `graphService`.
- `projectsRouter` accepts optional `linkService`, `reindexService`, `fs`, and `graphService`.
- Missing services sometimes produce empty arrays and sometimes typed errors or ad hoc 503 responses.

Why it matters:

Optional dependencies are helpful in tests, but they weaken production assumptions. A misconfigured app can appear healthy while silently dropping backlinks or tags.

Recommendation:

Use required dependencies in production context construction. If tests need minimal services, provide test doubles. If a dependency is truly optional, surface its degraded state in `/health`.

### 4. Folder and archive semantics are coupled through path conventions

Priority: Medium

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

Priority: Medium

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

Priority: Medium

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

1. Define a derived-data invalidation contract.
2. Normalize backend optional dependency behavior.
3. Extract workspace selection from `App.tsx`.
4. Centralize archive/folder path helpers.
5. Add URL sync for selected project/document.

## Principle Check

- YAGNI: Keep the current architecture; no need for Redux, ORM, or plugin system.
- KISS: Make state ownership clearer with small hooks/helpers.
- Assignment Focus: Fix coordination risks created by actual implemented features.
- Professional Quality: State, docs, and API behavior should align.
- Maintainability: Reduce hidden coupling around derived indexes and path conventions.
