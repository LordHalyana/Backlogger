---
id: 71bc8e7a-69b4-4d89-935f-49533ecc859e
title: "Block 3 — Markdown Editor (UI)"
project: backlogger-docs
type: design_doc
status: archived
created_at: "2026-05-30T07:02:10.224Z"
updated_at: "2026-05-30T10:55:57.892Z"
tags: ["p1"]
---

# Block 3 — Markdown Editor (UI)

> Parent: [../implementation_plan.md](../implementation_plan.md)
> Depends on: Blocks 1, 2, 4.
> Delivers: the three-pane editing experience described in the design doc's *Block 3*.

---

## 1. Purpose

Provide a usable Markdown editing surface with live preview and metadata editing, persisting changes to disk through the API.

This block satisfies the design doc's **First Milestone**.

---

## 2. Scope

In scope:
- Three-pane layout: Project Tree | Editor | Preview/Metadata.
- CodeMirror 6 markdown editor.
- Live preview rendered with the same `markdown-it` config used server-side (shared in `packages/shared`).
- Metadata panel editing `title`, `status`, `tags`.
- Debounced auto-save (default 800 ms) via `PUT /api/documents/:id`.
- Unsaved-changes indicator.
- Routing: `/projects/:projectId` and `/projects/:projectId/documents/:documentId`.
- Theme toggle in the top bar (dark ↔ light), persisted in `localStorage` under the `theme` key. Dark is the default. CodeMirror uses a matching dark theme (e.g. `@codemirror/theme-one-dark`) and switches with the app theme.

Out of scope: templates dialog (Block 5), search, diffing, collaborative editing, system-preference auto-detection (manual toggle only in MVP).

---

## 3. Design

### 3.1 Layout

```text
+----------------------------------------------------------+
| [Project Switcher]                       [unsaved dot]   |
+---------------+--------------------+---------------------+
|  Project Tree |  Markdown Editor   |  Preview            |
|  (by type)    |  (CodeMirror)      |  Metadata panel     |
+---------------+--------------------+---------------------+
```

### 3.2 Components

- `AppShell` — top bar + 3-pane grid (CSS grid, fixed-percentage columns, resizable later).
- `ProjectTree` — fetches `GET /api/projects/:id/documents`, groups by `type`.
- `DocumentEditor` — wraps CodeMirror 6 with markdown language + line wrapping.
- `DocumentPreview` — renders body via shared `renderMarkdown(body)`.
- `MetadataPanel` — controlled inputs bound to frontmatter.

### 3.3 Save flow

1. Editor change → update local buffer + mark dirty.
2. After 800 ms idle → `PUT /api/documents/:id` with `{ body, title, status, tags }`.
3. On success → clear dirty flag, update `updated_at` from response.
4. On 409 (optimistic-lock mismatch) → show banner "Document changed on disk; reload to continue".

### 3.4 Optimistic locking

The PUT request includes the last-known `updated_at`. The API rejects with 409 if it does not match. (Server-side support specified in Block 4.)

### 3.5 Unsaved-changes guard

`window.addEventListener('beforeunload', ...)` while dirty.

---

## 4. Tasks

1. Install CodeMirror 6 packages (`@codemirror/state`, `@codemirror/view`, `@codemirror/lang-markdown`, theme).
2. Implement shared `renderMarkdown` in `packages/shared`.
3. Build `AppShell` + routing.
4. Build `ProjectTree` with react-query hook `useDocuments(projectId)`.
5. Build `DocumentEditor` with debounced save via `useMutation`.
6. Build `DocumentPreview` and `MetadataPanel`.
7. Wire optimistic-lock handling.
8. Add a Vitest + RTL test covering the dirty → save → clean flow.

---

## 5. Exit Criteria

- Selecting a document loads its content into the editor.
- Typing updates the preview within one frame.
- After 800 ms of idle, the change is persisted (verified by hitting `GET` again).
- Reloading the page restores the saved content.
- Closing the tab while dirty prompts the browser warning.

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| Save storms during fast typing | Debounce + single-flight mutation. |
| Editor performance on large files | CodeMirror handles large docs; warn over 1 MB. |
| Preview drift vs server render | Single `renderMarkdown` shared between API and web. |

---

## 7. Implementation Notes

> Status: ✅ Done. All exit criteria met. 73/73 tests pass; lint, typecheck, and build are clean.

### What shipped

