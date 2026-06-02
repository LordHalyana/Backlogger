---
id: 1e1c6a8d-9763-473d-8b69-c2af3323b285
title: "Block 2 — Project Registry"
project: backlogger-docs
type: design_doc
status: archived
created_at: "2026-05-30T07:02:10.170Z"
updated_at: "2026-05-30T10:27:23.838Z"
tags: ["p1"]
---

# Block 2 — Project Registry

> Parent: [../implementation_plan.md](../implementation_plan.md)
> Depends on: Blocks 0, 1.
> Delivers: CRUD for projects via SQLite + filesystem, exposed over the API and a minimal UI switcher.

---

## 1. Purpose

Introduce the "project" as the top-level organizational unit. Each project has a metadata row and a folder skeleton on disk.

---

## 2. Scope

In scope:
- SQLite bootstrap with `better-sqlite3` and a migration runner.
- `projects` table (schema v1).
- `ProjectService` orchestrating `MetadataRepository` + `FsRepository`.
- REST routes: `GET/POST /api/projects`, `GET/PUT/DELETE /api/projects/:id`.
- React `ProjectSwitcher` component + "New Project" modal.
- `DELETE` removes both row and folder (with confirmation in UI).

Out of scope: documents (Block 4), templates (Block 5), editor (Block 3).

---

## 3. Design

### 3.1 SQLite setup

- DB file: `data/backlogger.sqlite`.
- Migrations: numbered `.sql` files in `migrations/`. A `schema_version` row tracks the applied version.
- `npm run db:migrate` applies pending migrations.

### 3.2 `projects` table (v1)

```sql
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
```

### 3.3 Validation (zod, in `packages/shared`)

```ts
const ProjectId = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/);

const CreateProject = z.object({
  id: ProjectId,
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});

const UpdateProject = CreateProject.partial().omit({ id: true });
```

### 3.4 Service semantics

- **Create:** insert row, then `ensureProjectSkeleton(id)`. If filesystem step fails, delete the row.
- **Delete:** delete row first (cascades to future `documents`), then `removeProject(id)` on disk. If disk step fails, log a warning; reindex will reconcile.
- **Update:** only mutable fields; bump `updated_at`.

### 3.5 UI

- `ProjectSwitcher`: dropdown listing projects, "+ New Project" item opens a modal with `id`, `name`, `description`.
- Selecting a project navigates to `/projects/:id`.

---

## 4. Tasks

1. Add `better-sqlite3` dependency and DB bootstrap module (singleton).
2. Implement migration runner + `0001_init.sql` containing `projects` and `schema_version`.
3. Implement `MetadataRepository.projects.*` (find, list, insert, update, delete).
4. Implement `ProjectService` with the semantics above.
5. Wire Express router `/api/projects` with zod validation and error mapping.
6. Add API tests (Supertest) for happy paths and validation errors.
7. Build `ProjectSwitcher` + "New Project" modal in React.
8. Add react-query hooks: `useProjects`, `useCreateProject`, `useDeleteProject`.

---

## 5. Exit Criteria

- A user can create, list, rename, and delete projects from the UI.
- Folder skeleton appears on disk on create and is removed on delete.
- `npm run db:migrate` is idempotent.
- API tests cover validation, duplicate id, and not-found cases.

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| DB/filesystem drift on partial failure | Two-phase create with rollback; reindex as recovery. |
| Accidental project deletion | UI confirmation modal requires typing the project id. |
| Long-lived DB handle in dev reload | Single-process singleton; close on `SIGINT`. |

---

## 7. Implementation Notes

**Status:** ✅ Complete (M2).

