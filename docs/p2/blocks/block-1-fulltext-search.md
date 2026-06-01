# Block 1 — Full-text Search

> Parent: [../implementation_plan.md](../implementation_plan.md)
> Depends on: Phase 1 Blocks 1, 2, 4 (filesystem, projects, documents).
> Delivers: cross-project full-text search backed by SQLite FTS5, plus a command-palette UI.

---

## 1. Purpose

Make every document discoverable. A user typing "rate limit" should see every doc that mentions the phrase, ranked by relevance, with a snippet around the match.

---

## 2. Scope

In scope:
- SQLite `documents_fts` virtual table (FTS5) over `title`, `tags`, `body`.
- Triggers to keep `documents_fts` in sync with `documents` on insert / update / delete.
- Reindex pass rebuilds the FTS table from scratch when the table is empty or `--full` is passed.
- `GET /api/search?q=<text>&projectId=<id?>&limit=<n?>` returning `{ id, project_id, title, type, snippet, rank }[]`.
- Web command palette (`Ctrl/Cmd+K`) — input field, debounced query, results list with keyboard navigation, "open" on Enter.
- Topbar "Search" button as a discoverable entrypoint.

Out of scope:
- Search highlighting inside the editor.
- Boolean operators beyond what FTS5 ships (we expose the raw `MATCH` query but recommend simple terms).
- Per-user saved searches.

---

## 3. Design

### 3.1 Schema

New migration `migrations/0003_search.sql`:

```sql
CREATE VIRTUAL TABLE documents_fts USING fts5(
  id UNINDEXED,
  project_id UNINDEXED,
  title,
  tags,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER documents_ai AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts(id, project_id, title, tags, body)
  VALUES (new.id, new.project_id, new.title, new.tags, new.body);
END;

CREATE TRIGGER documents_ad AFTER DELETE ON documents BEGIN
  DELETE FROM documents_fts WHERE id = old.id;
END;

CREATE TRIGGER documents_au AFTER UPDATE ON documents BEGIN
  DELETE FROM documents_fts WHERE id = old.id;
  INSERT INTO documents_fts(id, project_id, title, tags, body)
  VALUES (new.id, new.project_id, new.title, new.tags, new.body);
END;
```

`body` is added to `documents` (currently the table stores metadata only — body lives on disk). Two options:
- **Option A (chosen):** add a `body_indexed` column to `documents` that holds a copy of the body just for the trigger to pick up. Updated on every write through `DocumentsRepo`. Cheap, no virtual-table reads on writes.
- Option B: insert directly into `documents_fts` from `DocumentService` after the disk write. Rejected because reindex would then duplicate the logic.

Migration `0003_search.sql` adds the column with `DEFAULT ''`, then the triggers above.

### 3.2 Reindex changes

`ReindexService.run` already wipes and re-populates `documents`. Add a step that wipes `documents_fts` and lets the triggers refill it. Sanity check: after reindex, `SELECT count(*) FROM documents` equals `SELECT count(*) FROM documents_fts`.

### 3.3 API

`packages/api/src/services/search-service.ts`:

```ts
export interface SearchHit {
  id: string;
  project_id: string;
  title: string;
  type: DocumentType;
  snippet: string;   // 1–2 line snippet, FTS5 snippet() with <mark> tags stripped
  rank: number;
}
class SearchService {
  search(q: string, opts: { projectId?: string; limit?: number }): SearchHit[];
}
```

Route at `packages/api/src/routes/search.ts`: `GET /api/search` → `400 SEARCH_QUERY_REQUIRED` for empty `q`; otherwise returns up to `limit` (default 50, max 200) hits ordered by `rank` ascending (lower = better in FTS5).

Snippet via `snippet(documents_fts, 4, '[[', ']]', '…', 12)` then sanitized to plain text (we render it as plain text in the UI; no HTML escaping risk).

### 3.4 Web

- `packages/web/src/lib/search.ts` — `useSearch(query, opts)` debounced 200 ms.
- `packages/web/src/components/CommandPalette.tsx` — modal portal (uses Block-6 `DialogProvider` for backdrop styling, not the imperative API), `<input>` + virtualized results list (`<ul>` is fine for ≤ 200), arrow keys + Enter to navigate, Esc to close.
- Global hotkey: `Ctrl+K` / `Cmd+K` opens it, `Esc` closes it.
- Selecting a result calls `props.onOpen(projectId, documentId)`; `App.tsx` sets both pieces of state.

