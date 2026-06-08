---
id: bd9b2fa8-3946-4280-9f95-7ec08909cd37
title: "Backlogger — Implementation Plan"
project: backlogger-docs
type: implementation_plan
status: active
created_at: "2026-05-30T06:50:27.881Z"
updated_at: "2026-06-08T00:00:00.000Z"
tags: ["design"]
---

# Backlogger — Implementation Plan

> **Historical note:** This is the original Phase 1 MVP implementation plan, kept for history.
> It records the initial build sequence, milestones, ports, and configuration as first planned
> and is **not** a description of current behavior. For the current system, see
> [architecture.md](architecture.md), [derived-data.md](derived-data.md), and the
> [API reference](../api.md). Active analysis lives under [docs/reports/](../reports/).

> Scope: Phase 1 MVP as defined in [overview.md](overview.md).
> Target stack: Node.js + Express (backend), React + Vite (frontend), SQLite (metadata), filesystem (source of truth).

---

## 1. Guiding Principles

- **Filesystem is source of truth.** SQLite stores metadata, indexes, and derived data only; it can be rebuilt from disk at any time.
- **Small, vertical slices.** Each milestone produces a runnable end-to-end behavior.
- **Boring choices.** Pick well-understood libraries; avoid frameworks that hide the filesystem.
- **No premature features.** Strictly defer everything listed in *Non-Goals* of the design doc.
- **Self-hosted single-user.** No auth, no multi-tenancy, no realtime sync in MVP.

---

## 2. Technology Choices

| Concern              | Choice                              | Rationale |
|----------------------|-------------------------------------|-----------|
| Runtime              | Node.js 20 LTS                      | Stable, long-lived. |
| Backend framework    | Express 4                           | Minimal, well-known. |
| Language             | TypeScript (strict)                 | Safer refactors as scope grows. |
| Database             | SQLite via `better-sqlite3`         | Zero-config, synchronous, file-based. |
| Migrations           | Hand-written SQL in `migrations/`   | No ORM overhead for MVP. |
| Markdown parsing     | `gray-matter` (frontmatter) + `markdown-it` (render) | Lightweight, predictable. |
| Validation           | `zod`                               | Shared types across API boundary. |
| Frontend             | React 18 + Vite                     | Fast dev loop. |
| Editor               | CodeMirror 6 (markdown mode)        | Lightweight, embeddable. |
| Preview              | `markdown-it` (shared package)      | Same rendering server and client. |
| Styling              | Plain CSS modules + CSS variables   | No design system needed yet; CSS variables drive theming. |
| Theming              | Dark mode default, light optional   | Long reading/editing sessions — default to a low-eye-strain dark theme. |
| Testing              | Vitest + Supertest                  | Single test runner across FE/BE. |
| Lint/format          | ESLint + Prettier                   | Standard. |
| Package manager      | npm workspaces                      | Avoid extra tooling. |

---

## 3. Repository Layout

The current workspace root (`/opt/dev-local/Backlogger/`) **is** the `services/backlogger/` folder referenced in the design doc. All paths below are relative to this root; do not create an additional `services/backlogger/` subfolder inside it.

```text
Backlogger/                     # repo root == services/backlogger
├── package.json                # npm workspaces root
├── tsconfig.base.json
├── .env.example
├── data/                       # runtime data (gitignored)
│   ├── projects/               # Markdown files on disk
│   └── backlogger.sqlite       # metadata DB
├── packages/
│   ├── shared/                 # zod schemas, types, markdown utils
│   ├── api/                    # Express server
│   └── web/                    # React + Vite app
├── migrations/                 # SQL migrations
├── scripts/                    # dev/setup scripts (reindex, seed, etc.)
├── docs/                       # design doc + this plan
└── README.md
```

Rationale: separating `api` and `web` lets each be built and deployed independently while sharing types via `shared`.

---

## 4. Data Model

### 4.1 Filesystem layout

```text
data/projects/<project-id>/
├── ideas/
├── design-docs/
├── implementation-plans/
├── backlog/
└── notes/
```

- `<project-id>` is a kebab-case slug (e.g. `home-system`).
- Each document is a single `.md` file with YAML frontmatter.
- Subfolder is derived from `type` frontmatter but the filesystem path is canonical.

### 4.2 Frontmatter schema

```yaml
---
id: <uuid-v4>             # stable identifier; never changes
title: string             # required
project: string           # required; must equal containing project id
type: idea | note | design_doc | implementation_plan | backlog_item | finding
status: draft | active | archived
created_at: ISO-8601
updated_at: ISO-8601
tags: [string]            # optional
---
```

### 4.3 SQLite schema (v1)

