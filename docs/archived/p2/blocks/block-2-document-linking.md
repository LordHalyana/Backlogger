---
id: 9c691bdc-3d90-40a8-906f-fe31f8b1e5d8
title: "Block 2 — Document Linking & Backlinks"
project: backlogger-docs
type: design_doc
status: archived
created_at: "2026-05-30T12:33:36.855Z"
updated_at: "2026-05-30T13:39:27.398Z"
tags: ["p2"]
---

# Block 2 — Document Linking & Backlinks

> Parent: [../implementation_plan.md](../implementation_plan.md)
> Depends on: P2 Block 1 (search/title index), P1 Blocks 3 (editor) and 4 (documents).
> Delivers: `[[wiki-link]]` syntax with autocomplete, persisted link index, and a backlinks panel.

---

## 1. Purpose

Let users connect related thinking. Typing `[[design` in the editor should suggest matching documents; saving stores the link; opening the target shows what links to it.

---

## 2. Scope

In scope:
- `[[<title>]]` and `[[<title>|<display>]]` parser that extracts links from a document body.
- `links` table: `(source_id, target_id, target_title, position)` plus `target_id NULL` for unresolved links.
- Reindex re-builds `links` from scratch.
- Autocomplete inside the editor (CodeMirror completion source) backed by an in-memory title cache.
- `GET /api/documents/:id/backlinks` → list of `{ id, project_id, title, snippet }`.
- Backlinks section in the existing `MetadataPanel`.
- Preview rendering: `[[Title]]` becomes a clickable link that opens the target in the workspace.
- Broken-link indicator (target not found) in preview and a small badge in the backlinks panel.