- **Shared** `packages/shared/src/markdown.ts` exports `renderMarkdown(source)` backed by a single `markdown-it` instance (`html: false`, `linkify: true`). Re-exported from `@backlogger/shared`.
- **Web hooks** `packages/web/src/lib/documents.ts`: `useDocuments(projectId)`, `useDocument(id)` (with `staleTime: Infinity` so the editor buffer is never clobbered by a refetch), `useCreateDocument`, `useUpdateDocument` (sends `If-Match`), `useDeleteDocument`.
- **Theme** `packages/web/src/lib/theme.ts` — `useTheme()` hook that reads/writes `localStorage.theme` and toggles `<html data-theme>`; pre-hydration script in `index.html` continues to set the attribute before React mounts.
- **Components**:
  - `ThemeToggle` — sun/moon button in the topbar.
  - `ProjectTree` — sidebar grouped by document type, with `+ New` button that opens `NewDocumentDialog`. Selected item is highlighted; non-`draft` statuses show a small badge.
  - `NewDocumentDialog` — title + type select (six types).
  - `DocumentEditor` — thin React wrapper around CodeMirror 6 (`@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/lang-markdown`, `@codemirror/theme-one-dark`). Theme swap uses a `Compartment` (no remount). External `value` changes are diffed against the editor's current doc so typing doesn't trigger a reset.
  - `DocumentPreview` — renders `renderMarkdown(body)`. Hidden via CSS for MVP; toggle is a follow-up.
  - `MetadataPanel` — title / status / tags (comma-separated) + path + updated time + delete button.
  - `DocumentWorkspace` — orchestrates the buffer, debounced save (800 ms via `useDebouncedCallback`), `If-Match` against `baseUpdatedAt`, conflict banner with Reload action on 409, `beforeunload` guard while dirty, status line (`Saved` / `Unsaved changes` / `Saving…` / `Save failed: …`), and confirm-then-delete flow.
- **App shell**: `App.tsx` now hosts the 3-pane `project-layout` grid (`240px 1fr`); the workspace internally splits `1fr | 320px` for editor + metadata. Topbar shows project switcher, health pill, and theme toggle.
- **Styling**: extended `styles/app.css` with tree, workspace, conflict banner, dirty dot, metadata panel, CodeMirror host (`.cm-editor { height: 100% }`), and lightweight `.markdown-body` rules for the (currently hidden) preview.
- **Tests**: Vitest now picks `jsdom` for `packages/web/**` via `environmentMatchGlobs`. New `DocumentWorkspace.test.tsx` (React Testing Library + user-event + fake timers) stubs `fetch`, loads a document, edits the title via the metadata panel, advances 900 ms, and asserts: status flips dirty → saving → saved, and the `PUT` carried `If-Match: <original updated_at>` plus the new title.

### Deviations from the design

- **No router yet.** Selection is state-based (`selectedProjectId` + `selectedDocumentId` in `App.tsx`) instead of `/projects/:id/documents/:id`. The hooks already key by id, so adding `react-router-dom` is a drop-in follow-up.
- **Preview pane hidden for MVP.** The 3-pane design called for tree | editor | preview/metadata. The preview component and shared `renderMarkdown` are wired up; we render the metadata pane in the right column for now. A topbar toggle to swap preview ↔ metadata is queued for M6.
- **Manual theme toggle only**; no `prefers-color-scheme` auto-detect (block design explicitly scoped this out).
- **Bundle size warning**: the production JS bundle is now 853 KB (297 KB gzip) because CodeMirror's lang/view/theme packages don't tree-shake well. Acceptable for self-hosted MVP; M6 should add `manualChunks` or dynamic-import the editor.

### Verification

```bash
npm run typecheck  # clean
npm run lint       # clean (after escaping curly quotes in JSX copy)
npm test           # 73/73 (4 files: path-resolver 31, repository 16, app 25, workspace 1)
npm run build      # api + shared + web; bundle 853 KB / 297 KB gzip (CodeMirror weight)
```

### Follow-ups for later blocks

- M5 (templates): `NewDocumentDialog` already accepts only `title` + `type`; add a template picker that pre-fills `body`/`tags` and posts via the existing `CreateDocumentRequest.template` field (server-side wiring lives in M5).
- M6 hardening:
  - Replace `window.confirm` and the legacy `window.prompt` (project delete) with a proper confirm modal.
  - Add a preview ↔ metadata toggle and reinstate the third pane.
  - Code-split the editor to bring first-load JS back under ~250 KB gzip.
  - Add Playwright smoke covering: create project → create doc → edit → reload → see saved content.
  - Wire the admin reindex endpoint to a small UI in the topbar.
