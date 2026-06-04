# UI Conventions

Date: 2026-06-04

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
- `--focus`
- `--hover`
- `--selected`
- `--warning`

New styling should use tokens instead of hardcoded colors when possible.

## Buttons

Base button class:

```css
.btn
```

Current variants:

- `.btn--ghost`
- `.btn--danger`
- `.topbar-action`
- `.topbar-action--active`

Preferred direction:

- Reuse `.btn` for new command buttons.
- Add small variants only when repeated need exists.
- Keep destructive actions visibly dangerous.
- Preserve `:focus-visible` styling.

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
project sidebar | document workspace
```

The sidebar contains project tree and tag explorer.

The workspace contains editor, preview, and metadata panel.

Known limitation:

- Layout is desktop-first with fixed sidebar/metadata widths. If mobile support becomes a requirement, define responsive behavior before adding more panels.

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