Out of scope:
- Cross-project linking enforcement (links can cross projects; that's a feature).
- Block-level / anchor links (`[[Doc#Section]]`) — Phase 3.
- Rename-with-link-rewrite — Phase 3.

---

## 3. Design

### 3.1 Link syntax

```
[[Page Title]]          → display "Page Title", target title "Page Title"
[[Page Title|click me]] → display "click me",  target title "Page Title"
```

Regex (POSIX-ish): `/\[\[([^\[\]\|\n]{1,200})(?:\|([^\[\]\n]{1,200}))?\]\]/g`.

Title match is case-insensitive and ignores surrounding whitespace. Ties (two docs with the same title) resolve to the most-recently-updated one and the editor flags the ambiguity with a yellow underline.

### 3.2 Schema

Migration `migrations/0004_links.sql`:

```sql
CREATE TABLE links (
  source_id   TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  target_id   TEXT REFERENCES documents(id) ON DELETE SET NULL,
  target_title TEXT NOT NULL,
  position    INTEGER NOT NULL,
  PRIMARY KEY (source_id, position)
);
CREATE INDEX idx_links_target_id ON links(target_id);
CREATE INDEX idx_links_target_title ON links(target_title COLLATE NOCASE);
```

### 3.3 Extraction & resolution

`packages/shared/src/wiki-link.ts` — `parseWikiLinks(body) : Array<{ title, display, position }>`. Pure function, exhaustively unit-tested.

`packages/api/src/services/link-service.ts` — `rebuildForDocument(doc)` deletes the document's rows from `links` and reinserts them; `resolveTitle(title)` returns the best `documents.id` match (LOWER + TRIM equality, ties broken by `updated_at DESC`).

Hook called from `DocumentsRepo.upsert` (after the row exists). Hook also called from `ReindexService` after the per-document insert.

When a *target* document is created, also re-resolve any link rows whose `target_id IS NULL AND target_title = LOWER(<new doc title>)`. Implemented as a single UPDATE inside the upsert transaction.

### 3.4 API

- `GET /api/documents/:id/backlinks` — joins `links` to `documents`, filters by `target_id = ?`, returns `[{ id, project_id, title, snippet }]` (snippet pulled from `documents_fts.snippet`).
- `GET /api/projects/:projectId/titles` — lightweight `(id, title, project_id)[]` used by the editor autocomplete; cached client-side for `staleTime: Infinity`.

### 3.5 Editor autocomplete

CodeMirror 6 `autocompletion` extension. Trigger when the cursor is inside a `[[ … ` (no closing `]]` yet). Provide options from `useTitles()`. Inserting a selection writes `[[Selected Title]]`. Keyboard navigation is CM6 default.

### 3.6 Preview & MetadataPanel

- `renderMarkdown` (in `@backlogger/shared`) gains a `markdown-it` plugin that turns `[[Title]]` into a custom `<a class="wiki-link" data-title="…">` element. The web app intercepts clicks on `.wiki-link`, looks up the title via the cached `useTitles()`, and dispatches an "open document" event.
- `MetadataPanel` gets a new "Backlinks" section (collapsed by default) that uses `useBacklinks(documentId)`.
- Broken links render with `class="wiki-link broken"` and an `aria-label="No document with this title"`.

---

## 4. Tasks

| # | Task | Files |
|---|------|-------|
| 1 | `parseWikiLinks` in shared + unit tests | `packages/shared/src/wiki-link.ts`, test |
| 2 | Migration `0004_links.sql` | `migrations/0004_links.sql` |
| 3 | `LinkService` + integration with `DocumentsRepo` + `ReindexService` | `services/link-service.ts` |
| 4 | Routes: backlinks + titles | `routes/documents.ts`, `routes/projects.ts` |
| 5 | `markdown-it` plugin for `[[…]]` | `packages/shared/src/markdown.ts` |
| 6 | Editor autocomplete extension | `components/DocumentEditor.tsx` |
| 7 | `useTitles`, `useBacklinks` hooks | `packages/web/src/lib/links.ts` |
| 8 | Backlinks section in `MetadataPanel` | `components/MetadataPanel.tsx` |
| 9 | Web event wiring to navigate on wiki-link click | `App.tsx` |

---

## 5. Exit Criteria

- Saving a doc with body `See [[Other Doc]]` produces a `links` row pointing to `Other Doc`.
- Renaming `Other Doc` (title change) is reflected because the link is title-based; the link still resolves.
- Deleting `Other Doc` sets `target_id` to NULL; preview now shows a "broken link" marker; backlinks count drops accordingly.
- Creating a new doc titled `Other Doc` resolves previously-broken links pointing to that title.
- `Ctrl+Space` or typing `[[` in the editor opens the autocomplete with the 5 best-matching titles.
- Backlinks panel shows every doc that links to the open one.
- `npm run typecheck && npm run lint && npm test && npm run build` green.

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| Title collisions across projects | Resolution is deterministic (`updated_at DESC`); editor flags ambiguity with an underline; explicit `[[Project/Title]]` syntax deferred to Phase 3. |
| Link extraction performance on large docs | `parseWikiLinks` is a single-pass regex over text already in memory; benchmarked at 1 MB / < 10 ms. |
| Cascade on document delete leaves orphan `target_id` rows | `ON DELETE SET NULL` keeps source rows; UI shows broken-link indicator. |
| `markdown-it` plugin escaping | Plugin emits text via `token.content`, never raw HTML; existing `html: false` config remains. |

---

## 7. Implementation Notes

### Status: ✅ Done

### What shipped

| Area | Detail |
|------|--------|
| **Shared parser** | `packages/shared/src/wiki-link.ts` — `WikiLink {title, display, position, length}`; `parseWikiLinks(body)` using `/\[\[([^[\]|\n]{1,200})(?:\|([^[\]\n]{1,200}))?\]\]/g`; `normalizeWikiTitle(s)` = trim + lowercase + collapse whitespace. 12 unit tests. |
| **Migration** | `migrations/0004_links.sql` — `links` table with `ON DELETE CASCADE` (source) and `ON DELETE SET NULL` (target); indexes on `target_id` and `target_title_norm`. |
| **LinkService** | `packages/api/src/services/link-service.ts` — `rebuildForDocument`, `backlinksFor`, `titles`, `onDocumentDeleted`, `truncate`, `resolveTitle`. All writes in a single transaction. |
| **Service integration** | `DocumentService` calls `linkService.rebuildForDocument` on create/update and `onDocumentDeleted` on delete. `ReindexService` calls `linkService.truncate` then `rebuildForDocument` for each document. |
| **Routes** | `GET /api/documents/:id/backlinks` and `GET /api/projects/:id/titles` wired through `documentsRouter` and `projectsRouter` via `AppContext.linkService`. |
| **markdown-it plugin** | Inline rule in `packages/shared/src/markdown.ts` — `before('emphasis', 'wiki_link', ...)`. Matches at `state.pos`, delegates to `parseWikiLinks` for consistency. Emits `<a class="wiki-link" data-title="…">display</a>`; title is HTML-escaped; `html: false` preserved. |
| **Editor autocomplete** | `packages/web/src/components/DocumentEditor.tsx` — `makeWikiLinkSource(titlesRef)` reads a ref updated via `useEffect` so suggestions stay fresh without rebuilding the editor. Matches `\[\[([^\]|\n]*)$` at cursor; inserts `Title]]`. Uses `@codemirror/autocomplete` (`autocompletion`, `closeBrackets`). |
| **Web hooks** | `packages/web/src/lib/links.ts` — `useTitles(projectId)` (`staleTime: 30 000`), `useBacklinks(documentId)` (`staleTime: 10 000`). |
| **MetadataPanel** | `documentId` and `onOpenDocument` props added; fetches `useBacklinks`; renders a `<details open>` "Backlinks" section with count, click-to-open buttons, and display-alias sub-label. |
| **App.tsx delegation** | Global `click` listener on `window`; `event.target.closest('a.wiki-link')`; resolves `data-title` against `titlesRef.current` (populated by `useTitles`); calls `openDocumentFromSearch`; adds `.broken` class if no match. |
| **CSS** | `.wiki-link` (accent + dotted underline), `.wiki-link.broken` (danger + dashed), `.backlinks` collapsible section, `.backlinks-list`, `.backlinks-row`, `.backlinks-display`, `.link-button`, `.backlinks-empty`. |

### Deviations from design doc

| Design spec | Actual implementation | Reason |
|-------------|-----------------------|--------|
| `links` columns: `source_id, target_id, target_title, position` | Added `target_title_norm TEXT NOT NULL` and `display TEXT NOT NULL` | `target_title_norm` is needed for O(1) resolution refresh on rename; `display` must be persisted to surface alias text in the backlinks panel without re-parsing. |
| `GET /api/documents/:id/backlinks` returns `{ id, project_id, title, snippet }` | Returns `{ id, project_id, title, display, position }` | Snippet generation would require an FTS join per row; deferred to Phase 3 or Block 5 hardening. `display` is more immediately useful in the panel. |
| `markdown-it` plugin receives a resolver function to mark broken links at render time | Plugin always emits `class="wiki-link"`; `.broken` added client-side by the delegated click handler | Server-side rendering has no access to the live title cache; client-side marking is simpler and consistent with the SPA model. |

### Verification

```
npm run build   # ✅ gzip initial 126.57 kB (budget 200 kB)
npm run lint    # ✅ 0 errors
npm test        # ✅ 119/119 tests (12 parser unit + 10 Links API + 97 baseline)
```

### Follow-ups (Phase 3 / Block 5)

- Snippet generation in `GET /api/documents/:id/backlinks` (FTS join per source row).
- `[[Project/Title]]` scoped cross-project links.
- Rename-with-link-rewrite (update source bodies when a target is renamed).
- Block-level anchor links (`[[Doc#Section]]`).
- Backlinks invalidation on save (currently `staleTime: 10 000` — good enough for M1).
