# Duplicated Code Analysis

Date: 2026-06-04

## Scope

This report reviews repeated implementation patterns across the React web app, Express API, shared schemas, scripts, tests, and docs. The goal is not to remove every repeated line. The goal is to remove repetition that increases maintenance cost, creates inconsistent behavior, or makes future changes risky.

## Executive Summary

Backlogger is still small enough that most duplication is tolerable. The quick-win pass removed one modal duplication by moving project creation onto the shared `Modal`. The remaining high-value cleanup is still a few narrow helpers where the same logic appears with small behavioral differences.

The main duplication clusters are:

- API route validation and async error wrapping.
- React Query keys and invalidation rules.
- Modal/dialog implementations, now reduced but not eliminated.
- Form/button CSS.
- Duplicate domain constants for document types and status.
- Documentation/template duplication.

## Findings

### 1. API validation and route wrappers repeat across routers

Priority: Medium

Evidence:

- `packages/api/src/routes/documents.ts` defines `parseProjectId`, `parseDocId`, and repeated `safeParse` error handling.
- `packages/api/src/routes/projects.ts` defines another `parseId` and repeats `VALIDATION_FAILED` construction.
- `packages/api/src/routes/import.ts`, `search.ts`, and `tags.ts` repeat the same pattern.
- Most async handlers manually wrap `try/catch` and call `next(err)`.

Why it matters:

The code is readable today, but new routes can easily return different error codes, omit `parsed.error.format()`, or forget `next(err)`. The graph unavailable route previously showed this drift by returning an ad hoc string error while the rest of the API usually returned `{ error: { code, message } }`.

Recommendation:

Add two small utilities:

- `validateBody(schema, body)` that throws `BadRequestError('VALIDATION_FAILED', ...)`.
- `asyncRoute(handler)` that catches rejected promises and forwards to Express.

Keep ID parsers explicit unless a third duplicated ID parser appears. Do not introduce a full routing framework.

### 2. React Query invalidation rules are scattered

Priority: Medium

Evidence:

- `packages/web/src/lib/documents.ts` invalidates documents, tags, and backlinks after updates/imports.
- `packages/web/src/lib/projects.ts` invalidates documents, tags, titles, backlinks, and removes document queries after reload.
- `packages/web/src/App.tsx` directly invalidates document queries after import.
- `packages/web/src/hooks/useWikiLinkNavigation.ts` invalidates title queries independently.

Why it matters:

Derived data is central to the app: document lists, title lookup, backlinks, tags, graph, and editor buffers. When a mutation changes one of these, every caller must remember the same cache fan-out. That is easy to miss as features grow.

Recommendation:

Create a tiny cache helper in `packages/web/src/lib/query-keys.ts` or `cache.ts`:

- Centralize keys: projects, documents(projectId), document(id), tags(projectId), titles(projectId), backlinks(documentId), graph(projectId).
- Provide focused invalidators such as `invalidateDocumentDerived(qc, projectId)` and `clearDocumentBuffers(qc)`.

Keep this as simple functions, not a state layer.

### 3. Modal duplication is reduced, but overlays still have multiple patterns

Priority: Low

Evidence:

- `packages/web/src/components/Modal.tsx` is the shared modal shell.
- `NewDocumentDialog`, `ImportDialog`, `SettingsDialog`, and `NewProjectDialog` use it.
- `lib/dialog.tsx` implements its own confirm/prompt modal host.
- `HelpDrawer.tsx` implements another overlay/backdrop model.

Why it matters:

The remaining separate hosts are justified by behavior: confirm/prompt resolve promises, and help is a drawer. The risk is now mostly shared styling/focus consistency.

Recommendation:

Leave `DialogProvider` separate for confirm/prompt. Do not force HelpDrawer into `Modal`; it is a drawer, not a modal form. Reuse shared button/control classes across these overlays.

### 4. Button and form styling is repeated in CSS

Priority: Medium

Evidence:

- `app.css` has a shared `.btn` system, but many controls still use feature-specific selectors:
  - `.project-tree-header button`
  - `.folder-add-btn`, `.folder-manage-btn`
  - `.settings-row button`
  - `.download-button`
  - `.tag-clear-btn`
  - `.modal button`
- `TopbarAction.tsx` uses `.btn`, but many other buttons recreate padding, borders, hover states, and disabled states.

Why it matters:

This duplication directly affects styling consistency. It also explains why buttons differ in size, line-height, hover color, and focus behavior.

Recommendation:

Expand the existing `.btn` system with a few practical variants:

- `.btn--sm`
- `.btn--icon`
- `.btn--danger`
- `.btn--link`
- `.btn--segmented`

Then migrate opportunistically when touching components. Avoid a large CSS rewrite.

### 5. Document type and status constants are duplicated

Priority: Medium

Evidence:

- `packages/shared/src/documents.ts` defines `DocumentTypeSchema` and `DocumentStatusSchema`.
- `packages/web/src/lib/display.ts` maps document types/statuses to labels and colors.
- `packages/api/src/services/import-service.ts` maintains its own `DOCUMENT_TYPES` array and `isDocumentStatus`.

Why it matters:

Adding a new document type requires edits in multiple places. The API import path can drift from shared validation.

Recommendation:

Export literal arrays from shared, for example `DOCUMENT_TYPES` and `DOCUMENT_STATUSES`, then derive zod enums and import-service guards from those. Keep display labels in the web app.

### 6. Documentation and built-in templates duplicate content

Priority: Low

Evidence:

- `docs/docs-template.md` and `packages/api/templates/docs-template.md` have overlapping content.
- README feature descriptions overlap with in-app help chapters.
- `docs/design/overview.md` and `docs/design/roadmap.md` both describe phases and repository layout, with some stale differences.

Why it matters:

The README was corrected, and new current docs now exist. The remaining drift is between older design docs, archived reports, built-in template docs, and in-app help.

Recommendation:

Declare one canonical source per topic:

- README: install, run, deploy, backup.
- `docs/design/overview.md`: current architecture and non-goals.
- `docs/design/roadmap.md`: future decisions only.
- In-app help: user workflow documentation.
- Template files: seed content only.

## What Not To Deduplicate

- Small colocated render helpers such as `renderItem` in `ProjectTree.tsx`; extracting them now would reduce readability.
- API service dependencies that are explicit in constructors; duplication there is mostly wiring, not logic.
- E2E user flows; repeated setup is acceptable if it keeps tests readable.

## Suggested Cleanup Order

1. Centralize React Query keys and derived-data invalidation.
2. Add the API `validateBody` helper and migrate only new or high-churn routes first.
3. Export document type/status literals from `shared`.
4. Gradually migrate repeated CSS button styles to `.btn` variants.
5. Keep current docs canonical and mark old phase docs as historical.

## Principle Check

- YAGNI: No new framework, no generated clients, no global state layer.
- KISS: Prefer small utilities with obvious call sites.
- Assignment Focus: Remove duplication that causes actual drift.
- Professional Quality: Make future behavior changes less error-prone.
- Maintainability: Keep local code readable; do not abstract one-off UI structure.
