---
id: 09d88fd4-48a9-4d4a-a9b8-434b73c03a43
title: Bad Practices Analysis
project: backlogger-docs
type: finding
status: active
created_at: '2026-06-04T00:00:00.000Z'
updated_at: '2026-06-08T00:00:00.000Z'
tags: []
---

# Bad Practices Analysis

Date: 2026-06-04

## Scope

This report identifies practices that can create bugs, reduce accessibility, cause inconsistent user experience, or make the codebase harder to maintain. It intentionally separates actual risk from style preferences.

## Executive Summary

The project is generally pragmatic: TypeScript is strict, validation is shared through zod, filesystem access is centralized, and the test suite covers a lot of behavior. The quick-win pass fixed the most visible UI mojibake, the stale README folder claim, the graph error shape, and `apiFetch` JSON parsing. Remaining bad practices are concentrated in older docs/comments with encoding issues, optional-service fallbacks, suppressed hook lint rules, and a large API test file.

## Findings

### 1. Encoding corruption remains in older docs and comments

Priority: Completed

> **Resolved (QW-6/7):** Decorative box-drawing banners removed from `app.css`. Remaining
> non-ASCII characters in design docs are intentional Unicode (em-dashes, box-drawing in
> code trees) and are not encoding corruption.

Evidence:

- The quick-win pass fixed touched UI files and README.
- `docs/design/overview.md`, `docs/design/roadmap.md`, archived reports, and some source comments still contain mojibake.
- `app.css` comments still include corrupted decorative section separators.

Why it matters:

Remaining corruption is mostly in historical docs and comments, but it still makes maintainers distrust documentation and source hygiene.

Recommendation:

Run a focused encoding cleanup:

- Replace user-visible symbols with ASCII or known-good Unicode.
- Prefer text labels or icon components over raw symbol glyphs.
- Configure the repo/editor workflow to save UTF-8 consistently.
- Add a lightweight mojibake search check before release.

### 2. README feature claims were corrected, but historical docs still mix current and old scope

Priority: Completed

> **Resolved (QW-8):** `Historical note` callouts added to the Non-Goals (MVP) and Phase 1
> Scope sections of `docs/design/overview.md`. Both sections now point to [[Architecture]]
> as the current source of truth.

Evidence:

- README now describes current folder behavior.
- `docs/design/overview.md` and `docs/design/roadmap.md` still mix historical MVP notes, completed phases, and future ideas.
- New current docs now exist in `docs/design/architecture.md`, `docs/design/derived-data.md`, and related runbooks.

Why it matters:

Historical docs can still mislead contributors if they are treated as current source-of-truth.

Recommendation:

Mark older design docs as historical or trim them to point at the new current docs.

### 3. Optional service fallbacks can still hide misconfiguration

Priority: Completed

> **Resolved (BP-3):** The last silent empty-data fallbacks were removed. `linkService` is now
> a required dependency of `documentsRouter`, and the backlinks route calls
> `linkService.backlinksFor(id)` directly (was `linkService?.backlinksFor(id) ?? []`). The
> matching `titles` fallback in `projects.ts` was already removed in DF-F3, and
> `DocumentService`/`ReindexService` now require `linkService`, `tagsService`, and
> `graphService` (no `?` deps). All services are constructed exclusively via `buildContext`,
> so a missing service is now a startup/type error rather than a feature that silently looks
> empty. Verified by the existing backlinks integration tests (99 API tests pass).

Evidence:

- Most API errors flow through `BadRequestError`, `ConflictError`, `NotFoundError`, and `errorMiddleware`, returning `{ error: { code, message, details? } }`.
- The graph unavailable route now uses `HttpError(503, 'GRAPH_UNAVAILABLE', ...)`.
- Some optional service fallbacks return empty data, such as backlinks and titles when `linkService` is absent.

Why it matters:

The web client expects structured API errors via `ApiErrorBody`. Silent empty fallbacks can make a disabled feature look like an empty feature.

Recommendation:

For optional services, choose one policy per feature:

- Required in production: throw a typed error if not configured.
- Optional in tests: provide a test context implementation instead of changing runtime response behavior.

### 4. Several React effects suppress hook dependency linting

Priority: Completed

