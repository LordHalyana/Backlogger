---
id: 221b047d-40ec-4ba2-824f-fcf53608724c
title: Styling and Theming Consistency Analysis
project: backlogger-docs
type: findings
status: active
created_at: '2026-06-02T00:00:00.000Z'
updated_at: '2026-06-02T00:00:00.000Z'
tags: ["analysis", "styling", "theming"]
---

# Styling and Theming Consistency Analysis

> Project: backlogger-docs
> Created: 2026-06-02

---

## Purpose

This report identifies styling and theming consistency issues in the web UI.
The app already has a practical token layer in `theme.css`; the next step is
to apply those tokens more consistently and reduce repeated one-off styling.

---

## Key Principles Applied

| Principle | How it applies here |
|-----------|---------------------|
| YAGNI | Do not build a full design system. |
| KISS | Prefer reusable CSS utilities and small components. |
| Assignment Focus | Improve the existing app surface without changing product scope. |
| Professional Quality | Remove visual rough edges and inconsistent controls. |
| Maintainability | Make future UI changes touch fewer selectors. |

---

## Findings

### 1. Button styles are repeated instead of tokenized

Files:

- `packages/web/src/styles/app.css`
- `packages/web/src/App.tsx`

Multiple button classes repeat the same values:

- background: `var(--bg-panel)`
- color: `var(--fg)`
- border: `1px solid var(--border)`
- border radius: `4px`
- padding: `4px 10px`
- hover border: `var(--accent)`

Recommendation:

Add base classes:

- `.btn`
- `.btn--sm`
- `.btn--ghost`
- `.btn--danger`
- `.topbar-action`

Then keep feature-specific classes only when layout requires them.

Priority: High.

---

### 2. Theme tokens are too few for current UI states

File: `packages/web/src/styles/theme.css`

Current tokens cover the basics: background, elevated background, panel,
border, foreground, muted foreground, accent, danger, ok, and shadow.

Missing tokens:

- warning
- focus ring
- hover background
- selected background
- disabled opacity or disabled foreground
- code background if different from panel
- graph-specific colors

Recommendation:

Add only the tokens currently needed:

```css
--focus: #...
--hover: #...
--selected: #...
--warning: #...
```

Avoid a large palette. The app needs consistency, not a brand system.

Priority: Medium.

---

### 3. Hard-coded colors bypass theme tokens

Files:

- `packages/web/src/styles/app.css`
- `packages/web/src/components/KnowledgeGraph.tsx`

Examples include graph node colors, `#e06c75`, `#5a1f1f`, `#ffd9d9`,
`#f87171`, and fallback slate colors.

Recommendation:

Move recurring semantic colors into theme tokens. Keep graph type colors local
if they are domain-specific, but align them with document type labels and
document badge colors.

Priority: Medium.

---

### 4. Controls use text where icons would scan better

Files:

- `packages/web/src/App.tsx`
- `packages/web/src/components/ProjectTree.tsx`
- `packages/web/src/components/MetadataPanel.tsx`

The app uses text actions such as Search, Import, Reload, Graph, Manage, Done,
Archive, Delete document, and Download. Text is fine for high-risk actions,
but dense toolbar actions should be icon-first or icon+text.

Recommendation:

For toolbar actions, use familiar icons with labels or tooltips:

- search
- import/upload
- reload
- graph
- settings
- help

Keep destructive actions text-based where clarity matters.

Priority: Low to Medium.

---

### 5. Modal sizing and spacing vary by feature

Files:

- `packages/web/src/styles/app.css`
- `packages/web/src/components/NewDocumentDialog.tsx`
- `packages/web/src/components/ImportDialog.tsx`
- `packages/web/src/components/SettingsDialog.tsx`

The base `.modal` has one width; settings overrides it. Feature dialogs add
their own internal spacing and table styles.

Recommendation:

After extracting a `Modal` shell, define modal size variants:

- default
- wide
- full-height drawer remains separate

Priority: Medium.

---

### 6. The graph overlay has a separate visual language

File: `packages/web/src/components/KnowledgeGraph.tsx`

The graph overlay uses different color values, naming, and visual density from
the document workspace. The graph is full-screen and visually distinct, but it
should still feel part of the same app.

Recommendation:

Map graph colors to document type display metadata and use shared tokens for
background, border, muted text, and error states. Keep only the force-graph
rendering logic unique.

Priority: Low.

---

## Recommended Next Steps

1. Add base button classes and migrate topbar buttons.
2. Add minimal missing theme tokens for focus, hover, selected, and warning.
3. Replace hard-coded semantic colors with tokens.
4. Normalize modal spacing through a shared `Modal` shell.
5. Align graph type colors with document type display metadata.

---

## What Not To Do

- Do not introduce Tailwind, CSS-in-JS, or a component library for this app.
- Do not replace all CSS at once.
- Do not make the UI decorative. Backlogger should remain a quiet,
  work-focused document tool.