### 3.5 Performance

Bench corpus: 1,000 documents, ~2 KB each (synthetic). Target p95 ≤ 100 ms for a 2-term query. Measured via a `scripts/bench-search.ts` script that seeds the corpus and times 100 queries.

---

## 4. Tasks

| # | Task | Files |
|---|------|-------|
| 1 | Migration: `body_indexed`, `documents_fts`, triggers | `migrations/0003_search.sql` |
| 2 | `DocumentsRepo` writes `body_indexed` on create/update; reindex too | `db/documents-repo.ts`, `services/reindex-service.ts` |
| 3 | `SearchService` + Zod request schema | `services/search-service.ts`, `packages/shared/src/search.ts` |
| 4 | Route `GET /api/search` + tests | `routes/search.ts`, `app.test.ts` |
| 5 | `useSearch` hook | `packages/web/src/lib/search.ts` |
| 6 | `CommandPalette` component + global hotkey | `packages/web/src/components/CommandPalette.tsx`, `App.tsx` |
| 7 | Bench script | `scripts/bench-search.ts` |

---

## 5. Exit Criteria

- A document containing "foo bar" is returned by `/api/search?q=foo` and `/api/search?q="foo bar"`.
- Deleting a document removes it from results within the same request that performed the delete.
- Reindex from disk produces an FTS row count equal to the documents row count.
- `Ctrl+K` opens the palette; results update as the user types; Enter opens the selected doc.
- Bench: p95 ≤ 100 ms on the 1k-document corpus.
- `npm run typecheck && npm run lint && npm test && npm run build` green.

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| FTS5 not compiled into `better-sqlite3` on some hosts | Add a startup check (`SELECT * FROM pragma_compile_options() WHERE compile_options LIKE '%FTS5%'`) and fail fast with a clear message. |
| Index drift if a write bypasses `DocumentsRepo` | All writes go through the repo today; add a test that asserts a direct `documents` UPDATE without FTS sync produces an inconsistency that reindex fixes. |
| Snippet rendering injects user content unsafely | Snippet is rendered as plain text into a React node; FTS5 markers (`[[`, `]]`) are stripped, no HTML. |
| Large body bloats the DB | Acceptable for Phase 2 (target corpus 1k×2 KB ≈ 2 MB); Phase 3 considers an external index. |

---

## 7. Implementation Notes

**Status:** ✅ Done.

### What shipped

