---
id: b7ac0e97-2478-49cd-8102-cb5f57d6b3bd
title: Styling And Theming Consistency Analysis
project: backlogger-docs
type: finding
status: active
created_at: '2026-06-04T00:00:00.000Z'
updated_at: '2026-06-08T00:00:00.000Z'
tags: []
---

# Styling and Theming Consistency Analysis

Date: 2026-06-04

## Scope

This report reviews CSS structure, theme tokens, UI consistency, accessibility styling, and product polish. It focuses on changes that keep the current plain-CSS approach rather than introducing a design framework.

## Executive Summary

The app has a good foundation: `theme.css` defines dark and light tokens, and `app.css` uses variables broadly. The quick-win pass fixed the most visible corrupted UI symbols and added `docs/design/ui-conventions.md`. The main issue remains scale and drift: `app.css` is about 1,643 lines and mixes global reset, layout, feature styles, modal styles, markdown styles, graph styles, tags, folders, help, settings, and command palette rules in one file.

## Findings

### 1. `app.css` is too large and mixed-responsibility

Priority: Medium

Evidence:

- `packages/web/src/styles/app.css` has about 1,643 lines.
- It contains shell layout, project tree, folders, document workspace, metadata panel, markdown preview, modal, toast, error boundary, graph overlay, import dialog, command palette, wiki links, tag chips, settings, and help drawer styles.

Why it matters:

One large CSS file makes style ownership unclear. New selectors are easier to add than to reuse. Feature styles can accidentally affect unrelated components.

Recommendation:

Split by responsibility, keeping plain CSS:

- `base.css`: body, typography, resets.
- `theme.css`: tokens only.
- `layout.css`: shell, topbar, project layout.
- `controls.css`: buttons, inputs, segmented controls, modal primitives.
- `document.css`: editor, preview, metadata.
- `sidebar.css`: project tree, folders, tags.
- `overlays.css`: command palette, help drawer, graph, dialogs/toasts.

Import them from `main.tsx` or a single `styles/index.css`.

### 2. Button styles are inconsistent

Priority: Medium

Evidence:

- `.btn` exists and is used by `TopbarAction`.
- Many buttons bypass it: project tree buttons, folder management buttons, settings buttons, modal buttons, download button, tag clear button, conflict banner button, error boundary buttons.

Why it matters:

This creates inconsistent hover, focus, disabled, line-height, sizing, and danger styles. It also increases CSS duplication.

Recommendation:

Expand the existing button class system and migrate gradually:

- `.btn`
- `.btn--sm`
- `.btn--ghost`
- `.btn--danger`
- `.btn--primary`
- `.btn--icon`
- `.btn--link`

Apply focus-visible styles consistently. Do not introduce a UI library.

### 3. Theme tokens are too minimal for current UI

Priority: Medium

Evidence:

- `theme.css` defines core colors: background, elevated background, panel background, border, foreground, muted foreground, accent, danger, ok, focus, hover, selected, warning.
- Feature CSS still uses fallback values and hardcoded colors such as `rgba(0, 0, 0, 0.45)`, `rgba(0 0 0 / 0.15)`, and graph fallback colors.

Why it matters:

The app has grown beyond the original token set. Without semantic tokens, every new feature chooses its own overlay, hover, chip, graph, and banner colors.

Recommendation:

Add a small semantic token layer:

- `--surface`
- `--surface-muted`
- `--overlay-backdrop`
- `--text-danger`
- `--text-success`
- `--control-bg`
- `--control-border`
- `--control-hover`
- `--banner-bg`
- `--graph-node-*` if graph colors should be theme-aware.

Keep primitive color tokens too, but use semantic tokens in components.

### 4. Raw glyph risk is reduced but not eliminated

Priority: Completed

> **Resolved (verify-only):** The high-visibility glyph/mojibake defects were fixed in the
> quick-win pass, and the standing convention is now documented in the "Encoding" section of
> `docs/design/ui-conventions.md` (prefer ASCII, verify any Unicode in source/browser/docs,
> search for mojibake before release). Future symbols are governed by that convention rather
> than fixed case-by-case.

