# Block 5 — Help & Documentation Center

> Parent: [../implementation_plan.md](../implementation_plan.md)
> Depends on: Phase 1 Block 6 (dialog primitives + markdown preview).
> Delivers: a built-in help drawer that teaches Markdown basics, wiki-links, tags, search, templates, projects, and import/export — without ever leaving the app.

---

## 1. Purpose

Make Backlogger learnable from inside Backlogger. New users should not have to read a README to discover that `[[Title]]` is a wiki-link or that `Ctrl+K` opens the command palette.

---

## 2. Scope

In scope:
- A slide-in **Help Drawer** anchored to the right of the viewport, opened by a header `?` button and by Settings → Help.
- Six sections matching the Phase-3 scope doc: Markdown Basics, Wiki Links, Tags, Search, Templates, Projects, Import & Export. (Seven titles, six conceptual chapters.)
- Content authored as Markdown files under `packages/web/src/help/` and rendered by the existing `markdown-it` preview pipeline (so `[[wiki-link]]`, code blocks, and tag chips render naturally).
- In-page search across the help content (uses the existing `useSearch` flow scoped to help docs only, no backend hit).
- Deep-link from any section to its anchor: `?help=wiki-links` opens the drawer at that section.
- Keyboard shortcut `?` (shift + `/`) opens the drawer.

Out of scope:
- Localization (English only for Phase 3).
- Embedded videos, GIFs, or interactive widgets (text + images only).
- Versioned help (single set of docs against the current build).
- Searchable across user content from the help drawer.
- Per-page tour / coach-mark walkthroughs.

---

## 3. Design

### 3.1 Content layout

```
packages/web/src/help/
  index.ts            # registers chapters in order
  markdown-basics.md
  wiki-links.md
  tags.md
  search.md
  templates.md
  projects.md
  import-export.md
```

Each `.md` file has frontmatter:

```yaml
---
slug: wiki-links
title: Wiki Links
order: 2
---
```

