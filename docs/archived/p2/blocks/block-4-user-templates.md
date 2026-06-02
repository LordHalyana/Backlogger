---
id: 0567baf0-b945-4a5e-ad09-724ae497257a
title: "Block 4 — User-defined Templates"
project: backlogger-docs
type: design_doc
status: archived
created_at: "2026-05-30T12:33:37.015Z"
updated_at: "2026-05-30T14:48:45.172Z"
tags: ["p2"]
---

# Block 4 — User-defined Templates

> Parent: [../implementation_plan.md](../implementation_plan.md)
> Depends on: P1 Block 5 (built-in templates).
> Delivers: user templates loaded from `data/templates/`, with the built-in five remaining as fallback.

---

## 1. Purpose

The built-in templates are opinionated; users want their own. Let them drop a Markdown file into `data/templates/` and have it appear in the New-Document dialog, no restart required (best effort) and no code changes ever.

---

## 2. Scope

In scope:
- Second template directory: `data/templates/` (created at app start if missing).
- `TemplateRegistry` loads built-ins **and** user templates; user wins on `template_id` collision.
- `POST /api/admin/reload-templates` — reloads both directories, returns `{ loaded, skipped }`.
- Watcher: `chokidar` (already idiomatic in this codebase or added as a dep) watches `data/templates/` and triggers reload on change with a 500 ms debounce.
- Web "Templates" panel under Settings (new minimal Settings page) listing all templates with source (`built-in` / `user`), reload button, and a "Reveal in data dir" affordance (just shows the absolute path).
- `New Document` dialog already filters by type; nothing changes there except the list now includes user templates.

Out of scope:
- In-app template editor (the file is the editor).
- Template versioning.
- Sharing / import-export.

---

## 3. Design

### 3.1 Layout

```
data/templates/
  <template-id>.md
```

Each file uses the same frontmatter shape as built-ins (`template_id`, `template_name`, `type`). The filename is informational; the canonical id is `frontmatter.template_id`.

### 3.2 Registry changes

`TemplateRegistry` (Phase 1) already exposes `setAll(loaded)`. Refactor the startup flow:

```ts
async function loadAllTemplates(builtinDir, userDir, logger) {
  const builtin = await loadTemplatesFromDir(builtinDir);
  const user    = await loadTemplatesFromDir(userDir, { optional: true });
  // user wins on id collision; emit a warning when a built-in is overridden.
  const merged = new Map<string, Template>();
  for (const t of builtin.loaded) merged.set(t.id, t);
  for (const t of user.loaded) {
    if (merged.has(t.id)) logger.warn(`template ${t.id} overridden by user file`);
    merged.set(t.id, t);
  }
  return { loaded: [...merged.values()], skipped: [...builtin.skipped, ...user.skipped] };
}
```

`loadTemplatesFromDir(dir, { optional })` — when `optional`, a missing directory returns `{loaded:[], skipped:[]}` instead of throwing.

`TemplateSummary` gains a `source: 'builtin' | 'user'` field. Backwards-compatible: the field is optional and defaults to `'builtin'` for clients that don't read it.

### 3.3 Watcher

`chokidar.watch(userDir, { ignoreInitial: true })` triggers `loadAllTemplates` (debounced 500 ms). On reload, React Query invalidates the `['templates']` key via SSE or a polling hint? — Phase 2 chooses polling: `useTemplates` already runs with `staleTime: Infinity`; the reload endpoint *also* bumps an in-memory `revision` counter that `/api/templates` returns as a header `X-Templates-Revision`. The web side keeps the value and refetches when the topbar Reindex button is clicked. Auto-refresh in the UI is a Phase-3 nicety; the reload happens server-side regardless.

### 3.4 API

- `POST /api/admin/reload-templates` — runs `loadAllTemplates`, calls `registry.setAll(loaded)`, returns `{ loaded: number, skipped: Array<{file, reason}> }`.
- Existing `GET /api/templates` now includes the `source` field.

### 3.5 Web

