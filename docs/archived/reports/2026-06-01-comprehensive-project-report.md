# Backlogger — Comprehensive Project Report

*Date: 2026-06-01 · After Phase 4 Block 1 (Folder Management)*

---

## 1. Executive Summary

Backlogger is a self-hosted, single-user Markdown workspace for capturing ideas, writing
design documents, implementation plans, and backlogs. It ships as a TypeScript monorepo with
an Express API, a React + CodeMirror UI, SQLite metadata, and a filesystem-as-source-of-truth
storage model.

Four phases of work have been completed. The project is production-ready for a solo developer
or small home-lab setup. All tests are green.

| Metric | Value |
|--------|-------|
| Unit / integration tests | **184 passing** across 9 test files |
| E2E tests (Playwright) | **14 passing** across 10 spec files |
| Source code (TS/TSX, non-test) | ~8 600 lines |
| CSS | ~1 500 lines |
| SQLite migrations | 5 |
| Built-in document templates | 5 |
| Help pages | 8 |
| Search p95 latency (1 k docs) | 4.57 ms (budget 100 ms) |
| Initial JS bundle (gzip) | ~127 kB (budget 200 kB) |

---

## 2. Goals and Design Principles

### Primary goals (from the original design document)

- Store, read, update, and delete Markdown files organized by project.
- Provide a three-panel editor (tree · editor · preview/metadata).
- Support typed documents (idea, note, design doc, plan, backlog item, finding).
- Generate documents from templates.
- Link documents together with wiki-style `[[Title]]` syntax.
- Full-text search across all documents.
- Organize documents by tag.
- Import and export raw `.md` files.
- Be monitorable by an external system (Home System integration).

### Non-goals (remain deferred)

- Multi-user collaboration and RBAC.
- Git synchronization.
- Real-time or live editing between clients.
- AI-assisted generation.
- Knowledge graphs.
- Kanban / project execution tracking.
- Notifications and workflow automation.

### Guiding principles

1. **Filesystem is source of truth.** The SQLite database stores only metadata and derived
   indexes; it can be fully rebuilt from disk at any time via `npm run reindex` or the
   in-app Reload button.
2. **Boring technology choices.** Express, React, CodeMirror 6, better-sqlite3, zod, Vite —
   well-understood, well-documented, minimal magic.
3. **Small vertical slices.** Each milestone delivers a runnable, demoable behaviour.
4. **No premature features.** Only what is needed now; the non-goal list is respected strictly.

---

## 3. Architecture

### 3.1 Repository layout

```text
Backlogger/
├── packages/
│   ├── shared/        # zod schemas, types, markdown renderer, wiki-link parser
│   ├── api/           # Express 4 server
│   └── web/           # React 18 + Vite 5 SPA
├── e2e/               # Playwright specs (chromium)
├── migrations/        # Hand-written SQL migrations (5 files)
├── scripts/           # CLI utilities (reindex, seed, bench, bundle-audit)
├── docs/              # Design docs, implementation plans, status reports
└── data/              # Runtime data — gitignored, the full app state
    ├── projects/      # Markdown files on disk
    ├── templates/     # User-defined templates (optional)
    └── backlogger.sqlite
```

### 3.2 Technology stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | Node.js 20 LTS | Long support cycle. |
| Backend | Express 4 | Minimal, well-understood. |
| Language | TypeScript 5.5 strict + composite | Safe refactors; shared types across API/web. |
| Database | SQLite via better-sqlite3 | Zero-config, synchronous, file-based. |
| Schema validation | zod | Single source of type + validation truth. |
| Markdown parsing | gray-matter (frontmatter) + markdown-it | Lightweight, predictable. |
| Frontend | React 18 StrictMode + Vite 5 | Fast dev loop. |
| State management | TanStack Query 5 | Cache, invalidation, mutation lifecycle. |
| Editor | CodeMirror 6 (markdown mode) | Embeddable, accessible. |
| Testing | Vitest 1.6 + Supertest | Single runner across FE/BE. |
| E2E | Playwright 1.60 (chromium) | Reliable, fast. |

### 3.3 Backend layers

```text
HTTP (Express routers)
  └─ Services
       ├─ ProjectService         — CRUD for projects
       ├─ DocumentService        — CRUD + link/tag rebuild on every write
       ├─ ImportService          — batch .md ingestion, dedup by content hash
       ├─ SearchService          — FTS5 prefix-AND queries with snippets
       ├─ LinkService            — wiki-link index maintenance
       ├─ TagsService            — tag normalization + document_tags table
       ├─ ReindexService         — per-project or global rebuild from disk
       ├─ TemplateRegistry       — built-ins + user overrides, hot-reload
       └─ HealthService          — subsystem probes, 2 s cached
            └─ Repositories
                 ├─ FsRepository           — read/write .md files, path guards,
                 │                           folder management
                 └─ MetadataRepository     — documents, links, tags, FTS triggers
```

