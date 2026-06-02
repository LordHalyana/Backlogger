# Block 5 — Templates

> Parent: [../implementation_plan.md](../implementation_plan.md)
> Depends on: Blocks 3, 4.
> Delivers: built-in document templates and a "New Document" dialog that uses them.

---

## 1. Purpose

Reduce friction when starting a new document by providing opinionated, pre-filled Markdown skeletons.

---

## 2. Scope

In scope:
- Built-in template files shipped with the app.
- Template loader that reads them at startup.
- `GET /api/templates` and `GET /api/templates/:id`.
- `POST /api/projects/:projectId/documents` accepts an optional `template` id and uses it to seed `body`.
- React "New Document" dialog: pick type, then pick template, then enter title.
- Placeholder substitution: `{{title}}`, `{{date}}`, `{{project}}`.

Out of scope: user-defined templates, template editing UI, parameterized templates beyond the three placeholders.

---

## 3. Design

### 3.1 Template files

Location: `packages/api/templates/*.md`. Each file is a normal Markdown file with frontmatter declaring metadata about the template itself:

```md
---
template_id: design-document
template_name: Design Document
type: design_doc
---

# {{title}}

> Project: {{project}}
> Created: {{date}}

## Purpose
...
```

Templates do **not** include document `id`, `created_at`, etc.; those are added by `DocumentService` at creation time.

### 3.2 Initial template set

| id                    | name                  | type                  |
|-----------------------|-----------------------|-----------------------|
| `design-document`     | Design Document       | `design_doc`          |
| `implementation-plan` | Implementation Plan   | `implementation_plan` |
| `idea-expansion`      | Idea Expansion        | `idea`                |
| `risk-assessment`     | Risk Assessment       | `finding`             |
| `findings-report`     | Findings Report       | `finding`             |

### 3.3 Loader

At startup, scan `packages/api/templates/`, parse each file with `gray-matter`, validate template frontmatter (zod), and hold in memory. Reload on `SIGHUP` (optional; nice-to-have).

### 3.4 Placeholder substitution

Naive string replace at document creation:
- `{{title}}` → user-provided title.
- `{{project}}` → project id.
- `{{date}}` → `YYYY-MM-DD` in local time.

Unknown placeholders are left untouched.

### 3.5 API

```http
GET /api/templates
→ [{ id, name, type }]

GET /api/templates/:id
→ { id, name, type, body }
```

`POST /api/projects/:projectId/documents` now accepts:

```ts
{ title: string; type: DocumentType; status?: Status; tags?: string[]; template?: string }
```

If `template` is provided, its `type` must match the request's `type` (server enforces).

### 3.6 UI

`NewDocumentDialog`:
1. Pick document type (radio).
2. Choose template (list filtered by type, plus a "Blank" option).
3. Enter title.
4. Submit → navigate to the new document's editor route.

---

## 4. Tasks

1. Author the five template `.md` files.
2. Implement `TemplateLoader` + zod validation of template frontmatter.
3. Implement template API routes.
4. Extend `DocumentService.create` to accept and apply a template.
5. Implement placeholder substitution helper + unit tests.
6. Build `NewDocumentDialog` in React.
7. Wire dialog from `ProjectTree` "+ New Document" action.

---

## 5. Exit Criteria

- All five templates load on startup and are listed by `GET /api/templates`.
- Creating a "Design Document" produces a `.md` file with the rendered template body and substituted placeholders.
- Type/template mismatch returns 400.
- E2E smoke: create project → create design doc from template → edit → reload → content intact.

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| Template drift between repo and shipped artifact | Templates loaded from the package directory; covered by a CI test that asserts the five expected ids load. |
| Placeholder injection via title | Substitution is plain string replace into Markdown source; rendered output is sanitized by `markdown-it` defaults (no raw HTML). |
| Future user templates | Loader API is extensible; document the path forward in the block's "Future" note (not implemented in MVP). |

## 7. Implementation Notes

### Status
✅ Done. 84/84 tests passing (5 registry + 6 templates API added). Lint, typecheck, and build all clean.

### What shipped
- 5 built-in templates under `packages/api/templates/` loaded at startup:
  - `design-document.md` (type `design_doc`) — Purpose / Goals / Design / Alternatives / Risks / Open Questions.
  - `implementation-plan.md` (type `implementation_plan`) — Objective / Scope / Build Order / Exit Criteria / Risks.
  - `idea-expansion.md` (type `idea`).
  - `risk-assessment.md` (type `finding`) — risks table.
  - `findings-report.md` (type `finding`) — Summary / Investigation / Findings / Recommendations.
- `packages/shared/src/templates.ts` — `TemplateIdSchema` (kebab-case), `TemplateSummarySchema`, `TemplateSchema`, `TemplateFrontmatterSchema`. Re-exported from package index.
- `packages/api/src/templates/registry.ts` — `TemplateRegistry` (`list/get/getOrThrow/setAll`), `loadTemplatesFromDir` (skips invalid frontmatter and reports the reason), `defaultTemplatesDir()` (resolves `packages/api/templates/` from compiled output), `applyPlaceholders` (regex `/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi`; supports `{{title}}`, `{{project}}`, `{{date}}` — local-time `YYYY-MM-DD`; unknown placeholders left untouched).
- `packages/api/src/routes/templates.ts` — `GET /api/templates` (sorted by name) and `GET /api/templates/:id` (404 `TEMPLATE_NOT_FOUND`).
- `DocumentService.create` — when `template` is provided: resolves via registry, enforces `tpl.type === parsed.type` (else 400 `TEMPLATE_TYPE_MISMATCH`), then substitutes placeholders into the body before writing.
- `context.ts` / `app.ts` / `server.ts` wired: server resolves `process.env.BACKLOGGER_TEMPLATES_DIR ?? defaultTemplatesDir()`, loads at startup, logs `loaded/skipped/dir`.
- `packages/web/src/lib/templates.ts` — `useTemplates()` (React Query, `staleTime: Infinity`).
- `packages/web/src/components/NewDocumentDialog.tsx` rewritten — Type → Template → Title flow, "Blank" option, templates filtered by selected type, resets to Blank when type changes.

### Deviations from the original plan
- No SIGHUP/runtime reload; restart to pick up template changes (acceptable for MVP).
- User-defined templates not implemented — left as a follow-up.
- `{{date}}` uses local time (not UTC).
- `app.test.ts` `TEMPLATES_DIR` resolves with a single `..` from `src/` to `packages/api/templates/` (one level, not two).

### Verification
- `npm run typecheck` ✅
- `npm run lint` ✅
- `npm test` → 84/84 ✅ (`packages/api/src/templates/registry.test.ts` 5 tests; `packages/api/src/app.test.ts` Templates API block adds 6 tests: list, get, 404, create-with-placeholders, type mismatch, unknown template id)
- `npm run build` ✅

### Follow-ups (rolled into M6 Hardening)
- Playwright smoke covering "create project → create design doc from template → edit → reload → content intact" (matches §5 exit criterion).
- Replace `window.prompt` / `confirm` with a real modal.
- Code-split CodeMirror to address the 853 kB bundle warning.
- Preview toggle in editor.
- Reindex UI surface for `POST /api/admin/reindex`.
- Allow user-defined templates from a `data/templates/` directory.
