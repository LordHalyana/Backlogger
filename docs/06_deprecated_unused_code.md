# Deprecated And Unused Code Analysis

## Summary

There is no obvious block of dead application code, but there are historical docs, compatibility paths, scripts, and examples that can mislead maintainers. Cleanup should separate "legacy but still active" from "obsolete and removable." The biggest current risk is not unused code execution; it is stale guidance pulling future work away from assignment goals.

## Findings

### Finding 1: Historical roadmap content remains active-looking

**Priority:** Medium  
**Assignment relevance:** Helpful  
**Location:** `docs/design/roadmap.md`, `docs/archived/README.md`, `docs/archived/backlogger_revised_roadmap.md`

**Problem:**  
`docs/design/roadmap.md` previously held a historical Phase 1 MVP implementation plan under active design docs, with old paths, ports, milestones, and scope details.

**Why it matters:**  
New contributors could treat historical scope as current requirements. That creates assignment drift and can lead to unnecessary features.

**Suggested fix:**  
Either move the old roadmap fully under `docs/archived/` or keep only a short active roadmap that points to current architecture, data storage, and assignment priorities.

**Status:**  
Addressed on 2026-06-09. `docs/design/roadmap.md` now contains a short current roadmap focused on mounted-docs reliability, maintainability cleanup, and documentation hygiene. The README status line now points to it as current priorities rather than a historical phase roadmap.

**Risk:**  
Replacing docs can break links from existing Backlogger docs. Keep the path stable and scan for stale references after changes.

---

### Finding 2: Legacy type-to-folder mapping is still active compatibility behavior

**Priority:** Low  
**Assignment relevance:** Optional  
**Location:** `packages/shared/src/documents.ts`, `packages/api/src/services/document-service.ts`, `packages/web/src/components/NewDocumentDialog.tsx`

**Problem:**  
`DOCUMENT_TYPE_TO_SUBDIR` maps document types to default folders when no explicit folder is supplied. Comments correctly call it legacy compatibility behavior.

**Why it matters:**  
This is not dead code. Removing it would break document creation flows that omit folders. But it can confuse maintainers because current folder management supports arbitrary folders.

**Suggested fix:**  
Keep it until all creation flows always send an explicit folder or root target. Add a regression test before removing it.

**Status:**  
Kept intentionally on 2026-06-11. The mapping remains active compatibility behavior, not dead code. API coverage verifies documents without explicit folders still route to the expected legacy folders, including ideas under `ideas/` and findings under `notes/`. The web New Document dialog now selects and sends the type default folder explicitly, with focused component coverage for the default idea folder and finding-to-notes default. The API fallback remains for older clients and scripts.

**Risk:**  
Removing it too early can change where new files are written and break user expectations.

---

### Finding 3: Seed/register docs scripts overlap in purpose

**Priority:** Medium  
**Assignment relevance:** Helpful  
**Location:** `scripts/seed-docs-project.ts`, `scripts/register-docs-project.ts`, `docs/operations/scripts.md`

**Problem:**  
Both scripts exist for dogfooding docs as a project. One copies/seeds docs into runtime data; the other registers a symlinked project in place. Their purposes are documented, but they overlap enough that a user could run the wrong one.

**Why it matters:**  
Scripts that touch runtime data can be destructive or confusing. Assignment quality benefits from clear, narrow maintenance scripts.

**Suggested fix:**  
Keep both only if both workflows are used. Otherwise prefer `register-docs` because it matches the mounted-docs direction. Add stronger warnings to `seed-docs` or mark it demo-only.

**Status:**  
Addressed on 2026-06-09. `docs/operations/scripts.md` now marks `register-docs` as the preferred local dogfooding workflow and `seed:docs` as demo-only. `scripts/seed-docs-project.ts` also carries the same warning in its header comment.

**Risk:**  
Removing a script may break package scripts or local dogfooding habits. Check `package.json` and docs before deleting.

---

### Finding 4: Old analysis reports were removed, but new top-level analysis docs should not become stale

**Priority:** Medium  
**Assignment relevance:** Required  
**Location:** `docs/01_duplicated_code_analysis.md` through `docs/08_documentation_cleanup.md`

**Problem:**  
The repo previously accumulated analysis reports that later became stale. This request reintroduces analysis docs in a new top-level format.

**Why it matters:**  
Analysis files are useful for assignment review, but they become harmful if treated as permanent truth after code changes.

**Suggested fix:**  
Treat these eight files as review artifacts. Refresh or archive them after the cleanup pass they describe. Do not keep adding new report folders for every review.

**Status:**  
Addressed for the current cleanup pass on 2026-06-09. The stale `docs/reports/` copies were removed, `docs/analysis-lifecycle.md` documents how to refresh/archive the eight active analysis files, and completed findings now carry dated status notes.

**Risk:**  
Deleting them too soon may remove assignment evidence. Keep them while they are actively used.

---

### Finding 5: Benchmark scripts are useful but not assignment-critical

**Priority:** Low  
**Assignment relevance:** Optional  
**Location:** `scripts/bench-search.ts`, `scripts/bench-graph.ts`, `scripts/bundle-audit.ts`, `package.json`

**Problem:**  
Bench and audit scripts support quality checks, but they are not core app behavior. They add maintenance cost around synthetic data and performance budgets.

**Why it matters:**  
For an assignment, benchmark scripts are only valuable if they are easy to run and documented. Otherwise they can distract from correctness and maintainability.

**Suggested fix:**  
Keep them because they are isolated. Do not expand them unless performance becomes a stated requirement. Ensure `docs/operations/scripts.md` stays accurate.

**Status:**  
Kept intentionally on 2026-06-09. The benchmark and bundle audit scripts are isolated npm scripts, documented in `docs/operations/scripts.md`, and not part of runtime behavior. No expansion is planned for the assignment cleanup.

**Risk:**  
Removing them can reduce confidence around search/graph regressions. Expanding them can waste time.

---

## Recommended Action Plan

1. Immediate fixes: keep temporary analysis docs refreshed while cleanup is active.
2. Next cleanup pass: remove the legacy fallback only if API compatibility is intentionally broken in a future version.
3. Optional improvements: archive the eight analysis files when the assignment review no longer needs them.

## What Not To Do

- Do not delete compatibility code just because it is old.
- Do not keep historical planning docs in active paths without a clear warning.
- Do not expand benchmark scripts into a full performance framework.
- Do not let analysis documents become permanent stale requirements.
