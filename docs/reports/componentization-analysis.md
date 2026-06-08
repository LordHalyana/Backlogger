---
id: f6a1acb8-00ab-49f6-8ab3-7f478b0daf11
title: Componentization Analysis
project: backlogger-docs
type: finding
status: active
created_at: '2026-06-04T00:00:00.000Z'
updated_at: '2026-06-08T00:00:00.000Z'
tags: []
---

# Componentization Analysis

Date: 2026-06-04

## Scope

This report identifies UI and frontend logic that should become reusable components or hooks. It also calls out areas that should not be componentized yet because the added abstraction would not pay for itself.

## Executive Summary

The web app already has a healthy component split: `DocumentWorkspace`, `ProjectTree`, `KnowledgeGraph`, `CommandPalette`, `HelpDrawer`, and dialogs are separated by feature. The quick-win pass moved project creation onto the shared `Modal`. The next componentization step should focus on cohesive workspace state and reusable controls, not on fragmenting feature components.

## Recommended Components and Hooks

### 1. `WorkspaceShell` or `WorkspaceLayout`

Priority: Medium

Current code:

- `App.tsx` renders topbar, project sidebar, empty states, selected document workspace, and all overlays.

Why extract:

The layout is now a real product surface: topbar, sidebar, tags, document workspace, graph, import, help, settings. Extracting layout would make `App.tsx` more of a composition root and less of a feature owner.

Suggested shape:

- `App.tsx`: providers, theme, health, workspace selection.
- `WorkspaceLayout`: project sidebar plus selected document/empty state.
- `Topbar`: actions and health.

Keep state in hooks rather than adding a global store.

### 2. `useWorkspaceSelection`

Priority: Completed

> **Resolved (DF-F1):** Extracted to `packages/web/src/hooks/useWorkspaceSelection.ts`. It owns
> selected project/document/tags, clears document + tags on project change, handles removed
> document IDs after reload (`clearDocumentIfRemoved`), and exposes
> `openDocument(projectId, documentId)` plus `selectProject`/`selectDocument`/tag helpers. The
> old zero-delay `setTimeout` sequencing and `useProjectSelectionReset` were removed; project +
> document are now set in a single batched update. Dialog and health state were intentionally
> left in `App.tsx`. (URL sync added later in DF-F5.)

Current code:

- `App.tsx` manually coordinates selected project, selected document, selected tags, reset behavior, wiki-link navigation, command palette document opening, and reload removed-document handling.

Why extract:

This is domain state, not display state. The sequencing is subtle enough that it already uses a zero-delay timeout.

Suggested responsibilities:

- Select project.
- Select/open document.
- Clear document and tags on project change.
- Handle removed document IDs after reload.
- Provide `openDocument(projectId, documentId)`.

Do not include dialog state or health state in this hook.

### 3. Continue modal/control consistency after project creation cleanup

Priority: Low

Current code:

- `Modal.tsx` is used by `NewDocumentDialog`, `ImportDialog`, `SettingsDialog`, and `NewProjectDialog`.
- `DialogProvider` and `HelpDrawer` remain behavior-specific overlays.

Why extract:

The main modal duplication is gone. Remaining work is styling consistency across modal, prompt, drawer, and graph overlays.

Suggested action:

Keep behavior-specific overlays separate, but share control classes and accessibility conventions.

### 4. `Button` or stricter `.btn` usage

Priority: Medium

Current code:

- `TopbarAction.tsx` wraps topbar buttons.
- Other feature buttons directly use classes and ad hoc styles.

Why extract:

The existing `.btn` CSS system is underused. A React `Button` component may be useful, but it is not required if CSS classes are applied consistently.

Suggested minimal path:

- Keep `TopbarAction`.
- Add class variants for common sizes and semantic states.
- Use classes directly in components.

Only introduce a `Button.tsx` if class composition becomes noisy.

### 5. `SegmentedControl`

Priority: Completed

> **Resolved (CMP-5):** Added `packages/web/src/components/SegmentedControl.tsx`
> (`value`, `options`, `onChange`, `ariaLabel`, `className`) and adopted it for the document
> view-mode toggle in `DocumentWorkspace.tsx`. It centralizes the toggle-button ARIA
> (`role="group"` + `aria-pressed`) and adds arrow-key navigation with wrap-around. The
> per-toggle CSS was generalized from `.view-mode-*` to reusable `.segmented`/`.segmented-option`
> classes (`.view-mode-toggle` now only handles positioning). The `size` prop from the original
> suggestion was omitted per YAGNI — there is a single size today. Covered by
> `SegmentedControl.test.tsx` (4 tests).

