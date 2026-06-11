# Duplicated Code Analysis

## Summary

Backlogger has useful separation between API services, shared schemas, and React components, but several implementation patterns are repeated in ways that can create drift. The most important duplication is not raw identical lines; it is repeated behavior around cache invalidation, document path rules, modal form patterns, and documentation/template content. Cleanup should focus on removing places where one bug fix would otherwise need to be repeated.

## Findings

### Finding 1: Query invalidation is repeated across feature hooks

**Priority:** Medium  
**Assignment relevance:** Helpful  
**Location:** `packages/web/src/lib/query-keys.ts`, `packages/web/src/lib/documents.ts`, `packages/web/src/lib/projects.ts`, `packages/web/src/lib/reindex.ts`, `packages/web/src/App.tsx`

**Problem:**  
The project already has `queryKeys`, `invalidateDocumentDerived`, and `clearDocumentBuffers`, but invalidation is still spread across several hooks and one inline callback in `App.tsx`. Document update/delete, project reload, import, folder mutations, and full reindex each decide which React Query keys to invalidate.

**Why it matters:**  
Derived features are central to the app: search, tags, titles, backlinks, and graph views all depend on document changes. When invalidation rules are duplicated, a future mutation can refresh the tree but leave tags, graph, or open editor buffers stale.

**Suggested fix:**  
Keep the current lightweight helper approach, but route all document-affecting success handlers through a small set of named functions in `packages/web/src/lib/query-keys.ts`, for example `invalidateProjectDocuments(qc, projectId)`, `invalidateDocumentMutation(qc, projectId, documentId)`, and `invalidateGlobalReindex(qc)`. Move the import success callback in `App.tsx` into the same pattern.

**Status:**  
Addressed on 2026-06-09. `packages/web/src/lib/query-keys.ts` now owns project list, folder list, document cache, project reload, and global reindex invalidation helpers. Document mutations, project reload, project updates, folder changes, imports, and full reindex use those helpers. The duplicate import invalidation callback was removed from `App.tsx`.

**Risk:**  
Over-broad invalidation can cause extra refetches and make the UI feel slower. Verify create, update, delete, import, reload, tag filtering, backlinks, and graph after changing this.

---

### Finding 2: Docs template content exists in two places

**Priority:** Medium  
**Assignment relevance:** Helpful  
**Location:** `docs/docs-template.md`, `packages/api/templates/docs-template.md`

**Problem:**  
The docs guide template is duplicated as a live Backlogger document and as a built-in API template. These files are already drifting risk surfaces because every wording or example change must be applied twice.

**Why it matters:**  
The docs template explains project layout, archive behavior, templates, tags, and naming conventions. If one copy is updated and the other is not, new documents created from the app can teach different behavior than the maintained docs.

**Suggested fix:**  
Pick one source of truth. The simple assignment-focused option is to keep `packages/api/templates/docs-template.md` as the built-in template and replace `docs/docs-template.md` with a short pointer to it, or document that `docs/docs-template.md` is only an exported example. Avoid building a generator unless templates continue to multiply.

**Status:**  
Addressed on 2026-06-09. `packages/api/templates/docs-template.md` is now the maintained source of truth. `docs/docs-template.md` has been reduced to a short indexable note that points to the built-in template instead of duplicating the full template body.

**Risk:**  
Removing or replacing the docs copy may affect dogfooding workflows if the docs project expects it as a normal document. Verify template loading tests and the docs project registration flow.

---

### Finding 3: Archive and folder rules are repeated in docs, services, and UI

**Priority:** Medium  
**Assignment relevance:** Helpful  
**Location:** `packages/shared/src/paths.ts`, `packages/api/src/services/document-service.ts`, `packages/web/src/components/ProjectTree.tsx`, `docs/design/archive-invariants.md`, `docs/design/folder-invariants.md`

**Problem:**  
The shared path helpers centralize core archive logic, but the meaning of archive folders still appears in several places: service comments, UI grouping, invariants docs, and folder deletion behavior.