### 3.4 Frontend components

```text
App
├─ ProjectSwitcher           — project selector in topbar
├─ CommandPalette            — Ctrl/Cmd+K global search overlay
├─ ImportDialog              — file picker + folder placement
├─ SettingsDialog            — theme toggle, template reload
├─ HelpDrawer                — ? button → chapter-based help drawer
├─ TagExplorer               — sidebar, tag counts, AND filter
├─ ProjectTree               — grouped by folder, collapsible, Manage mode
│   └─ NewDocumentDialog     — type + folder + template + title
└─ DocumentWorkspace         — three-panel editor workspace
    ├─ DocumentEditor        — CodeMirror 6, debounced 800 ms save
    ├─ DocumentPreview       — markdown-it HTML, relative-link interception
    └─ MetadataPanel         — title, status, tags, backlinks, delete, export
```

### 3.5 SQLite schema

```
projects          id, name, description, created_at, updated_at
documents         id, project_id, title, type, status, path, tags,
                  body_indexed, created_at, updated_at
documents_fts     FTS5 virtual table (title, tags, body); AI/AD/AU triggers
links             source_id, target_id, target_title, target_title_norm,
                  display, position
tags              tag
document_tags     document_id, tag
```

Path stored in `documents.path` is `<projectId>/<folder>/<slug>-<short8>.md` — an arbitrary
relative path that has always supported user-managed subfolders in the DB layer.

---

## 4. Feature Inventory (by Phase)

### Phase 1 — MVP (6 blocks)

| Block | Feature | Notes |
|-------|---------|-------|
| 0 | Foundation | Express + React + Vite + SQLite bootstrap; npm workspaces; migrations; `FsRepository` with safe path resolver; auto-reindex on startup. |
| 1 | Markdown Storage | Atomic write (`write-then-rename`); `gray-matter` frontmatter; UUID `id` in every file; `buildFilename` slug. |
| 2 | Project Registry | CRUD via `GET/POST/PUT/DELETE /api/projects`; `ProjectSwitcher` UI. |
| 3 | Markdown Editor | CodeMirror 6 `oneDark` theme; debounced autosave (800 ms); `If-Match` optimistic-lock guard; 409 conflict banner; Edit / Split / Preview toggle; dark/light theme persisted in `localStorage`. |
| 4 | Document Types | Six types; `DocumentSummarySchema` / `DocumentSchema` via zod; type-aware `NewDocumentDialog`; type badges in tree. |
| 5 | Templates | 5 built-ins (design doc, implementation plan, idea expansion, risk assessment, findings report); user templates from `data/templates/`; hot-reload via Settings; collision warning when user file overrides built-in. |
| 6 | Hardening | `ErrorBoundary`; `beforeunload` guard; modal dialog utility (`useDialog`); toast notifications; `BACKLOGGER_DATA_DIR` env var; `PathOutsideDataDirError` / symlink guard. |

### Phase 2 — Search · Linking · Tags · Templates · Hardening (5 blocks)

| Block | Feature | Notes |
|-------|---------|-------|
| 1 | Full-text Search | FTS5 `documents_fts`; prefix-AND semantics; `GET /api/search?q=&projectId=&limit=`; ranked snippets; `CommandPalette` (Ctrl/Cmd+K); 200 ms debounce. **p95 = 4.57 ms** on a 1 k-doc corpus. |
| 2 | Document Linking | `[[wiki-link]]` inline rule in `@backlogger/shared`; `links` table with `target_title_norm`; autocomplete in editor; delegated click handler in preview; Backlinks panel in MetadataPanel; rename re-resolution; `GET /api/documents/:id/backlinks`. |
| 3 | Tag Explorer | `TagSchema` (kebab-case transform + dedup); `tags` + `document_tags` tables; `TagsService`; `GET /api/tags?projectId=`; `TagExplorer` sidebar; chip input in MetadataPanel; AND-filtered tree. |
| 4 | User-defined Templates | User templates stored in `data/templates/` with `template_id:` frontmatter; hot-reload without restart; displayed in `SettingsDialog` with source badges; available in `NewDocumentDialog` filtered by type. |
| 5 | Hardening | Playwright wired into CI; e2e specs for search, links, tags, user-templates; perf bench (`npm run bench`); bundle audit (`npm run bundle-audit`); initial gzip ~127 kB. |