Current code:

- `DocumentWorkspace.tsx` renders view mode buttons inline.
- CSS has `.view-mode-toggle` and `.view-mode-button`.

Why extract:

Segmented controls are likely to recur for editor/preview modes, graph filters, import options, and settings. This is a familiar UI primitive and keeps keyboard/ARIA behavior consistent.

Suggested props:

- `value`
- `options`
- `onChange`
- `ariaLabel`
- `size`

Start with the document view mode only.

### 6. `StatusBanner` / `InlineError`

Priority: Low

Current code:

- `StatusMessage` handles loading/empty/error blocks.
- `DocumentWorkspace` has conflict banner and save error.
- `ImportDialog`, `ProjectSwitcher`, `TagExplorer`, and others render ad hoc error paragraphs.

Why extract:

The app has multiple status styles. A small set of primitives would improve consistency without heavy design-system work.

Suggested shape:

- Keep `StatusMessage` for full-panel states.
- Add `InlineError` for field/dialog errors.
- Add `Banner` for conflict/reload/import result messages.

### 7. `TagInput`

Priority: Completed

> **Resolved (CMP-7):** Extracted to `packages/web/src/components/TagInput.tsx`
> (`value`, `onChange`, `disabled?`, `placeholder?`). It owns the chip rendering, input state,
> keyboard commit (Enter/comma/blur), and validation error display, while validation stays in
> the shared `TagSchema`/`normalizeTags`. `MetadataPanel.tsx` now renders `<TagInput>` and
> dropped its local tag state and the `TagChip`/`TagSchema` imports. Covered by
> `TagInput.test.tsx` (4 tests).

Current code:

- `MetadataPanel.tsx` contains tag chip rendering, input state, validation, keyboard behavior, and errors.
- `TagChip.tsx` is already reusable.

Why extract:

Tag input is distinct behavior and likely to be reused in search/filtering or creation workflows.

Suggested props:

- `value: string[]`
- `onChange(next)`
- `disabled?`
- `placeholder?`

Keep tag validation in shared `TagSchema` or a web helper.

### 8. `FolderPicker`

Priority: Low

Current code:

- `FolderField.tsx` exists for document creation folder selection.
- `ProjectTree.tsx` owns folder creation/deletion/collapsing.

Why extract:

Folder selection and folder management are related but distinct. Avoid merging them. A better `FolderPicker` could wrap `FolderField` only if folder choice appears in import or move flows.

Recommendation:

Keep as-is for now. Revisit when document move/rename is implemented.

## What Should Stay Feature-Local

### `KnowledgeGraph`

Do not split aggressively yet. It wraps a specialized canvas library and has feature-specific data mapping, filtering, and legend behavior. Extract only pure helpers if tests need them.

### `CommandPalette`

It is a feature component with keyboard behavior and active result state. Keep it whole unless command categories or actions expand.

### `DocumentEditor`

CodeMirror setup is inherently imperative. Keep it isolated in one component. Extracting small wrappers around CodeMirror before there is a second editor would be overengineering.

### `ProjectTree` folder rendering

`FolderTreeGroup` already handles a useful subset. Additional extraction should wait until move/rename/drag behavior exists.

## Suggested Componentization Order

1. ~~Create `useWorkspaceSelection`.~~ (done — DF-F1)
2. ~~Add `SegmentedControl` for document view mode.~~ (done — CMP-5)
3. ~~Extract `TagInput` from `MetadataPanel`.~~ (done — CMP-7)
4. Add `InlineError` and `Banner` only when touching dialogs/status flows.
5. Apply `docs/design/ui-conventions.md` when adding new UI.

## Principle Check

- YAGNI: Do not build a full design system yet.
- KISS: Extract components only where behavior repeats or state ownership is unclear.
- Assignment Focus: Improve maintainability around current features.
- Professional Quality: Shared primitives should improve accessibility and consistency.
- Maintainability: Keep feature components understandable and avoid premature micro-components.