```sql
CREATE TABLE projects (
  id            TEXT PRIMARY KEY,         -- slug
  name          TEXT NOT NULL,
  description   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE documents (
  id            TEXT PRIMARY KEY,         -- uuid from frontmatter
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  type          TEXT NOT NULL,
  status        TEXT NOT NULL,
  path          TEXT NOT NULL UNIQUE,     -- relative to data/projects
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX idx_documents_project ON documents(project_id);
CREATE INDEX idx_documents_type    ON documents(type);

CREATE TABLE schema_version (
  version INTEGER PRIMARY KEY
);
```

Notes:
- Document body is **not** stored in SQLite.
- A `reindex` command walks `data/projects/` and rebuilds the `documents` table from frontmatter.

---

## 5. Backend Architecture

### 5.1 Layers

```text
HTTP (Express routers)
  └─ Services (project-service, document-service, template-service)
        └─ Repositories
              ├─ FsRepository      (read/write .md files)
              └─ MetadataRepository (better-sqlite3 queries)
```

- Routers do request validation (`zod`) and call services.
- Services orchestrate filesystem + metadata writes atomically (write file first, then update DB; on DB failure, roll back file via temp-file + rename strategy).
- Repositories are the only modules that touch the filesystem or DB.

### 5.2 Atomic write strategy

1. Resolve target absolute path; reject any path outside `data/projects/`.
2. Write to `<file>.tmp` in the same directory.
3. `fsync` and `rename` to final path.
4. Upsert metadata row in a single SQLite transaction.
5. On failure after step 3, mark dirty in an in-memory log; `reindex` is the recovery path.

### 5.3 Security (single-user, local)

- Bind to `127.0.0.1` by default; configurable via env.
- Strict path normalization to prevent traversal (`..`, absolute paths, symlinks).
- Reject filenames not matching `^[a-z0-9-_]+\.md$`.
- CORS: allow only the configured frontend origin.
- No authentication in MVP; document this clearly in the README.

---

## 6. API Specification

All responses are JSON. Errors use `{ "error": { "code": string, "message": string } }` with appropriate HTTP status.

### 6.1 Health

- `GET /health` → `{ status: "ok", version, uptime }`

### 6.2 Projects

| Method | Path                    | Body                              | Returns |
|--------|-------------------------|-----------------------------------|---------|
| GET    | `/api/projects`         | —                                 | `Project[]` |
| POST   | `/api/projects`         | `{ id, name, description? }`      | `Project` |
| GET    | `/api/projects/:id`     | —                                 | `Project` |
| PUT    | `/api/projects/:id`     | `{ name?, description? }`         | `Project` |
| DELETE | `/api/projects/:id`     | —                                 | `204` (also removes folder) |

### 6.3 Documents

| Method | Path                                              | Body                                                  | Returns |
|--------|---------------------------------------------------|-------------------------------------------------------|---------|
| GET    | `/api/projects/:projectId/documents`              | —                                                     | `DocumentSummary[]` |
| POST   | `/api/projects/:projectId/documents`              | `{ title, type, status?, template?, tags? }`          | `Document` |
| GET    | `/api/documents/:documentId`                      | —                                                     | `Document` (incl. body) |
| PUT    | `/api/documents/:documentId`                      | `{ title?, status?, tags?, body? }`                   | `Document` |
| DELETE | `/api/documents/:documentId`                      | —                                                     | `204` |

### 6.4 Templates

| Method | Path                  | Returns |
|--------|-----------------------|---------|
| GET    | `/api/templates`      | `Template[]` (id, name, type) |
| GET    | `/api/templates/:id`  | `{ id, name, type, body }`    |

### 6.5 Maintenance

- `POST /api/admin/reindex` → walks filesystem and rebuilds `documents` table. Returns counts.

---

## 7. Frontend Architecture

### 7.1 Layout (per design doc)

```text
+----------------------------------------------------------+
| [Project Switcher]                                       |
+---------------+--------------------+---------------------+
|  Project Tree |  Markdown Editor   |  Preview / Metadata |
+---------------+--------------------+---------------------+
```

### 7.2 State management

- `@tanstack/react-query` for server state (projects, documents, templates).
- Local component state for editor buffer; debounce-save (default 800 ms) via `PUT /api/documents/:id`.
- Unsaved-changes indicator and `beforeunload` guard.

### 7.3 Components (initial set)

- `AppShell` — top bar + 3-pane layout.
- `ProjectSwitcher` — dropdown + "New Project" modal.
- `ProjectTree` — folder/file tree grouped by document type.
- `DocumentEditor` — CodeMirror 6 instance.
- `DocumentPreview` — rendered markdown.
- `MetadataPanel` — frontmatter fields (title, type, status, tags).
- `NewDocumentDialog` — picks type + template.

### 7.4 Routing

- `/` → redirect to last opened project.
- `/projects/:projectId` → tree visible, no document selected.
- `/projects/:projectId/documents/:documentId` → full editor view.

---

## 8. Templates

Templates ship as `.md` files under `packages/api/templates/` and are loaded at startup.

