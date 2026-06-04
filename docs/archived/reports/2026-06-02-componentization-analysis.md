---
id: b96dfc28-2812-4f38-a4ee-7bc8dd19f258
title: Componentization Analysis
project: backlogger-docs
type: finding
status: active
created_at: '2026-06-02T00:00:00.000Z'
updated_at: '2026-06-02T00:00:00.000Z'
tags: ["analysis", "components", "kiss"]
---

# Componentization Analysis

> Project: backlogger-docs
> Created: 2026-06-02

---

## Purpose

This report identifies what should become components or small hooks. The goal
is not to atomize the UI. Components should exist when they reduce real
duplication, clarify ownership, or make behavior easier to test.

---

## Key Principles Applied

| Principle | How it applies here |
|-----------|---------------------|
| YAGNI | Do not create generic components for one-off UI. |
| KISS | Small, concrete components beat broad abstractions. |
| Assignment Focus | Componentize workflows that are already present. |
| Professional Quality | Reusable UI should improve consistency and accessibility. |
| Maintainability | Pull out code when it has a stable responsibility. |

---

## Recommended Components

### 1. `Modal`

Current files:

- `packages/web/src/lib/dialog.tsx`
- `packages/web/src/components/NewDocumentDialog.tsx`
- `packages/web/src/components/ImportDialog.tsx`
- `packages/web/src/components/SettingsDialog.tsx`

Why:

The modal shell is repeated across feature dialogs. A shared shell would keep
role, backdrop behavior, title wiring, and spacing consistent.

Suggested API:

```tsx
<Modal title="New Document" onClose={onClose} className="new-document-modal">
  {content}
</Modal>
```

Keep form-specific logic inside each dialog.

Priority: High.

---

### 2. `TopbarAction`

Current file: `packages/web/src/App.tsx`

Why:

Topbar actions share structure but differ in labels, disabled state, and click
handlers. The current code is readable, but styling duplication is growing.

Suggested API:

```tsx
<TopbarAction label="Reload" disabled={reload.isPending} onClick={handleReload} />
```

This can also support optional icon slots later without changing every button.

Priority: Medium.

---

### 3. `FolderField`

Current files:

- `packages/web/src/components/NewDocumentDialog.tsx`
- `packages/web/src/components/ProjectTree.tsx`

Why:

Folder creation and folder selection are two faces of the same workflow. A
shared field can show existing folders, support "new folder", and provide
consistent validation feedback.

Suggested behavior:

- receives `projectId`
- lists folders through `useFolders`
- optionally allows creating a folder
- returns `undefined` for default placement

Priority: Medium.

---

### 4. `FolderTreeGroup`

Current file: `packages/web/src/components/ProjectTree.tsx`

Why:

`ProjectTree` owns grouping, folder rendering, root rendering, archived-section
rendering, folder deletion, and tag filter display. Extracting only the folder
row/group keeps the parent readable without splitting state too far.

Suggested props:

- `folder`
- `items`
- `collapsed`
- `depth`
- `manageFolders`
- `onToggle`
- `onDelete`
- `renderItem`

Priority: Medium.

---

### 5. `StatusMessage`

Current files:

- `ProjectTree.tsx`
- `DocumentWorkspace.tsx`
- `KnowledgeGraph.tsx`
- `CommandPalette.tsx`
- `HelpDrawer.tsx`

Why:

Loading, empty, and error states are scattered. A small component can keep
spacing, color, and accessibility consistent.

Suggested API:

```tsx
<StatusMessage kind="loading">Loading...</StatusMessage>
<StatusMessage kind="error">Failed to load: {message}</StatusMessage>
```

Priority: Low to Medium.

---

### 6. `DocumentTypeSelect` and `DocumentStatusSelect`

Current files:

- `packages/web/src/components/NewDocumentDialog.tsx`
- `packages/web/src/components/MetadataPanel.tsx`

Why:

Type and status options are stable domain concepts. Reusable selects help keep
labels aligned with shared schemas.

Recommendation:

Only extract these if another component needs the same controls. Today they are
low priority.

Priority: Low.

---

## Recommended Hooks

### 1. `useWikiLinkNavigation`

Current file: `packages/web/src/App.tsx`

Move delegated `.wiki-link` click handling into a hook. It can receive
`selectedProjectId`, cached titles, query client, and `openDocument`.

Priority: High.

### 2. `useGlobalShortcuts`

Current file: `packages/web/src/App.tsx`

Move Ctrl/Cmd+K and `?` help handling out of the root component.

Priority: Medium.

### 3. `useDocumentBuffer`

Current file: `packages/web/src/components/DocumentWorkspace.tsx`

The document buffer, dirty state, conflict handling, and debounced save logic
are coherent enough to become a hook. This would make `DocumentWorkspace`
mostly layout.

Priority: Medium, but only after current behavior has strong tests.

---

## What Should Stay As-Is

- `TagChip` is already appropriately small.
- API query hooks should remain explicit.
- `DocumentPreview` should stay a single component until preview behavior grows
  again.
- `KnowledgeGraph` should not be split unless graph behavior expands.

---

## Recommended Next Steps

1. Extract `Modal`.
2. Replace native folder dialogs using `useDialog` or `Modal`.
3. Extract `useWikiLinkNavigation`.
4. Add `TopbarAction` or shared topbar CSS.
5. Revisit `useDocumentBuffer` after tests cover save/conflict behavior.