- `packages/web/src/lib/admin.ts` — `useReloadTemplates()` mutation hook (uses the existing `DialogProvider` toast for "Reloaded 7 user templates").
- `packages/web/src/components/SettingsDialog.tsx` — opened from a topbar gear icon. Sections: "Theme" (moves the existing toggle here), "Reindex" (moves the existing button here), "Templates" (lists templates with source + reload button + path display).

The topbar stays uncluttered: theme toggle and Reindex move into Settings; the topbar grows a single Settings (gear) button instead.

---

## 4. Tasks

| # | Task | Files |
|---|------|-------|
| 1 | `loadTemplatesFromDir` `optional` mode + `source` field | `templates/registry.ts` |
| 2 | `loadAllTemplates` merge function | `templates/registry.ts`, `server.ts` |
| 3 | Add `chokidar` dep + watcher | `templates/watcher.ts`, `server.ts` |
| 4 | `POST /api/admin/reload-templates` | `routes/admin.ts` |
| 5 | `useReloadTemplates` hook | `packages/web/src/lib/admin.ts` |
| 6 | `SettingsDialog` + topbar gear button | `components/SettingsDialog.tsx`, `App.tsx` |
| 7 | `userTemplatesDir()` helper | `templates/registry.ts` |

---

## 5. Exit Criteria

- Dropping `data/templates/runbook.md` (valid frontmatter) makes it appear in `GET /api/templates` after a reload, with `source: "user"`.
- A user template with `template_id: design-document` overrides the built-in (built-in is logged as overridden but not removed from disk).
- Creating a document with that template substitutes placeholders as in Phase 1.
- Settings dialog lists every template with its source.
- `npm run typecheck && npm run lint && npm test && npm run build` green.

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| Chokidar adds a native dep on macOS | `chokidar` is pure JS; fsevents is optional. CI verifies install on linux + macOS. |
| Watcher loops on its own writes | Watcher only watches `data/templates/`; no service ever writes to that dir. |
| Invalid user template blocks startup | `loadTemplatesFromDir` skips invalid files (already Phase 1 behavior) and logs them; reload endpoint surfaces the same list. |
| Override clobbers a built-in unintentionally | The collision warning is surfaced in the Settings UI with a visual "overrides built-in" badge. |

---

## 7. Implementation Notes

### Architecture decisions

- **`source` field on `TemplateSummary` / `Template`**: Added to `@backlogger/shared` as `z.enum(['builtin','user']).default('builtin')` so both API and web share the same type. `loadTemplatesFromDir` accepts `opts.source` (defaults `'builtin'`).
- **`loadAllTemplates(builtinDir, userDir)`**: Parallel load; user wins on `template_id` collision with `console.warn`. Returns merged `{ loaded, skipped }`.
- **`watcher.ts`**: Thin chokidar wrapper with 500 ms debounce; calls `loadAllTemplates` + `registry.setAll` on any `add`/`change`/`unlink` inside `data/templates/`. Returns a cleanup function called in `shutdown()`.
- **Admin router refactor**: `adminRouter` now takes `AdminRouterOptions` object (reindex + template dirs) so the router is not coupled to positional args. `POST /api/admin/reload-templates` returns 501 when dirs are not configured (safe default for tests that don't set dirs).
- **`SettingsDialog`**: Single modal component consolidating theme toggle, reindex, and template management. Replaces the inline topbar buttons. Opened via a `⚙` gear button in the topbar.

### Key frontmatter field names

User template files must use `template_id` and `template_name` in frontmatter (not `id`/`name`). This is validated by `TemplateFrontmatterSchema`; invalid files are skipped and reported in the reload response's `skipped` array.

### Test approach

- `packages/api/src/templates/registry.test.ts`: Added `source`-field assertions on `loadTemplatesFromDir`, plus `loadAllTemplates` merge + user-wins-collision tests.
- `packages/api/src/app.test.ts`: New `describe('Templates API — user templates')` block wires a context with `builtinTemplatesDir` + `userTemplatesDir` to test reload endpoint (200 with counts), live pickup of a new user template, and 501 when dirs unconfigured.

### Metrics (Block 4 complete)

| Metric | Value |
|--------|-------|
| Tests | 134 / 134 passing |
| Initial gzip | 128.00 kB |
| Typecheck / lint | clean |