Initial set (per design doc):

1. `design-document.md`
2. `implementation-plan.md`
3. `idea-expansion.md`
4. `risk-assessment.md`
5. `findings-report.md`

Each template:
- Has its own frontmatter declaring `type` and placeholder `title`.
- Supports `{{title}}`, `{{date}}`, `{{project}}` placeholders, substituted at document creation.

---

## 9. Configuration

`.env` (loaded via `dotenv`):

```env
BACKLOGGER_HOST=127.0.0.1
BACKLOGGER_PORT=4317
BACKLOGGER_DATA_DIR=./data
BACKLOGGER_WEB_ORIGIN=http://127.0.0.1:5173
LOG_LEVEL=info
```

All paths resolved relative to repo root unless absolute.

---

## 10. Testing Strategy

| Layer        | Tooling             | Coverage target |
|--------------|---------------------|-----------------|
| Unit         | Vitest              | Services, repositories, markdown utils |
| API          | Supertest + Vitest  | All routes, including error paths |
| Frontend     | Vitest + RTL        | Editor save flow, tree rendering |
| E2E (smoke)  | Playwright (1 spec) | Create project → create doc → edit → reload |

Test data lives under a per-test temp directory; never touches real `data/`.

---

## 11. Tooling & Quality

- ESLint (typescript-eslint, react) with `--max-warnings 0` in CI.
- Prettier on pre-commit via `lint-staged` + `husky`.
- `tsc --noEmit` in CI.
- GitHub Actions workflow: install → lint → typecheck → test → build.

---

## 12. Local Development

```bash
npm install
npm run db:migrate          # apply SQL migrations
npm run dev                 # concurrently: api (tsx watch) + web (vite)
```

Single command launches API on `:4317` and web on `:5173` with Vite proxy to the API.

---

## 13. Milestones

Each milestone is independently runnable and demoable.

### Milestone 1 — Skeleton (Walking Skeleton)
- Monorepo + workspaces set up.
- Express app with `GET /health`.
- React app rendering "Backlogger" + calling `/health`.
- CI pipeline green.

**Exit criteria:** `npm run dev` serves both apps; health check returns ok in browser.

### Milestone 2 — Filesystem + Projects
- `FsRepository` with safe path handling.
- SQLite + migrations + `projects` table.
- Project CRUD API + minimal `ProjectSwitcher` in UI.
- Creating a project creates its folder skeleton on disk.

**Exit criteria:** User can create/list projects from the UI; folders appear under `data/projects/`.

### Milestone 3 — Document CRUD
- `documents` table + reindex command.
- Document CRUD API (read/write `.md` files with frontmatter).
- `ProjectTree` lists documents grouped by type.

**Exit criteria:** Documents created via API appear in the tree and on disk; reindex rebuilds DB from disk.

### Milestone 4 — Editor + Preview (First Milestone of design doc)
- CodeMirror editor wired to debounced save.
- `markdown-it` preview pane.
- Metadata panel editing title/status/tags.

**Exit criteria:** Edit a doc, refresh page, content persists; preview updates as you type.

### Milestone 5 — Templates
- Template loader + API.
- "New Document" dialog selects type and template.
- All 5 templates ship.

**Exit criteria:** Creating a new design doc from template produces a pre-filled markdown file.

### Milestone 6 — Polish & Hardening
- Error boundaries + toast notifications.
- `beforeunload` unsaved-changes guard.
- Theme toggle (dark default, light alternative) persisted in `localStorage`.
- E2E smoke test passing.
- README with setup, backup (just copy `data/`), and restore instructions.

**Exit criteria:** All Success Criteria from the design doc are demonstrably met.

---

## 14. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Filesystem/DB drift | Tree shows stale data | `reindex` endpoint + run on startup. |
| Path traversal vulnerability | Arbitrary file write | Centralized path resolver; reject any path escaping `data/projects/`. |
| Large markdown files in editor | UI sluggish | CodeMirror handles large docs; add soft warning over 1 MB. |
| Concurrent edits (same user, two tabs) | Lost writes | Use `updated_at` as optimistic-lock token in `PUT /api/documents/:id`. |
| Backup forgotten | Data loss | README emphasizes that `data/` is the entire app state. |

---

## 15. Out of Scope (reiterated)

Anything from the design doc's **Non-Goals** and **Phase 2/3/4** sections is explicitly excluded from this plan. New scope requires an updated design doc and a follow-up implementation plan.

---

## 16. Definition of Done (MVP)

The MVP is shippable when, on a fresh clone:

1. `npm install && npm run db:migrate && npm run dev` works.
2. A user can create a project, create a document from a template, edit it, see live preview, and reload without data loss.
3. CI is green: lint, typecheck, unit, API, and the Playwright smoke test.
4. `data/` directory can be copied to back up the entire workspace.