**Why it matters:**  
Archive behavior is filesystem-visible. If rules drift, a document can appear active in one surface and archived in another, or a folder operation can accidentally target the wrong part of the tree.

**Suggested fix:**  
Keep `packages/shared/src/paths.ts` as the implementation source of truth. In code comments, link to the helper instead of restating full rules. In UI code, prefer shared helpers such as `isArchivedFolder` and avoid new string-prefix checks.

**Status:**  
Addressed on 2026-06-09 for service helper duplication. `DocumentService` now calls `archivePath` and `unarchivePath` from `packages/shared/src/paths.ts` directly, and the archive invariant tests exercise the shared helpers instead of service-local aliases.

**Risk:**  
Changing archive path behavior can move user files. Keep this cleanup mostly documentation/comment-level unless there is a failing test or known bug.

---

### Finding 4: Prompt, confirm, and toast handling is similar across components

**Priority:** Low  
**Assignment relevance:** Optional  
**Location:** `packages/web/src/components/ProjectSwitcher.tsx`, `packages/web/src/components/ProjectTree.tsx`, `packages/web/src/components/DocumentWorkspace.tsx`, `packages/web/src/lib/dialog.tsx`

**Problem:**  
Several components assemble confirm/prompt/toast flows manually. The shared `DialogProvider` helps, but each component still repeats success/error phrasing and mutation callback wiring.

**Why it matters:**  
The duplication is small today, but user-facing destructive actions should stay consistent. Repeated patterns also make it easier to forget error handling on a new mutation.

**Suggested fix:**  
Do not add a large dialog framework. Instead, when touching these flows, extract one or two tiny local helpers only where they remove real repetition, such as a `toastMutationError(dialog, message)` helper or colocated action handlers.

**Status:**  
Addressed on 2026-06-09 with a small `toastError` helper in `packages/web/src/lib/dialog.tsx`. Reload, reindex, template reload, folder mutations, project mode updates, and project deletes now share error-toast formatting without introducing a dialog framework.

**Risk:**  
Too much abstraction here would make simple UI flows harder to read. Keep the current direct style unless a component grows more complicated.

---

### Finding 5: Test setup patterns are repeated in one large API test file

**Priority:** Medium  
**Assignment relevance:** Helpful  
**Location:** `packages/api/src/app.test.ts`

**Problem:**  
`app.test.ts` is over 1,400 lines and covers CORS, documents, search, tags, templates, reload, graph, and route errors. Setup and request patterns are repeated across many describe blocks.

**Why it matters:**  
Large test files are hard to scan during assignment review. They also make targeted changes slower because a developer must understand unrelated test sections before editing one feature.

**Suggested fix:**  
Split only when touching related behavior. Good boundaries are `app.documents.test.ts`, `app.search-tags.test.ts`, `app.templates.test.ts`, `app.reload.test.ts`, and `app.graph.test.ts`. Keep shared test harness helpers in one small file.

**Status:**  
Deferred on 2026-06-09. The API integration suite is large, but it is also the strongest coverage for mounted-doc indexing, reload, folder, graph, and route-order behavior. Recent route cleanup kept it intact and relied on the full file to verify unchanged endpoints. Split it gradually only when a specific feature area is already being edited.

**Risk:**  
Mechanical test splits can accidentally weaken coverage if setup changes. Do not refactor this only for aesthetics unless there is time to run the full test suite.

---

## Recommended Action Plan

1. Immediate fixes: keep document/project cache helpers in `query-keys.ts` when new mutations are added.
2. Next cleanup pass: keep the current docs index updated as cleanup artifacts are archived or removed.
3. Optional improvements: split `app.test.ts` gradually when modifying the relevant route groups.

## What Not To Do

- Do not create a generic event bus for cache invalidation.
- Do not introduce a documentation build pipeline just to avoid one duplicated template.
- Do not refactor every dialog into a new abstraction before there is repeated complexity.
- Do not split tests in a way that hides feature intent or removes integration coverage.