### Phase 3 — Integration · Portability · Usability (6 blocks)

| Block | Feature | Notes |
|-------|---------|-------|
| 1 | Home System Integration | External monitoring service polls `GET /health`; renders Backlogger subsystem tile with status badges. |
| 2 | Expanded Health Endpoint | `GET /health` returns `{status, api, database, storage, templates, fts, version, uptime, checked_at}`; aggregate = worst subsystem; JSON Schema at `GET /health/schema`; 2 s cache. |
| 3 | Markdown Import | Topbar **Import** button; drag-and-drop or file picker; folder placement; dedup by content hash; frontmatter `id` round-trip; `POST /api/projects/:id/import`; joins search/link/tag indexes. |
| 4 | Markdown Export | Toolbar **Download** streams the raw `.md` bytes including frontmatter; byte-faithful for unedited files. |
| 5 | Help & Documentation Center | Topbar `?` button opens a chapter-based drawer; 8 help pages (Markdown basics, wiki-links, tags, search, templates, projects, import/export); deep-link via `?help=<slug>`. |
| 6 | Project Reload | Topbar **Reload** triggers `POST /api/admin/reindex/:projectId`; reconciles external filesystem edits without server restart; toast on completion. |

### Phase 4 — Dogfooding Improvements (ongoing)

| Block | Feature | Notes |
|-------|---------|-------|
| 1 | Folder Management | Arbitrary user-managed folder hierarchy per project; `FolderPathSchema` (depth ≤ 8, segment regex); `GET/POST/DELETE /api/projects/:id/folders`; sidebar Manage mode with `×` delete buttons; `NewDocumentDialog` Folder combobox with inline `+ New folder…`; collapsible folder groups in tree. |
| — | Preview link interception | Relative `.md` links in `DocumentPreview` now open the target Backlogger document instead of navigating the browser; fallback `.broken` class when the target is not in the same project. |
| — | Folder collapse | Each folder group in the sidebar is collapsible; caret `▸/▾` + doc count badge; state held in React `useState` (not persisted). |

---

## 5. API Reference

### Base: `http://127.0.0.1:3333`

#### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Subsystem health. 200 ok/degraded, 503 error. |
| `GET` | `/health/schema` | JSON Schema for the health response. |

#### Projects

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects` | List all projects. |
| `POST` | `/api/projects` | Create project `{id, name, description?}`. |
| `PUT` | `/api/projects/:id` | Update project name/description. |
| `DELETE` | `/api/projects/:id` | Delete project + all documents (cascade). |

#### Folders

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/:id/folders` | List folders `string[]`. |
| `POST` | `/api/projects/:id/folders` | Create folder `{folder}` → 201. Idempotent. |
| `DELETE` | `/api/projects/:id/folders/*` | Delete folder by path → 204 / 404 / 409. |

#### Documents

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/:id/documents` | List summaries; `?tag=t1,t2` for AND filter. |
| `POST` | `/api/projects/:id/documents` | Create `{title, type, folder?, status?, tags?, template?, body?}`. |
| `GET` | `/api/documents/:id` | Full document including body. |
| `PUT` | `/api/documents/:id` | Update `{title?, body?, status?, tags?}`; `If-Match` required. |
| `DELETE` | `/api/documents/:id` | Delete document. |
| `GET` | `/api/documents/:id/backlinks` | Documents that `[[link]]` to this one. |

#### Search & Tags

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/search` | `?q=&projectId=&limit=` → ranked hits with snippets. |
| `GET` | `/api/projects/:id/titles` | All `{id, title}` pairs for wiki-link autocomplete. |
| `GET` | `/api/tags` | `?projectId=` → `{tag, count}[]` for TagExplorer. |

#### Import / Templates / Reindex

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/projects/:id/import` | Batch import `{files: [{filename, content, folder?}]}`. |
| `GET` | `/api/templates` | `?type=` → list templates. |
| `POST` | `/api/admin/reindex` | Global reindex. |
| `POST` | `/api/admin/reindex/:projectId` | Per-project reindex (used by Reload button). |

---

## 6. Data Flow: Document Write

```text
User edits in CodeMirror (debounced 800 ms)
  → PUT /api/documents/:id  (If-Match: <updated_at>)
      → DocumentService.update()
           → FsRepository.write()         write .md + frontmatter to disk
           → MetadataRepository.upsert()  update documents row + body_indexed
           → DocumentsFTS triggers        AI/AD/AU update documents_fts
           → LinkService.rebuildForDocument()   update links table
           → TagsService.rebuildForDocument()   update document_tags table
  ← 200 Document (new updated_at)
  → TanStack Query: setQueryData + invalidate documents list
