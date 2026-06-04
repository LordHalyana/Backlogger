---
id: 5af30ce7-44bf-4b2f-a57c-8a307c295fb5
title: Duplicated Code Analysis
project: backlogger-docs
type: finding
status: active
created_at: '2026-06-02T00:00:00.000Z'
updated_at: '2026-06-02T00:00:00.000Z'
tags: ["analysis", "maintainability", "kiss"]
---

# Duplicated Code Analysis

> Project: backlogger-docs
> Created: 2026-06-02

---

## Purpose

This report identifies repeated implementation patterns that are starting to
cost maintainability. The goal is not to remove every repeated line. Small,
local duplication is acceptable when it keeps the code simple. The priority is
duplication that creates inconsistent behavior, inconsistent styling, or
future bug-fix drift.

---

## Key Principles Applied

| Principle | How it applies here |
|-----------|---------------------|
| YAGNI | Do not introduce a broad design system or generic abstraction before repeated needs are clear. |
| KISS | Prefer a few small helpers and shared components over large framework-like rewrites. |
| Assignment Focus | Fix duplication that affects current requirements: documents, folders, search, tags, import/export, help, and graph. |
| Professional Quality | Shared patterns should improve consistency without hiding simple behavior. |
| Maintainability | Repeated code should stay only when the repeated code is easier to read than an abstraction. |

---

## Highest-Value Duplication

### 1. Topbar action buttons repeat structure and CSS

Files:

- `packages/web/src/App.tsx`
- `packages/web/src/styles/app.css`

The topbar defines separate button blocks for Search, Import, Reload, Graph,
Help, and Settings. The CSS then repeats the same base styles across selectors
such as `.search-button`, `.import-button`, `.reload-button`,
`.graph-button`, `.help-button`, and `.settings-button`.

Impact:

- A small visual change requires edits in several selectors.
- Hover and disabled behavior can drift between actions.
- Text-only buttons make the topbar harder to scan as more actions are added.

Recommended fix:

Create a small `TopbarActionButton` component or, more simply, a shared
`.topbar-action` CSS class with modifiers such as `.topbar-action--compact`
and `.topbar-action--danger` only when needed. Keep button behavior in place;
only centralize the repeated chrome.

Priority: High.

---

### 2. Modal shell markup is repeated

Files:

- `packages/web/src/lib/dialog.tsx`
- `packages/web/src/components/NewDocumentDialog.tsx`
- `packages/web/src/components/ImportDialog.tsx`
- `packages/web/src/components/SettingsDialog.tsx`

The app already has a `DialogProvider`, but feature dialogs still repeat the
same modal backdrop, modal container, heading, form, and action layout. This is
not a major bug today, but it is why accessibility details and sizing can vary.

Impact:

- Repeated `role="dialog"`, `aria-modal`, backdrop handling, and title wiring.
- Modal width and spacing drift by feature.
- Future focus-management fixes may only land in one dialog.

Recommended fix:

Extract a small `Modal` shell component:

- `title`
- `onClose`
- `children`
- optional `className`

Keep feature forms inside each component. Do not introduce a full modal
framework.

Priority: Medium.

---

### 3. Folder path handling is duplicated across UI and backend concerns

Files:

- `packages/web/src/components/ProjectTree.tsx`
- `packages/web/src/components/NewDocumentDialog.tsx`
- `packages/web/src/lib/folders.ts`
- `packages/shared/src/documents.ts`
- `packages/api/src/fs/path-resolver.ts`
- `packages/api/src/routes/projects.ts`

Backend validation is correctly centralized through `FolderPathSchema` and the
filesystem resolver. The UI, however, has multiple places that ask for or
display folder paths and relies on server errors for validation.

Impact:

- Folder creation in `ProjectTree` uses `window.prompt`, while document
  creation uses an inline field.
- Users get inconsistent feedback for the same invalid folder path.
- Backend is safe, but frontend ergonomics are inconsistent.

Recommended fix:

Create one `FolderSelect` or `FolderField` component for document creation and
folder management. Reuse the same placeholder, validation copy, and error
display. Keep canonical validation on the server.

Priority: Medium.

---

### 4. Loading, empty, and error states repeat by component

Files:

- `packages/web/src/components/ProjectTree.tsx`
- `packages/web/src/components/DocumentWorkspace.tsx`
- `packages/web/src/components/KnowledgeGraph.tsx`
- `packages/web/src/components/HelpDrawer.tsx`
- `packages/web/src/components/CommandPalette.tsx`

Several components hand-roll `Loading...`, empty text, and error messages.
This is normal in early development, but the app now has enough surfaces that
inconsistent state handling is visible.

Impact:

- Some states use `.muted`, some use `.error`, some use feature-specific
  classes.
- Loading text and failure text are not always as helpful as they could be.
- Accessibility attributes vary.

Recommended fix:

Add small presentational components such as `InlineStatus`, `EmptyState`, and
`PanelError`. Keep them boring: a class name, message, optional action.

Priority: Medium.

---

### 5. API query hook patterns are repeated but acceptable

Files:

- `packages/web/src/lib/documents.ts`
- `packages/web/src/lib/projects.ts`
- `packages/web/src/lib/folders.ts`
- `packages/web/src/lib/tags.ts`
- `packages/web/src/lib/templates.ts`
- `packages/web/src/lib/links.ts`

The TanStack Query hooks share structure: key constants, `apiFetch`, mutation,
and invalidation. This is repeated, but it is readable and explicit.

Impact:

- Low risk.
- A generic CRUD hook would likely hide important invalidation behavior.

Recommended fix:

Do not abstract aggressively. Only extract query-key constants and shared
mutation helpers when a concrete bug appears.

Priority: Low.

---

## Recommended Next Steps

1. Add shared CSS classes for topbar and standard buttons.
2. Extract a small modal shell and move `NewDocumentDialog`, `ImportDialog`,
   and `SettingsDialog` onto it.
3. Replace folder `window.prompt` and `window.confirm` with existing
   `useDialog` or the new modal shell.
4. Add one or two small state components for common loading/error/empty cases.
5. Leave service-layer and query-hook repetition alone unless a future change
   proves the duplication is harmful.

---

## What Not To Do

- Do not build a broad component library for this assignment.
- Do not create generic API-resource factories for every hook.
- Do not remove all duplication mechanically. Some duplication keeps intent
  clearer than an abstraction.

