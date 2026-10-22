---
id: ecf33ccb-2435-4fa9-aec5-089f80f26b2d
title: UI Conventions
project: backlogger-docs
type: design_doc
status: active
created_at: '2026-06-04T00:00:00.000Z'
updated_at: '2026-06-08T00:00:00.000Z'
tags: []
---

# UI Conventions

Date: 2026-06-09

## Scope

This document captures the current UI conventions. It does not define a full design system.

## Visual Direction

Backlogger is a dense document workspace. Favor compact, predictable controls over decorative layouts.

Use:

- restrained spacing
- readable text sizes
- clear focus states
- stable panel dimensions
- simple icon/text labels
- plain CSS variables

Avoid:

- marketing-style hero sections
- decorative gradients
- nested card layouts
- one-off button styling when `.btn` can work

## Theme Tokens

Theme tokens live in:

```text
packages/web/src/styles/theme.css
```

Current tokens include:

- `--bg`
- `--bg-elev`
- `--bg-panel`
- `--border`
- `--fg`
- `--fg-muted`
- `--accent`
- `--accent-fg`
- `--danger`
- `--ok`
- `--shadow`
- `--overlay-shadow`
- `--drawer-shadow`
- `--backdrop`
- `--backdrop-strong`
- `--backdrop-soft`
- `--tag-active-hover`
- `--focus`
- `--hover`
- `--selected`
- `--warning`

New styling should use tokens instead of hardcoded colors when possible.
Component styles should not add fallback color literals such as
`var(--border, #...)`; missing tokens should be fixed in `theme.css`.
Canvas-only graph colors live in `packages/web/src/lib/display.ts` with the
document type color map; do not redefine them inside graph components.

## CSS Organization

The app currently uses plain CSS:

```text
packages/web/src/styles/theme.css
packages/web/src/styles/app.css
packages/web/src/styles/project-tree.css
packages/web/src/styles/project-switcher.css
packages/web/src/styles/document-workspace.css
packages/web/src/styles/comments.css
packages/web/src/styles/markdown.css
packages/web/src/styles/links.css
packages/web/src/styles/command-palette.css
packages/web/src/styles/import.css
packages/web/src/styles/tags.css
packages/web/src/styles/settings.css
packages/web/src/styles/help.css
packages/web/src/styles/modal.css
packages/web/src/styles/graph.css
packages/web/src/styles/board.css
packages/web/src/styles/daily-work.css
packages/web/src/styles/recovery.css
```

Keep `theme.css` as the token source. `project-tree.css` owns the project
sidebar document tree and folder controls. `project-switcher.css` owns the
topbar project selector and read-only toggle. `document-workspace.css` owns the
editor/preview/metadata workspace surface and a backlog item's Description |
Comments tabs. `comments.css` owns the Comments tab: thread, reader pane and
docked composer. `markdown.css` owns shared rendered
Markdown body rules for document preview and help. `links.css` owns wiki-link
and backlinks styling. `command-palette.css` owns the search command overlay
and result rows. `import.css` owns import dialog file-list and result-summary
styles. `tags.css` owns tag chips, the sidebar tag explorer, filter bar, and
metadata tag input. `settings.css` owns settings-dialog content, `help.css`
owns the help drawer, `modal.css` owns the shared modal shell and standard
modal form/result-summary layout, `graph.css` owns the full-screen graph
overlay, and `board.css` owns the sidebar Documents | Board switch, the board
columns and cards, and the board's Undo notice. `daily-work.css` owns the
workspace rail, capture form and palette, ⌂ Inbox triage and the Current work
drawer. `recovery.css` owns the Recovery page, the recovery banner and the
recovery states on board cards, Current work rows and the task. The per-surface split is complete: `app.css` now holds only residual
app-shell and layout rules. Put new styles in the matching per-surface file and
keep `app.css` for shared shell/layout, preserving cascade order. Do not
introduce Tailwind, CSS-in-JS, CSS modules, or a component library for the
current assignment.

## Buttons

Base button class:

```css
.btn
```

Current variants:

- `.btn--primary` (the main action of a panel, such as Recheck)
- `.btn--ghost`
- `.btn--danger`
- `.btn--danger-solid` (confirms an irreversible choice, such as Abandon)
- `.btn--sm`
- `.btn--icon`
- `.btn--link`
- `.topbar-action`
- `.topbar-action--active`

Preferred direction:

- Reuse `.btn` for new command buttons.
- Add small variants only when repeated need exists.
- Keep destructive actions visibly dangerous.
- Preserve `:focus-visible` styling.
- Use icon-only buttons only for universally recognizable actions and always
  include `aria-label` and `title`.
- Use `packages/web/src/components/Icon.tsx` for local app icons instead of
  Unicode symbols or ad hoc text glyphs.
- Keep text labels for destructive, ambiguous, or workflow-changing actions.

## Modals And Dialogs

Use `Modal` for standard form dialogs:

- new document
- new project
- import
- settings

Use `DialogProvider` for promise-based confirm/prompt flows.

Use a drawer/overlay component only when the interaction is not a modal form, such as help or graph.

## Forms

Labels should wrap or clearly associate with inputs.

Use short helper text for validation rules that users need before submitting.

Errors should be shown near the failing form or field.

## Sidebar And Workspace

Current layout:

```text
topbar
rail | project sidebar | document workspace or board | Current work drawer (toggleable)
```

The rail (+ Capture, ⌂ Inbox, projects) and the Current work drawer come from
the daily-work milestone (spec #40, layout C). Below 900px the rail folds into
the topbar project switcher and the drawer overlays the workspace. The ⌂ mark
is a deliberate exception to "use `Icon.tsx` instead of Unicode symbols": the
spec makes it the only visual distinction of the designated Inbox, and it must
also appear inside `<option>` text.

The sidebar contains project tree and tag explorer.

The workspace contains editor, preview, and metadata panel.

Supported viewports:

- Backlogger is a desktop-first workspace. Mobile/touch layouts are explicitly out of
  scope for the current single-user assignment.
- Minimum supported width is **1024px**. The layout uses a fixed 280px project sidebar and a
  fixed 320px metadata panel, so the editor/preview area needs the remaining space to stay
  usable. Split view (editor + preview + metadata side by side) is most comfortable at
  **1280px and wider**; below 1024px, panels compress and the topbar actions can wrap.
- If mobile support later becomes a requirement, define responsive behavior (collapse the
  sidebar, move the metadata panel into a tab/drawer, reduce the topbar health text to a
  status indicator) before adding more panels.

## Markdown Preview

Markdown preview uses shared rendering from `packages/shared`.

Raw HTML is disabled in the renderer. If renderer settings change, revisit `docs/operations/security.md`.

## Accessibility

Minimum expectations:

- Buttons have text labels or `aria-label`.
- Modals use `role="dialog"` and `aria-modal`.
- Keyboard shortcuts do not block text entry.
- Focus restoration is preserved for modals.
- Interactive controls expose disabled state when pending.

## Encoding

Prefer ASCII for UI symbols unless there is a clear reason to use Unicode.

If Unicode is used, verify it renders correctly in source, browser, and docs.

Search for mojibake before release.