```

On any failure after disk write, the service rolls back by deleting the
just-written file, keeping disk and DB in sync.

---

## 7. Storage Model

```text
data/
├── backlogger.sqlite            ← metadata, FTS index, link graph, tags
├── projects/
│   └── <project-id>/
│       ├── ideas/               ← legacy type→subdir buckets (kept for back-compat)
│       ├── design-docs/
│       ├── implementation-plans/
│       ├── backlog/
│       ├── notes/
│       └── <user-defined>/      ← arbitrary nested folders (Phase 4)
│           └── <slug>-<8hex>.md
└── templates/                   ← user-defined templates (optional)
```

**Backup:** `cp -r data/ /path/to/backup` — that is the entire application state.

**Recovery:** delete `backlogger.sqlite`, restart the server, or run `npm run reindex`.
The database is rebuilt from frontmatter in every `.md` file.

Every `.md` file is self-describing:

```yaml
---
id: 3f2504e0-4f89-11d3-9a0c-0305e82c3301
title: Block 1 — Folder Management
project: backlogger-docs
type: design_doc
status: active
created_at: "2026-06-01T00:00:00.000Z"
updated_at: "2026-06-01T00:00:00.000Z"
tags: ["phase-4", "blocks"]
---

# Block 1 — Folder Management
...
```

---

## 8. Security Model

- **Path resolver** (`packages/api/src/fs/path-resolver.ts`): all document and folder paths are
  normalized, checked for `..` sequences, verified to stay within `data/`, and
  symlink-checked (`assertNoSymlinks`) before any read or write.
- **Zod validation** at every API boundary; malformed requests return `400
  VALIDATION_FAILED` before any filesystem or database operation.
- **No authentication.** Backlogger is explicitly designed for single-user LAN use.
  The API is not exposed to the internet by default (`BACKLOGGER_HOST=0.0.0.0` is LAN-only in
  practice).
- **CORS** via `BACKLOGGER_ALLOWED_ORIGINS`; defaults to `*` for dev convenience; lock to a
  specific origin for production.
- **Content policy:** `dangerouslySetInnerHTML` is used for the markdown preview but the
  renderer (`markdown-it`) is configured without raw HTML, limiting injection vectors to
  crafted link hrefs — mitigated by the preview's click handler which only follows `.md`
  relative links.

---

## 9. Developer Experience

### Scripts

| Command | What it does |
|---------|-------------|
| `npm run dev` | API + web in parallel watch mode. |
| `npm test` | Vitest across all packages (~1.8 s). |
| `npm run test:e2e` | Playwright chromium suite (~6 s). |
| `npm run build` | Build all workspaces. |
| `npm run typecheck` | `tsc -b --noEmit` across the monorepo. |
| `npm run lint` | ESLint, zero warnings. |
| `npm run format` | Prettier write. |
| `npm run db:migrate` | Apply SQL migrations. |
| `npm run reindex` | CLI: walk `data/` and rebuild metadata. |
| `npm run bench` | Search latency: p50 / p95 / p99 on 1 k docs. |
| `npm run bundle-audit` | Assert initial JS gzip ≤ 200 kB. |
| `npx tsx scripts/seed-docs-project.ts` | Seed the `backlogger-docs` project from `docs/`. |

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `BACKLOGGER_HOST` | `0.0.0.0` | API bind address. |
| `BACKLOGGER_PORT` | `3333` | API listen port. |
| `BACKLOGGER_WEB_PORT` | `5173` | Vite dev server port. |
| `BACKLOGGER_DATA_DIR` | `./data` (relative to `packages/api/`) | Data directory. |
| `BACKLOGGER_TEMPLATES_DIR` | `packages/api/templates` | Built-in templates dir. |
| `BACKLOGGER_ALLOWED_ORIGINS` | `*` | CORS allow-list. |

---

## 10. Test Coverage

### Unit / integration (Vitest)

| File | Tests | What it covers |
|------|------:|----------------|
| `packages/shared/src/wiki-link.test.ts` | 12 | `[[wiki-link]]` parser; `normalizeWikiTitle`; edge cases. |
| `packages/api/src/fs/path-resolver.test.ts` | 33 | Path sanitization, symlink guard, folder path assertions. |
| `packages/api/src/fs/repository.test.ts` | 21 | FS read/write/delete/list; folder create/delete/list. |
| `packages/api/src/templates/registry.test.ts` | 9 | Built-in loading, user overrides, collision warning. |
| `packages/api/src/services/health-service.test.ts` | 4 | Subsystem probe aggregation. |
| `packages/api/src/app.test.ts` | 92 | Full HTTP API integration (all routes, error cases, folder API). |
| `packages/web/src/lib/dialog.test.tsx` | 3 | `useDialog` / `useConfirm` hook. |
| `packages/web/src/components/DocumentWorkspace.test.tsx` | 1 | Save / conflict banner smoke. |
| `packages/web/src/components/HelpDrawer.test.tsx` | 9 | Chapter switching, deep-link, Esc close. |
| **Total** | **184** | |

### E2E (Playwright chromium)

| Spec | Tests | Scenario |
|------|------:|---------|
| `smoke.spec.ts` | 1 | Create project, create doc from template, edit, reload — content intact. |
| `search.spec.ts` | 2 | Unique phrase opens correct doc; Ctrl+K opens palette and Esc closes. |
| `links.spec.ts` | 1 | `[[wiki-link]]` creates backlink on target document. |
| `tags.spec.ts` | 2 | Tag filter narrows tree; Clear restores full list. |
| `user-templates.spec.ts` | 2 | User template appears after Reload; Settings lists templates with badges. |
| `import.spec.ts` | 1 | Topbar Import ingests a `.md` file via the file picker. |
| `export.spec.ts` | 1 | Download button streams the raw Markdown. |
| `reload.spec.ts` | 1 | Topbar Reload picks up an out-of-band edit on disk. |
| `help.spec.ts` | 2 | `?` opens drawer, chapters switch, Esc closes; `?help=tags` deep-link. |
| `folders.spec.ts` | 1 | Create folder, place doc in it, verify, delete folder once empty. |
| **Total** | **14** | |

---

## 11. Performance Budgets

| Metric | Budget | Measured |
|--------|--------|---------|
| Initial JS bundle (gzip) | 200 kB | ~127 kB |
| Search p95 (1 k docs, dev machine) | 100 ms | **4.57 ms** |
| Health endpoint response | 50 ms total | Cached 2 s |

---

## 12. Known Limitations and Deferred Work

| Item | Notes |
|------|-------|
| Folder rename / move | Users create a new folder and move files manually on disk, then Reload. |
| Drag-and-drop document reorganization | Deferred; creation-time folder placement covers most of the need. |
| `window.prompt` / `window.confirm` in folder UI | Works but is visually inconsistent; proper inline dialogs are a follow-up. |
| Folder collapse not persisted | Collapsed state is in-memory; resets on page reload. |
| E2E suite is chromium-only | Firefox / WebKit not wired up. |
| No template edit UI | The file on disk is the editor, by design. |
| Filesystem watcher for live external edits | Explicit non-goal; per-project Reload button is the mechanism. |

---

## 13. Roadmap

The design doc reserves capability phases for when they are genuinely needed:

| Phase | Theme | Status |
|-------|-------|--------|
| P1 | MVP — storage, editor, types, templates | ✅ Complete |
| P2 | Search, linking, tags, user templates, hardening | ✅ Complete |
| P3 | Integration, portability, usability (import/export, health, help, reload) | ✅ Complete |
| P4 | Dogfooding improvements (folder management, preview links, collapse) | ✅ In progress |
| P5 | Git synchronization / knowledge graphs | Not started |
| P6 | AI-assisted generation | Not started |
| P7 | Multi-user, RBAC, team workspaces | Not started |

---

## 14. Reference Documents

| Document | Path |
|----------|------|
| Design overview | [design/overview.md](../design/overview.md) |
| Roadmap / implementation plan | [design/roadmap.md](../design/roadmap.md) |
| Phase 1 plan | [p1/implementation_plan.md](../p1/implementation_plan.md) |
| Phase 2 plan | [p2/implementation_plan.md](../p2/implementation_plan.md) |
| Phase 3 plan | [p3/implementation_plan.md](../p3/implementation_plan.md) |
| Phase 4 plan | [p4/implementation_plan.md](../p4/implementation_plan.md) |
| Folder management block | [p4/blocks/block-1-folder-management.md](../p4/blocks/block-1-folder-management.md) |
| Operations / monitoring | [operations/monitoring.md](../operations/monitoring.md) |
| Status 2026-05-31 | [reports/2026-05-31-status.md](./2026-05-31-status.md) |
| Status 2026-06-01 (folder management) | [reports/2026-06-01-folder-management.md](./2026-06-01-folder-management.md) |