`index.ts` uses Vite's `import.meta.glob('./*.md', { as: 'raw', eager: true })` so the content is bundled at build time (no runtime fetch).

### 3.2 Component

`packages/web/src/components/HelpDrawer.tsx`:
- `<aside role="dialog" aria-label="Help">` sliding from the right (CSS transform).
- Left rail: chapter list (clickable, current chapter highlighted).
- Right pane: rendered Markdown via the existing `DocumentPreview` component.
- Top: a small search input that filters the chapter list by title and full-text using a precomputed lowercase-substring index.

### 3.3 Activation

- Topbar button `?` (tooltip "Help") next to Settings.
- Global hotkey `Shift+/` when no input has focus.
- Settings dialog grows a "Help" link that opens the drawer and closes settings.
- URL query param `?help=<slug>` opens the drawer at the matching chapter on initial load; clicking a chapter updates the URL without a reload.

### 3.4 Content guidelines

- Every example block must be valid Markdown that would render correctly inside Backlogger itself (no hand-waved syntax).
- Every keyboard shortcut is wrapped in `<kbd>` via a markdown-it extension we already ship (or inline HTML — `markdown-it` allows it by default for our trusted help content).
- Every cross-reference between chapters uses the deep-link query param.

---

## 4. Tasks

| # | Task | Files |
|---|------|-------|
| 1 | Help content (7 Markdown files + index) | `packages/web/src/help/*.md`, `index.ts` |
| 2 | `HelpDrawer` component + styles | `packages/web/src/components/HelpDrawer.tsx`, `styles/app.css` |
| 3 | Topbar `?` button + `Shift+/` hotkey | `packages/web/src/App.tsx` |
| 4 | Settings → Help link | `packages/web/src/components/SettingsDialog.tsx` |
| 5 | Query-param sync (`?help=<slug>`) | `packages/web/src/lib/help-link.ts` |
| 6 | Vitest: chapter index loads in expected order; deep-link resolves the right chapter | `HelpDrawer.test.tsx` |
| 7 | E2E: open via `?`, navigate two chapters, close with Esc | `e2e/help.spec.ts` |

---

## 5. Exit Criteria

- Pressing `?` (on a non-input focus) opens the drawer; Esc closes it.
- The drawer shows seven chapters in the documented order.
- Loading `/?help=tags` opens the drawer at the Tags chapter on first paint.
- Code samples render with syntax highlighting via the existing preview pipeline.
- All wiki-link examples in the help content render as `wiki-link`-styled anchors (no broken styling).
- Lighthouse a11y pass on the drawer ≥ 95.
- Bundle size delta: ≤ +35 kB gzip (mostly text content; we accept this within the +20 kB P3 budget headroom since import + export carry near-zero JS).

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| Help content drifts from the implementation | One owner per chapter; PRs that change a feature must update the corresponding chapter (CI lint: every chapter mentions at least one element in the corresponding `data-help-anchor` attribute on the actual feature). |
| Bundle bloat from text | Compressed Markdown is small; we benchmark via the bundle audit added in Phase 2. If we overshoot, switch from `import.meta.glob({ eager: true })` to lazy import of the drawer. |
| Markdown-it XSS via embedded HTML | Help content is part of the bundle, not user input; embedded HTML is allowed but reviewed in PR. |
| Hotkey `?` clashes with editor input | Listener checks `event.target` is not an input/textarea/contenteditable before firing. |

---

## 7. Implementation Notes (M5, 2026-06)

### 7.1 Content authored, in order
Seven chapters live under `packages/web/src/help/`:
`markdown-basics`, `wiki-links`, `tags`, `search`, `templates`, `projects`,
`import-export`. Order is driven by `order:` in each chapter's frontmatter
and validated by a unit test.

### 7.2 Frontmatter parsing in the browser
The design referenced `import.meta.glob('./*.md', { as: 'raw', eager: true })`.
Vite 5 deprecated `as: 'raw'` in favor of `query: '?raw', import: 'default'`,
so the registry uses the new form. Frontmatter is parsed by a minimal
inline parser in `help/index.ts` (string + number scalars only) — pulling
in `gray-matter` on the web bundle would have been ~25 kB for three
lines of YAML.

### 7.3 Renderer
Reuses `renderMarkdown` from `@backlogger/shared`. The shared renderer
has `html: false` so embedded `<kbd>` would be stripped — chapters use
backticked key sequences (e.g. `` `Ctrl+K` ``) instead. No separate
help-only renderer was introduced.

### 7.4 Drawer activation
- Topbar `?` button (added next to ⚙ Settings).
- Global `Shift+/` (`?`) hotkey, gated on `event.target` not being an
  input / textarea / contenteditable element.
- Settings → **Open Help** link (shipped as a new section in the dialog;
  the dialog gained an optional `onOpenHelp` prop).
- Deep link `?help=<slug>` opens the drawer at the matching chapter on
  initial paint; chapter switches update the URL via
  `history.replaceState` (no history pollution).

### 7.5 In-drawer search
The design called for "uses the existing `useSearch` flow scoped to help
docs only". Shipped simpler: a client-side substring filter over chapter
titles and bodies inside `HelpDrawer.tsx`. No new hook, no FTS, no
backend involvement.

### 7.6 Items deferred
- **`data-help-anchor` lint** (risks §6): not added. Help/feature drift
  will be caught by PR review for now.
- **Bundle audit budget check**: not measured; chapters total ~6 KB of
  raw Markdown, comfortably inside the ≤ +35 kB gzip budget.
- **Lighthouse a11y ≥ 95 pass**: not measured this milestone; drawer
  uses `role="dialog"`, `aria-modal`, `aria-label`, and labelled
  controls.

### 7.7 Test-suite collision
None this milestone (the `Help` button name is unique across topbar +
dialogs).

### 7.8 Files touched
- `packages/web/src/help/index.ts` — chapter registry + frontmatter parser.
- `packages/web/src/help/{markdown-basics,wiki-links,tags,search,templates,projects,import-export}.md` — chapter content (7 files).
- `packages/web/src/components/HelpDrawer.tsx` — drawer component.
- `packages/web/src/components/HelpDrawer.test.tsx` — 9 unit tests.
- `packages/web/src/components/SettingsDialog.tsx` — new `onOpenHelp` prop + Help section.
- `packages/web/src/lib/help-link.ts` — URL `?help=<slug>` sync.
- `packages/web/src/App.tsx` — topbar `?` button, `Shift+/` hotkey, drawer mount, settings wiring.
- `packages/web/src/styles/app.css` — `.help-button`, `.help-drawer*` styles.
- `e2e/help.spec.ts` — 2 e2e specs.

### 7.9 Test counts
- Unit: 160 → **169** (+9 in `HelpDrawer.test.tsx`).
- E2E: 11 → **13** (+2 in `help.spec.ts`).
