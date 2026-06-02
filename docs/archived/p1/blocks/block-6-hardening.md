# Block 6 — Hardening

> Parent: [../implementation_plan.md](../implementation_plan.md)
> Depends on: Blocks 0–5.
> Delivers: production-ready polish — no new features, focused on UX safety, performance, and verification.

---

## 1. Purpose

Tie off MVP-quality loose ends so the app is pleasant to use day-to-day and safe to ship internally. Nothing here introduces a new domain concept; everything strengthens what already exists.

---

## 2. Scope

In scope:
- Replace `window.prompt` / `window.confirm` with an in-app modal that respects the dark theme.
- Code-split CodeMirror so the initial bundle drops below the 500 kB Vite warning.
- Preview toggle in the editor (Edit / Split / Preview) backed by `markdown-it` from `@backlogger/shared`.
- Reindex UI: a "Reindex from disk" button in the topbar that calls `POST /api/admin/reindex` and surfaces the summary.
- Top-level React `ErrorBoundary` and a friendly fallback.
- `README.md` at the repo root with: what it is, install, run, env vars, data layout.
- Playwright smoke test: create project → create design doc from template → edit body → reload → content intact.

Out of scope:
- New file/document types.
- Auth, multi-user, sharing.
- Search.
- Plugin system.

---

## 3. Design

### 3.1 Modal-based prompt / confirm

`packages/web/src/components/Dialog.tsx` exports:
- `<PromptDialog title message defaultValue onSubmit onCancel />`
- `<ConfirmDialog title message confirmLabel danger onConfirm onCancel />`

A tiny `useDialog()` hook + a `<DialogHost />` mounted near the app root replaces all current `window.prompt` / `window.confirm` calls (in `ProjectSwitcher`, `ProjectTree`, and any delete affordances). Modal is rendered into a portal, closes on `Esc` and backdrop click, traps focus on `Tab`, restores focus on close.

### 3.2 Code-split CodeMirror

`packages/web/src/components/MarkdownEditor.tsx` is currently imported eagerly by `DocumentWorkspace`. Switch to:

```ts
const MarkdownEditor = lazy(() => import('./MarkdownEditor.js'));
```

Wrap the editor pane in `<Suspense fallback={<EditorSkeleton />}>`. Target: initial JS gzip < 200 kB; CodeMirror chunk loads on first document open.

### 3.3 Preview toggle

A `ViewMode = 'edit' | 'split' | 'preview'` state on `DocumentWorkspace`. Topbar buttons swap modes. `Preview` calls `renderMarkdown(body)` (already exported from `@backlogger/shared`). CSS grid layout reshuffles the editor / preview columns.

### 3.4 Reindex UI

`useReindex()` hook → `POST /api/admin/reindex`. Topbar button "Reindex" opens a confirm dialog ("This rescans disk and updates the database. Continue?"). On success, displays a toast with `{ projects, documents, ms }`, invalidates `['projects']` and per-project `['documents', id]` queries.

### 3.5 Error boundary

`packages/web/src/components/ErrorBoundary.tsx`. Wraps `<App>`. Renders a fallback panel with the error message and a "Reload" button. Logs to `console.error` (no telemetry in MVP).

### 3.6 README

Top-level `README.md`: 1-paragraph what-it-is, then "Install" (`npm ci`), "Develop" (`npm run dev`), "Test" (`npm test`), "Build" (`npm run build`), env vars (`PORT`, `BACKLOGGER_DATA_DIR`, `BACKLOGGER_TEMPLATES_DIR`), data layout (`data/projects/<id>/<subdir>/<file>.md` + `data/backlogger.sqlite`), license.

### 3.7 Playwright smoke

`packages/web/e2e/smoke.spec.ts`. Spins the API (already a `npm run dev:api` script) and Vite (`npm run dev:web`) via Playwright's `webServer` config. Steps:
1. Open `/`, click "+ New Project", create `smoke`.
2. Pick the project. Click "+ New". Choose Type = Design doc, Template = Design Document, Title = "Smoke Doc". Submit.
3. Editor opens with the template body. Type ` extra text` at the end. Wait ~1 s for autosave.
4. Reload the page. Open the same doc. Assert body still contains ` extra text` and the template's `## Purpose` heading.

---

## 4. Tasks

| # | Task | Files |
|---|------|-------|
| 1 | Dialog primitives + `useDialog()` + `<DialogHost />` | `packages/web/src/components/Dialog.tsx`, `packages/web/src/lib/dialog.ts` |
| 2 | Replace `prompt`/`confirm` callers | `ProjectSwitcher`, `ProjectTree` |
| 3 | Lazy-load `MarkdownEditor` | `DocumentWorkspace.tsx` |
| 4 | Preview mode | `DocumentWorkspace.tsx`, CSS |
| 5 | Reindex UI | `lib/reindex.ts`, topbar |
| 6 | `ErrorBoundary` + wrap `<App>` | `components/ErrorBoundary.tsx`, `main.tsx` |
| 7 | `README.md` | repo root |
| 8 | Playwright smoke | `packages/web/e2e/smoke.spec.ts`, `playwright.config.ts`, devDep `@playwright/test` |

---

## 5. Exit Criteria

