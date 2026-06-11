# Bad Practices Analysis

## Summary

The codebase is generally pragmatic: TypeScript schemas are shared, persistence is isolated behind repositories, and the API uses services for most domain behavior. The main bad practices were concentrated around assignment-risk areas: mounted docs being editable by default, runtime logging consistency, lint suppressions around delicate hooks, and metadata problems causing files to disappear from indexing.

## Findings

### Finding 1: Mounted external docs are writable by default

**Priority:** High  
**Assignment relevance:** Required  
**Location:** `docs/operations/data-storage.md`, `packages/api/src/services/document-service.ts`, `packages/api/src/fs/path-resolver.ts`

**Problem:**  
The repository now documents the realistic goal of mounting another project's `docs/` folder into Backlogger. Current behavior treats mounted projects like normal Backlogger-owned projects. Editing, deleting, archiving, or unarchiving can write frontmatter or move files in the external repository.

**Why it matters:**  
For assignment-focused quality, the app should not surprise users by mutating external docs just because they wanted to browse or index them. This is especially risky when the mounted folder belongs to another project with its own documentation conventions.

**Suggested fix:**  
Add a simple read-only project mode before expanding mounted-doc features. Store it on the project row or a small mount config. In read-only mode, allow list/search/graph/reload but block create, update, delete, import replacement, archive, and folder mutation endpoints.

**Status:**  
Addressed on 2026-06-09. Plain Markdown files indexed from mounted folders are now marked `readOnly`, blocked at document update/delete paths, and shown as read-only in the UI. Auto-discovered mounted projects now start in project-level read-only mode, and the project switcher includes a read-only/editable toggle for deliberate unlocks.

**Risk:**  
Read-only checks must be applied consistently across all write paths. Verify document updates, deletes, import, archive, folder routes, and UI disabled states.

---

### Finding 2: Indexing silently skips normal Markdown without Backlogger frontmatter

**Priority:** High  
**Assignment relevance:** Required  
**Location:** `packages/api/src/services/reindex-service.ts`, `packages/api/src/fs/repository.ts`, `docs/operations/data-storage.md`

**Problem:**  
Reindex requires valid Backlogger frontmatter. A normal external `docs/` folder often contains plain Markdown files, so Backlogger can mount the folder but skip many or all files.

**Why it matters:**  
This conflicts with the stated product direction: users should be able to mount docs from other projects and see them. The current behavior is technically correct but poor from a user perspective unless skipped files are obvious and actionable.

**Suggested fix:**  
For the assignment, either make skipped files prominent in the reload/reindex UI or implement a minimal frontmatterless read-only indexing path. The simplest valuable behavior is title from first heading, id from stable path hash, type `note`, status from path, and no source rewrite.

**Status:**  
Addressed on 2026-06-11. Reindex/reload now derives read-only metadata for plain Markdown and malformed-frontmatter Markdown without rewriting the source file. Files with valid Backlogger frontmatter whose `project` value disagrees with the containing folder are indexed with repaired derived metadata instead of being skipped. Full reindex also registers valid on-disk project folders as read-only projects before indexing.

**Risk:**  
Generated ids based on paths can change if files move. If path-derived ids are used, document that moves are treated as remove/add unless a frontmatter id exists.

---

### Finding 3: Operational logging uses scattered console calls

**Priority:** Low  
**Assignment relevance:** Optional  
**Location:** `packages/api/src/server.ts`, `packages/api/src/fs/project-watcher.ts`, `packages/api/src/templates/registry.ts`, `scripts/*.ts`

**Problem:**  
The server and scripts use direct `console.log` and `console.warn` calls. This is acceptable for a small self-hosted app, but it scatters formatting and makes severity/filtering inconsistent.

**Why it matters:**  
Operational messages matter for project discovery, reindexing, and skipped files. Inconsistent logging makes troubleshooting harder when mounted docs fail to appear.

**Suggested fix:**  
Keep it simple: add a tiny logger module with `info`, `warn`, and `error` wrappers that prefix `[backlogger]`. Use it only in the API runtime first. Leave scripts alone unless they need the same format.

**Status:**  
Addressed on 2026-06-09 for API runtime logging. `packages/api/src/logger.ts` now centralizes `info`, `warn`, and `error` output with a `[backlogger]` prefix, and server, watcher, template registry, and API error middleware use it. CLI and benchmark scripts still use direct console output because they are command-line tools.

**Risk:**  
Replacing every console call at once is churn with little assignment value. Do not introduce a heavy logging dependency unless deployment requirements demand it.

---

### Finding 4: Lint suppressions around hooks can hide future stale-closure bugs

**Priority:** Medium  
**Assignment relevance:** Helpful  
**Location:** `packages/web/src/components/DocumentWorkspace.tsx`, `packages/web/src/components/HelpDrawer.tsx`, `packages/api/src/fs/path-resolver.ts`

**Problem:**  
Some lint suppressions are intentional, but the hook dependency suppression in `DocumentWorkspace.tsx` protects a delicate editor-buffer rebase behavior. Future edits could change dependencies and accidentally reset unsaved work or miss server updates.

**Why it matters:**  
Autosave and conflict handling are critical user trust paths. A stale closure in this area can lose edits.

**Suggested fix:**  
Keep the suppression if it is needed, but add a focused test around rebase behavior: loading a new `doc.updated_at` resets the buffer; ordinary render changes do not. This is better than replacing the hook with a clever abstraction.

**Status:**  
Addressed on 2026-06-09. `DocumentWorkspace` now rebases the edit buffer only when the loaded document id or `updated_at` changes, and regression tests cover same-version cache refreshes preserving local edits plus newer-version cache updates resetting the buffer.

**Risk:**  
Changing the hook dependencies directly can cause editor reset loops. Verify autosave, conflict reload, switching documents, and beforeunload behavior.

---

### Finding 5: Browser-facing health and CORS defaults favor convenience over safety

**Priority:** Low  
**Assignment relevance:** Optional  
**Location:** `README.md`, `docs/operations/deployment.md`, `packages/api/src/app.ts`, `packages/api/src/server.ts`

**Problem:**  
CORS defaults to reflect any origin and the host defaults to `0.0.0.0`. This is documented as LAN-friendly, but it is still an unsafe default outside trusted networks.

**Why it matters:**  
The app is explicitly single-user and self-hosted. Assignment quality should show that this is an intentional tradeoff, not an overlooked security gap.

**Suggested fix:**  
Keep the default if LAN access is part of the assignment, but make the README warning more direct: use an allow-list or bind localhost on untrusted networks. Do not add auth unless it is required.

**Status:**  
Addressed on 2026-06-09 as documentation-only guidance. README and deployment docs now state that `0.0.0.0` plus `BACKLOGGER_ALLOWED_ORIGINS=*` is intended for trusted LAN use, and recommend binding localhost or using an allow-list on untrusted networks.

**Risk:**  
Changing defaults could break the documented Docker/LAN workflow. Prefer documentation unless the assignment requires secure-by-default deployment.

---

## Recommended Action Plan

1. Immediate fixes: keep mounted docs indexed with derived/repaired metadata and verify the read-only toggle across write paths.
2. Next cleanup pass: add a UI history for background skipped-file reports only if invalid project folders or skipped symlinks show up often in mounted-project testing.
3. Optional improvements: add a tiny logger wrapper for API runtime messages.

## What Not To Do

- Do not add multi-user auth or RBAC only to compensate for LAN-friendly defaults.
- Do not rewrite external docs automatically just to make indexing easier.
- Do not silence lint rules without a nearby explanation and regression test.
- Do not add a full observability stack for a small self-hosted assignment app.
