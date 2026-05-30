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