### What shipped
- SQLite bootstrap with `better-sqlite3` 12.x, WAL mode, foreign keys ON, and a numbered-`.sql` migration runner ([packages/api/src/db/database.ts](../../../packages/api/src/db/database.ts)).
- Migration [migrations/0001_init.sql](../../../migrations/0001_init.sql) creates `projects` and `schema_version`.
- `ProjectsRepo` over `better-sqlite3` prepared statements ([packages/api/src/db/projects-repo.ts](../../../packages/api/src/db/projects-repo.ts)).
- `ProjectService` with two-phase create (insert row → ensure folder; rollback row on FS failure) and delete (row first, FS best-effort) ([packages/api/src/services/project-service.ts](../../../packages/api/src/services/project-service.ts)).
- Shared zod schemas + DTO types in [packages/shared/src/projects.ts](../../../packages/shared/src/projects.ts) and an `ApiErrorBody` shape in [packages/shared/src/errors.ts](../../../packages/shared/src/errors.ts).
- Express `/api/projects` router with full CRUD + zod validation ([packages/api/src/routes/projects.ts](../../../packages/api/src/routes/projects.ts)).
- Centralized error middleware mapping `HttpError` and `FsRepoError` to JSON responses ([packages/api/src/error-middleware.ts](../../../packages/api/src/error-middleware.ts), [packages/api/src/errors.ts](../../../packages/api/src/errors.ts)).
- App composition root ([packages/api/src/context.ts](../../../packages/api/src/context.ts)); `server.ts` now opens the DB, runs migrations, and registers a `SIGINT/SIGTERM` shutdown hook to close it cleanly.
- `scripts/migrate.ts` + `npm run db:migrate` ([scripts/migrate.ts](../../../scripts/migrate.ts)).
- 13 new Supertest cases for `/api/projects` covering happy paths, validation, 404, 409, and disk side-effects ([packages/api/src/app.test.ts](../../../packages/api/src/app.test.ts)).
- Web: `apiFetch` wrapper with typed `ApiError` ([packages/web/src/lib/api.ts](../../../packages/web/src/lib/api.ts)), react-query hooks `useProjects`, `useCreateProject`, `useUpdateProject`, `useDeleteProject` ([packages/web/src/lib/projects.ts](../../../packages/web/src/lib/projects.ts)), and a `ProjectSwitcher` component with a "New Project" modal and a confirm-by-typing delete button ([packages/web/src/components/ProjectSwitcher.tsx](../../../packages/web/src/components/ProjectSwitcher.tsx)).
- Theming extended: modal and form controls use the existing CSS variables ([packages/web/src/styles/app.css](../../../packages/web/src/styles/app.css)).

### Deviations from the design
- **`better-sqlite3` v12, not v11.** Node 24 on the dev machine has no prebuilt binary for `better-sqlite3` 11.x and the gyp build fails; 12.x ships prebuilds for Node 24. API is identical for our usage. CI still pins Node 20 (which has prebuilds for both).
- **Description column is nullable.** Design said "optional"; the SQLite column is `TEXT` (nullable) and the API returns `null` (not `undefined`) for absent descriptions. Shared `ProjectSchema` reflects this.
- **Project id minimum length is 2.** The shared zod regex (`/^[a-z0-9][a-z0-9-]{1,62}$/`) requires at least 2 characters. Single-char ids are intentionally rejected so the slug can't collide with common filesystem entries.
- **No project list endpoint pagination.** All projects come back in one response; acceptable while the workspace is single-user.
- **Delete confirmation in the UI uses `window.prompt`.** Functional but not pretty; will be replaced with a proper modal during M6 hardening.
- **DB handle is a request-scoped singleton via the `AppContext`** rather than a hidden module-level singleton, so tests can pass `':memory:'` and a custom `migrationsDir`.

### Verification (local)
- `npm run db:migrate` — schema version 1.
- `npm run typecheck` — pass.
- `npm run lint` — pass (0 warnings).
- `npm test` — 60/60 pass (47 from Block 1 + 13 new).
- `npm run build` — pass; vite bundle 188 KB (60 KB gzip).

### Follow-ups for later blocks
- Block 4 will add migration `0002_documents.sql`, the `documents` table, the document API surface, and the reindex endpoint. The `MetadataRepository` will grow a `documents` namespace next to `projects`.
- Replace `window.prompt` delete confirmation with a styled modal during M6.
- Audit warnings remain from Block 0 install; defer to M6.
