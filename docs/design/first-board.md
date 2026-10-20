<!-- Mirror of the spec issue: https://github.com/LordHalyana/Backlogger/issues/13 — the issue is authoritative. -->

# Spec: first Kanban board for backlog items

Source map: Wayfinder: evolve Backlogger into a local personal Kanban workspace (#1). Inspected revision `b714742`. Every rule below traces to a resolved decision ticket; this spec restates them as one contract. If this spec and a decision ticket disagree, the ticket wins and this spec is corrected.

## Problem

Backlog items (`type: backlog_item`) are Markdown documents with a lifecycle `status` (draft/active/archived) but no notion of work progress. The user wants to manage them on a three-column board inside the existing project workspace. The board must not alter legacy files, mounted documentation, or recoverability.

## Scope

Frontmatter-mode projects only. One local user. A board per project.

### Task state (#11, #6)
- Frontmatter key `task_state`, values exactly `todo` | `in_progress` | `done`, written immediately after `status`.
- Columns: **To do**, **In progress**, **Done**. Any-to-any moves.
- New backlog items (blank or template) are written with `task_state: todo`.
- Absent or unrecognised values parse without error, display as To do, and are preserved byte-for-byte until a state change. Legacy files stay byte-identical through read and reindex.
- `task_state` on non-backlog types is ignored by the board, preserved, and never written. Setting it on a non-backlog document returns 400.
- Write path: the existing `PUT /api/documents/:id` accepts optional `task_state` (recognised values only, else 400), and `POST` create accepts it too. The usual stale-revision 409 rules apply. A missing `If-Match` is still accepted *(decided in #12)*; the editor and the board always send it.
- Import: new/copy carry the value verbatim, replace overwrites only when the incoming file has one, and skip does nothing. Raw export is unchanged.

### Board content and order (#7, #10)
- Shows every non-archived `backlog_item` in the project, drafts included (with a Draft badge).
- Excludes archived items and **sidecar-mode** projects' items.
- Order within a column: `created_at` ascending, tie-break by document ID. Nothing is persisted for order, and a moved card takes its creation-order place.
- Read-only/mounted projects: cards are shown and marked read-only. They cannot be dragged, moved by keyboard, or archived (409 `PROJECT_READ_ONLY`).
- Board read *(decided in #12)*: `GET /api/projects/:projectId/board` returns `{ columns: { todo, in_progress, done } }` of card summaries (id, title, tags, status, readOnly, revision, raw `task_state`). Column assignment and ordering happen server-side, so the API tests own the rule. Not an extension of the document list.

### Archive lifecycle (#7)
- Done ≠ archived. Reaching Done never archives, and archiving never changes `task_state`.
- Archiving any card removes it from the board. Archiving a non-Done card means it is abandoned.
- Restore keeps the ID and `task_state`. The card returns to its column at its creation-order place.

### Interaction (#9)
- **View switch:** a `Documents | Board` SegmentedControl at the top of the project sidebar, above the tree. *(decided in #12)*
- **URLs** *(decided in #12)*:
  - `/projects/:id` → Documents (the default when picking a project)
  - `/projects/:id/board` → Board
  - `/projects/:id/board/documents/:docId` → existing editor with a "Back to board" control; survives refresh and Back
  - `/projects/:id/documents/:docId` → editor without a back link (unchanged)
- Columns replace the document pane, and the tree stays in the sidebar. Opening a card shows the existing editor in place.
- Moves: drag-and-drop between columns. Keyboard: a focused card with Alt+←/→ steps to the adjacent column, and Enter opens it.
- Per-card "Saving…" badge while a move is in flight; further moves of that card are disabled meanwhile.
- **Archive on Done cards** with an Undo notice. Undo is a **real restore call** (`PUT status: active` with the new revision), not a delayed commit. If Undo gets a 409, the conflict banner shows. *(decided in #12)*
- Rejected/conflicting save: the card returns to its previous column, and a conflict banner says the move was not saved.
- States: loading placeholder; an empty-board message that mentions `backlog_item`.

## Delivery order
Prerequisites P1 → P2 come first for every write slice. The read-only board slice S1 may proceed in parallel *(decided in #12)*.

## Out of scope (first board)
Manual ordering, priority, card creation from the board, filters, WIP limits, sidecar-mode items, archived items on the board, bulk archive, Blocked/Cancelled/Backlog states, preserving arbitrary unknown frontmatter keys, GitHub integration, teams/hosting.

## Test boundaries (#10)
1. HTTP API tests on real temp storage, in a new test file, with `setup()`/`teardown()` extracted into a shared test-support module. No tests of services, SQL or private methods.
2. The on-disk Markdown is a contract: byte-level assertions for the eight #11 boundaries.
3. Reindex leaves the board unchanged. A fresh DB over the same data dir plus reindex gives the same IDs, states and order.
4. Stale `If-Match` → 409 with the file unchanged. Plus a barrier overlap regression (wrap `ctx.fs.read` on the test's own context) where exactly one request gets 200 and one gets 409. No production test hook.
5. Playwright, each test in its own project: (1) switch → legacy item in To do; (2) drag → reload → persisted; (3) Alt+→; (4) Archive → Undo; (5) disk edit then move → snap back + banner; (6) read-only project.
6. RTL component tests: loading, empty, Saving…, Draft badge.
7. Sidecar item absent from the board. Read-only move/archive is refused and the file is unchanged.
Outside the boundary: the file watcher, real process restart, crash recovery, multi-process writers.

## Known limitations
- Autosave can still drop newer editor input during a delayed save (write-safety outcome 2). This is not a board prerequisite and is recommended as a follow-up issue.
- Shared-sidecar lost update persists. Sidecar mode is off the board.
- An in-process queue assumes a single server process per data dir.
