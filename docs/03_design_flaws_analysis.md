# Design Flaws Analysis

## Summary

The core design is sound: Markdown files are durable source data, SQLite is derived query state, and services own write behavior. The biggest design flaws are mismatches between the intended mounted-docs workflow and the current Backlogger-owned document model. Secondary issues are scattered frontend coordination, broad route dependency injection, and incomplete product boundaries around archive and reload behavior.

## Findings

### Finding 1: Mounted docs goal conflicts with required Backlogger frontmatter

**Priority:** High  
**Assignment relevance:** Required  
**Location:** `docs/operations/data-storage.md`, `packages/api/src/services/reindex-service.ts`, `packages/shared/src/documents.ts`

**Problem:**  
The desired workflow is to mount another project's `docs/` folder and have Backlogger auto-index and display all docs. Current indexing requires every Markdown file to contain Backlogger-specific frontmatter with `id`, `project`, `type`, timestamps, status, and tags.

**Why it matters:**  
The filesystem mount feature is only partially useful if normal Markdown docs are skipped. It turns a user-facing design goal into a migration task.

**Suggested fix:**  
Separate "indexed document metadata" from "source file frontmatter". Support frontmatterless files as read-only indexed documents with derived metadata. Only require Backlogger frontmatter for editable/adopted files.

**Status:**  
Addressed on 2026-06-11 for indexing, API write protection, project-level read-only mode, UI visibility, and adoption. Plain Markdown and malformed-frontmatter Markdown now get derived metadata. Files with frontmatter for a different project are indexed with repaired metadata using the containing folder as the project. Auto-discovered or full-reindex-discovered mounted projects start read-only; when explicitly unlocked, the first edit adopts a derived Markdown file by writing Backlogger frontmatter to the same path.

**Risk:**  
Derived metadata must be stable enough for links, open-document URLs, and graph nodes. Verify reload behavior when files are renamed, moved, or later adopted with real frontmatter.

---

### Finding 2: `App.tsx` remains the top-level coordinator for too many UI concerns

**Priority:** Medium  
**Assignment relevance:** Helpful  
**Location:** `packages/web/src/App.tsx`

**Problem:**  
`App.tsx` owns project/document selection, tag selection, command palette state, settings state, import state, graph state, help state, theme, health polling, reload handling, and query invalidation for imports.

**Why it matters:**  
This is still readable, but every new workflow tends to touch `App.tsx`. That increases merge conflicts and makes it harder to reason about whether a feature belongs in shell state, project state, or document state.

**Suggested fix:**  
Keep `App.tsx` as the shell, but move related state into small hooks only when touched. Good candidates are `useShellDialogs` for palette/settings/import/graph/help booleans and an `onImported` helper that uses central query invalidation.

**Status:**  
Addressed on 2026-06-09 for shell overlay state. `App.tsx` now uses `useShellOverlays` for command palette, settings, import, graph, and help drawer state while keeping rendering in the shell.

**Risk:**  
Extracting too much can make navigation harder to trace. Do not split purely by line count; split by behavior that changes together.

---

### Finding 3: Route constructors take broad service sets

**Priority:** Low  
**Assignment relevance:** Optional  
**Location:** `packages/api/src/app.ts`, `packages/api/src/routes/projects.ts`

**Problem:**  
`projectsRouter` receives `ProjectService`, `LinkService`, `ReindexService`, `FsRepository`, and `GraphService`. It handles project CRUD, titles, reload, folders, and graph in one router.

**Why it matters:**  
This makes the router a feature hub. It is not broken, but it weakens ownership boundaries and encourages adding more project-adjacent endpoints to the same file.

**Suggested fix:**  
Do not split now unless the router grows. If cleanup is needed, split route construction by resource: `projectFoldersRouter`, `projectGraphRouter`, and `projectReloadRouter`, while keeping URL paths unchanged.

**Status:**  
Addressed on 2026-06-09. Project CRUD remains in `projectsRouter`, while titles, reload, folders, and graph now live in resource-specific routers mounted on the same `/api/projects` base path. Route parameter validation is shared through `route-params.ts`. URL paths are unchanged.

**Risk:**  
Route refactors can cause subtle path ordering bugs in Express. Verify every `/api/projects/:id/...` endpoint after splitting.

---

### Finding 4: Archive is both metadata and filesystem structure

**Priority:** Medium  
**Assignment relevance:** Helpful  
**Location:** `packages/shared/src/paths.ts`, `packages/api/src/services/document-service.ts`, `docs/design/archive-invariants.md`

**Problem:**  
Archive state is encoded in frontmatter and by moving files under `archived/`. Reindex resolves conflicts by letting filesystem path win.

**Why it matters:**  
This is understandable for Backlogger-owned docs, but it is risky for mounted external docs because archive/unarchive physically reorganizes another repository's documentation.

**Suggested fix:**  
Keep the invariant for editable Backlogger projects. For mounted read-only projects, disable archive moves. Editable mounted projects are now an explicit opt-in through the project read-only toggle.

**Risk:**  
Disabling archive in some modes introduces conditional UI and API behavior. Verify both normal Backlogger projects and mounted projects.

---

### Finding 5: Startup discovery and file watching are useful but invisible

**Priority:** Medium  
**Assignment relevance:** Helpful  
**Location:** `packages/api/src/server.ts`, `packages/api/src/fs/project-watcher.ts`, `docs/operations/deployment.md`

**Problem:**  
Project auto-discovery, startup sync, and watcher-triggered reindex are implemented in the server, but users mostly see only final project lists. Skipped files and discovery details are logged, not surfaced in the app.

**Why it matters:**  
For mounted docs, "nothing appears" can mean invalid project id, skipped nested symlink, watcher delay, project read-only expectations, or stale cache. Invalid or mismatched frontmatter is no longer enough to hide a file because reindex falls back to derived/repaired metadata.

**Suggested fix:**  
Add a simple reload result panel or toast details link showing added, updated, removed, and skipped files. Keep logs too, but do not make logs the only feedback.

**Status:**  
Partially addressed on 2026-06-11. Manual project reload and full reindex now surface skipped-file details through shared result summaries. Startup discovery, startup sync, startup full reindex, and watcher-triggered sync log skipped counts plus capped path/reason details. Metadata problems that used to skip files are now repaired during indexing, so a UI surface for background skipped-file history is optional polish for invalid project folders or skipped symlinks.

**Risk:**  
Showing every skipped file in a huge repo can overwhelm the UI. Cap the preview and offer a downloadable/copyable full report if needed.

---

## Recommended Action Plan

1. Immediate fixes: keep mounted-doc indexing, adoption, and metadata repair covered by tests and docs.
2. Next cleanup pass: add UI history for background skipped-file reports only if users need it after testing mounted projects.
3. Optional improvements: split project router endpoints only if new mounted-project APIs are added.

## What Not To Do

- Do not make mounted docs require a Backlogger migration before they are useful.
- Do not introduce a plugin system to solve simple mount configuration.
- Do not turn `App.tsx` into many tiny hooks without behavioral boundaries.
- Do not remove the filesystem source-of-truth model; improve how external files enter it.
