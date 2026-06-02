# Phase 2 — Implementation Plan

> Parent: [../design/roadmap.md](../design/roadmap.md)
> Source design: [../design/overview.md](../design/overview.md#future-expansion)
> Predecessor: [../p1/implementation_plan.md](../p1/implementation_plan.md) — Phase 1 (✅ complete, 87/87 tests).
> Scope: Phase 2 of the design doc — full-text search, document linking, tag explorer. Plus the most-asked Phase 1 follow-up (user-defined templates) and a hardening pass that wires Playwright into CI.

---

## 1. Objective

Make the existing Markdown workspace **discoverable and connected** without changing the "filesystem is the source of truth" contract:

- A user can find any word in any document in milliseconds.
- A user can link documents (`[[wiki style]]`) and see what links to the current document.
- A user can browse documents by tag.
- A user can drop their own templates into a directory and see them in the New-Document dialog.
- The Playwright smoke spec from Block 6 (Phase 1) becomes the seed of a real e2e suite that runs in CI.

Phase 2 must remain backwards-compatible with all Phase 1 data: opening a Phase-1 `data/` directory in a Phase-2 build must work with no manual migration step beyond the auto-reindex that already runs at startup.

---

## 2. Lego Block Breakdown

Phase 2 is five independent blocks. Each has its own design document under [./blocks/](./blocks/).

| # | Block                       | Design Doc                                                                       | Depends on (P2) | Depends on (P1) |
|---|-----------------------------|----------------------------------------------------------------------------------|-----------------|-----------------|
| 1 | Full-text Search            | [block-1-fulltext-search.md](./blocks/block-1-fulltext-search.md)               | —               | 1, 2, 3 (docs)  |
| 2 | Document Linking & Backlinks | [block-2-document-linking.md](./blocks/block-2-document-linking.md)             | 1               | 3, 4            |
| 3 | Tag Explorer                | [block-3-tag-explorer.md](./blocks/block-3-tag-explorer.md)                     | —               | 3, 4            |
| 4 | User-defined Templates      | [block-4-user-templates.md](./blocks/block-4-user-templates.md)                  | —               | 5               |
| 5 | Phase 2 Hardening           | [block-5-hardening.md](./blocks/block-5-hardening.md)                            | 1, 2, 3, 4      | 6               |

> Blocks 1, 3, 4 are independent and can be picked up in any order. Block 2 builds on Block 1's link index. Block 5 is last because it tests everything.

---

## 3. Build Order & Milestones

Each milestone delivers a runnable, demoable slice. Theme remains dark by default; no UI work breaks that.

### Status

| Milestone | Block | Status         | Notes |
|-----------|-------|----------------|-------|
| M0        | 1     | ✅ Done        | FTS5-backed `documents_fts` with AI/AD/AU triggers; `body_indexed` column on `documents` keeps the index fed without re-reading disk. `SearchService` exposes prefix-AND semantics; `GET /api/search?q=&projectId=&limit=` returns ranked hits with snippets. Web: `useSearch` (debounced 200 ms), `CommandPalette` (Ctrl/Cmd+K, arrow-key nav), topbar Search button. Bench (1k docs, 100 queries): **p95 = 4.57 ms** (budget 100 ms). 9 new API tests; 97/97 green. |
| M1        | 2     | ✅ Done        | `[[wiki-link]]` parser + normalizer in `@backlogger/shared`; `links` table (with `target_title_norm` and `display` columns) maintained transactionally on every doc create/update/delete; renames re-resolve both old and new title rows; deletes set `target_id` NULL. Reindex rebuilds the table from disk. Web: CodeMirror autocomplete inside `[[…`, markdown-it renders `<a class="wiki-link" data-title>` (sanitized; preview opens via delegated click handler); MetadataPanel grew a Backlinks section. Routes: `GET /api/documents/:id/backlinks`, `GET /api/projects/:id/titles`. 22 new tests (12 parser unit + 10 API); 119/119 green; gzip initial 126.57 kB (budget 200 kB). |
| M2        | 3     | ✅ Done        | Tag normalization (`TagSchema` kebab-case transform + dedup via `normalizeTags`); `tags` + `document_tags` tables with CASCADE delete; `TagsService` (rebuildForDocument, list, truncate) wired into DocumentService + ReindexService; `GET /api/tags?projectId=` returns `{tag,count}[]`; `GET /api/projects/:id/documents?tag=` supports AND-filtered listing; frontend: `useTags`, `useFilteredDocuments`, `TagChip`, `TagExplorer` sidebar section, filter bar in `ProjectTree`, MetadataPanel chip-based tag input with `TagSchema` validation (Enter/comma/blur commits; inline error on invalid value). 7 new API tests; **126/126 green**; gzip initial 127.57 kB (budget 200 kB). |
| M3        | 4     | ✅ Done | `data/templates/<id>.md` loaded alongside built-ins; precedence rules; New / Edit / Delete template UI (file-based). |
| M4        | 5     | ✅ Done | Playwright in CI, e2e specs for search/links/tags/user-templates, perf bench, bundle audit, README + design doc updates. See [Block 5 — Implementation Notes](./blocks/block-5-hardening.md#7-implementation-notes). |

### M0 — Search
Deliver Block 1. Type a word, get results across all projects with a snippet and a click-to-open.

### M1 — Linking
Deliver Block 2. Type `[[` in the editor, get an autocomplete of document titles. Save: link is persisted. Open the linked doc: see the source in the backlinks panel.

### M2 — Tag Explorer
Deliver Block 3. Sidebar tab "Tags" lists every tag in the active project with counts; click filters the document tree.

### M3 — User Templates
Deliver Block 4. Add `data/templates/my-thing.md` (with `template_id:` frontmatter); it appears in the New-Document dialog without a restart.

### M4 — Hardening
Cross-cutting. CI runs Playwright; bundle stays below the gzip-200 kB initial-load budget set in Phase 1; design doc and README reflect Phase 2 reality.

---

## 4. Cross-Cutting Concerns

All Phase 1 cross-cutting rules still apply. New ones for Phase 2:

- **Backwards compatibility** — A Phase-1 `data/` directory must work unchanged. Any new SQLite schema arrives as a new migration file under `migrations/`; the reindex pass rebuilds derived tables (search, links, tags) from disk.
- **Derived tables are rebuildable** — `documents_fts`, `links`, `tags` (and any junction tables) are all populated by the reindex; nothing in them is canonical. Source of truth remains the Markdown file.
- **Migrations are additive only** — Phase 2 does not drop or rename Phase 1 tables. New columns get sensible defaults.
- **Filesystem watcher (deferred)** — Auto-detect external file edits is *not* in Phase 2. Reindex stays manual / startup-triggered.
- **Performance budget** — Initial JS bundle stays ≤ 200 kB gzip (Phase 1 finished at 124 kB). Search response p95 ≤ 100 ms on a 1k-document corpus on developer hardware.
- **A11y** — Command palette, autocomplete, and backlinks panel are keyboard-navigable; focus management reuses the Block 6 dialog primitives.

---

## 5. Definition of Done (Phase 2)

The phase is complete when all of the following hold:

1. All five Phase 2 block design docs are implemented and their per-block exit criteria are met.
2. The design doc's *Phase 2* expansion list is demonstrably satisfied:
   - Full-text search returns relevant hits with snippets.
   - `[[document]]` linking works in the editor; backlinks list is populated.
   - Tag explorer shows every tag with counts and filters the tree.
3. User-defined templates (Block 4) load from disk without code changes.
4. `npm install && npm run dev` on a fresh clone still works; a Phase-1 `data/` directory mounts unchanged and the auto-reindex produces a populated search index.
5. CI green: lint, typecheck, unit/API/component tests, Playwright e2e (chromium).
6. Initial JS gzip ≤ 200 kB; search p95 ≤ 100 ms on the bench corpus.

---

## 6. Out of Scope

Everything in the design doc's *Phase 3/4* sections (Git sync, knowledge graphs, AI assistance, multi-user, RBAC) and the following Phase 2 stretch goals:

- Filesystem watcher for live external edits.
- Full WYSIWYG / rich preview while typing (current preview toggle is sufficient).
- Mobile-optimized layout (LAN access on a phone works but isn't designed for).
- Template editing through the UI beyond create/rename/delete (the file IS the editor).
- Multi-language tokenization in search beyond what FTS5 ships by default.

Changes to this scope require an updated design doc and a new implementation-plan revision.
