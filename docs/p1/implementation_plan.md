# Phase 1 — Implementation Plan

> Parent: [../backlogger_implementation_plan.md](../backlogger_implementation_plan.md)
> Source design: [../backlogger_design_document.md](../backlogger_design_document.md)
> Scope: Phase 1 MVP only. Non-goals from the design doc are explicitly excluded.

---

## 1. Objective

Deliver the Backlogger MVP as defined in the design document's *Phase 1 Scope* and *Success Criteria* sections: a single-user, self-hosted Markdown workspace where projects and documents can be created, edited, previewed, and persisted across restarts.

---

## 2. Lego Block Breakdown

Phase 1 is built from six independently designed "lego blocks". Each block has its own design document under [./blocks/](./blocks/) and must reach its exit criteria before the next dependent block starts.

| # | Block                  | Design Doc                                                       | Depends on |
|---|------------------------|------------------------------------------------------------------|------------|
| 0 | Foundation / Skeleton  | [block-0-foundation.md](./blocks/block-0-foundation.md)          | —          |
| 1 | Markdown Storage       | [block-1-markdown-storage.md](./blocks/block-1-markdown-storage.md) | 0       |
| 2 | Project Registry       | [block-2-project-registry.md](./blocks/block-2-project-registry.md) | 0, 1    |
| 3 | Document Types         | [block-4-document-types.md](./blocks/block-4-document-types.md)  | 1, 2       |
| 4 | Markdown Editor (UI)   | [block-3-markdown-editor.md](./blocks/block-3-markdown-editor.md) | 1, 2, 3   |
| 5 | Templates              | [block-5-templates.md](./blocks/block-5-templates.md)            | 3, 4       |

> Note: numbering follows the design doc's block list. Build order is 0 → 1 → 2 → 4 → 3 → 5, because Document Types (Block 4 in the design doc) is a cross-cutting schema concern needed before the editor UI is finalized.

---

## 3. Build Order & Milestones

Each milestone delivers a runnable, demoable slice.

### M0 — Foundation
Deliver Block 0. Walking skeleton: monorepo, Express health route, React shell, CI green.

### M1 — Storage on Disk
Deliver Block 1. `FsRepository` with safe path resolution; reindex command writes/reads `.md` files under `data/projects/`.

### M2 — Projects
Deliver Block 2. Project CRUD API + UI switcher; creating a project creates its folder skeleton.

### M3 — Typed Documents
Deliver Block 4 (Document Types). Frontmatter schema enforced; SQLite `documents` table populated via reindex and writes.

### M4 — Editor + Preview *(design doc "First Milestone")*
Deliver Block 3. CodeMirror editor + `markdown-it` preview + metadata panel; debounced save persists to disk.

### M5 — Templates
Deliver Block 5. Template loader, "New Document" dialog, all 5 templates shipped.

### M6 — Hardening
Cross-cutting: error boundaries, unsaved-changes guard, Playwright smoke test, README. No new feature work.

---

## 4. Cross-Cutting Concerns

These apply to every block and are not owned by any single one:

- **Safe path handling** — Centralized resolver rejects any path escaping `data/projects/`. Used by every filesystem call.
- **Validation** — All request bodies validated with `zod` schemas from `packages/shared/`.
- **Error shape** — `{ error: { code, message } }` everywhere.
- **Logging** — `pino` JSON logs at the API boundary; child loggers per request id.
- **Atomic writes** — Temp-file + `rename` for every `.md` write; metadata upsert in a single SQLite transaction.
- **Theming** — Dark mode is the default theme; a light theme is available as an alternative. Implemented via CSS variables on a `data-theme` attribute on `<html>`. Choice persisted in `localStorage` and respected on first paint to avoid a flash of light content. Block 0 ships the variable scaffolding; Block 3 ships the toggle.
- **Tests** — Each block ships unit tests for its services/repositories and at least one API or component test.

---

## 5. Definition of Done (Phase 1)

The phase is complete when all of the following hold:

1. All six block design docs are implemented and their per-block exit criteria are met.
2. The design doc's *Success Criteria* are demonstrably satisfied:
   - Documents can be created, edited, saved.
   - Markdown previews render.
   - Projects can be created.
   - Templates can be generated.
   - Data survives restart.
3. `npm install && npm run db:migrate && npm run dev` works on a fresh clone.
4. CI green: lint, typecheck, unit, API, Playwright smoke.
5. `data/` directory contains the entire app state and can be copied as a backup.

---

## 6. Out of Scope

Everything in the design doc's *Non-Goals* and *Phase 2/3/4* sections. Changes to scope require an updated design doc and a new implementation plan revision.
