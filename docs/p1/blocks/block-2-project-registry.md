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