- **Migration [migrations/0003_search.sql](../../../migrations/0003_search.sql)** — adds a `body_indexed TEXT NOT NULL DEFAULT ''` column to `documents`, creates the `documents_fts` virtual table (`tokenize = 'unicode61 remove_diacritics 2'`), and the AI/AD/AU triggers. The FTS table sees `id`, `project_id`, `title`, the JSON-stringified `tags`, and the body via `body_indexed`.
- **DocumentsRepo** ([packages/api/src/db/documents-repo.ts](../../../packages/api/src/db/documents-repo.ts)) — `DocumentUpsertInput` gained a required `body: string` field; the upsert writes it to `body_indexed`. All four call sites (DocumentService create/update + ReindexService) pass it through.
- **Shared schema [packages/shared/src/search.ts](../../../packages/shared/src/search.ts)** — `SearchHitSchema`, `SearchRequestSchema`, and the constants `SEARCH_DEFAULT_LIMIT = 50`, `SEARCH_MAX_LIMIT = 200`.
- **SearchService [packages/api/src/services/search-service.ts](../../../packages/api/src/services/search-service.ts)** — `buildFtsQuery` strips FTS5-reserved characters (`"()*:^-`), splits on whitespace, and joins terms with implicit-AND prefix matching (`foo* bar*`). Optional `projectId` filter is a parameterised `AND documents_fts.project_id = ?`. Snippet via `snippet(documents_fts, 4, '[[', ']]', '…', 12)` with the `[[`/`]]` markers stripped before returning. Malformed FTS5 queries surface as `400 SEARCH_QUERY_INVALID`; empty post-clean queries surface as `400 SEARCH_QUERY_REQUIRED`.
- **Route [packages/api/src/routes/search.ts](../../../packages/api/src/routes/search.ts)** — `GET /api/search?q=&projectId=&limit=` validated via `SearchRequestSchema` (with `z.coerce.number()` for the limit query param).
- **Context / app wiring** — `searchService` added to `AppContext`; `searchRouter` mounted at `/api/search` before the admin router in [packages/api/src/app.ts](../../../packages/api/src/app.ts).
- **API tests** — 9 new specs in [packages/api/src/app.test.ts](../../../packages/api/src/app.test.ts) (`describe('Search API', …)`) cover missing-q, no-searchable-terms, single-term, AND, prefix, project filter, snippet sanitization, limit, delete-removes-hit, and reindex parity (`documents` count == `documents_fts` count).
- **Web hook [packages/web/src/lib/search.ts](../../../packages/web/src/lib/search.ts)** — `useSearch(query, { projectId?, limit?, debounceMs = 200 })`; skips fetching while the trimmed query is < 2 chars; `staleTime: 30_000`.
- **Web component [packages/web/src/components/CommandPalette.tsx](../../../packages/web/src/components/CommandPalette.tsx)** — portaled modal, focuses the input on open, arrow-key navigation with auto-scroll, mouse-hover updates selection, Enter opens, Esc/backdrop closes. Status line is `aria-live="polite"`.
- **App integration [packages/web/src/App.tsx](../../../packages/web/src/App.tsx)** — global `Ctrl/Cmd+K` listener toggles the palette; new topbar "Search" button with platform-aware `⌘+K` / `Ctrl+K` kbd hint. Selecting a hit sets the active project, then schedules `setSelectedDocumentId(documentId)` on the next tick so the project-change `useEffect` doesn't clobber it.
- **Styles [packages/web/src/styles/app.css](../../../packages/web/src/styles/app.css)** — new `.search-button`, `.command-palette*` rules; CSS gzip grew 2.19 → 2.50 kB.
- **Bench [scripts/bench-search.ts](../../../scripts/bench-search.ts)** — seeds N synthetic docs into a temp data dir/DB, runs M two-term queries, reports p50/p95/p99. `--p95-budget=<ms>` flag fails the run when exceeded. Run: `npx tsx scripts/bench-search.ts --docs=1000 --queries=100 --p95-budget=100`.

### Deviations from the design

- **Query semantics** — The plan described "the raw `MATCH` query" as the contract; in practice we sanitize and prefix-AND user input. This protects against accidental FTS5 syntax errors (a quote or a colon in the query string) and gives "type as you search" the natural feel users expect. Power-users can still phrase multi-word queries; quoted phrase search is a Phase-3 add-on.
- **Body storage location** — Stored as `documents.body_indexed` (Option A from §3.1). The trigger reads from the new column, not from the body that lives on disk. No `body` row in `documents` was added because the existing summary endpoints would otherwise leak the full body.
- **Web command palette modal** — Implemented as its own portal rather than reusing the `DialogProvider`. The provider's confirm/prompt/toast API didn't fit the long-lived input + results list shape, and reuse would have required widening the provider's surface area. Backdrop styling and z-index match the existing dialogs.
- **Startup FTS5-compile check** — Skipped; `better-sqlite3@12` ships FTS5 in its bundled SQLite. If a future build drops FTS5 the first reindex throws an obvious "no such module: fts5" error, which is acceptable.

### Verification

- `npm run build` — green, gzip initial 125.68 kB (under 200 kB budget; +1.30 kB from the palette + button).
- `npm run lint` — green.
- `npm test` — 97/97 (was 87 pre-block; added 9 search API tests, kept the existing web/dialog suite as-is + 1 pre-existing DocumentWorkspace integration test).
- Bench (`--docs=1000 --queries=100`): p50 = 3.84 ms, **p95 = 4.57 ms**, p99 = 5.89 ms. Budget 100 ms, met with ~20× headroom.

### Follow-ups

- Quoted phrase search (`"rate limit"` as a literal phrase) — defer to Phase 3.
- Surface a "no results — try fewer terms" hint distinguishing "0 hits" from a query that became empty after sanitization.
- Once Block 2 (linking) lands, augment the palette with a "Linked from" affordance on each row.
- Wire the bench script into CI as a non-blocking job in Block 5 (Hardening).
