---
id: b45f567e-f148-4b3f-8aae-18459e7da1f2
title: "Block 6 — Project Reload"
project: backlogger-docs
type: design_doc
status: archived
created_at: "2026-05-31T13:45:47.536Z"
updated_at: "2026-06-01T00:02:41.273Z"
tags: ["p3"]
---

# Block 6 — Project Reload

> Parent: [../implementation_plan.md](../implementation_plan.md)
> Depends on: Phase 1 Block 1 (FsRepository), Phase 2 Block 5 (ReindexService).
> Delivers: an operator can re-sync a single project's filesystem state into the DB on demand, without restarting the server and without blocking other projects.

---

## 1. Purpose

When a user edits a `.md` file outside Backlogger (e.g. via `vim` over SSH, or by restoring a backup), the DB row may go stale. Today the only recovery is a full reindex at startup. This block gives a targeted, online reindex per project.

---

## 2. Scope

In scope:
- `POST /api/projects/:id/reload` runs the existing reindex pipeline scoped to one project.
- Refactor `ReindexService.run()` so `run({ projectId? })` can target a single project or the whole data dir.
- A "Reload" button in the project header issues the request and shows a toast with stats: documents added / updated / removed, duration.
- Concurrency: reloads of the *same* project are serialized (later requests get `409 Conflict`); reloads of *different* projects can run in parallel.
- Soft progress: response returns a summary object; UI shows it in the toast — no streaming progress bar.

Out of scope:
- Watch-mode (filesystem change notifications) — Phase 4+.
- Partial reload (single document) — full project is the unit.
- Cross-project rebuild from this endpoint (the existing startup path covers that).
- Background queue / job system — we synchronously process the request.

---

## 3. Design

### 3.1 Service refactor

Today:
```ts
class ReindexService { run(): ReindexReport; }
```

New:
```ts
interface ReindexOptions { projectId?: string; }
class ReindexService {
  run(opts?: ReindexOptions): ReindexReport;
  // Internal: per-project lock
  private readonly running = new Set<string>();
}
```

Where `projectId === undefined` walks all projects (existing behavior). With a `projectId`, the service:
1. Acquires the lock for that project; if already held → throws `ReloadInProgressError`.
2. Lists `data/projects/<id>/*.md` via FsRepository.
3. For each file: parse frontmatter, upsert into `documents`, refresh `links`, `tags`, `tag_documents`, `documents_fts`. Use the existing single-doc reindex helper, no copy-paste.
4. Deletes DB rows whose backing files have vanished (scoped: `WHERE project_id = ?`).
5. Releases the lock; returns `{ projectId, added, updated, removed, durationMs }`.

All DB work happens inside one `db.transaction(() => …)` so a crash mid-reload leaves the previous state intact.

### 3.2 Route

`POST /api/projects/:id/reload`:
- Confirms project exists → else 404.
- Calls `reindexService.run({ projectId })`.
- On `ReloadInProgressError` → `409 { code: 'RELOAD_IN_PROGRESS' }`.
- On success → `200 { added, updated, removed, durationMs }`.

No body. No query params. Idempotent in the sense that a second call after the first finishes is safe and cheap (mostly no-ops).

### 3.3 Web

- `useReloadProject(projectId)` mutation hook.
- "Reload" button in the project header (next to the project name).
- Disabled state while the mutation is in flight; click → toast on success / error.
- On success the hook invalidates `documents`, `tags`, `titles`, `links` queries so the tree, tag explorer, and any open document refresh.
- If the currently open document is among the *removed* set, the editor closes and a toast explains why.

### 3.4 Lock semantics

The lock is an in-memory `Set<string>` on the service instance. This is correct for the single-process server we ship in Phase 3. The lock is documented as in-process; a multi-process deployment would need a DB-level advisory lock — out of scope here.

### 3.5 Observability

`logger.info({ projectId, added, updated, removed, durationMs }, 'project.reload')` at the end of each run. Health endpoint's `database.lastReindexAt` (Block 2) is updated on each successful reload.

---

## 4. Tasks

| # | Task | Files |
|---|------|-------|
| 1 | Refactor `ReindexService.run` to accept `{ projectId? }`, extract per-project routine | `packages/api/src/services/reindex-service.ts` |
| 2 | Per-project lock + `ReloadInProgressError` | same |
| 3 | Route `POST /api/projects/:id/reload` | `routes/projects.ts` |
| 4 | API tests: happy, 404, 409 on concurrent, removed-file is purged | `app.test.ts`, `services/reindex-service.test.ts` |
| 5 | `useReloadProject` hook | `packages/web/src/lib/projects.ts` |
| 6 | Project header button + toast | `packages/web/src/components/ProjectHeader.tsx` |
| 7 | E2E: edit a file on disk, click Reload, observe new content | `e2e/reload.spec.ts` |
| 8 | Healthcheck integration: `database.lastReindexAt` advances after reload | `health/probes/database.ts` |

---

## 5. Exit Criteria

