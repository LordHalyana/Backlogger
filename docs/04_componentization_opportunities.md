# Componentization Opportunities

## Summary

The frontend has a reasonable component split already. The best componentization opportunities are targeted: move shell dialog state out of `App.tsx`, isolate ProjectTree folder behavior, make reload/reindex feedback reusable, and keep modal form patterns consistent. Broad rewrites or a new UI framework would not help the assignment.

## Findings

### Finding 1: Shell dialog state can be grouped without changing UI behavior

**Priority:** Medium  
**Assignment relevance:** Helpful  
**Location:** `packages/web/src/App.tsx`

**Problem:**  
`App.tsx` manages booleans for command palette, settings, import, graph, help drawer, and help slug. The state itself is simple, but it creates repetitive open/close handlers and makes shell rendering long.

**Why it matters:**  
New shell overlays will likely add more state here. A small hook would make the shell easier to scan while preserving the current architecture.

**Suggested fix:**  
Extract `useShellOverlays` or similar with explicit methods: `openSettings`, `openHelp(slug?)`, `togglePalette`, `openImport`, `openGraph`, and close methods. Keep the returned object plain and local to the web app.

**Status:**  
Addressed on 2026-06-09. `packages/web/src/hooks/useShellOverlays.ts` now groups shell overlay booleans and explicit open/close/toggle methods; `App.tsx` still owns shell layout and passes the callbacks directly.

**Risk:**  
An over-abstract hook can hide simple UI flow. Keep names concrete and avoid a generic modal registry.

---

### Finding 2: ProjectTree mixes data preparation, folder actions, and rendering

**Priority:** Medium  
**Assignment relevance:** Helpful  
**Location:** `packages/web/src/components/ProjectTree.tsx`

**Problem:**  
`ProjectTree` fetches documents/folders, filters by tags, groups documents by folder, manages collapsed state, manages archive-section state, creates/deletes folders, renders tag chips, renders root documents, and opens the new document dialog.

**Why it matters:**  
Folder and archive behavior is central to mounted docs and filesystem browsing. Keeping all of it in one component makes future changes riskier.

**Suggested fix:**  
Extract the pure grouping logic into a small helper or hook such as `useProjectTreeGroups(projectId, docs, folders)`. Keep rendering in `ProjectTree`. Only extract folder mutation handlers if they grow further.

**Status:**  
Addressed on 2026-06-09. `ProjectTree` now uses a pure `buildProjectTreeGroups` helper in `packages/web/src/lib/project-tree-groups.ts`, with unit coverage for root docs, nested folders, archived folders, empty folders, and collapsed ancestors.

**Risk:**  
Moving JSX too aggressively can create prop drilling. Start with pure grouping logic because it is easy to test and low risk.

---

### Finding 3: Reload and reindex feedback should share a result display pattern

**Priority:** Medium  
**Assignment relevance:** Required  
**Location:** `packages/web/src/hooks/useReloadToast.ts`, `packages/web/src/lib/reindex.ts`, `packages/web/src/components/SettingsDialog.tsx`

**Problem:**  
Project reload and full reindex both produce counts and skipped files, but user feedback is mostly terse toast text. Mounted docs need clearer feedback when files are skipped.

**Why it matters:**  
The assignment goal depends on external docs appearing after mount/reload. Users need practical feedback when that does not happen.

**Suggested fix:**  
Create a small `ReindexResultSummary` component that can display counts and the first few skipped files. Use it in reload and settings reindex flows. Keep the component display-only; do not add a full job/history system.

**Status:**  
Addressed on 2026-06-11. `ReindexResultSummary` now provides the shared display pattern for project reload and full reindex results. It shows counts plus capped skipped-file details inside the existing alert dialog, keeping the component display-only and avoiding a job/history system.

**Risk:**  
Showing too much detail in a toast can clutter the UI. Use a dialog or expandable details area for skipped files.

---

### Finding 4: Modal shell is shared, but form sections are still ad hoc

**Priority:** Low  
**Assignment relevance:** Optional  
**Location:** `packages/web/src/components/Modal.tsx`, `packages/web/src/components/NewDocumentDialog.tsx`, `packages/web/src/components/ImportDialog.tsx`, `packages/web/src/components/SettingsDialog.tsx`, `packages/web/src/components/ProjectSwitcher.tsx`

**Problem:**  
The shared `Modal` handles shell layout, but individual modal forms repeat footer/button/status patterns.

**Why it matters:**  
Inconsistent modal structure can make small UI changes repetitive. It also affects accessibility and keyboard workflow if one modal diverges.

**Suggested fix:**  
Only extract small pieces that are clearly repeated, such as `ModalActions` or `FieldError`. Do not create a generic form builder.

**Status:**  
Addressed on 2026-06-09 for repeated modal footer markup. `Modal.tsx` now exports a tiny `ModalActions` wrapper, and create/import dialogs use it while keeping their form behavior local.

**Risk:**  
Generic modal form abstractions often make simple forms harder to maintain. Keep extraction incremental.

---

### Finding 5: DocumentWorkspace owns autosave, metadata, view mode, conflict, and delete flow

**Priority:** Medium  
**Assignment relevance:** Helpful  
**Location:** `packages/web/src/components/DocumentWorkspace.tsx`

**Problem:**  
`DocumentWorkspace` is responsible for editor buffer state, autosave, optimistic locking, dirty state, conflict reload, document delete confirmation, view mode, preview, metadata panel, and lazy editor loading.

**Why it matters:**  
This is a high-value component. Assignment reviewers are likely to inspect it because it represents the core app workflow. Keeping the autosave logic understandable is more important than minimizing lines.

**Suggested fix:**  
Extract a focused `useDocumentBuffer` hook only if working on autosave/conflict behavior. Keep rendering in `DocumentWorkspace`. Add tests around the hook if extracted.

**Status:**  
Addressed on 2026-06-09. Buffer/rebase/autosave state now lives in `packages/web/src/hooks/useDocumentBuffer.ts`, while `DocumentWorkspace` keeps rendering and delete/view-mode coordination. Focused regression tests cover same-version refetches and newer-version rebases.

**Risk:**  
Autosave bugs can lose work. Avoid cosmetic refactors here unless there is time for regression tests.

---

## Recommended Action Plan

1. Immediate fixes: keep ProjectTree grouping covered by focused tests when folder behavior changes.
2. Next cleanup pass: keep result summaries display-only unless a real background job history is added.
3. Optional improvements: leave modal forms local unless another repeated pattern appears.

## What Not To Do

- Do not introduce Redux, Zustand, or another state library for current UI state.
- Do not build a generic modal/form framework.
- Do not split `DocumentWorkspace` by line count alone.
- Do not componentize every repeated button before there is behavior worth sharing.