Evidence:

- Settings, project-tree carets, and modal close text were converted to ASCII/text in the quick-win pass.
- Other UI/files may still contain Unicode symbols or corrupted comments.

Why it matters:

The highest-visibility defects are fixed. Future symbols should follow `docs/design/ui-conventions.md`.

Recommendation:

Keep using text/ASCII labels unless the project deliberately adds an icon library.

### 5. Form styles are scattered

Priority: Medium

Evidence:

- Modal form controls are styled under `.project-switcher select, .project-switcher button, .modal button, .modal input, .modal textarea`.
- Metadata panel inputs/selects have separate rules.
- Help drawer search, command palette input, graph filter, folder inputs, and tag input each have separate control styling.

Why it matters:

Inputs should feel like the same application. Today similar controls are similar but not governed by one primitive.

Recommendation:

Create classes:

- `.field`
- `.field-label`
- `.input`
- `.select`
- `.textarea`
- `.field-error`
- `.field-help`

Migrate new forms first. Do not rewrite every component at once.

### 6. Layout responsiveness needs explicit review

Priority: Completed

> **Resolved (ST-6):** Took the documented-scope path. `docs/design/ui-conventions.md` now
> states that Backlogger is desktop-first, mobile/touch is explicitly out of scope for the
> current single-user assignment, the **minimum supported width is 1024px**, split view is most
> comfortable at **≥1280px**, and it records the responsive plan (collapse sidebar, move
> metadata to a tab/drawer, reduce topbar health text) to follow if mobile becomes a
> requirement. No speculative responsive CSS was added.

Evidence:

- `project-layout` uses fixed `280px 1fr`.
- `metadata-panel` uses fixed `320px`.
- Help drawer uses `grid-template-columns: 220px 1fr`.
- Topbar contains many actions plus health text.

Why it matters:

The UI is dense and likely desktop-first. On narrow screens, fixed sidebars and topbar actions can overflow or compress.

Recommendation:

Define supported viewport targets. If mobile is in scope:

- Collapse project sidebar below a threshold.
- Let metadata panel become a tab/drawer.
- Reduce health text to status indicator in narrow topbars.

If mobile is not in scope, document minimum supported width.

### 7. Markdown preview styling is intentionally minimal but lacks theme depth

Priority: Completed

> **Resolved (ST-7):** Added compact, token-based `.markdown-body` styles for tables (bordered
> cells, panel-background header), blockquotes (left rule + muted text), images
> (`max-width: 100%`, rounded), unordered/ordered lists and task-list checkboxes, and horizontal
> rules. Also fixed `pre > code` so fenced code blocks no longer inherit the inline-chip
> padding/background. All colors use existing theme tokens, so dark/light themes are respected.
> Build verified; typography kept compact per the workspace direction.

Evidence:

- Markdown body headings, code, and pre blocks are styled.
- Tables, blockquotes, task lists, images, and horizontal rules are not clearly styled in `app.css`.

Why it matters:

Backlogger is a Markdown workspace. Preview quality affects perceived quality directly.

Recommendation:

Add modest Markdown styles for:

- Tables.
- Blockquotes.
- Images.
- Lists and task lists.
- Horizontal rules.

Keep typography compact; this is a workspace, not a marketing site.

## Suggested Cleanup Order

1. Add button/control CSS variants and apply them to new/changed components.
2. Split `app.css` by responsibility.
3. Add semantic theme tokens for overlays, controls, and banners.
4. ~~Review responsive behavior and document target viewport support.~~ (done — ST-6)
5. ~~Improve Markdown preview styling.~~ (done — ST-7)
6. ~~Continue cleanup of corrupted comments/docs.~~ (done — QW-6/7 + ui-conventions Encoding)

## Principle Check

- YAGNI: Keep plain CSS; no component library required.
- KISS: Build on existing CSS variables and `.btn`.
- Assignment Focus: Improve consistency where users see it.
- Professional Quality: UI symbols, focus states, and docs should be clean.
- Maintainability: Split CSS by ownership to reduce accidental drift.
