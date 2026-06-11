# Styling And Theming Consistency

## Summary

The styling approach is intentionally simple: plain CSS with theme variables. That fits the assignment. The maintainability problems are a large mixed-responsibility `app.css`, a few text-heavy controls where icons would be clearer, and styling rules that are hard to audit by feature. Cleanup should preserve plain CSS and improve organization, not introduce a design system.

## Findings

### Finding 1: `app.css` is large and mixes layout, components, and utilities

**Priority:** Medium  
**Assignment relevance:** Helpful  
**Location:** `packages/web/src/styles/app.css`

**Problem:**  
`app.css` is roughly 1,700 lines and contains shell layout, project tree, document workspace, metadata panel, graph, modal, tags, buttons, and responsive rules.

**Why it matters:**  
Large CSS files are hard to safely modify. Assignment-focused styling changes should be easy to review and should not risk unrelated surfaces.

**Suggested fix:**  
Split by feature only when touching styles: `shell.css`, `project-tree.css`, `document-workspace.css`, `modal.css`, and `graph.css`. Keep `theme.css` as the token source. Avoid CSS modules unless the project is already moving that way.

**Status:**  
Partially addressed on 2026-06-09. Project tree, project switcher, document workspace, Markdown rendering, wiki/backlink navigation, command palette, import dialog details, modal shell/form, graph overlay, tag controls, settings dialog, and help drawer rules now live in feature CSS files. The remaining `app.css` sections stay unsplit until those surfaces are actively changed, to avoid broad cascade churn.

**Risk:**  
Splitting CSS can change cascade order. Preserve import order and visually verify shell, tree, editor, dialogs, graph, and mobile layout.

---

### Finding 2: Theme tokens are good, but component-specific colors can drift

**Priority:** Medium  
**Assignment relevance:** Helpful  
**Location:** `packages/web/src/styles/theme.css`, `packages/web/src/styles/app.css`

**Problem:**  
The app has theme variables, but component styles can still hard-code emphasis, border, status, and hover treatments in `app.css`.

**Why it matters:**  
Dark/light theme consistency depends on every component using the same token vocabulary. Drift creates contrast bugs and one-off visual decisions.

**Suggested fix:**  
Audit `app.css` for raw color values and replace repeated meanings with existing tokens or a few new semantic tokens, such as danger, success, warning, focus, and muted border. Keep the token list short.

**Status:**  
Addressed on 2026-06-09. Repeated overlay, backdrop, drawer shadow, tag-hover, and stale color fallbacks now use theme tokens in `theme.css`. `app.css` no longer uses raw fallback colors for graph, archive restore, broken links, tree borders, modal backdrops, command palette overlays, or help drawer shadows. Canvas-only graph colors are centralized in `packages/web/src/lib/display.ts` beside the document type color map instead of being defined inside `KnowledgeGraph.tsx`.

**Risk:**  
Changing tokens affects many components at once. Verify contrast and hover/focus states in both themes.

---

### Finding 3: Some controls use text where stable icon buttons would scale better

**Priority:** Low  
**Assignment relevance:** Optional  
**Location:** `packages/web/src/components/SettingsDialog.tsx`, `packages/web/src/components/ProjectTree.tsx`, `packages/web/src/components/TopbarAction.tsx`

**Problem:**  
Buttons such as Settings, Manage, Done, archive labels, and theme toggle text are readable but can make compact toolbars crowded. The current design instructions prefer familiar icons for common actions where available.

**Why it matters:**  
Crowded topbar and sidebar controls are harder to scan as features are added. Mounted-project status and skipped-file feedback may add more controls.

**Suggested fix:**  
Use icon buttons only for universally recognizable actions like settings, help, add folder, search, graph, and theme. Keep text where the action is destructive or ambiguous. Add accessible labels and titles.

**Status:**  
Addressed on 2026-06-09 for common topbar/settings actions. Help, settings, graph, theme, and graph close now use the local `Icon` component with accessible labels/titles, while ambiguous actions such as import and reload remain text buttons.

**Risk:**  
Icons can reduce clarity if overused. Verify keyboard accessibility and screen-reader labels.

---

### Finding 4: Graph and modal styles live beside core app layout

**Priority:** Low  
**Assignment relevance:** Optional  
**Location:** `packages/web/src/styles/app.css`, `packages/web/src/components/KnowledgeGraph.tsx`, `packages/web/src/components/Modal.tsx`

**Problem:**  
Special surfaces like graph overlay and modal shell styles live in the same file as core app layout.

**Why it matters:**  
Graph and modal changes are visually sensitive and likely to need focused review. Keeping them in dedicated sections or files reduces accidental edits to unrelated layout.

**Suggested fix:**  
At minimum, add clearer section comments and keep related rules together. If splitting CSS, move graph and modal rules into their own files.

**Status:**  
Addressed on 2026-06-11. Graph overlay styles were moved to `packages/web/src/styles/graph.css`, and modal shell, dialog-message, and reindex-summary styles live in `packages/web/src/styles/modal.css`; both are imported after `app.css` to preserve override behavior. Graph filtering, link mapping, and third-party node adapters are now named helpers in `KnowledgeGraph.tsx`, keeping canvas integration details out of the JSX.

**Risk:**  
CSS order matters for overlay z-index, focus states, and responsive layout. Visual check required.

---

### Finding 5: Styling docs should stay aligned with actual CSS conventions

**Priority:** Low  
**Assignment relevance:** Helpful  
**Location:** `docs/design/ui-conventions.md`, `packages/web/src/styles/theme.css`, `packages/web/src/styles/app.css`

**Problem:**  
The UI conventions doc can drift from the actual CSS and component patterns. This is especially likely after style cleanup or if icon buttons are introduced.

**Why it matters:**  
Docs are used for assignment review and future maintenance. If they describe conventions the code does not follow, they add noise instead of guidance.

**Suggested fix:**  
After any styling cleanup, update `docs/design/ui-conventions.md` with only rules the app actually follows. Keep it short and concrete.

**Status:**  
Addressed on 2026-06-09. `docs/design/ui-conventions.md` now reflects the current token set, the plain-CSS organization, the rule against fallback color literals in component styles, and the limited icon-button guidance already used by the app.

**Risk:**  
Over-documenting style decisions creates another maintenance burden. Document only stable conventions.

---

## Recommended Action Plan

1. Immediate fixes: keep new component colors mapped through `theme.css` tokens.
2. Next cleanup pass: split remaining `app.css` sections only when changing those surfaces.
3. Optional improvements: replace a few common toolbar actions with accessible icon buttons.

## What Not To Do

- Do not introduce Tailwind, a component library, or CSS-in-JS for this assignment.
- Do not redesign the UI palette from scratch.
- Do not convert every text button to an icon.
- Do not split CSS without checking cascade order and responsive behavior.