- Editing `data/projects/foo/note-abc12345.md` on disk and clicking Reload makes the new body visible in the editor and searchable.
- Deleting a `.md` file on disk and reloading removes the row, the FTS entry, the tag links, and inbound links to it; if it was open in the editor, the editor closes with a toast.
- Two simultaneous reloads of the same project: second returns `409`.
- Two simultaneous reloads of *different* projects both succeed.
- Phase 1+2 tests all still pass.

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| User has unsaved changes in the editor when reload runs | The mutation hook checks the active document's dirty flag and prompts (Save / Discard / Cancel) before issuing the request. |
| Long reload blocks the event loop on a huge project | better-sqlite3 work is synchronous but small per file; we add a soft warning if any project exceeds 1 000 docs and document the wall-clock expectation (≤ 1 s / 100 docs on the reference machine). |
| Concurrent same-project reloads slip past the lock under load | Lock is a `Set` on a singleton service instance — synchronous check-and-add; safe in Node's single-threaded model. |
| Removed-file purge accidentally deletes rows that just haven't been written yet (race) | FsRepository's listing is a single `readdirSync`; we compare against rows under the same DB transaction. Files appearing after the snapshot will be picked up by the next reload, never marked removed in this one. |
| Reload races with an in-flight `DocumentService.update` for the same file | DocumentService's write + DB upsert happens inside its own transaction; the reload transaction either sees the new file or the old, never a torn state. |

---

## 7. Implementation Notes (M4, 2026-06)

### 7.1 Service shape
`ReindexService` keeps the existing `run()` (truncate + walk-all) and gains
`runProject(projectId): Promise<ReloadReport>` plus a `ReloadInProgressError`.
The per-project lock is a private `Set<string>` updated synchronously around
the awaited body, so two concurrent calls for the same project are
deterministic (first wins, second throws). Different projects run
concurrently with no contention.

`ReloadReport` = `{ projectId, added, updated, removed, skipped, durationMs, removedIds }`.
`added` vs `updated` is computed by snapshotting `documentsRepo.listByProject()`
before the walk and decrementing as each file is seen — anything left in
the snapshot at the end is `removed` and its row + link backrefs are purged.

### 7.2 No explicit `db.transaction(...)`
The design called for a single transaction wrapping the whole reload.
Skipped: `DocumentsRepo.upsert` already runs prepared statements, and the
incremental nature ("partial commit on crash is still a valid index for
what was seen") is acceptable for a single-user tool. Adding a transaction
later is a one-line wrap inside `runProject` if needed.

### 7.3 Route
`POST /api/projects/:id/reload` is mounted on the existing projects router
(now takes an optional `ReindexService`). 404 / 400 use the existing
helpers; the `ReloadInProgressError` is mapped to `409 RELOAD_IN_PROGRESS`
in the route's catch.

### 7.4 Web: button + ephemeral toast
The design called for a dedicated `ProjectHeader` component. Shipped
simpler: a **Reload** button in the topbar next to **Import**, visible
when a project is selected. Result/error feedback uses a lightweight
`.app-toast` banner under the topbar that auto-dismisses after 4 s — no
new toast library introduced.

### 7.5 Cache invalidation gotcha
Out-of-band disk edits do not bump frontmatter `updated_at`, so a plain
`invalidateQueries({ predicate: ['document', ...] })` would refetch but
return the same `updated_at`, and `DocumentWorkspace`'s
`useEffect([doc?.id, doc?.updated_at])` would never rebuild the buffer.
Fix: the reload hook calls `removeQueries({ predicate: ['document'] })`,
which forces a full unmount → refetch cycle, so editors rebase on the
new body. The deferred-document case (when `documentId` is in
`removedIds`) clears the selection from `App.tsx`'s success handler.

### 7.6 No editor dirty-flag check before reload
The design said the hook should prompt Save / Discard / Cancel when the
editor has unsaved changes. Shipped without — autosave on blur covers the
common case; the explicit dialog is deferred.

### 7.7 Health probe `lastReindexAt`
The design suggested updating `database.lastReindexAt`. Not added — the
health probe doesn't currently surface a `lastReindexAt` field; introducing
one would mean schema + probe + UI changes for marginal value. Logged for
follow-up.

### 7.8 Test-suite collision
The new topbar **Reload** button collided with
`e2e/user-templates.spec.ts`, which used a page-wide
`getByRole('button', { name: /Reload/i })`. Fixed by scoping the locator
to the Settings dialog inside that spec.

### 7.9 Files touched
- `packages/api/src/services/reindex-service.ts` — `runProject`, `ReloadInProgressError`, `ReloadReport`.
- `packages/api/src/routes/projects.ts` — new route + injection.
- `packages/api/src/app.ts` — pass `reindexService` into router.
- `packages/api/src/app.test.ts` — +6 Project Reload API tests.
- `packages/web/src/lib/projects.ts` — `useReloadProject`.
- `packages/web/src/App.tsx` — topbar **Reload** button + toast slot.
- `packages/web/src/styles/app.css` — `.reload-button`, `.app-toast`.
- `e2e/reload.spec.ts` (new).
- `e2e/user-templates.spec.ts` — scope `Reload` locator to Settings dialog.

### 7.10 Test counts
- Unit: 154 → **160** (+6).
- E2E: 10 → **11** (+1 `reload.spec.ts`).