> **Resolved (QW-1):** Invariant comments added to all four suppressions in
> `DocumentWorkspace.tsx`, `DocumentEditor.tsx`, `DocumentPreview.tsx`, and `HelpDrawer.tsx`.

Evidence:

- `DocumentWorkspace.tsx` disables exhaustive deps for buffer reinitialization.
- `DocumentEditor.tsx` disables exhaustive deps around editor setup.
- `DocumentPreview.tsx` and `HelpDrawer.tsx` disable `react/no-danger`, which is acceptable for rendered Markdown but should stay consciously isolated.

Why it matters:

The suppressions may be justified, but each becomes a local footgun during future edits. The editor buffer is especially sensitive because it protects user edits.

Recommendation:

For each suppression, add a short comment that states the invariant. Example: "Only rebase the editor buffer when document identity or server version changes." Keep suppressions local and audited.

### 5. `apiFetch` is hardened, but fetch coverage is still thin

Priority: Completed

> **Resolved (QW-2):** `packages/web/src/lib/api.test.ts` added with 5 tests covering
> success, 204, `INVALID_JSON`, structured error body, and `HTTP_ERROR` fallback.

Evidence:

- `packages/web/src/lib/api.ts` now catches JSON parse failures and throws `ApiError` with code `INVALID_JSON`.
- There is no dedicated test for that behavior.

Why it matters:

The implementation is safer, but a focused test would prevent regression.

Recommendation:

Add a small unit test for invalid JSON and non-OK structured JSON responses.

### 6. `setTimeout(..., 0)` is used for selection sequencing

Priority: Completed

> **Resolved (QW-3):** Explanatory comment added to the `setTimeout` call in `App.tsx`
> describing the ordering invariant and linking to [[Medium Wins]] MW-2 for the proper fix.
>
> **Superseded (DF-F1):** The structural fix has since landed. `App.tsx` no longer uses
> `setTimeout(..., 0)` or `useProjectSelectionReset`; project/document selection is now owned
> by `useWorkspaceSelection`, whose `openDocument(projectId, documentId)` sets both in a single
> batched update (and clears tags when the project changes). The sequencing hack is gone.

Evidence:

- `App.tsx` uses `setTimeout(() => setSelectedDocumentId(documentId), 0)` after changing projects.

Why it matters:

This is a sequencing hack. It may be working around `useProjectSelectionReset`, but the dependency is implicit and fragile.

Recommendation:

Replace with explicit navigation state, or update `useProjectSelectionReset` to accept an intended next document. If that is too much right now, add a comment explaining why the zero-timeout is needed.

### 7. Large API integration test file hurts maintainability

Priority: Low

Evidence:

- `packages/api/src/app.test.ts` is about 54 KB and covers many unrelated API features.

Why it matters:

Large test files are harder to navigate and make targeted failures slower to understand. This is not urgent because the tests provide valuable coverage.

Recommendation:

Split when touching affected areas:

- `projects.routes.test.ts`
- `documents.routes.test.ts`
- `search.routes.test.ts`
- `import.routes.test.ts`
- `folders.routes.test.ts`
- `graph.routes.test.ts`

Do not split just for aesthetics if there is no active work nearby.

## Positive Practices To Keep

- Shared zod schemas between frontend and backend.
- Central `PathResolver` for filesystem safety.
- Optimistic locking with `If-Match` on document update.
- Focused service tests for graph, health, repository, and path resolver.
- Plain CSS and npm workspaces are appropriate for current scale.

## Suggested Cleanup Order

1. ~~Add tests for `apiFetch` invalid JSON behavior.~~ (done — QW-2)
2. ~~Document or remove hook dependency suppressions.~~ (done — QW-1)
3. ~~Normalize optional-service behavior.~~ (done — BP-3 / DF-F2 / DF-F3)
4. ~~Mark old design docs as historical or redirect them.~~ (done — QW-8)
5. ~~Clean remaining mojibake in old docs/comments.~~ (done — QW-6/7)

## Principle Check

- YAGNI: Avoid broad rewrites; fix the practices that create real drift.
- KISS: Keep route and fetch error handling simple and uniform.
- Assignment Focus: Prioritize correctness and user-visible quality.
- Professional Quality: User-facing docs and UI should not contain mojibake.
- Maintainability: Make hidden assumptions explicit where code depends on them.