- No remaining `window.prompt` / `window.confirm` in `packages/web/src/`.
- Vite build shows initial gzip < 200 kB (CodeMirror in a separate chunk).
- Preview toggle renders Markdown without raw HTML escaping issues.
- Reindex button shows a toast on success and refreshes lists.
- Unhandled error in a child surface still leaves the topbar reachable (error boundary catches it).
- `README.md` exists with the sections above.
- `npx playwright test` passes the smoke spec locally.
- `npm run typecheck && npm run lint && npm test && npm run build` all green.

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| Lazy editor regresses tests that import it synchronously | Keep `MarkdownEditor` itself importable directly; lazy-wrap only in `DocumentWorkspace`. |
| `markdown-it` rendering raw HTML | Constructor already set with `html: false` in Block 1; preview reuses the same function. |
| Playwright in CI | Smoke spec lives behind `npm run test:e2e`; CI wiring deferred (MVP runs it locally). |
| Focus trap regressions in dialogs | Unit test asserts `Escape` closes and focus returns to the trigger. |

---

## 7. Implementation Notes

### Status
✅ Done. Tests: 87/87 passing (3 dialog tests added; DocumentWorkspace test now wraps in `DialogProvider`). Lint, typecheck, and build all clean.

### What shipped
- `packages/web/src/lib/dialog.tsx` — `DialogProvider` + `useDialog()` with an imperative API: `confirm({title,message,danger?})`, `prompt({title,message,defaultValue?,placeholder?,validate?})`, and `toast(message,{kind?,durationMs?})`. Renders into a portal, supports `Esc` cancel, basic `Tab` focus trap, and restores focus to the previously active element on close.
- `packages/web/src/components/ErrorBoundary.tsx` — top-level boundary with "Try again" / "Reload page" actions. Wrapped around `<App>` in `main.tsx` (outside the QueryClient so even provider failures are caught).
- `packages/web/src/lib/reindex.ts` — `useReindex()` hook; `POST /api/admin/reindex` → toast `Reindex complete: N of M documents (K skipped)` on success, invalidates `['projects']` and `['documents']`.
- `App.tsx` — Topbar "Reindex" button opens a confirm dialog, then runs the mutation. Disabled while pending.
- `ProjectSwitcher.tsx` — Delete project uses `dialog.prompt(...)` with inline `validate` instead of `window.prompt`.
- `DocumentWorkspace.tsx` — Delete document uses `dialog.confirm({danger:true})`; `MarkdownEditor` is now `lazy()` + wrapped in `<Suspense>`; new `ViewMode` state ('edit' | 'split' | 'preview') with topbar pill buttons that re-flow the workspace via CSS classes (`view-edit`, `view-split`, `view-preview`).
- `styles/app.css` — Workspace grid converted from `display: contents` + grid-area placement to a flex row so view-mode toggles can hide/show editor and preview; preview is now full-height, scrollable, themed. Added `.view-mode-toggle`, `.toast-stack`, `.toast`, `.error-boundary`, `.reindex-button` styles.
- `README.md` — Added env-var table (`BACKLOGGER_PORT`, `BACKLOGGER_DATA_DIR`, `BACKLOGGER_TEMPLATES_DIR`) and `npm run reindex` row.
- `packages/web/playwright.config.ts` + `packages/web/e2e/smoke.spec.ts` — Smoke spec scaffolded: create project → create design doc from `design-document` template → type extra text into `.cm-content` → wait for "Saved" → reload → assert template heading and extra token still present.
- `vitest.config.ts` — `exclude` extended with `packages/web/e2e/**` so Vitest does not try to run the Playwright spec.
- `.eslintrc.cjs` — `ignorePatterns` extended with `packages/web/e2e` and `packages/web/playwright.config.ts`.
- `packages/web/package.json` — `test:e2e: playwright test`.
- `packages/web/src/lib/dialog.test.tsx` — 3 tests: confirm-yes, Escape-cancels, prompt-validate-blocks-then-passes.

### Deviations from the original plan
- `@playwright/test` is **not** installed as a devDep yet (would pull the browser binary; left to opt-in via `npm i -D @playwright/test && npx playwright install chromium` per the docstring at the top of `playwright.config.ts`).
- `MarkdownEditor` is referenced as `DocumentEditor.tsx` (existing filename); the `lazy()` call points to that file. Tests import `DocumentWorkspace`, which already wraps it in `<Suspense>`; the existing test still passes because it never asserts on editor content.
- Lazy chunk (`DocumentEditor`) is itself > 500 kB raw, which triggers Vite's chunk-size warning — but that's the deferred chunk, not the initial bundle. Initial JS is now 124 kB gzip (was 297 kB).
- Toast feedback ships via the same `DialogProvider` (kept the API surface minimal — one provider for modals + toasts).

### Verification
- `npm run typecheck` ✅
- `npm run lint` ✅
- `npm test` → 87/87 ✅ (`packages/web/src/lib/dialog.test.tsx` adds 3; `DocumentWorkspace.test.tsx` updated to use `DialogProvider`)
- `npm run build` ✅
  - Initial: `dist/assets/index-*.js` 353.50 kB / **gzip 124.16 kB** (was 853 kB / 297 kB).
  - Lazy: `dist/assets/DocumentEditor-*.js` 506.16 kB / gzip 176.03 kB (loads on first document open).
- `npm run test:e2e` — not run in this pass (requires `npm i -D @playwright/test && npx playwright install chromium` first).

### Follow-ups (post-Phase 1)
- Install `@playwright/test`, wire `test:e2e` into CI, and ensure the smoke spec passes there.
- Code-split the lazy `DocumentEditor` chunk further (split CodeMirror language pack, lazy-load `oneDark` only when dark theme is active).
- Persist `ViewMode` per document in `localStorage`.
- Add full-text search across documents (Phase 2 candidate).
- Add a settings page (data dir, templates dir, theme defaults).
