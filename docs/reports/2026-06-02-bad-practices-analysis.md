---
id: e0403581-21c0-4d31-a5d2-dac92c21ba40
title: Bad Practices Analysis
project: backlogger-docs
type: findings
status: active
created_at: '2026-06-02T00:00:00.000Z'
updated_at: '2026-06-02T00:00:00.000Z'
tags: ["analysis", "quality", "professional-quality"]
---

# Bad Practices Analysis

> Project: backlogger-docs
> Created: 2026-06-02

---

## Purpose

This report identifies practices that work today but lower professional quality
or increase maintenance risk. The standard here is practical: fix issues that
affect user experience, reliability, clarity, or future change cost.

---

## Key Principles Applied

| Principle | How it applies here |
|-----------|---------------------|
| YAGNI | Avoid process-heavy fixes for low-risk code. |
| KISS | Prefer direct cleanup over architecture rewrites. |
| Assignment Focus | Prioritize visible quality and correctness gaps in the existing app. |
| Professional Quality | Remove rough edges that make the product feel unfinished. |
| Maintainability | Make the next change easier to reason about. |

---

## Findings

### 1. Browser-native dialogs remain in folder management

File: `packages/web/src/components/ProjectTree.tsx`

`ProjectTree` uses `window.prompt`, `window.alert`, and `window.confirm` for
folder create/delete flows.

Why this is a bad practice:

- Native dialogs ignore the app theme.
- They block the browser thread.
- They are harder to test consistently.
- The repo already has `useDialog`, so this is inconsistent with existing
  infrastructure.

Recommended fix:

Use `useDialog().prompt`, `useDialog().confirm`, and `useDialog().toast`, or a
small folder dialog component. Keep the current behavior and validation rules;
only replace the interaction surface.

Priority: High.

---

### 2. Mojibake appears in source and docs

Examples:

- `packages/web/src/App.tsx`
- `packages/web/src/components/ProjectTree.tsx`
- `packages/web/src/components/NewDocumentDialog.tsx`
- `packages/web/src/components/MetadataPanel.tsx`
- `docs/docs-template.md`

Several strings show encoding damage, such as replacement text for ellipses,
arrows, quote marks, carets, and icons.

Why this is a bad practice:

- It creates an unprofessional UI.
- It makes docs harder to read.
- It can hide intent in comments and labels.

Recommended fix:

Normalize files to UTF-8 and replace damaged characters with ASCII where
possible:

- `...` instead of ellipsis.
- `>` / `v` or icon components instead of damaged caret glyphs.
- Straight quotes in Markdown docs.

Priority: High.

---

### 3. Global event handlers carry navigation responsibilities

File: `packages/web/src/App.tsx`

`App` handles global keyboard shortcuts, help toggling, wiki-link navigation,
project selection side effects, reload toasts, and graph/help/settings/import
dialog state.

Why this is a bad practice:

- The root component is becoming a workflow controller.
- Global click handling for `.wiki-link` depends on class names emitted by the
  markdown renderer.
- It is harder to test behavior without rendering the whole app.

Recommended fix:

Move global behaviors into small hooks:

- `useCommandPaletteShortcut`
- `useHelpShortcut`
- `useWikiLinkNavigation`
- `useReloadToast`

This keeps `App` as composition, not orchestration.

Priority: Medium.

---

### 4. `dangerouslySetInnerHTML` is used correctly but needs visible guardrails

Files:

- `packages/web/src/components/DocumentPreview.tsx`
- `packages/web/src/components/HelpDrawer.tsx`
- `packages/shared/src/markdown.ts`

Rendered Markdown is inserted with `dangerouslySetInnerHTML`. The shared
renderer is configured without raw HTML, which lowers risk. The practice is
acceptable here, but the safety assumption is distributed across files.

Why this matters:

- Future changes to Markdown rendering could accidentally enable raw HTML.
- Reviewers must know to check `packages/shared/src/markdown.ts`.

Recommended fix:

Add a short comment near the renderer configuration that raw HTML must remain
disabled, and add a regression test for script/html stripping or escaping.

Priority: Medium.

---

### 5. Type casts in graph rendering weaken type safety

File: `packages/web/src/components/KnowledgeGraph.tsx`

The graph component casts graph data to `never` and callback node payloads
through `unknown as GraphNode`.

Why this is a bad practice:

- It silences useful TypeScript feedback.
- Runtime shape mismatches become easier to miss.

Recommended fix:

Define adapter types for the `react-force-graph-2d` input and callbacks, then
convert API data into that view model. Keep the adapter local to
`KnowledgeGraph.tsx`.

Priority: Medium.

---

### 6. UI strings and domain options are scattered

Examples:

- Document type labels in `NewDocumentDialog.tsx`
- Status options in `MetadataPanel.tsx`
- Graph colors in `KnowledgeGraph.tsx`
- Button labels throughout `App.tsx`

Why this is a bad practice:

- Labels can drift from shared schemas.
- A small rename requires hunting across UI files.

Recommended fix:

Centralize stable display metadata in `packages/web/src/lib/display.ts` or
similar:

- document type labels
- status labels
- type colors

Do not centralize every string. Keep one-off button text local.

Priority: Low.

---

## Recommended Next Steps

1. Replace native folder dialogs.
2. Fix encoding damage in source and docs.
3. Add a Markdown-rendering safety test.
4. Extract root-level shortcut/navigation hooks from `App`.
5. Type the graph adapter instead of casting through `never`.

---

## What Not To Do

- Do not introduce localization infrastructure just to centralize a few labels.
- Do not remove `dangerouslySetInnerHTML` if the Markdown renderer remains
  controlled and tested.
- Do not rewrite the root app state into a global store unless a real shared
  state problem appears.

